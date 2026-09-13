import type { FastifyInstance } from 'fastify';
import { errorBody } from '../app/errors';
import { requireAccount } from '../auth/session-guard';
import type { HubDatabase } from '../db/client';
import { normalizeGp } from '../git/normalize';
import { writeFirstVersion } from '../git/versions';
import { readMemberScore } from './members';

export interface ImportRoutesOptions {
  db: HubDatabase;
  cookieSecure: boolean;
  gitRoot: string;
}

const SCORE_CONTENT_TYPE = 'application/octet-stream';

/**
 * Guitar Pro writes well under a megabyte for an ordinary song, and rather
 * more once a score embeds audio. Generous rather than tight: the cost of
 * being wrong upwards is disk, and the cost of being wrong downwards is a
 * musician who cannot import their own file.
 */
const MAX_SCORE_BYTES = 32 * 1024 * 1024;

/**
 * What the first version of an imported score is called. Deliberately not the
 * uploaded filename: decision 9 keeps score titles out of clone urls, and a
 * filename passed as a query parameter would put the song title straight into
 * the access log instead. The name the musician typed is already on the row.
 */
const FIRST_VERSION_MESSAGE = 'Imported';

/**
 * Its own plugin, registered alongside `scoreRoutes` under the same prefix,
 * for the reason `gitRoutes` is also its own: this route's body is a file and
 * needs a content-type parser that must not reach the JSON API.
 */
export async function importRoutes(fastify: FastifyInstance, opts: ImportRoutesOptions) {
  const { db, cookieSecure, gitRoot } = opts;

  fastify.addContentTypeParser(
    SCORE_CONTENT_TYPE,
    { parseAs: 'buffer', bodyLimit: MAX_SCORE_BYTES },
    (_request, body, done) => done(null, body)
  );

  fastify.post('/:id/import', { bodyLimit: MAX_SCORE_BYTES }, async (request, reply) => {
    const account = requireAccount(db, request, reply, cookieSecure);
    if (!account) return reply;

    const { id } = request.params as { id: string };

    const score = readMemberScore(db, id, account.id);

    // Same answer for "no such score" and "not yours", as everywhere else.
    if (!score) {
      return reply.code(404).send(errorBody('no_such_score', 'No score with that id.'));
    }

    // Content-type parsers are inherited, so the JSON parser above is still
    // in this scope and a JSON body arrives parsed rather than refused. Two
    // answers rather than one: "that was not a file" and "that file was
    // empty" are different mistakes.
    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      return reply
        .code(415)
        .send(
          errorBody(
            'not_a_file',
            `Send the .gp file as the request body, with content-type ${SCORE_CONTENT_TYPE}.`
          )
        );
    }
    if (body.length === 0) {
      return reply.code(400).send(errorBody('empty_score', 'That file is empty.'));
    }

    // Before the blob, always. The companion normalizes every byte it commits
    // so that a Guitar Pro save which changed no note produces no new
    // version; a first version written raw would make the musician's next
    // save look like a musical change. See docs/normalize-gp.md.
    const normalized = normalizeGp(body);

    // The owner's segment, not the caller's: this writes into the repository
    // the score already lives in, which does not move when it is shared.
    const written = await writeFirstVersion(
      gitRoot,
      score.ownerId,
      score.id,
      normalized,
      FIRST_VERSION_MESSAGE
    );

    if (written.status === 'invalid_id') {
      // Unreachable from a row that exists, since the same validation gated
      // the directory being created. Refusing rather than trusting it is the
      // point: this is the first code that writes into a repository path
      // without http-backend in front of it.
      return reply.code(404).send(errorBody('no_such_score', 'No score with that id.'));
    }

    if (written.status === 'already_has_versions') {
      return reply
        .code(409)
        .send(
          errorBody(
            'already_has_versions',
            'This score already has a version. Import only starts an empty one.'
          )
        );
    }

    return reply.code(201).send({
      id: score.id,
      name: score.name,
      version: written.commit,
      message: FIRST_VERSION_MESSAGE,
    });
  });
}
