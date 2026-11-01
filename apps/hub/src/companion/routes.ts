/**
 * Signing a companion in to an account. ADR 0011 and `docs/companion-sign-in.md`
 * carry the why; this is the clone claim's shape (`scores/claims.ts`) with a
 * PKCE challenge on the code.
 */

import { createHash, randomBytes } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import { and, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { errorBody } from '../app/errors';
import { requireAccount } from '../auth/session-guard';
import type { HubDatabase } from '../db/client';
import { accounts, companionCodes, companionTokens } from '../db/schema';
import { newId } from '../ids';
import { cloneUrl } from '../scores/clone-url';
import { listMemberScores, readMemberScore } from '../scores/members';
import { deviceName, hashToken, mintScoreToken } from '../scores/tokens';

export const CODE_TTL_MS = 5 * 60 * 1000;

const SECRET_BYTES = 32;

export type CodeRedemption =
  | { status: 'valid'; accountId: string; email: string }
  | { status: 'redeemed' }
  | { status: 'expired' }
  | { status: 'unknown' }
  | { status: 'wrong_verifier' };

export function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Mints a code, and collects this account's dead ones on the way past. */
export function createCompanionCode(
  db: HubDatabase,
  accountId: string,
  challenge: string,
  now: Date = new Date(),
): { code: string; expiresAt: Date } {
  const code = randomBytes(SECRET_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);

  db.delete(companionCodes)
    .where(
      and(
        eq(companionCodes.accountId, accountId),
        or(
          lte(companionCodes.expiresAt, now),
          isNotNull(companionCodes.redeemedAt),
        ),
      ),
    )
    .run();

  db.insert(companionCodes)
    .values({
      id: newId(),
      accountId,
      codeHash: hashToken(code),
      challenge,
      createdAt: now,
      expiresAt,
      redeemedAt: null,
    })
    .run();

  return { code, expiresAt };
}

/**
 * The verifier is part of the UPDATE's WHERE, like `redeemed_at IS NULL`: a
 * wrong one spends nothing, so whoever intercepted the code cannot burn the
 * real companion's sign-in by guessing.
 */
export function redeemCompanionCode(
  db: HubDatabase,
  code: string,
  verifier: string,
  now: Date = new Date(),
): CodeRedemption {
  const codeHash = hashToken(code);

  const spent = db
    .update(companionCodes)
    .set({ redeemedAt: now })
    .where(
      and(
        eq(companionCodes.codeHash, codeHash),
        isNull(companionCodes.redeemedAt),
        gt(companionCodes.expiresAt, now),
        eq(companionCodes.challenge, s256(verifier)),
      ),
    )
    .run();

  const row = db
    .select({
      accountId: accounts.id,
      email: accounts.email,
      challenge: companionCodes.challenge,
      expiresAt: companionCodes.expiresAt,
      redeemedAt: companionCodes.redeemedAt,
    })
    .from(companionCodes)
    .innerJoin(accounts, eq(companionCodes.accountId, accounts.id))
    .where(eq(companionCodes.codeHash, codeHash))
    .get();

  if (!row) return { status: 'unknown' };
  if (spent.changes === 1)
    return { status: 'valid', accountId: row.accountId, email: row.email };
  if (row.redeemedAt !== null) return { status: 'redeemed' };
  if (row.expiresAt.getTime() <= now.getTime()) return { status: 'expired' };
  if (row.challenge !== s256(verifier)) return { status: 'wrong_verifier' };
  return { status: 'redeemed' };
}

export function mintCompanionToken(
  db: HubDatabase,
  accountId: string,
  device: string,
  now: Date = new Date(),
): { id: string; token: string } {
  const token = randomBytes(SECRET_BYTES).toString('base64url');
  const id = newId();

  db.insert(companionTokens)
    .values({
      id,
      accountId,
      tokenHash: hashToken(token),
      device,
      createdAt: now,
    })
    .run();

  return { id, token };
}

export interface CompanionBearer {
  tokenId: string;
  accountId: string;
  email: string;
  device: string;
}

/**
 * `requireAccount`'s counterpart for `Authorization: Bearer <companion token>`.
 * Answers the request itself and returns null when there is no caller.
 */
function requireCompanion(
  db: HubDatabase,
  request: FastifyRequest,
  reply: FastifyReply,
  now: Date = new Date(),
): CompanionBearer | null {
  const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1];
  if (!token) {
    reply
      .code(401)
      .send(errorBody('no_token', 'This route needs a companion token.'));
    return null;
  }

  const row = db
    .select({
      tokenId: companionTokens.id,
      accountId: accounts.id,
      email: accounts.email,
      device: companionTokens.device,
      revokedAt: companionTokens.revokedAt,
    })
    .from(companionTokens)
    .innerJoin(accounts, eq(companionTokens.accountId, accounts.id))
    .where(eq(companionTokens.tokenHash, hashToken(token)))
    .get();

  if (!row) {
    reply
      .code(401)
      .send(errorBody('invalid_token', 'That token is not valid.'));
    return null;
  }
  if (row.revokedAt !== null) {
    reply
      .code(401)
      .send(
        errorBody(
          'token_revoked',
          'This device was disconnected from the hub.',
        ),
      );
    return null;
  }

  db.update(companionTokens)
    .set({ lastUsedAt: now })
    .where(eq(companionTokens.id, row.tokenId))
    .run();

  return {
    tokenId: row.tokenId,
    accountId: row.accountId,
    email: row.email,
    device: row.device,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface CompanionRoutesOptions {
  db: HubDatabase;
  cookieSecure: boolean;
  publicUrl: string;
}

const LIMIT = { max: 60, timeWindow: '1 hour' };

const newCode = z.object({
  // A S256 challenge is exactly a base64url sha256; anything else is not one.
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  challengeMethod: z.string(),
});

const redemption = z.object({
  code: z.string().min(1),
  // RFC 7636 §4.1.
  verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  device: z.unknown().optional(),
});

export async function companionRoutes(
  fastify: FastifyInstance,
  opts: CompanionRoutesOptions,
) {
  const { db, cookieSecure, publicUrl } = opts;

  await fastify.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      Object.assign(
        new Error(`Too many attempts. Try again in ${context.after}.`),
        {
          statusCode: 429,
          code: 'rate_limited',
        },
      ),
  });

  fastify.post(
    '/codes',
    { config: { rateLimit: LIMIT } },
    async (request, reply) => {
      const account = requireAccount(db, request, reply, cookieSecure);
      if (!account) return reply;

      const parsed = newCode.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(errorBody('invalid_request', 'Expected a S256 challenge.'));
      }
      // Refused rather than downgraded: `plain` would put the verifier in the link.
      if (parsed.data.challengeMethod !== 'S256') {
        return reply
          .code(400)
          .send(
            errorBody(
              'unsupported_challenge_method',
              'Only S256 challenges are accepted.',
            ),
          );
      }

      const issued = createCompanionCode(db, account.id, parsed.data.challenge);
      return reply
        .code(201)
        .send({ code: issued.code, expiresAt: issued.expiresAt.toISOString() });
    },
  );

  fastify.post(
    '/tokens',
    { config: { rateLimit: LIMIT } },
    async (request, reply) => {
      const parsed = redemption.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            errorBody('invalid_request', 'Expected a code and a verifier.'),
          );
      }

      const spent = redeemCompanionCode(
        db,
        parsed.data.code,
        parsed.data.verifier,
      );
      switch (spent.status) {
        case 'valid': {
          const minted = mintCompanionToken(
            db,
            spent.accountId,
            deviceName(parsed.data.device),
          );
          return reply
            .code(201)
            .send({ token: minted.token, email: spent.email });
        }
        case 'unknown':
          return reply
            .code(404)
            .send(
              errorBody('no_such_code', 'That code does not name anything.'),
            );
        case 'expired':
          return reply
            .code(410)
            .send(
              errorBody(
                'code_expired',
                'That code has expired. Sign in again.',
              ),
            );
        case 'redeemed':
          return reply
            .code(410)
            .send(
              errorBody(
                'code_redeemed',
                'That code has already been used. Sign in again.',
              ),
            );
        case 'wrong_verifier':
          return reply
            .code(403)
            .send(
              errorBody(
                'wrong_verifier',
                'That verifier does not match the code.',
              ),
            );
      }
    },
  );

  fastify.get('/tokens', async (request, reply) => {
    const account = requireAccount(db, request, reply, cookieSecure);
    if (!account) return reply;

    const rows = db
      .select({
        id: companionTokens.id,
        device: companionTokens.device,
        createdAt: companionTokens.createdAt,
        lastUsedAt: companionTokens.lastUsedAt,
      })
      .from(companionTokens)
      .where(
        and(
          eq(companionTokens.accountId, account.id),
          isNull(companionTokens.revokedAt),
        ),
      )
      .orderBy(companionTokens.createdAt)
      .all();

    return reply.send(
      rows.map((row) => ({
        id: row.id,
        device: row.device,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      })),
    );
  });

  fastify.delete('/tokens/:id', async (request, reply) => {
    const account = requireAccount(db, request, reply, cookieSecure);
    if (!account) return reply;

    const { id } = request.params as { id: string };
    const revoked = db
      .update(companionTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(companionTokens.id, id),
          eq(companionTokens.accountId, account.id),
          isNull(companionTokens.revokedAt),
        ),
      )
      .run();

    if (revoked.changes !== 1) {
      return reply
        .code(404)
        .send(errorBody('no_such_token', 'No device with that id.'));
    }
    return reply.code(204).send();
  });

  fastify.get('/me', async (request, reply) => {
    const bearer = requireCompanion(db, request, reply);
    if (!bearer) return reply;

    return reply.send({ email: bearer.email });
  });

  fastify.get('/scores', async (request, reply) => {
    const bearer = requireCompanion(db, request, reply);
    if (!bearer) return reply;

    return reply.send(
      listMemberScores(db, bearer.accountId).map((row) => ({
        id: row.id,
        name: row.name,
        url: cloneUrl(publicUrl, row.bandId, row.id),
        createdAt: row.createdAt.toISOString(),
      })),
    );
  });

  /** `POST /scores/:id/token`'s response, so adoption reads the same triple. */
  fastify.post(
    '/scores/:id/token',
    { config: { rateLimit: LIMIT } },
    async (request, reply) => {
      const bearer = requireCompanion(db, request, reply);
      if (!bearer) return reply;

      const { id } = request.params as { id: string };
      const score = readMemberScore(db, id, bearer.accountId);
      if (!score) {
        return reply
          .code(404)
          .send(errorBody('no_such_score', 'No score with that id.'));
      }

      const token = mintScoreToken(
        db,
        score.id,
        bearer.accountId,
        bearer.device,
      );

      return reply.code(201).send({
        id: score.id,
        name: score.name,
        url: cloneUrl(publicUrl, score.bandId, score.id),
        username: score.bandId,
        token: token.token,
        tokenName: token.name,
      });
    },
  );
}
