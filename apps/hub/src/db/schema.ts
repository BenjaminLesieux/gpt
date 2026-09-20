import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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
    /**
     * Whose namespace the repository sits in — `<account>/<score>.git` — and
     * nothing more. This column stopped being the answer to "may this person
     * touch this score?" when `score_members` arrived; it stayed because the
     * path it builds is already written into every working clone's config.
     */
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** What the musician typed. It never reaches a URL or a path. */
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('scores_account_id_idx').on(table.accountId)]
);

/**
 * Who may touch a score. A band is more than one person, and until this table
 * existed the hub could not say so: a score had one account and every push was
 * attributed to them forever.
 *
 * Roles are `owner | member`. `owner` buys removing people and deleting the
 * score, and nothing else — resist a third until something needs one.
 */
export const scoreMembers = sqliteTable(
  'score_members',
  {
    id: text('id').primaryKey(),
    scoreId: text('score_id')
      .notNull()
      .references(() => scores.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    // One membership per person per score, and the lookup every score route
    // now makes before it answers anything.
    uniqueIndex('score_members_score_id_account_id_idx').on(table.scoreId, table.accountId),
    // `GET /scores` reads the same table the other way round.
    index('score_members_account_id_idx').on(table.accountId),
  ]
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

/**
 * An offer to join a score, as a link. The hub has no mailer — signup has no
 * verification and nothing sends email — so an invite cannot arrive addressed
 * to anybody; it is a code the inviter copies and sends however they already
 * talk to their band.
 *
 * Deliberately the same shape as [`cloneClaims`]: sha256 of the code and never
 * the code, single-use enforced by the UPDATE's own WHERE, and a spent row
 * kept so a replay can be told apart from a code that never existed. It lives
 * for days rather than five minutes, because a clone claim is fired at an app
 * on the same machine and this one is sent to a drummer who may be asleep.
 */
export const scoreInvites = sqliteTable(
  'score_invites',
  {
    id: text('id').primaryKey(),
    /** sha256 of the code in the link, never the code. */
    codeHash: text('code_hash').notNull().unique(),
    scoreId: text('score_id')
      .notNull()
      .references(() => scores.id, { onDelete: 'cascade' }),
    /** Which member held it out. Not who it is for: nobody is named until it
     * is accepted, because there is no mailer to tell a named person. */
    invitedBy: text('invited_by')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    /** Null until it is accepted. */
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('score_invites_score_id_idx').on(table.scoreId),
    index('score_invites_invited_by_idx').on(table.invitedBy),
    // The sweep is a range scan over this column.
    index('score_invites_expires_at_idx').on(table.expiresAt),
  ]
);

/**
 * What a version touched — tracks and bars — derived by diffing its score
 * against its parent's.
 *
 * A cache, and a permanently valid one: `commit` is a sha, a sha names one
 * tree forever, so a row here can never go stale and there is no invalidation
 * to get wrong. What it buys is real — deriving a scope means parsing two
 * Guitar Pro files, and a history screen asks for forty of them at once.
 *
 * A version whose file will not parse gets no row. Absent means "nothing to
 * say", which is the truth; a row of zeroes would be a claim that the version
 * changed nothing.
 */
export const versionScopes = sqliteTable(
  'version_scopes',
  {
    scoreId: text('score_id')
      .notNull()
      .references(() => scores.id, { onDelete: 'cascade' }),
    /** Full sha of the version this describes. */
    commit: text('commit').notNull(),
    /** JSON `{ name, bars }[]`, only the tracks whose bars changed. */
    tracks: text('tracks').notNull(),
    /** Sum over `tracks`. Stored rather than summed on read, so a list of
     * forty rows is forty integers and not forty JSON parses. */
    bars: integer('bars').notNull(),
    /** How many tracks the score has, for the *5 tracks · 0 bars* form. */
    trackCount: integer('track_count').notNull(),
    /** Tempo, title or a time signature moved. */
    meta: integer('meta', { mode: 'boolean' }).notNull(),
    computedAt: integer('computed_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    // The history screen reads this table one page of commits at a time, and
    // a version belongs to exactly one score.
    primaryKey({ columns: [table.scoreId, table.commit] }),
  ]
);

export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Score = typeof scores.$inferSelect;
export type ScoreMember = typeof scoreMembers.$inferSelect;
export type ScoreToken = typeof scoreTokens.$inferSelect;
export type CloneClaim = typeof cloneClaims.$inferSelect;
export type ScoreInvite = typeof scoreInvites.$inferSelect;
export type VersionScope = typeof versionScopes.$inferSelect;
