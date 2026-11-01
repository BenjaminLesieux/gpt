/**
 * Who may touch a score: the members of the band that owns it.
 *
 * Every score route asks this module rather than repeating the join, because a
 * call site that forgets is a score someone loses or one they gain, and both
 * are silent.
 *
 * A read returns [`MemberScore`], which carries the band's id — the first
 * segment of the repository path, `<band>/<score>.git` — so every path and
 * clone URL is built from the score and never from the session holding it.
 */

import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { BandRole } from '../bands/bands';
import { listBandMembers } from '../bands/bands';
import type { HubDatabase } from '../db/client';
import { accounts, bandMembers, scoreInvites, scores } from '../db/schema';

export type ScoreRole = BandRole;

/** A score as one of its members sees it. */
export interface MemberScore {
  id: string;
  name: string;
  createdAt: Date;
  /** The band that owns it. Everything that builds a path or a clone URL wants this. */
  bandId: string;
  /** What this caller is to the band. */
  role: ScoreRole;
}

const columns = {
  id: scores.id,
  name: scores.name,
  createdAt: scores.createdAt,
  bandId: scores.bandId,
  role: bandMembers.role,
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
    .from(scores)
    .innerJoin(
      bandMembers,
      and(eq(bandMembers.bandId, scores.bandId), eq(bandMembers.accountId, accountId))
    )
    .where(eq(scores.id, scoreId))
    .get();

  return row ?? null;
}

/** Every score this account is a member of, newest first. */
export function listMemberScores(db: HubDatabase, accountId: string): MemberScore[] {
  return db
    .select(columns)
    .from(scores)
    .innerJoin(bandMembers, eq(bandMembers.bandId, scores.bandId))
    .where(eq(bandMembers.accountId, accountId))
    .orderBy(desc(scores.createdAt))
    .all();
}

/**
 * A member, as the score page names them — or a link held out to somebody who
 * has not arrived yet.
 *
 * The second case is why this is a union rather than a row of `band_members`.
 * An invited person has no membership at all until they accept, so a list of
 * memberships draws them as *absent* — the same conflation of "issued" with
 * "in use" that the token activity fix removed one layer down, reintroduced
 * for people instead of machines.
 *
 * `id` is what the square is keyed by and nothing more: the account for
 * someone who is here, the invite for someone who is not. An invited person
 * has neither an account nor an address — there is no mailer, so nobody is
 * named until they accept — which is exactly what the union stops a caller
 * from forgetting.
 */
export type ScoreMemberEntry =
  | {
      status: 'joined';
      id: string;
      /**
       * Accounts have no display name yet, so this is the only thing a person
       * is called. The screen derives initials from the local part and keeps
       * the address itself for the tooltip — which is also how a version's
       * author is matched to a member, since git records an email and nothing
       * else.
       */
      email: string;
      role: ScoreRole;
    }
  | { status: 'invited'; id: string; invitedBy: string; expiresAt: Date };

/**
 * Everyone on a score's band, oldest first — the owner leads, and the invites
 * to this score nobody has opened yet come after the people who are here.
 *
 * Two queries rather than a union: the two halves carry different columns,
 * and an invite has no account to join to.
 */
export function listScoreMembers(
  db: HubDatabase,
  score: Pick<MemberScore, 'id' | 'bandId'>,
  now: Date = new Date()
): ScoreMemberEntry[] {
  const joined = listBandMembers(db, score.bandId);

  // Unaccepted and unexpired only. An invite that has been spent is the
  // membership row above it, and a dead one is a person who never came.
  const invited = db
    .select({
      id: scoreInvites.id,
      invitedBy: accounts.email,
      expiresAt: scoreInvites.expiresAt,
    })
    .from(scoreInvites)
    .innerJoin(accounts, eq(scoreInvites.invitedBy, accounts.id))
    .where(
      and(
        eq(scoreInvites.scoreId, score.id),
        isNull(scoreInvites.acceptedAt),
        gt(scoreInvites.expiresAt, now)
      )
    )
    .orderBy(scoreInvites.createdAt)
    .all();

  return [
    ...joined.map((row) => ({ status: 'joined' as const, ...row })),
    ...invited.map((row) => ({ status: 'invited' as const, ...row })),
  ];
}
