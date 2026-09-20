/**
 * Adding a second person to a score, as a link — the hub has no mailer, so an
 * invite cannot be addressed to anybody.
 *
 * `claims.ts` again, decision for decision: sha256 of the code and never the
 * code, single-use in the UPDATE's own WHERE, peek and accept separate so a
 * screen can name the score first. It differs in two ways, both because the
 * far end is a person rather than an app on the same machine: it lives for
 * days, and accepting needs a session because it adds an *account* to a score.
 */

import { createHash, randomBytes } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import { and, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { errorBody } from '../app/errors';
import { requireAccount } from '../auth/session-guard';
import type { HubDatabase } from '../db/client';
import { accounts, scoreInvites, scores } from '../db/schema';
import { newId } from '../ids';
import { addScoreMember, readMemberScore } from './members';

/** Long enough to survive a weekend, short enough that one forgotten in a chat
 * thread stops working before anybody has changed bands. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CODE_BYTES = 32;

type InviteLookup =
  | { status: 'valid'; scoreId: string; scoreName: string; invitedBy: string }
  | { status: 'accepted' }
  | { status: 'expired' }
  | { status: 'unknown' };

type InviteAcceptance =
  | { status: 'joined'; scoreId: string; scoreName: string }
  | { status: 'already_a_member'; scoreName: string }
  | { status: 'accepted' }
  | { status: 'expired' }
  | { status: 'unknown' };

/** Mints an invite, collecting that score's dead ones on the way past. */
export function createScoreInvite(
  db: HubDatabase,
  scoreId: string,
  invitedBy: string,
  now: Date = new Date()
) {
  const code = randomBytes(CODE_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

  db.delete(scoreInvites)
    .where(
      and(
        eq(scoreInvites.scoreId, scoreId),
        or(lte(scoreInvites.expiresAt, now), isNotNull(scoreInvites.acceptedAt))
      )
    )
    .run();

  db.insert(scoreInvites)
    .values({
      id: newId(),
      codeHash: hashCode(code),
      scoreId,
      invitedBy,
      createdAt: now,
      expiresAt,
      acceptedAt: null,
    })
    .run();

  return { code, expiresAt };
}

/**
 * What the accept screen may say before anyone agrees to anything. Consumes
 * nothing — accepting to fill a screen would burn the invite on every cancel.
 * The score's name comes from here rather than the link, so a crafted link
 * cannot say *Blackbird* and put someone on something else.
 */
export function peekScoreInvite(
  db: HubDatabase,
  code: string,
  now: Date = new Date()
): InviteLookup {
  const row = db
    .select({
      expiresAt: scoreInvites.expiresAt,
      acceptedAt: scoreInvites.acceptedAt,
      scoreId: scores.id,
      scoreName: scores.name,
      // The only name an account has until someone types one.
      invitedBy: accounts.email,
    })
    .from(scoreInvites)
    .innerJoin(scores, eq(scoreInvites.scoreId, scores.id))
    .innerJoin(accounts, eq(scoreInvites.invitedBy, accounts.id))
    .where(eq(scoreInvites.codeHash, hashCode(code)))
    .get();

  if (!row) return { status: 'unknown' };
  if (row.acceptedAt !== null) return { status: 'accepted' };
  if (row.expiresAt.getTime() <= now.getTime()) return { status: 'expired' };

  return {
    status: 'valid',
    scoreId: row.scoreId,
    scoreName: row.scoreName,
    invitedBy: row.invitedBy,
  };
}

/**
 * Spends the invite and writes the membership.
 *
 * Nothing here reads the invite to decide whether it is still good: the
 * UPDATE's own WHERE carries `accepted_at IS NULL`, and one changed row is the
 * proof that this caller is the one that got it. A read followed by a write
 * would let two people who both read "not yet accepted" both join. The peek
 * afterwards only turns "no rows changed" into the right sentence.
 *
 * The one read up front asks a different question — is this caller already on
 * the score — and exists so the unique index on `score_members` cannot throw
 * when the inviter opens their own link.
 */
export function acceptScoreInvite(
  db: HubDatabase,
  code: string,
  accountId: string,
  now: Date = new Date()
): InviteAcceptance {
  const codeHash = hashCode(code);
  const score = invitedScore(db, codeHash);

  // Refused without spending it, so it is still there for whoever it was for.
  if (score && readMemberScore(db, score.id, accountId)) {
    return { status: 'already_a_member', scoreName: score.name };
  }

  const spent = db
    .update(scoreInvites)
    .set({ acceptedAt: now })
    .where(
      and(
        eq(scoreInvites.codeHash, codeHash),
        isNull(scoreInvites.acceptedAt),
        // An expired invite is left alone rather than marked accepted, so the
        // sweep can still recognise it for what it is.
        gt(scoreInvites.expiresAt, now)
      )
    )
    .run();

  if (spent.changes !== 1) {
    const why = peekScoreInvite(db, code, now);
    // `valid` is unreachable: the UPDATE takes every valid invite. If it ever
    // is reached, someone spent it between the two statements, and "already
    // used" is the honest answer.
    return why.status === 'valid' ? { status: 'accepted' } : why;
  }

  // Unreachable: the UPDATE matched a row, so the invite is there and the
  // foreign key means the score is too.
  if (!score) return { status: 'unknown' };

  addScoreMember(db, score.id, accountId, 'member', now);

  return { status: 'joined', scoreId: score.id, scoreName: score.name };
}

/** Which score a code names, whatever state the invite is in. */
function invitedScore(db: HubDatabase, codeHash: string) {
  return db
    .select({ id: scores.id, name: scores.name })
    .from(scoreInvites)
    .innerJoin(scores, eq(scoreInvites.scoreId, scores.id))
    .where(eq(scoreInvites.codeHash, codeHash))
    .get();
}

/** Startup hygiene, as with sessions and claims. */
export function purgeExpiredInvites(db: HubDatabase, now: Date = new Date()): number {
  return db.delete(scoreInvites).where(lte(scoreInvites.expiresAt, now)).run().changes;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface InviteRoutesOptions {
  db: HubDatabase;
  cookieSecure: boolean;
}

/** Not what makes a 256-bit code unguessable — what stops an endpoint that
 * answers without a session being used to keep the hub busy. */
const INVITE_LIMIT = { max: 60, timeWindow: '1 hour' };

export async function inviteRoutes(fastify: FastifyInstance, opts: InviteRoutesOptions) {
  const { db, cookieSecure } = opts;

  await fastify.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      Object.assign(new Error(`Too many attempts. Try again in ${context.after}.`), {
        statusCode: 429,
        code: 'rate_limited',
      }),
  });

  /**
   * Open on purpose: the person holding the link may not have an account yet,
   * and being asked to sign up before being told what for is how an invite
   * gets ignored. It names the inviter, because who is asking is half of what
   * the invitee is agreeing to — and anyone holding this code can join the
   * score anyway, which is the larger disclosure by far.
   */
  fastify.get('/:code', { config: { rateLimit: INVITE_LIMIT } }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const invite = peekScoreInvite(db, code);

    if (invite.status !== 'valid') {
      return reply.code(inviteStatus(invite.status)).send(inviteError(invite.status));
    }

    return reply.send({ scoreName: invite.scoreName, invitedBy: invite.invitedBy });
  });

  /**
   * Hands back nothing but the score joined. Deliberately not a clone url and
   * a token: this puts a person on a score, and getting it onto a machine is
   * the Clone button and `claims.ts`.
   */
  fastify.post('/:code', { config: { rateLimit: INVITE_LIMIT } }, async (request, reply) => {
    const account = requireAccount(db, request, reply, cookieSecure);
    if (!account) return reply;

    const { code } = request.params as { code: string };
    const accepted = acceptScoreInvite(db, code, account.id);

    if (accepted.status === 'already_a_member') {
      return reply
        .code(409)
        .send(errorBody('already_a_member', `You are already on ${accepted.scoreName}.`));
    }

    if (accepted.status !== 'joined') {
      return reply.code(inviteStatus(accepted.status)).send(inviteError(accepted.status));
    }

    return reply.code(201).send({ id: accepted.scoreId, name: accepted.scoreName, role: 'member' });
  });
}

/** 404 for a code that names nothing, 410 for one that did — as with claims,
 * the caller already held a code and the refusals need different sentences. */
function inviteStatus(status: 'unknown' | 'expired' | 'accepted'): number {
  return status === 'unknown' ? 404 : 410;
}

function inviteError(status: 'unknown' | 'expired' | 'accepted') {
  switch (status) {
    case 'expired':
      return errorBody('invite_expired', 'That invite has expired. Ask for a new link.');
    case 'accepted':
      return errorBody('invite_accepted', 'That invite has already been used. Ask for a new link.');
    default:
      return errorBody('no_such_invite', 'That link does not name anything.');
  }
}
