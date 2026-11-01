import * as path from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app/app';
import { SESSION_COOKIE } from '../auth/cookie';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabaseHandle } from '../db/client';
import { addBandMember } from './bands';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');

let handle: HubDatabaseHandle;
let server: FastifyInstance;

/** An account, the cookie that speaks for it, and the band signup made for it. */
async function signUp(email: string): Promise<{ id: string; session: string; bandId: string }> {
  const response = await server.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email, password: 'a decent passphrase' },
  });
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error(`signup issued no session cookie: ${response.body}`);
  const [band] = (await bandsOf(cookie.value)).json();
  return { id: response.json().id, session: cookie.value, bandId: band.id };
}

function bandsOf(session: string): Promise<LightMyRequestResponse> {
  return server.inject({ method: 'GET', url: '/bands', cookies: { [SESSION_COOKIE]: session } });
}

function membersOf(bandId: string, session: string): Promise<LightMyRequestResponse> {
  return server.inject({
    method: 'GET',
    url: `/bands/${bandId}/members`,
    cookies: { [SESSION_COOKIE]: session },
  });
}

beforeEach(async () => {
  handle = openDatabase(':memory:');
  migrateToLatest(handle.db, MIGRATIONS);

  server = Fastify();
  // Nothing here reaches git, so neither value is used.
  await server.register(app, {
    db: handle.db,
    cookieSecure: false,
    gitRoot: '/tmp/gpt-unused',
    publicUrl: 'http://localhost',
  });
  await server.ready();
});

afterEach(async () => {
  await server.close();
  handle?.close();
});

describe('GET /bands', () => {
  it('should list only the caller’s bands, the band of one first', async () => {
    // Given a guitarist who has joined a drummer's band, and a stranger
    const guitarist = await signUp('guitarist@example.com');
    const drummer = await signUp('drummer@example.com');
    await signUp('stranger@example.com');
    addBandMember(handle.db, drummer.bandId, guitarist.id, 'member');

    // When
    const response = await bandsOf(guitarist.session);

    // Then
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { id: guitarist.bandId, name: 'guitarist', role: 'owner' },
      { id: drummer.bandId, name: 'drummer', role: 'member' },
    ]);
  });

  it('should need a session', async () => {
    // Given / When
    const response = await server.inject({ method: 'GET', url: '/bands' });

    // Then
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /bands/:id/members', () => {
  it('should name everyone in the band, owner first, for a member', async () => {
    // Given
    const guitarist = await signUp('guitarist@example.com');
    const drummer = await signUp('drummer@example.com');
    addBandMember(handle.db, guitarist.bandId, drummer.id, 'member');

    // When
    const response = await membersOf(guitarist.bandId, drummer.session);

    // Then
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: guitarist.bandId,
      name: 'guitarist',
      role: 'member',
      members: [
        { id: guitarist.id, email: 'guitarist@example.com', role: 'owner' },
        { id: drummer.id, email: 'drummer@example.com', role: 'member' },
      ],
    });
  });

  it('should answer the same for a band that is not yours as for one that does not exist', async () => {
    // Given
    const guitarist = await signUp('guitarist@example.com');
    const stranger = await signUp('stranger@example.com');

    // When
    const theirs = await membersOf(guitarist.bandId, stranger.session);
    const missing = await membersOf('nosuchbandid', stranger.session);

    // Then
    expect(theirs.statusCode).toBe(404);
    expect(theirs.json().error.code).toBe('no_such_band');
    expect(theirs.json()).toEqual(missing.json());
  });
});
