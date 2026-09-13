import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabase, HubDatabaseHandle } from '../db/client';
import { accounts, scoreMembers, scores } from '../db/schema';
import { newId } from '../ids';
import { addScoreMember, listMemberScores, readMemberScore } from './members';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');

/** The last migration before the one that introduced membership. */
const BEFORE_MEMBERS = 3;

let handle: HubDatabaseHandle;
let db: HubDatabase;
let temporaries: string[];

/** An account, named only so a failing assertion says which one. */
function anAccount(db: HubDatabase, email: string): string {
  const id = newId();
  db.insert(accounts)
    .values({ id, email, passwordHash: 'not a real hash', createdAt: new Date() })
    .run();
  return id;
}

/** A score row and nothing else — no membership, as before 0004. */
function aScoreRow(db: HubDatabase, ownerId: string, name: string, createdAt = new Date()): string {
  const id = newId();
  db.insert(scores).values({ id, accountId: ownerId, name, createdAt }).run();
  return id;
}

beforeEach(() => {
  temporaries = [];
  handle = openDatabase(':memory:');
  migrateToLatest(handle.db, MIGRATIONS);
  db = handle.db;
});

afterEach(async () => {
  handle.close();
  await Promise.all(temporaries.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('readMemberScore', () => {
  it('should give an owner their score', () => {
    // Given
    const owner = anAccount(db, 'owner@example.com');
    const score = aScoreRow(db, owner, 'Bridge rewrite');
    addScoreMember(db, score, owner, 'owner');

    // When
    const read = readMemberScore(db, score, owner);

    // Then
    expect(read).toMatchObject({ id: score, name: 'Bridge rewrite', ownerId: owner, role: 'owner' });
  });

  it('should give a member the owner as ownerId, never themselves', () => {
    // Given a score shared with a drummer
    const owner = anAccount(db, 'owner@example.com');
    const drummer = anAccount(db, 'drummer@example.com');
    const score = aScoreRow(db, owner, 'Bridge rewrite');
    addScoreMember(db, score, owner, 'owner');
    addScoreMember(db, score, drummer, 'member');

    // When
    const read = readMemberScore(db, score, drummer);

    // Then — the repository is still at `<owner>/<score>.git`, so every path
    // and clone url built from this row has to name the owner. Answering with
    // the caller's own id here points them at a repository that is not there.
    expect(read).toMatchObject({ ownerId: owner, role: 'member' });
    expect(read?.ownerId).not.toBe(drummer);
  });

  it('should answer nothing for someone who is not a member', () => {
    // Given
    const owner = anAccount(db, 'owner@example.com');
    const stranger = anAccount(db, 'stranger@example.com');
    const score = aScoreRow(db, owner, 'Bridge rewrite');
    addScoreMember(db, score, owner, 'owner');

    // When / Then — and the same nothing as for a score that never existed,
    // which is what keeps "no such score" and "not yours" indistinguishable
    // at every call site.
    expect(readMemberScore(db, score, stranger)).toBeNull();
    expect(readMemberScore(db, 'nosuchscoreid', stranger)).toBeNull();
  });

  it('should answer nothing for a score whose row is gone', () => {
    // Given a membership whose score has been deleted
    const owner = anAccount(db, 'owner@example.com');
    const score = aScoreRow(db, owner, 'Bridge rewrite');
    addScoreMember(db, score, owner, 'owner');
    db.delete(scores).where(eq(scores.id, score)).run();

    // When / Then — the cascade took the membership with it.
    expect(readMemberScore(db, score, owner)).toBeNull();
    expect(db.select().from(scoreMembers).all()).toEqual([]);
  });
});

describe('listMemberScores', () => {
  it('should list the scores someone owns and the ones they were added to', () => {
    // Given one score of their own and one of somebody else's
    const owner = anAccount(db, 'owner@example.com');
    const drummer = anAccount(db, 'drummer@example.com');

    const theirs = aScoreRow(db, drummer, 'Drum solo', new Date(1_000));
    addScoreMember(db, theirs, drummer, 'owner');

    const shared = aScoreRow(db, owner, 'Bridge rewrite', new Date(2_000));
    addScoreMember(db, shared, owner, 'owner');
    addScoreMember(db, shared, drummer, 'member');

    // When
    const listed = listMemberScores(db, drummer);

    // Then — newest first, and the shared one carries the owner's id.
    expect(listed.map((row) => row.name)).toEqual(['Bridge rewrite', 'Drum solo']);
    expect(listed[0]).toMatchObject({ ownerId: owner, role: 'member' });
    expect(listed[1]).toMatchObject({ ownerId: drummer, role: 'owner' });
  });

  it('should be empty for an account with no memberships', () => {
    // Given a score that belongs to somebody else
    const owner = anAccount(db, 'owner@example.com');
    const stranger = anAccount(db, 'stranger@example.com');
    const score = aScoreRow(db, owner, 'Bridge rewrite');
    addScoreMember(db, score, owner, 'owner');

    // When / Then
    expect(listMemberScores(db, stranger)).toEqual([]);
    expect(listMemberScores(db, owner)).toHaveLength(1);
    expect(score).toBeTruthy();
  });
});

describe('addScoreMember', () => {
  it('should refuse to add the same person to a score twice', () => {
    // Given
    const owner = anAccount(db, 'owner@example.com');
    const drummer = anAccount(db, 'drummer@example.com');
    const score = aScoreRow(db, owner, 'Bridge rewrite');
    addScoreMember(db, score, owner, 'owner');
    addScoreMember(db, score, drummer, 'member');

    // When / Then — the unique index, not a read-then-write. There is no
    // caller for which a silent second membership would be ordinary.
    expect(() => addScoreMember(db, score, drummer, 'member')).toThrow();
  });
});

/**
 * The migration is the risk in this change: it runs once, against a database
 * that already has scores in it, and getting it wrong means every existing
 * score disappears from the only account that can reach it.
 *
 * So this runs the real file rather than asserting about it. The journal is
 * truncated to what shipped before `0004_score_members`, scores are written
 * the way they existed then — a row and no membership — and only then is the
 * full journal put back and the migration allowed to run.
 */
describe('the 0004 backfill', () => {
  /** A copy of the migrations folder whose journal stops at `idx`. */
  async function migrationsUpTo(idx: number): Promise<string> {
    const folder = await mkdtemp(path.join(tmpdir(), 'gpt-migrations-'));
    temporaries.push(folder);
    await cp(MIGRATIONS, folder, { recursive: true });

    const journal = JSON.parse(
      await readFile(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')
    ) as { entries: { idx: number }[] };
    journal.entries = journal.entries.filter((entry) => entry.idx <= idx);
    await writeFile(path.join(folder, 'meta', '_journal.json'), JSON.stringify(journal));

    return folder;
  }

  let old: HubDatabaseHandle;

  beforeEach(async () => {
    // A database at the schema that shipped before membership existed.
    old = openDatabase(':memory:');
    migrateToLatest(old.db, await migrationsUpTo(BEFORE_MEMBERS));
  });

  afterEach(() => old.close());

  it('should leave every score that already existed visible to its owner', async () => {
    // Given two accounts with scores, written before there was a members table
    const ben = anAccount(old.db, 'ben@example.com');
    const sam = anAccount(old.db, 'sam@example.com');
    const bridge = aScoreRow(old.db, ben, 'Bridge rewrite', new Date(1_000));
    const solo = aScoreRow(old.db, ben, 'Drum solo', new Date(2_000));
    const theirs = aScoreRow(old.db, sam, 'Something else', new Date(3_000));

    // And no memberships, because the table is not there yet
    expect(() => old.db.select().from(scoreMembers).all()).toThrow();

    // When the migration runs
    migrateToLatest(old.db, MIGRATIONS);

    // Then every score is still reachable by the person who made it, and by
    // nobody else.
    expect(listMemberScores(old.db, ben).map((row) => row.name)).toEqual([
      'Drum solo',
      'Bridge rewrite',
    ]);
    expect(listMemberScores(old.db, sam).map((row) => row.name)).toEqual(['Something else']);
    expect(readMemberScore(old.db, bridge, sam)).toBeNull();
    expect(readMemberScore(old.db, theirs, ben)).toBeNull();
    expect(readMemberScore(old.db, solo, ben)).toMatchObject({ ownerId: ben, role: 'owner' });
  });

  it('should make the backfilled person an owner, dated to the score', async () => {
    // Given
    const ben = anAccount(old.db, 'ben@example.com');
    const createdAt = new Date(1_700_000_000_000);
    const score = aScoreRow(old.db, ben, 'Bridge rewrite', createdAt);

    // When
    migrateToLatest(old.db, MIGRATIONS);

    // Then — `owner`, because they are the only person who could ever remove
    // somebody from it, and as old as the score rather than as old as the
    // deploy that ran this.
    const [row] = old.db.select().from(scoreMembers).all();
    expect(row).toMatchObject({ scoreId: score, accountId: ben, role: 'owner', createdAt });
  });

  it('should give one membership per score and no more', async () => {
    // Given a score with two tokens on it, which is the shape that would fan
    // out if the backfill selected through a join
    const ben = anAccount(old.db, 'ben@example.com');
    aScoreRow(old.db, ben, 'Bridge rewrite');

    // When
    migrateToLatest(old.db, MIGRATIONS);

    // Then
    expect(old.db.select().from(scoreMembers).all()).toHaveLength(1);
  });

  it('should be empty rather than refusing when there is nothing to backfill', async () => {
    // Given a database with accounts but no scores — a fresh hub
    anAccount(old.db, 'ben@example.com');

    // When / Then
    expect(() => migrateToLatest(old.db, MIGRATIONS)).not.toThrow();
    expect(old.db.select().from(scoreMembers).all()).toEqual([]);
  });
});
