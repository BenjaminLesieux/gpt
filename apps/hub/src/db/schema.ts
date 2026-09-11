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

export const scores = sqliteTable(
  'scores',
  {
    /** Also the repository's directory name, which is why it is opaque. */
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** What the musician typed. It never reaches a URL or a path. */
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('scores_account_id_idx').on(table.accountId)]
);

export const scoreTokens = sqliteTable(
  'score_tokens',
  {
    /** Shown in the score list so a credential can be told apart from another. */
    id: text('id').primaryKey(),
    scoreId: text('score_id')
      .notNull()
      .references(() => scores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /**
     * sha256 of what companion sends as its git password, never the value.
     * Unique because every git request is a lookup by this column.
     */
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('score_tokens_score_id_idx').on(table.scoreId)]
);

export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Score = typeof scores.$inferSelect;
export type ScoreToken = typeof scoreTokens.$inferSelect;
