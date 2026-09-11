import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { authRoutes } from '../auth/routes';
import type { HubDatabase } from '../db/client';
import { gitRoutes } from '../git/routes';
import { scoreRoutes } from '../scores/routes';
import errorHandler from './plugins/error-handler';
import health from './routes/health';

export interface AppOptions {
  db: HubDatabase;
  /** Only ever false over plain-http development. */
  cookieSecure: boolean;
  /** Directory holding the bare repositories, one per score. */
  gitRoot: string;
  /** The origin clone URLs are built from. */
  publicUrl: string;
}

/**
 * Registered by hand rather than by @fastify/autoload. Autoload walks
 * `__dirname`, which does not exist under vitest's ESM transform, so the
 * whole app could only ever be assembled in production — the one place
 * nothing checks that it assembles.
 */
export async function app(fastify: FastifyInstance, opts: AppOptions) {
  await fastify.register(errorHandler);
  await fastify.register(cookie);

  await fastify.register(health);
  await fastify.register(authRoutes, { ...opts, prefix: '/auth' });
  await fastify.register(scoreRoutes, { ...opts, prefix: '/scores' });

  // Its own scope: the raw-stream content-type parser git needs must not
  // apply to the JSON API.
  await fastify.register(gitRoutes, { db: opts.db, gitRoot: opts.gitRoot, prefix: '/git' });
}
