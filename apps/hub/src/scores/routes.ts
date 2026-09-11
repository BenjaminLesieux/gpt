import { rm } from 'node:fs/promises';
import rateLimit from '@fastify/rate-limit';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errorBody } from '../app/errors';
import { requireAccount } from '../auth/session-guard';
import type { HubDatabase } from '../db/client';
import { scoreTokens, scores } from '../db/schema';
import { createRepository } from '../git/repositories';
import { newId } from '../ids';
import { mintScoreToken } from './tokens';

export interface ScoreRoutesOptions {
  db: HubDatabase;
  cookieSecure: boolean;
  gitRoot: string;
  /** The origin clone URLs are built from. */
  publicUrl: string;
}

/**
 * Creating a score makes a directory. The caller already has an account and
 * signup is throttled, so this is a backstop against a loop rather than
 * against a stranger — a real answer is a quota, which v1 does not have.
 */
const CREATE_LIMIT = { max: 30, timeWindow: '1 hour' };

const newScore = z.object({
  name: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(200)),
});

export async function scoreRoutes(fastify: FastifyInstance, opts: ScoreRoutesOptions) {
  const { db, cookieSecure, gitRoot, publicUrl } = opts;

  await fastify.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      Object.assign(new Error(`Too many scores at once. Try again in ${context.after}.`), {
        statusCode: 429,
        code: 'rate_limited',
      }),
  });

  fastify.post('/', { config: { rateLimit: CREATE_LIMIT } }, async (request, reply) => {
    const account = requireAccount(db, request, reply, cookieSecure);
    if (!account) return reply;

    const parsed = newScore.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return reply.code(400).send(errorBody('invalid_request', `name: ${issue.message}`));
    }

    const id = newId();
    const repository = await createRepository(gitRoot, account.id, id);

    try {
      db.insert(scores)
        .values({ id, accountId: account.id, name: parsed.data.name, createdAt: new Date() })
        .run();

      const token = mintScoreToken(db, id, 'companion');

      return reply.code(201).send({
        id,
        name: parsed.data.name,
        url: cloneUrl(publicUrl, account.id, id),
        username: account.id,
        // The only time this value exists outside companion's keychain.
        token: token.token,
        tokenName: token.name,
      });
    } catch (error) {
      // Both writes are local and can only collide on an id, so this is very
      // nearly unreachable — but a directory with no row is unreferenced
      // forever, and a score with no token is the half-provisioned state the
      // whole design is meant not to have.
      db.delete(scores).where(eq(scores.id, id)).run();
      await rm(repository, { recursive: true, force: true });
      throw error;
    }
  });

  fastify.get('/', async (request, reply) => {
    const account = requireAccount(db, request, reply, cookieSecure);
    if (!account) return reply;

    const rows = db
      .select({
        id: scores.id,
        name: scores.name,
        createdAt: scores.createdAt,
        tokenId: scoreTokens.id,
        tokenName: scoreTokens.name,
      })
      .from(scores)
      .leftJoin(scoreTokens, eq(scoreTokens.scoreId, scores.id))
      .where(eq(scores.accountId, account.id))
      .orderBy(desc(scores.createdAt))
      .all();

    return reply.send(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        url: cloneUrl(publicUrl, account.id, row.id),
        createdAt: row.createdAt.toISOString(),
        // Name and id only. The value does not exist any more, and a row that
        // implied otherwise would be a lie the user acts on.
        token: row.tokenId ? { id: row.tokenId, name: row.tokenName } : null,
      }))
    );
  });
}

function cloneUrl(publicUrl: string, accountId: string, scoreId: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/git/${accountId}/${scoreId}.git`;
}
