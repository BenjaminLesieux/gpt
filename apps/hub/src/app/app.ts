import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { authRoutes } from '../auth/routes';
import type { HubDatabase } from '../db/client';
import { gitRoutes } from '../git/routes';
import { scoreRoutes } from '../scores/routes';
import errorHandler from './plugins/error-handler';
import health from './routes/health';
import { webRoutes } from './plugins/web';

export interface AppOptions {
  db: HubDatabase;
  /** Only ever false over plain-http development. */
  cookieSecure: boolean;
  /** Directory holding the bare repositories, one per score. */
  gitRoot: string;
  /** The origin clone URLs are built from. */
  publicUrl: string;
  /**
   * Built hub-web bundle. Optional: the hub is a working git remote and JSON
   * API without a UI, and every test builds it that way.
   */
  webRoot?: string;
}

/**
 * Registered by hand rather than by @fastify/autoload. Autoload walks
 * `__dirname`, which does not exist under vitest's ESM transform, so the
 * whole app could only ever be assembled in production — the one place
 * nothing checks that it assembles.
 */
export async function app(fastify: FastifyInstance, opts: AppOptions) {
  // Static first: the not-found handler below calls reply.sendFile.
  if (opts.webRoot) await fastify.register(webRoutes, { webRoot: opts.webRoot });
  await fastify.register(errorHandler, { webRoot: opts.webRoot });
  await fastify.register(cookie);

  await fastify.register(health);
  await fastify.register(authRoutes, { ...opts, prefix: '/auth' });
  await fastify.register(scoreRoutes, { ...opts, prefix: '/scores' });

  // Its own scope: the raw-stream content-type parser git needs must not
  // apply to the JSON API.
  await fastify.register(gitRoutes, { db: opts.db, gitRoot: opts.gitRoot, prefix: '/git' });

}
