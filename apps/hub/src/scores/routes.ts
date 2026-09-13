import { rm } from 'node:fs/promises';
import rateLimit from '@fastify/rate-limit';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errorBody } from '../app/errors';
import { requireAccount } from '../auth/session-guard';
import type { HubDatabase } from '../db/client';
import { scores } from '../db/schema';
import { createRepository } from '../git/repositories';
import { newId } from '../ids';
import { DEFAULT_TOKEN_NAME, deviceName, listScoreTokens, mintScoreToken } from './tokens';

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

      const token = mintScoreToken(db, id, DEFAULT_TOKEN_NAME);

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

  /**
   * Mints a token for a score. Two callers, one shape:
   *
   * - a score whose creation crashed between the row and the token, which the
   *   owner sees as *Setup unfinished* and fixes with a retry they can press;
   * - a second machine, which is a second device and wants its own credential.
   *
   * The refusal that used to sit here — one token per score, ever — was the
   * assumption that a score lives on exactly one computer. It does not: a
   * token cannot be handed over twice because only its hash was kept, so
   * reaching a score from a laptop *and* a studio machine has to mean two
   * tokens or it means copying a secret between keychains by hand. Two also
   * makes the studio machine revocable on its own, which one never was.
   */
  fastify.post('/:id/token', { config: { rateLimit: CREATE_LIMIT } }, async (request, reply) => {
    const account = requireAccount(db, request, reply, cookieSecure);
    if (!account) return reply;

    const { id } = request.params as { id: string };

    const score = db
      .select({ id: scores.id, name: scores.name })
      .from(scores)
      .where(and(eq(scores.id, id), eq(scores.accountId, account.id)))
      .get();

    // Same answer for "no such score" and "not yours": which one it is is not
    // this caller's business.
    if (!score) {
      return reply.code(404).send(errorBody('no_such_score', 'No score with that id.'));
    }

    const token = mintScoreToken(
      db,
      score.id,
      deviceName((request.body as { name?: unknown } | null)?.name)
    );

    return reply.code(201).send({
      id: score.id,
      name: score.name,
      url: cloneUrl(publicUrl, account.id, score.id),
      username: account.id,
      token: token.token,
      tokenName: token.name,
    });
  });

  fastify.get('/', async (request, reply) => {
    const account = requireAccount(db, request, reply, cookieSecure);
    if (!account) return reply;

    const rows = db
      .select({ id: scores.id, name: scores.name, createdAt: scores.createdAt })
      .from(scores)
      .where(eq(scores.accountId, account.id))
      .orderBy(desc(scores.createdAt))
      .all();

    // Second query rather than a join: a score with two devices would come
    // back from a join as two scores, and the caller renders one row per
    // element of this array.
    const tokens = listScoreTokens(
      db,
      rows.map((row) => row.id)
    );

    return reply.send(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        url: cloneUrl(publicUrl, account.id, row.id),
        createdAt: row.createdAt.toISOString(),
        // Names, ids and dates only. The values do not exist any more, and a
        // row that implied otherwise would be a lie the user acts on.
        tokens: (tokens.get(row.id) ?? []).map((token) => ({
          id: token.id,
          name: token.name,
          createdAt: token.createdAt.toISOString(),
        })),
      }))
    );
  });
}

function cloneUrl(publicUrl: string, accountId: string, scoreId: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/git/${accountId}/${scoreId}.git`;
}
