import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabaseHandle } from '../db/client';
import { accounts, sessions } from '../db/schema';
import {
  SESSION_TTL_MS,
  issueSession,
  purgeExpiredSessions,
  readSession,
  revokeSession,
} from './sessions';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');

describe('sessions', () => {
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
  });

  afterEach(() => {
    handle.close();
  });

  it('should store the hash of the token and not the token when issuing', () => {
    // Given / When
    const { token } = issueSession(handle.db, 'acc1');

    // Then — a copy of the file must not be a drawer of working cookies.
    const rows = handle.db.select().from(sessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('should issue a different token each time when called twice', () => {
    // Given / When
    const first = issueSession(handle.db, 'acc1');
    const second = issueSession(handle.db, 'acc1');

    // Then
    expect(first.token).not.toBe(second.token);
  });

  it('should resolve the account when the token is current', () => {
    // Given
    const { token } = issueSession(handle.db, 'acc1');

    // When
    const lookup = readSession(handle.db, token);

    // Then
    expect(lookup).toMatchObject({ status: 'valid', accountId: 'acc1' });
  });

  it('should report unknown when the token names no session', () => {
    // Given a token that was never issued — a tampered or forged cookie
    // When
    const lookup = readSession(handle.db, 'made-up-token');

    // Then
    expect(lookup.status).toBe('unknown');
  });

  it('should report expired when the session has run out', () => {
    // Given
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const { token } = issueSession(handle.db, 'acc1', issuedAt);

    // When
    const lookup = readSession(
      handle.db,
      token,
      new Date(issuedAt.getTime() + SESSION_TTL_MS + 1)
    );

    // Then — distinct from unknown: the caller did once hold a real session.
    expect(lookup.status).toBe('expired');
  });

  it('should delete the row when it reads an expired session', () => {
    // Given
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const { token } = issueSession(handle.db, 'acc1', issuedAt);

    // When
    readSession(handle.db, token, new Date(issuedAt.getTime() + SESSION_TTL_MS + 1));

    // Then
    expect(handle.db.select().from(sessions).all()).toHaveLength(0);
  });

  it('should still resolve the account one millisecond before expiry', () => {
    // Given
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const { token } = issueSession(handle.db, 'acc1', issuedAt);

    // When
    const lookup = readSession(
      handle.db,
      token,
      new Date(issuedAt.getTime() + SESSION_TTL_MS - 1)
    );

    // Then
    expect(lookup.status).toBe('valid');
  });

  it('should stop resolving the token when the session is revoked', () => {
    // Given
    const { token } = issueSession(handle.db, 'acc1');

    // When
    revokeSession(handle.db, token);

    // Then — revocation is a DELETE, which is the whole point of opaque ids.
    expect(readSession(handle.db, token).status).toBe('unknown');
  });

  it('should leave other sessions alone when one is revoked', () => {
    // Given
    const kept = issueSession(handle.db, 'acc1');
    const dropped = issueSession(handle.db, 'acc1');

    // When
    revokeSession(handle.db, dropped.token);

    // Then
    expect(readSession(handle.db, kept.token).status).toBe('valid');
  });

  it('should collect abandoned sessions when purging', () => {
    // Given one session nobody will ever present again, and one live
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    issueSession(handle.db, 'acc1', issuedAt);
    const live = issueSession(handle.db, 'acc1');

    // When
    const collected = purgeExpiredSessions(
      handle.db,
      new Date(issuedAt.getTime() + SESSION_TTL_MS + 1)
    );

    // Then
    expect(collected).toBe(1);
    expect(readSession(handle.db, live.token).status).toBe('valid');
  });
});
