import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  /** Lowercased before it ever reaches here — the unique index is case-sensitive. */
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    /**
     * The sha256 of the cookie's token, never the token. A copy of this file
     * is then a list of spent hashes rather than a drawer of working session
     * cookies.
     */
    tokenHash: text('token_hash').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  // Without it the cascade behind every account delete is a full table scan.
  (table) => [index('sessions_account_id_idx').on(table.accountId)]
);

export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
