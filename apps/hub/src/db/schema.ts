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
    /**
     * When this credential last authenticated anything at all — a fetch, a
     * push, a probe. Null means minted and never used, which is the state a
     * score sits in between `POST /scores` and the app first running: issuing
     * a token says nothing about whether a machine has it.
     */
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    /**
     * When this credential last completed a `git-receive-pack`. Narrower than
     * `lastUsedAt` on purpose: connecting proves the score reached a machine,
     * pushing proves someone is working on it, and only the second one should
     * ever be read as activity.
     */
    lastPushedAt: integer('last_pushed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [index('score_tokens_score_id_idx').on(table.scoreId)]
);

/**
 * A capability to take one score onto one more machine. It holds no secret:
 * the code lives in the link the browser hands to the app, the hub keeps its
 * sha256, and the *token* the code buys is minted at redemption rather than
 * sitting here in plaintext for five minutes.
 *
 * Single-use is enforced by the write — `redeemed_at IS NULL` in the WHERE of
 * the UPDATE — so two racing redemptions produce one token and one refusal.
 */
export const cloneClaims = sqliteTable(
  'clone_claims',
  {
    id: text('id').primaryKey(),
    /** sha256 of the code in the link, never the code. */
    codeHash: text('code_hash').notNull().unique(),
    scoreId: text('score_id')
      .notNull()
      .references(() => scores.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    /** Null until it is spent. A spent claim is kept so a replay can be told
     * apart from a code that never existed. */
    redeemedAt: integer('redeemed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('clone_claims_score_id_idx').on(table.scoreId),
    // The sweep is a range scan over this column.
    index('clone_claims_expires_at_idx').on(table.expiresAt),
  ]
);

export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Score = typeof scores.$inferSelect;
export type ScoreToken = typeof scoreTokens.$inferSelect;
export type CloneClaim = typeof cloneClaims.$inferSelect;
