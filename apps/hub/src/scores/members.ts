/**
 * Who may touch a score.
 *
 * Every score route used to ask `scores.account_id = me`, which made a score
 * the property of one person forever. It now asks this module, and the answer
 * is a join against `score_members`. The point of putting it behind two
 * functions rather than repeating the join is that a call site that forgets is
 * a score someone loses or one they gain, and both are silent.
 *
 * A read returns [`MemberScore`], which carries the *owner's* account id under
 * a name that cannot be mistaken for the caller's. The repository lives at
 * `<owner-account>/<score>.git` and stays there when the score is shared, so
 * the clone URL a member is handed is built from `ownerId` and never from the
 * session they are holding.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { HubDatabase } from '../db/client';
import { accounts, scoreMembers, scores } from '../db/schema';
import { newId } from '../ids';

export type ScoreRole = 'owner' | 'member';

/** A score as one of its members sees it. */
export interface MemberScore {
  id: string;
  name: string;
  createdAt: Date;
  /**
   * The account whose namespace holds the repository — not necessarily the
   * caller. Everything that builds a path or a clone URL wants this one.
   */
  ownerId: string;
  /** What this caller is to this score. */
  role: ScoreRole;
}

const columns = {
  id: scores.id,
  name: scores.name,
  createdAt: scores.createdAt,
  ownerId: scores.accountId,
  role: scoreMembers.role,
};

/**
 * The score, if this account is a member of it. Null covers both "no such
 * score" and "not yours" on purpose: every caller turns it into the same 404,
 * because which of the two it is is not the caller's business.
 */
export function readMemberScore(
  db: HubDatabase,
  scoreId: string,
  accountId: string
): MemberScore | null {
  const row = db
    .select(columns)
    .from(scoreMembers)
    .innerJoin(scores, eq(scoreMembers.scoreId, scores.id))
    .where(and(eq(scoreMembers.scoreId, scoreId), eq(scoreMembers.accountId, accountId)))
    .get();

  return row ?? null;
}

/** Every score this account is a member of, newest first. */
export function listMemberScores(db: HubDatabase, accountId: string): MemberScore[] {
  return db
    .select(columns)
    .from(scoreMembers)
    .innerJoin(scores, eq(scoreMembers.scoreId, scores.id))
    .where(eq(scoreMembers.accountId, accountId))
    .orderBy(desc(scores.createdAt))
    .all();
}

/**
 * Writes a membership. The unique index on `(score_id, account_id)` means a
 * second call for the same pair throws rather than quietly making a person a
 * member twice — there is no caller yet for which that would be ordinary.
 */
export function addScoreMember(
  db: HubDatabase,
  scoreId: string,
  accountId: string,
  role: ScoreRole,
  now: Date = new Date()
): void {
  db.insert(scoreMembers)
    .values({ id: newId(), scoreId, accountId, role, createdAt: now })
    .run();
}

/** A member, as the score page names them. */
export interface ScoreMemberAccount {
  accountId: string;
  /**
   * Accounts have no display name yet, so this is the only thing a person is
   * called. The screen derives initials from the local part and keeps the
   * address itself for the tooltip — which is also how a version's author is
   * matched to a member, since git records an email and nothing else.
   */
  email: string;
  role: ScoreRole;
}

/** Everyone on a score, oldest membership first — the owner leads. */
export function listScoreMembers(db: HubDatabase, scoreId: string): ScoreMemberAccount[] {
  return db
    .select({
      accountId: scoreMembers.accountId,
      email: accounts.email,
      role: scoreMembers.role,
    })
    .from(scoreMembers)
    .innerJoin(accounts, eq(scoreMembers.accountId, accounts.id))
    .where(eq(scoreMembers.scoreId, scoreId))
    .orderBy(scoreMembers.createdAt)
    .all();
}
