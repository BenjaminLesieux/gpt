import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateToLatest, openDatabase } from './client';
import type { HubDatabaseHandle } from './client';
import { accounts, scoreTokens, sessions } from './schema';

const MIGRATIONS = path.join(import.meta.dirname, 'migrations');

/**
 * The migrations folder as it stood before `tag`, so a test can write rows
 * the way the schema of the day would have and then migrate over them. The
 * journal is what the migrator walks, so truncating it is the whole trick.
 */
async function migrationsBefore(tag: string): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'gpt-migrations-'));
  await cp(MIGRATIONS, folder, { recursive: true });

  const journalPath = path.join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  const upTo = journal.entries.findIndex((entry: { tag: string }) => entry.tag === tag);
  expect(upTo).toBeGreaterThan(-1);
  journal.entries = journal.entries.slice(0, upTo);
  await writeFile(journalPath, JSON.stringify(journal));

  return folder;
}

describe('the hub database', () => {
  let handle: HubDatabaseHandle;

  beforeEach(() => {
    handle = openDatabase(':memory:');
    migrateToLatest(handle.db, MIGRATIONS);
  });

  afterEach(() => {
    handle?.close();
  });

  it('should accept an account row when the migrations have run', () => {
    // Given / When
    handle.db.insert(accounts).values({
      id: 'acc1',
      email: 'player@example.com',
      passwordHash: 'not-a-real-hash',
      createdAt: new Date(),
    }).run();

    // Then
    const rows = handle.db.select().from(accounts).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('player@example.com');
  });

  it('should reject a second account when the email is already taken', () => {
    // Given
    const row = {
      id: 'acc1',
      email: 'player@example.com',
      passwordHash: 'not-a-real-hash',
      createdAt: new Date(),
    };
    handle.db.insert(accounts).values(row).run();

    // When / Then
    expect(() =>
      handle.db.insert(accounts).values({ ...row, id: 'acc2' }).run()
    ).toThrow(/UNIQUE/);
  });

  it('should drop the sessions when the account is deleted', () => {
    // Given — the cascade only fires because openDatabase turns the pragma on
    handle.db.insert(accounts).values({
      id: 'acc1',
      email: 'player@example.com',
      passwordHash: 'not-a-real-hash',
      createdAt: new Date(),
    }).run();
    handle.db.insert(sessions).values({
      tokenHash: 'hash1',
      accountId: 'acc1',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
    }).run();

    // When
    handle.db.delete(accounts).where(eq(accounts.id, 'acc1')).run();

    // Then
    expect(handle.db.select().from(sessions).all()).toHaveLength(0);
  });

  it('should leave every token that already existed with its owner on it', async () => {
    // Given a database as it stood before a token named a person, holding a
    // score and a credential for it
    handle.close();
    const folder = await migrationsBefore('0007_tokens_name_a_person');
    handle = openDatabase(':memory:');
    migrateToLatest(handle.db, folder);
    handle.db.run(sql`
      INSERT INTO accounts (id, email, password_hash, created_at)
      VALUES ('acc1', 'player@example.com', 'not-a-real-hash', 0)
    `);
    handle.db.run(sql`
      INSERT INTO scores (id, account_id, name, created_at)
      VALUES ('sc1', 'acc1', 'Blackbird', 0)
    `);
    handle.db.run(sql`
      INSERT INTO score_tokens (id, score_id, name, token_hash, created_at, last_used_at, last_pushed_at)
      VALUES ('tok1', 'sc1', 'companion', 'hash1', 0, 1, 2)
    `);

    // When
    migrateToLatest(handle.db, MIGRATIONS);
    await rm(folder, { recursive: true, force: true });

    // Then — the only person a score has ever had is its owner, and the
    // activity stamps survive the table being rebuilt underneath them.
    const row = handle.db.select().from(scoreTokens).where(eq(scoreTokens.id, 'tok1')).get();
    expect(row?.accountId).toBe('acc1');
    expect(row?.lastPushedAt).toEqual(new Date(2));
  });

  it('should refuse a session that points at no account', () => {
    // Given / When / Then
    expect(() =>
      handle.db.insert(sessions).values({
        tokenHash: 'hash1',
        accountId: 'nobody',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
      }).run()
    ).toThrow(/FOREIGN KEY/);
  });
});
