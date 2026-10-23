import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addBandMember, createBand } from '../bands/bands';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabase, HubDatabaseHandle } from '../db/client';
import { accounts, bands, scores } from '../db/schema';
import { newId } from '../ids';
import { listMemberScores, readMemberScore } from './members';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');

let handle: HubDatabaseHandle;
let db: HubDatabase;

/** An account, named only so a failing assertion says which one. */
function anAccount(db: HubDatabase, email: string): string {
  const id = newId();
  db.insert(accounts)
    .values({ id, email, passwordHash: 'not a real hash', createdAt: new Date() })
    .run();
  return id;
}

/** A score row in a band, and nothing else. */
function aScoreRow(db: HubDatabase, bandId: string, name: string, createdAt = new Date()): string {
  const id = newId();
  db.insert(scores).values({ id, bandId, name, createdAt }).run();
  return id;
}

beforeEach(() => {
  handle = openDatabase(':memory:');
  migrateToLatest(handle.db, MIGRATIONS);
  db = handle.db;
});

afterEach(() => {
  handle?.close();
});

describe('readMemberScore', () => {
  it('should give an owner their band’s score', () => {
    // Given
    const owner = anAccount(db, 'owner@example.com');
    const band = createBand(db, 'owner', owner);
    const score = aScoreRow(db, band, 'Bridge rewrite');

    // When
    const read = readMemberScore(db, score, owner);

    // Then
    expect(read).toMatchObject({ id: score, name: 'Bridge rewrite', bandId: band, role: 'owner' });
  });

  it('should give a member the band as bandId, never themselves', () => {
    // Given a band with a drummer in it
    const owner = anAccount(db, 'owner@example.com');
    const drummer = anAccount(db, 'drummer@example.com');
    const band = createBand(db, 'owner', owner);
    addBandMember(db, band, drummer, 'member');
    const score = aScoreRow(db, band, 'Bridge rewrite');

    // When
    const read = readMemberScore(db, score, drummer);

    // Then — the repository is at `<band>/<score>.git`, so every path and
    // clone url built from this row has to name the band.
    expect(read).toMatchObject({ bandId: band, role: 'member' });
    expect(read?.bandId).not.toBe(drummer);
  });

  it('should answer nothing for someone outside the band', () => {
    // Given
    const owner = anAccount(db, 'owner@example.com');
    const stranger = anAccount(db, 'stranger@example.com');
    const score = aScoreRow(db, createBand(db, 'owner', owner), 'Bridge rewrite');

    // When / Then — and the same nothing as for a score that never existed,
    // which is what keeps "no such score" and "not yours" indistinguishable
    // at every call site.
    expect(readMemberScore(db, score, stranger)).toBeNull();
    expect(readMemberScore(db, 'nosuchscoreid', stranger)).toBeNull();
  });

  it('should not give a member of one band a score of another', () => {
    // Given two bands, each with its own score
    const ben = anAccount(db, 'ben@example.com');
    const sam = anAccount(db, 'sam@example.com');
    const bensScore = aScoreRow(db, createBand(db, 'ben', ben), 'Bridge rewrite');
    const samsScore = aScoreRow(db, createBand(db, 'sam', sam), 'Drum solo');

    // When / Then
    expect(readMemberScore(db, samsScore, ben)).toBeNull();
    expect(readMemberScore(db, bensScore, sam)).toBeNull();
  });

  it('should answer nothing once the band is gone', () => {
    // Given
    const owner = anAccount(db, 'owner@example.com');
    const band = createBand(db, 'owner', owner);
    const score = aScoreRow(db, band, 'Bridge rewrite');

    // When
    db.delete(bands).where(eq(bands.id, band)).run();

    // Then — the cascade took the score with it.
    expect(readMemberScore(db, score, owner)).toBeNull();
    expect(db.select().from(scores).all()).toEqual([]);
  });
});

describe('listMemberScores', () => {
  it('should list every score of every band someone is in', () => {
    // Given a drummer with a band of their own, who is also in another
    const owner = anAccount(db, 'owner@example.com');
    const drummer = anAccount(db, 'drummer@example.com');

    const solo = createBand(db, 'drummer', drummer);
    const shared = createBand(db, 'owner', owner);
    addBandMember(db, shared, drummer, 'member');

    aScoreRow(db, solo, 'Drum solo', new Date(1_000));
    aScoreRow(db, shared, 'Bridge rewrite', new Date(2_000));
    aScoreRow(db, shared, 'Outro', new Date(3_000));

    // When
    const listed = listMemberScores(db, drummer);

    // Then — newest first, each carrying its band and the drummer's role in it.
    expect(listed.map((row) => row.name)).toEqual(['Outro', 'Bridge rewrite', 'Drum solo']);
    expect(listed[0]).toMatchObject({ bandId: shared, role: 'member' });
    expect(listed[1]).toMatchObject({ bandId: shared, role: 'member' });
    expect(listed[2]).toMatchObject({ bandId: solo, role: 'owner' });
  });

  it('should be empty for an account in no band', () => {
    // Given a score that belongs to somebody else's band
    const owner = anAccount(db, 'owner@example.com');
    const stranger = anAccount(db, 'stranger@example.com');
    aScoreRow(db, createBand(db, 'owner', owner), 'Bridge rewrite');

    // When / Then
    expect(listMemberScores(db, stranger)).toEqual([]);
    expect(listMemberScores(db, owner)).toHaveLength(1);
  });
});

describe('addBandMember', () => {
  it('should refuse to add the same person to a band twice', () => {
    // Given
    const owner = anAccount(db, 'owner@example.com');
    const drummer = anAccount(db, 'drummer@example.com');
    const band = createBand(db, 'owner', owner);
    addBandMember(db, band, drummer, 'member');

    // When / Then — the unique index, not a read-then-write. There is no
    // caller for which a silent second membership would be ordinary.
    expect(() => addBandMember(db, band, drummer, 'member')).toThrow();
  });
});
