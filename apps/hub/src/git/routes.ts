import type { FastifyInstance } from 'fastify';
import { errorBody } from '../app/errors';
import type { HubDatabase } from '../db/client';
import { readScoreToken, touchScoreToken } from '../scores/tokens';
import { proxyToGit } from './http-backend';
import { readHeads, recordPush } from './pushes';
import { repositoryPath } from './repositories';

export interface GitRoutesOptions {
  db: HubDatabase;
  /** Directory holding `<band>/<score>.git`. */
  gitRoot: string;
}

export async function gitRoutes(fastify: FastifyInstance, opts: GitRoutesOptions) {
  const { db, gitRoot } = opts;

  // Fastify would otherwise parse these away. git's request bodies have to
  // reach the CGI as the stream they are.
  fastify.addContentTypeParser(/^application\/x-git/, (_request, payload, done) =>
    done(null, payload)
  );

  fastify.all('/:band/:repo/*', async (request, reply) => {
    const { band, repo } = request.params as { band: string; repo: string };

    const password = basicAuthPassword(request.headers.authorization);
    if (!password) {
      // Without the challenge git gives up instead of asking for credentials.
      reply
        .header('WWW-Authenticate', 'Basic realm="gitarpro"')
        .code(401)
        .send(errorBody('no_credentials', 'This repository needs a username and token.'));
      return;
    }

    const bearer = readScoreToken(db, password);
    if (!bearer) {
      reply.code(401).send(errorBody('invalid_token', 'That token is not valid.'));
      return;
    }

    // Two facts. The path is where the repository is stored, so it is checked
    // against the token's band; that the holder may be here at all
    // `readScoreToken` has already made by joining `band_members`. Dropping the
    // path comparison is somebody else's repository.
    if (band !== bearer.bandId || repo !== `${bearer.scoreId}.git`) {
      reply.code(403).send(errorBody('wrong_repository', 'That token is for another score.'));
      return;
    }

    const repository = repositoryPath(gitRoot, bearer.bandId, bearer.scoreId);
    if (!repository) {
      reply.code(404).send(errorBody('not_found', 'No such repository.'));
      return;
    }

    const rest = (request.params as Record<string, string>)['*'];
    const receivePack = request.method === 'POST' && rest === 'git-receive-pack';

    // Stamped before the proxy rather than after it. The cost of being early
    // is that a push which fails inside receive-pack still counts as activity
    // — which is true, someone tried — where the cost of being late would be
    // dropping every stamp on a connection the client closed. `score_pushes`
    // below wants the opposite and is read the other side of the CGI.
    touchScoreToken(db, bearer, receivePack);

    // Read before a single byte reaches receive-pack. Awaiting here leaves the
    // request body paused in the socket rather than lost; reading it any later
    // would be reading the tips the push itself has already written.
    const before = receivePack ? await readHeads(repository) : null;

    proxyToGit(request, reply, {
      projectRoot: gitRoot,
      pathInfo: `/${band}/${repo}/${rest}`,
      remoteUser: bearer.tokenId,
      onFinished: before
        ? () => {
            // The reply has already been streamed and closed, so a failure to
            // write the history cannot be reported to the pusher — and must
            // not take the process down either.
            recordPush(db, repository, bearer, before).catch((error: unknown) =>
              request.log.error({ err: error }, 'failed to record a push')
            );
          }
        : undefined,
    });
  });
}

export function basicAuthPassword(header: string | undefined): string | null {
  const basic = /^Basic (.+)$/.exec(header ?? '');
  if (!basic) return null;

  // git sends the token as the password and ignores the username, which is
  // why the username here is not checked against anything.
  const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) return null;

  return decoded.slice(separator + 1) || null;
}
