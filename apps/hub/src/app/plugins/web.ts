import { existsSync } from 'node:fs';
import staticFiles from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Prefixes the JSON API and git own; the SPA never answers for these. */
const API_PREFIXES = ['/auth/', '/scores', '/git/', '/health', '/invites'];

/**
 * The one client route that lives inside an API prefix: a score's own page,
 * `/scores/<id>`. It is the URL a musician links their band to, so it has to
 * be the readable one rather than something parked out of the way.
 *
 * The cost is a rule the API has to keep: **there is no bare
 * `GET /scores/:id`**. Everything score-scoped hangs one segment deeper —
 * `/scores/:id/history`, `/scores/:id/members` — which is why this pattern
 * is a single segment and nothing below it. Adding `GET /scores/:id` later
 * would not 404; it would quietly serve JSON to somebody's browser tab.
 */
const SCORE_PAGE = /^\/scores\/[^/]+$/;

/**
 * Whether a miss should be answered with the SPA shell rather than a JSON
 * 404. Client-side routes are real URLs the user can reload or link to, but
 * an unknown API path has to keep its 404 — answering it with HTML turns a
 * clear error into a JSON parse failure three frames away.
 */
export function servesShell(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const path = url.split('?')[0];
  if (SCORE_PAGE.test(path)) return true;
  return !API_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

/**
 * Serves the built hub-web bundle, when there is one. The directory is a
 * build artefact of a different project, so a hub running without it is an
 * ordinary API-only deployment rather than a misconfiguration — refusing to
 * boot over a missing UI would take the git remote down with it.
 */
export async function webRoutes(fastify: FastifyInstance, opts: { webRoot: string }) {
  if (!existsSync(opts.webRoot)) {
    fastify.log.info({ webRoot: opts.webRoot }, 'no web bundle found; serving the API only');
    return;
  }

  await fastify.register(staticFiles, { root: opts.webRoot, index: ['index.html'] });
}
