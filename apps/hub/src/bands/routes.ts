import type { FastifyInstance } from 'fastify';
import { errorBody } from '../app/errors';
import { requireAccount } from '../auth/session-guard';
import type { HubDatabase } from '../db/client';
import { listBandMembers, listMemberBands, readMemberBand } from './bands';

export interface BandRoutesOptions {
  db: HubDatabase;
  cookieSecure: boolean;
}

export async function bandRoutes(fastify: FastifyInstance, opts: BandRoutesOptions) {
  const { db, cookieSecure } = opts;

  fastify.get('/', async (request, reply) => {
    const account = requireAccount(db, request, reply, cookieSecure);
    if (!account) return reply;

    return reply.send(listMemberBands(db, account.id));
  });

  fastify.get('/:id/members', async (request, reply) => {
    const account = requireAccount(db, request, reply, cookieSecure);
    if (!account) return reply;

    const { id } = request.params as { id: string };
    const band = readMemberBand(db, id, account.id);
    if (!band) {
      return reply.code(404).send(errorBody('no_such_band', 'No band with that id.'));
    }

    return reply.send({ ...band, members: listBandMembers(db, band.id) });
  });
}
