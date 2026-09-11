import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabaseHandle } from '../db/client';
import { accounts, scoreTokens, scores } from '../db/schema';
import { mintScoreToken, readScoreToken, revokeScoreToken } from './tokens';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');

describe('score tokens', () => {
  let handle: HubDatabaseHandle;

  beforeEach(() => {
    handle = openDatabase(':memory:');
    migrateToLatest(handle.db, MIGRATIONS);

    handle.db.insert(accounts).values({
      id: 'acc1',
      email: 'player@example.com',
      passwordHash: 'not-a-real-hash',
      createdAt: new Date(),
    }).run();
    handle.db.insert(scores).values([
      { id: 'sc1', accountId: 'acc1', name: 'Bridge rewrite', createdAt: new Date() },
      { id: 'sc2', accountId: 'acc1', name: 'Untitled riff', createdAt: new Date() },
    ]).run();
  });

  afterEach(() => {
    handle.close();
  });

  it('should store the hash of the token and not the token when minting', () => {
    // Given / When
    const minted = mintScoreToken(handle.db, 'sc1', 'companion');

    // Then
    const rows = handle.db.select().from(scoreTokens).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(minted.token);
    expect(rows[0].tokenHash).toBe(createHash('sha256').update(minted.token).digest('hex'));
  });

  it('should produce a token safe to send as a git basic-auth password', () => {
    // Given / When
    const { token } = mintScoreToken(handle.db, 'sc1', 'companion');

    // Then — a colon would split the header, and + / = would need escaping
    // in the clone URL the user pastes.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should mint a different token each time for the same score', () => {
    // Given / When
    const first = mintScoreToken(handle.db, 'sc1', 'companion');
    const second = mintScoreToken(handle.db, 'sc1', 'companion');

    // Then
    expect(first.token).not.toBe(second.token);
    expect(first.id).not.toBe(second.id);
  });

  it('should resolve the score and its account when the token is current', () => {
    // Given
    const { id, token } = mintScoreToken(handle.db, 'sc1', 'companion');

    // When
    const bearer = readScoreToken(handle.db, token);

    // Then — the git route needs both halves of the path in one lookup.
    expect(bearer).toEqual({ tokenId: id, scoreId: 'sc1', accountId: 'acc1' });
  });

  it('should resolve nothing when the token was never issued', () => {
    // Given / When / Then
    expect(readScoreToken(handle.db, 'never-minted-this')).toBeNull();
  });

  it('should resolve only the score it was minted for', () => {
    // Given a token for one score and a second score in the same account
    const { token } = mintScoreToken(handle.db, 'sc1', 'companion');

    // When
    const bearer = readScoreToken(handle.db, token);

    // Then — this is the whole of the isolation guarantee: the route compares
    // this scoreId against the path and refuses anything else.
    expect(bearer?.scoreId).toBe('sc1');
    expect(bearer?.scoreId).not.toBe('sc2');
  });

  it('should stop resolving the token once revoked', () => {
    // Given
    const { id, token } = mintScoreToken(handle.db, 'sc1', 'companion');

    // When
    revokeScoreToken(handle.db, id);

    // Then
    expect(readScoreToken(handle.db, token)).toBeNull();
  });

  it('should leave a sibling token alone when one is revoked', () => {
    // Given
    const kept = mintScoreToken(handle.db, 'sc1', 'companion');
    const dropped = mintScoreToken(handle.db, 'sc1', 'companion');

    // When
    revokeScoreToken(handle.db, dropped.id);

    // Then
    expect(readScoreToken(handle.db, kept.token)?.tokenId).toBe(kept.id);
  });

  it('should drop the tokens when the score is deleted', () => {
    // Given
    mintScoreToken(handle.db, 'sc1', 'companion');

    // When
    handle.db.delete(scores).where(eq(scores.id, 'sc1')).run();

    // Then — revocation on delete is the cascade, not application code.
    expect(handle.db.select().from(scoreTokens).all()).toHaveLength(0);
  });

  it('should drop the scores and their tokens when the account is deleted', () => {
    // Given
    mintScoreToken(handle.db, 'sc1', 'companion');
    mintScoreToken(handle.db, 'sc2', 'companion');

    // When
    handle.db.delete(accounts).run();

    // Then
    expect(handle.db.select().from(scores).all()).toHaveLength(0);
    expect(handle.db.select().from(scoreTokens).all()).toHaveLength(0);
  });
});
