import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type HubDatabase = BetterSQLite3Database<typeof schema>;

export interface HubDatabaseHandle {
  db: HubDatabase;
  close(): void;
}

export function openDatabase(path: string): HubDatabaseHandle {
  const sqlite = new Database(path);

  // Both are per-connection and both default off/rollback: without the first,
  // the `references()` in the schema are documentation and a deleted account
  // leaves its sessions behind; without the second, a reader blocks a writer.
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');

  return { db: drizzle(sqlite, { schema }), close: () => sqlite.close() };
}

/**
 * The folder is a parameter rather than a path derived from `__dirname`
 * because the migrations are a build asset in production and a source
 * directory under test, and those are not the same place.
 */
export function migrateToLatest(db: HubDatabase, migrationsFolder: string): void {
  migrate(db, { migrationsFolder });
}
