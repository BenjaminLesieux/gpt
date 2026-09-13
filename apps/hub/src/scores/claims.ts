/**
 * Handing a score to a machine that does not have it yet.
 *
 * The thing the browser puts in a `gitarpro://` link is a *claim*, not a
 * token. A custom-scheme URL is handed to LaunchServices, which is not an
 * access log but is not nothing either: any installed app may register the
 * same scheme, and browsers vary on whether an external-protocol navigation
 * lands in history. So the value that travels there buys exactly one score,
 * expires in five minutes, and works once.
 *
 * The token itself is minted as the claim is redeemed — see
 * [`redeemCloneClaim`]. Nothing plaintext is ever at rest, which is the
 * property the rest of the hub already has and which a claim row carrying a
 * pre-minted token would have quietly given up.
 */

import { createHash, randomBytes } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import { and, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { errorBody } from '../app/errors';
import type { HubDatabase } from '../db/client';
import { cloneClaims, scores } from '../db/schema';
import { newId } from '../ids';
import { cloneUrl } from './clone-url';
import { deviceName, mintScoreToken } from './tokens';

/**
 * Long enough to switch apps and answer a dialog, short enough that a link
 * left in a chat window is worthless by the time anyone else reads it.
 */
export const CLAIM_TTL_MS = 5 * 60 * 1000;

const CODE_BYTES = 32;

export interface IssuedClaim {
  /** Goes in the link and is never written down. */
  code: string;
  expiresAt: Date;
}

/**
 * Four outcomes rather than two. "Never existed", "already spent" and "ran
 * out" are the same refusal to an attacker and three different sentences to
 * the person who pressed Clone — the second in particular has to say *the
 * retry is a new Clone*, because there is nothing to press again.
 */
export type ClaimLookup =
  | { status: 'valid'; scoreId: string; scoreName: string; accountId: string }
  | { status: 'redeemed' }
  | { status: 'expired' }
  | { status: 'unknown' };

/**
 * Mints a claim for a score, and collects that score's dead ones on the way
 * past. The table stays bounded without a timer: a claim is only ever created
 * here, and every creation clears what the last ones left behind.
 */
export function createCloneClaim(
  db: HubDatabase,
  scoreId: string,
  now: Date = new Date()
): IssuedClaim {
  const code = randomBytes(CODE_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS);

  db.delete(cloneClaims)
    .where(
      and(
        eq(cloneClaims.scoreId, scoreId),
        or(lte(cloneClaims.expiresAt, now), isNotNull(cloneClaims.redeemedAt))
      )
    )
    .run();

  db.insert(cloneClaims)
    .values({
      id: newId(),
      codeHash: hashCode(code),
      scoreId,
      createdAt: now,
      expiresAt,
      redeemedAt: null,
    })
    .run();

  return { code, expiresAt };
}

/**
 * What the confirmation dialog is allowed to say before the user has agreed
 * to anything. Consumes nothing: redeeming to populate a dialog would burn
 * the claim on every cancel.
 *
 * The name comes from here rather than from the link, so a crafted link
 * cannot say *Blackbird* and deliver something else.
 */
export function peekCloneClaim(
  db: HubDatabase,
  code: string,
  now: Date = new Date()
): ClaimLookup {
  const row = db
    .select({
      expiresAt: cloneClaims.expiresAt,
      redeemedAt: cloneClaims.redeemedAt,
      scoreId: scores.id,
      scoreName: scores.name,
      accountId: scores.accountId,
    })
    .from(cloneClaims)
    .innerJoin(scores, eq(cloneClaims.scoreId, scores.id))
    .where(eq(cloneClaims.codeHash, hashCode(code)))
    .get();

  if (!row) return { status: 'unknown' };
  if (row.redeemedAt !== null) return { status: 'redeemed' };
  if (row.expiresAt.getTime() <= now.getTime()) return { status: 'expired' };

  return {
    status: 'valid',
    scoreId: row.scoreId,
    scoreName: row.scoreName,
    accountId: row.accountId,
  };
}

/**
 * Spends the claim, or says why it could not.
 *
 * Consumption is the UPDATE and not a read followed by a write: the
 * `redeemed_at IS NULL` sits in the WHERE, and one changed row is the proof
 * that this caller is the one that got it. Two racing redemptions therefore
 * produce one token and one refusal — the same shape as `update-ref` with an
 * empty old value in `git/versions.ts`.
 *
 * The peek afterwards is only there to turn "no rows changed" into the right
 * sentence; it decides nothing.
 */
export function redeemCloneClaim(
  db: HubDatabase,
  code: string,
  now: Date = new Date()
): ClaimLookup {
  const codeHash = hashCode(code);

  const spent = db
    .update(cloneClaims)
    .set({ redeemedAt: now })
    .where(
      and(
        eq(cloneClaims.codeHash, codeHash),
        isNull(cloneClaims.redeemedAt),
        // An expired claim is left alone rather than marked spent, so the
        // sweep can still recognise it for what it is.
        gt(cloneClaims.expiresAt, now)
      )
    )
    .run();

  if (spent.changes !== 1) {
    const why = peekCloneClaim(db, code, now);
    // `valid` is unreachable: the UPDATE takes every valid claim. If it ever
    // is reached, something else spent it between the two statements, and
    // "already spent" is the honest answer.
    return why.status === 'valid' ? { status: 'redeemed' } : why;
  }

  return peekAfterSpending(db, codeHash);
}

/** Whose score this was, read back after the row has already been claimed. */
function peekAfterSpending(db: HubDatabase, codeHash: string): ClaimLookup {
  const row = db
    .select({ scoreId: scores.id, scoreName: scores.name, accountId: scores.accountId })
    .from(cloneClaims)
    .innerJoin(scores, eq(cloneClaims.scoreId, scores.id))
    .where(eq(cloneClaims.codeHash, codeHash))
    .get();

  // The UPDATE above matched, so the row is there and the foreign key means
  // the score is too.
  return row ? { status: 'valid', ...row } : { status: 'unknown' };
}

/**
 * Startup hygiene, as with sessions. A claim past its expiry is already
 * refused by [`redeemCloneClaim`], so this only keeps the table from growing.
 */
export function purgeExpiredClaims(db: HubDatabase, now: Date = new Date()): number {
  return db.delete(cloneClaims).where(lte(cloneClaims.expiresAt, now)).run().changes;
}

function hashCode(code: string): string {
  // As with sessions and tokens: 256 bits of randomness has nothing for a
  // slow hash to protect. This exists so the table cannot be replayed.
  return createHash('sha256').update(code).digest('hex');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface ClaimRoutesOptions {
  db: HubDatabase;
  /** The origin clone URLs are built from, and the name shown before trust. */
  publicUrl: string;
}

/**
 * Neither of these takes a session, which is the point: they are answered on
 * the machine the score is arriving at, and that machine has no account of
 * its own. The code *is* the authorisation.
 *
 * A code is 256 bits, so the limit below is not what makes guessing hopeless
 * — it is there so a stranger cannot turn an open endpoint into a way to keep
 * the hub busy.
 */
const CLAIM_LIMIT = { max: 60, timeWindow: '1 hour' };

export async function claimRoutes(fastify: FastifyInstance, opts: ClaimRoutesOptions) {
  const { db, publicUrl } = opts;

  await fastify.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      Object.assign(new Error(`Too many attempts. Try again in ${context.after}.`), {
        statusCode: 429,
        code: 'rate_limited',
      }),
  });

  /**
   * What the confirmation dialog reads out before the user has agreed to
   * anything. `hubName` is this hub's own idea of where it lives: the app
   * already knows the origin from the link, and the two disagreeing is how a
   * link pointing somewhere unexpected shows up.
   */
  fastify.get('/:code', { config: { rateLimit: CLAIM_LIMIT } }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const claim = peekCloneClaim(db, code);

    if (claim.status !== 'valid') {
      return reply.code(claimStatus(claim.status)).send(claimError(claim.status));
    }

    return reply.send({ scoreName: claim.scoreName, hubName: hubName(publicUrl) });
  });

  /**
   * Spends the claim and mints the credential it bought. The only response in
   * the hub other than score creation that carries a token value, and like
   * that one it is the only time the value exists outside a keychain.
   */
  fastify.post('/:code', { config: { rateLimit: CLAIM_LIMIT } }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const claim = redeemCloneClaim(db, code);

    if (claim.status !== 'valid') {
      return reply.code(claimStatus(claim.status)).send(claimError(claim.status));
    }

    const token = mintScoreToken(
      db,
      claim.scoreId,
      deviceName((request.body as { device?: unknown } | null)?.device)
    );

    return reply.code(201).send({
      name: claim.scoreName,
      url: cloneUrl(publicUrl, claim.accountId, claim.scoreId),
      username: claim.accountId,
      token: token.token,
      tokenName: token.name,
    });
  });
}

/**
 * 404 for a code that names nothing and 410 for one that did: the difference
 * is not worth hiding, because the caller already held a code and the three
 * refusals need three different sentences on screen.
 */
function claimStatus(status: 'unknown' | 'expired' | 'redeemed'): number {
  return status === 'unknown' ? 404 : 410;
}

function claimError(status: 'unknown' | 'expired' | 'redeemed') {
  switch (status) {
    case 'expired':
      return errorBody('claim_expired', 'That link has expired. Press Clone again.');
    case 'redeemed':
      return errorBody(
        'claim_redeemed',
        'That link has already been used. Press Clone again for a new one.'
      );
    default:
      return errorBody('no_such_claim', 'That link does not name anything.');
  }
}

/** Not a friendly label the operator chose — the origin, which is what is
 * actually being trusted. */
function hubName(publicUrl: string): string {
  try {
    return new URL(publicUrl).host;
  } catch {
    return publicUrl;
  }
}
