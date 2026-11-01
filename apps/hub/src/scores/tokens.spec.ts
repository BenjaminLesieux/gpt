import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabaseHandle } from '../db/client';
import { addBandMember } from '../bands/bands';
import { accounts, bandMembers, bands, scoreTokens, scores } from '../db/schema';
import {
  listScoreTokens,
  mintScoreToken,
  readScoreToken,
  revokeScoreToken,
  touchScoreToken,
} from './tokens';

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
    // A token only resolves while its holder is in the score's band, so the
    // fixture has to say that they are — signup writes this row.
    handle.db.insert(bands).values({ id: 'band1', name: 'player', createdAt: new Date() }).run();
    addBandMember(handle.db, 'band1', 'acc1', 'owner');
    handle.db.insert(scores).values([
      { id: 'sc1', bandId: 'band1', name: 'Bridge rewrite', createdAt: new Date() },
      { id: 'sc2', bandId: 'band1', name: 'Untitled riff', createdAt: new Date() },
    ]).run();
  });

  afterEach(() => {
    handle?.close();
  });

  function addDrummer() {
    handle.db.insert(accounts).values({
      id: 'acc2',
      email: 'drummer@example.com',
      passwordHash: 'not-a-real-hash',
      createdAt: new Date(),
    }).run();
    addBandMember(handle.db, 'band1', 'acc2', 'member');
  }

  it('should store the hash of the token and not the token when minting', () => {
    // Given / When
    const minted = mintScoreToken(handle.db, 'sc1', 'acc1', 'companion');

    // Then
    const rows = handle.db.select().from(scoreTokens).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(minted.token);
    expect(rows[0].tokenHash).toBe(createHash('sha256').update(minted.token).digest('hex'));
  });

  it('should produce a token safe to send as a git basic-auth password', () => {
    // Given / When
    const { token } = mintScoreToken(handle.db, 'sc1', 'acc1', 'companion');

    // Then — a colon would split the header, and + / = would need escaping
    // in the clone URL the user pastes.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should mint a different token each time for the same score', () => {
    // Given / When
    const first = mintScoreToken(handle.db, 'sc1', 'acc1', 'companion');
    const second = mintScoreToken(handle.db, 'sc1', 'acc1', 'companion');

    // Then
    expect(first.token).not.toBe(second.token);
    expect(first.id).not.toBe(second.id);
  });

  it('should resolve the score, its band and its holder when the token is current', () => {
    // Given
    const { id, token } = mintScoreToken(handle.db, 'sc1', 'acc1', 'companion');

    // When
    const bearer = readScoreToken(handle.db, token);

    // Then — the git route needs both halves of the path in one lookup, and
    // the stamp it may be about to write without reading the row again.
    expect(bearer).toEqual({
      tokenId: id,
      scoreId: 'sc1',
      bandId: 'band1',
      holderId: 'acc1',
      lastUsedAt: null,
    });
  });

  it('should resolve a second band member with the band and themselves as holder', () => {
    // Given a second person in the band, with their own credential
    addDrummer();
    const { token } = mintScoreToken(handle.db, 'sc1', 'acc2', "Sam's ThinkPad");

    // When
    const bearer = readScoreToken(handle.db, token);

    // Then — the repository is in the band's namespace and the credential is
    // the drummer's. The git route needs both, under names it cannot swap.
    expect(bearer?.bandId).toBe('band1');
    expect(bearer?.holderId).toBe('acc2');
  });

  it('should resolve nothing for a token whose holder has left the band', () => {
    // Given
    addDrummer();
    const { token } = mintScoreToken(handle.db, 'sc1', 'acc2', "Sam's ThinkPad");

    // When the membership goes and the token row stays
    handle.db.delete(bandMembers).where(eq(bandMembers.accountId, 'acc2')).run();

    // Then — a credential is only ever as good as the membership behind it,
    // and this is the only place that is enforced.
    expect(readScoreToken(handle.db, token)).toBeNull();
    expect(handle.db.select().from(scoreTokens).all()).toHaveLength(1);
  });

  it("should resolve nothing for a token whose holder is in another band", () => {
    // Given a second band with its own score, and a token on it held by
    // somebody who is not in it
    addDrummer();
    handle.db.insert(bands).values({ id: 'band2', name: 'other', createdAt: new Date() }).run();
    handle.db.insert(scores).values({ id: 'sc3', bandId: 'band2', name: 'Theirs', createdAt: new Date() }).run();
    const { token } = mintScoreToken(handle.db, 'sc3', 'acc2', "Sam's ThinkPad");

    // When / Then — being in a band says nothing about any other band's scores.
    expect(readScoreToken(handle.db, token)).toBeNull();
  });

  it('should resolve nothing when the token was never issued', () => {
    // Given / When / Then
    expect(readScoreToken(handle.db, 'never-minted-this')).toBeNull();
  });

  it('should resolve only the score it was minted for', () => {
    // Given a token for one score and a second score in the same band
    const { token } = mintScoreToken(handle.db, 'sc1', 'acc1', 'companion');

    // When
    const bearer = readScoreToken(handle.db, token);

    // Then — this is the whole of the isolation guarantee: the route compares
    // this scoreId against the path and refuses anything else.
    expect(bearer?.scoreId).toBe('sc1');
    expect(bearer?.scoreId).not.toBe('sc2');
  });

  it('should stop resolving the token once revoked', () => {
    // Given
    const { id, token } = mintScoreToken(handle.db, 'sc1', 'acc1', 'companion');

    // When
    revokeScoreToken(handle.db, id);

    // Then
    expect(readScoreToken(handle.db, token)).toBeNull();
  });

  it('should leave a sibling token alone when one is revoked', () => {
    // Given
    const kept = mintScoreToken(handle.db, 'sc1', 'acc1', 'companion');
    const dropped = mintScoreToken(handle.db, 'sc1', 'acc1', 'companion');

    // When
    revokeScoreToken(handle.db, dropped.id);

    // Then
    expect(readScoreToken(handle.db, kept.token)?.tokenId).toBe(kept.id);
  });

  it('should drop the tokens when the score is deleted', () => {
    // Given
    mintScoreToken(handle.db, 'sc1', 'acc1', 'companion');

    // When
    handle.db.delete(scores).where(eq(scores.id, 'sc1')).run();

    // Then — revocation on delete is the cascade, not application code.
    expect(handle.db.select().from(scoreTokens).all()).toHaveLength(0);
  });

  it('should not claim a freshly minted token has ever been used', () => {
    // Given / When — this is the state every score is in the instant it is
    // created, because POST /scores mints inline with the row.
    const { id } = mintScoreToken(handle.db, 'sc1', 'acc1', "Ben's MacBook");

    // Then — issued is not installed, and nothing may render it as such.
    const summary = listScoreTokens(handle.db, ['sc1']).get('sc1')?.[0];
    expect(summary).toMatchObject({ id, lastUsedAt: null, lastPushedAt: null });
  });

  it('should record a connection without claiming a push', () => {
    // Given
    const { token } = mintScoreToken(handle.db, 'sc1', 'acc1', "Ben's MacBook");
    const bearer = readScoreToken(handle.db, token)!;

    // When — a clone or a fetch: the score reached the machine, but no
    // versions came back the other way.
    const at = new Date('2026-09-13T10:00:00Z');
    touchScoreToken(handle.db, bearer, false, at);

    // Then
    const summary = listScoreTokens(handle.db, ['sc1']).get('sc1')?.[0];
    expect(summary?.lastUsedAt).toEqual(at);
    expect(summary?.lastPushedAt).toBeNull();
  });

  it('should record both stamps when the request was a push', () => {
    // Given
    const { token } = mintScoreToken(handle.db, 'sc1', 'acc1', "Ben's MacBook");
    const bearer = readScoreToken(handle.db, token)!;

    // When
    const at = new Date('2026-09-13T10:00:00Z');
    touchScoreToken(handle.db, bearer, true, at);

    // Then — a push is activity and a connection both; only the first of
    // those should ever be read as someone working on the score.
    const summary = listScoreTokens(handle.db, ['sc1']).get('sc1')?.[0];
    expect(summary?.lastUsedAt).toEqual(at);
    expect(summary?.lastPushedAt).toEqual(at);
  });

  it('should skip the write when a connection was already recorded moments ago', () => {
    // Given a token used a few seconds back — one push is several requests,
    // and the retry queue in push.rs makes more.
    const { token } = mintScoreToken(handle.db, 'sc1', 'acc1', "Ben's MacBook");
    const first = new Date('2026-09-13T10:00:00Z');
    touchScoreToken(handle.db, readScoreToken(handle.db, token)!, false, first);

    // When the ref advertisement arrives five seconds later
    const bearer = readScoreToken(handle.db, token)!;
    touchScoreToken(handle.db, bearer, false, new Date('2026-09-13T10:00:05Z'));

    // Then — nothing worth a write happened; "2h ago" cannot tell.
    expect(listScoreTokens(handle.db, ['sc1']).get('sc1')?.[0].lastUsedAt).toEqual(first);
  });

  it('should record a push even when a connection was just recorded', () => {
    // Given the ref advertisement that always precedes a push
    const { token } = mintScoreToken(handle.db, 'sc1', 'acc1', "Ben's MacBook");
    const advertised = new Date('2026-09-13T10:00:00Z');
    touchScoreToken(handle.db, readScoreToken(handle.db, token)!, false, advertised);

    // When receive-pack follows a second later
    const pushed = new Date('2026-09-13T10:00:01Z');
    touchScoreToken(handle.db, readScoreToken(handle.db, token)!, true, pushed);

    // Then — the throttle must not swallow the one event that matters. Every
    // push begins inside the window the throttle covers.
    const summary = listScoreTokens(handle.db, ['sc1']).get('sc1')?.[0];
    expect(summary?.lastPushedAt).toEqual(pushed);
    expect(summary?.lastUsedAt).toEqual(pushed);
  });

  it('should keep each device’s activity to itself', () => {
    // Given a score on two machines, as cloning to a second one leaves it
    const laptop = mintScoreToken(handle.db, 'sc1', 'acc1', "Ben's MacBook");
    mintScoreToken(handle.db, 'sc1', 'acc1', 'Studio iMac');

    // When only one of them pushes
    const at = new Date('2026-09-13T10:00:00Z');
    touchScoreToken(handle.db, readScoreToken(handle.db, laptop.token)!, true, at);

    // Then — the studio machine has a credential and no activity, which is
    // exactly the difference the score list has to draw.
    const summaries = listScoreTokens(handle.db, ['sc1']).get('sc1') ?? [];
    expect(summaries.find((t) => t.name === "Ben's MacBook")?.lastPushedAt).toEqual(at);
    expect(summaries.find((t) => t.name === 'Studio iMac')?.lastPushedAt).toBeNull();
    expect(summaries.find((t) => t.name === 'Studio iMac')?.lastUsedAt).toBeNull();
  });

  it('should drop the scores and their tokens when the band is deleted', () => {
    // Given
    mintScoreToken(handle.db, 'sc1', 'acc1', 'companion');
    mintScoreToken(handle.db, 'sc2', 'acc1', 'companion');

    // When
    handle.db.delete(bands).run();

    // Then
    expect(handle.db.select().from(scores).all()).toHaveLength(0);
    expect(handle.db.select().from(scoreTokens).all()).toHaveLength(0);
  });

  it("should drop an account's tokens and leave the band's scores when the account is deleted", () => {
    // Given
    mintScoreToken(handle.db, 'sc1', 'acc1', 'companion');

    // When
    handle.db.delete(accounts).run();

    // Then — the scores are the band's, the credentials were the person's.
    expect(handle.db.select().from(scores).all()).toHaveLength(2);
    expect(handle.db.select().from(scoreTokens).all()).toHaveLength(0);
  });
});
