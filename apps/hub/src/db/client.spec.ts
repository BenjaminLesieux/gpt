import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateToLatest, openDatabase } from './client';
import type { HubDatabaseHandle } from './client';
import { accounts, sessions } from './schema';

const MIGRATIONS = path.join(import.meta.dirname, 'migrations');

describe('the hub database', () => {
  let handle: HubDatabaseHandle;

  beforeEach(() => {
    handle = openDatabase(':memory:');
    migrateToLatest(handle.db, MIGRATIONS);
  });

  afterEach(() => {
    handle.close();
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
