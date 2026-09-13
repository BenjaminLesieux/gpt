import type { FastifyInstance } from 'fastify';
import { errorBody } from '../app/errors';
import type { HubDatabase } from '../db/client';
import { readScoreToken, touchScoreToken } from '../scores/tokens';
import { proxyToGit } from './http-backend';
import { repositoryPath } from './repositories';

export interface GitRoutesOptions {
  db: HubDatabase;
  /** Directory holding `<account>/<score>.git`. */
  gitRoot: string;
}

export async function gitRoutes(fastify: FastifyInstance, opts: GitRoutesOptions) {
  const { db, gitRoot } = opts;

  // Fastify would otherwise parse these away. git's request bodies have to
  // reach the CGI as the stream they are.
  fastify.addContentTypeParser(/^application\/x-git/, (_request, payload, done) =>
    done(null, payload)
  );

  fastify.all('/:account/:repo/*', (request, reply) => {
    const { account, repo } = request.params as { account: string; repo: string };

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

    // A token is minted per score, so it reaches exactly one repository. This
    // comparison is the whole isolation guarantee - not a scope model
    // borrowed from somewhere else.
    if (account !== bearer.accountId || repo !== `${bearer.scoreId}.git`) {
      reply.code(403).send(errorBody('wrong_repository', 'That token is for another score.'));
      return;
    }

    if (!repositoryPath(gitRoot, bearer.accountId, bearer.scoreId)) {
      reply.code(404).send(errorBody('not_found', 'No such repository.'));
      return;
    }

    const rest = (request.params as Record<string, string>)['*'];

    // Stamped before the proxy rather than after it: `proxyToGit` hijacks the
    // reply and streams, so there is no completion to hang this off without
    // reaching into the CGI's exit. The cost of being early is that a push
    // which fails inside receive-pack still counts as activity — which is
    // true, someone tried — where the cost of being late would be dropping
    // every stamp on a connection the client closed.
    touchScoreToken(db, bearer, request.method === 'POST' && rest === 'git-receive-pack');

    proxyToGit(request, reply, {
      projectRoot: gitRoot,
      pathInfo: `/${account}/${repo}/${rest}`,
      remoteUser: bearer.tokenId,
    });
  });
}

function basicAuthPassword(header: string | undefined): string | null {
  const basic = /^Basic (.+)$/.exec(header ?? '');
  if (!basic) return null;

  // git sends the token as the password and ignores the username, which is
  // why the username here is not checked against anything.
  const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) return null;

  return decoded.slice(separator + 1) || null;
}
