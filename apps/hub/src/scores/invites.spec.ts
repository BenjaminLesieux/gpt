import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app/app';
import { SESSION_COOKIE } from '../auth/cookie';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabaseHandle } from '../db/client';
import { scoreInvites, scoreMembers, scores } from '../db/schema';
import { INVITE_TTL_MS, acceptScoreInvite, purgeExpiredInvites } from './invites';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');
const PUBLIC_URL = 'https://hub.example.com';
const OWNER = { email: 'player@example.com', password: 'a decent passphrase' };

let handle: HubDatabaseHandle;
let server: FastifyInstance;
let gitRoot: string;
let session: string;

/** An account and the cookie that speaks for it. */
async function signUp(email: string): Promise<{ id: string; session: string }> {
  const response = await server.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email, password: 'another decent passphrase' },
  });
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error(`signup issued no session cookie: ${response.body}`);
  return { id: response.json().id, session: cookie.value };
}

beforeEach(async () => {
  gitRoot = await mkdtemp(path.join(tmpdir(), 'gpt-invites-'));

  handle = openDatabase(':memory:');
  migrateToLatest(handle.db, MIGRATIONS);

  server = Fastify();
  await server.register(app, {
    db: handle.db,
    cookieSecure: false,
    gitRoot,
    publicUrl: PUBLIC_URL,
  });
  await server.ready();

  const signup = await server.inject({ method: 'POST', url: '/auth/signup', payload: OWNER });
  const cookie = signup.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error('signup issued no session cookie');
  session = cookie.value;
});

afterEach(async () => {
  await server.close();
  handle.close();
  await rm(gitRoot, { recursive: true, force: true });
});

async function createScore(name = 'Blackbird'): Promise<{ id: string }> {
  const created = await server.inject({
    method: 'POST',
    url: '/scores',
    payload: { name },
    cookies: { [SESSION_COOKIE]: session },
  });
  return created.json();
}

/** The whole of what the inviter copies. */
async function inviteTo(scoreId: string, cookie = session): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: `/scores/${scoreId}/invites`,
    cookies: { [SESSION_COOKIE]: cookie },
  });
  expect(response.statusCode).toBe(201);
  return response.json().code;
}

function accept(code: string, cookie: string | null): Promise<LightMyRequestResponse> {
  return server.inject({
    method: 'POST',
    url: `/invites/${encodeURIComponent(code)}`,
    ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}),
  });
}

/** Drags every live invite's expiry into the past. These tests make one at a
 * time, so there is nothing to be selective about and nothing to wait for. */
function expire(): void {
  handle.db
    .update(scoreInvites)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .run();
}

function membersOf(scoreId: string) {
  return handle.db.select().from(scoreMembers).where(eq(scoreMembers.scoreId, scoreId)).all();
}

describe('POST /scores/:id/invites', () => {
  it('should hand back a code, when it stops working, and no credential', async () => {
    // Given
    const score = await createScore();

    // When
    const response = await server.inject({
      method: 'POST',
      url: `/scores/${score.id}/invites`,
      cookies: { [SESSION_COOKIE]: session },
    });

    // Then
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(body.scoreName).toBe('Blackbird');
    expect(body).not.toHaveProperty('token');
    expect(body).not.toHaveProperty('url');
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(INVITE_TTL_MS);
  });

  it('should outlive a clone claim by days', async () => {
    // Given / When — a link sent to a drummer who may be asleep, rather than
    // one fired at an app on the same machine.
    const score = await createScore();
    const response = await server.inject({
      method: 'POST',
      url: `/scores/${score.id}/invites`,
      cookies: { [SESSION_COOKIE]: session },
    });

    // Then
    const lifetime = new Date(response.json().expiresAt).getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it('should never write the code down, only its hash', async () => {
    // Given
    const score = await createScore();

    // When
    const code = await inviteTo(score.id);

    // Then
    const rows = handle.db.select().from(scoreInvites).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].codeHash).not.toBe(code);
    expect(rows[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].acceptedAt).toBeNull();
  });

  it('should record which member held it out', async () => {
    // Given
    const score = await createScore();

    // When
    await inviteTo(score.id);

    // Then — nobody is named as the recipient, because there is no mailer to
    // tell them. Only the sender is on the row.
    const row = handle.db.select().from(scoreInvites).get();
    const owner = membersOf(score.id)[0];
    expect(row?.invitedBy).toBe(owner.accountId);
  });

  it('should let a member invite, not only the owner', async () => {
    // Given a score shared with a second person
    const score = await createScore();
    const drummer = await signUp('drummer@example.com');
    await accept(await inviteTo(score.id), drummer.session);

    // When
    const response = await server.inject({
      method: 'POST',
      url: `/scores/${score.id}/invites`,
      cookies: { [SESSION_COOKIE]: drummer.session },
    });

    // Then — `owner` buys removing people and deleting the score, and nothing
    // else; a band that cannot add its own bassist is not a band.
    expect(response.statusCode).toBe(201);
  });

  it('should answer the same for a score that is not yours as for one that does not exist', async () => {
    // Given
    const score = await createScore();
    const stranger = await signUp('stranger@example.com');

    // When
    const theirs = await server.inject({
      method: 'POST',
      url: `/scores/${score.id}/invites`,
      cookies: { [SESSION_COOKIE]: stranger.session },
    });
    const missing = await server.inject({
      method: 'POST',
      url: '/scores/nosuchscoreid/invites',
      cookies: { [SESSION_COOKIE]: stranger.session },
    });

    // Then
    expect(theirs.statusCode).toBe(404);
    expect(theirs.json()).toEqual(missing.json());
  });

  it('should need a session', async () => {
    // Given
    const score = await createScore();

    // When
    const anonymous = await server.inject({
      method: 'POST',
      url: `/scores/${score.id}/invites`,
    });

    // Then
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('GET /invites/:code', () => {
  it('should name the score and who is asking, and consume nothing', async () => {
    // Given
    const score = await createScore();
    const code = await inviteTo(score.id);
    const drummer = await signUp('drummer@example.com');

    // When — no session: the invitee may not have an account yet, and being
    // asked to sign up before being told what for is how an invite is ignored.
    const peek = await server.inject({ method: 'GET', url: `/invites/${code}` });

    // Then
    expect(peek.statusCode).toBe(200);
    expect(peek.json()).toEqual({ scoreName: 'Blackbird', invitedBy: OWNER.email });
    // Cancelling the screen must leave the invite acceptable.
    expect((await accept(code, drummer.session)).statusCode).toBe(201);
  });

  it('should refuse a code that names nothing', async () => {
    // Given / When
    const peek = await server.inject({ method: 'GET', url: '/invites/nosuchcode' });

    // Then
    expect(peek.statusCode).toBe(404);
    expect(peek.json().error.code).toBe('no_such_invite');
  });

  it('should refuse an invite that has run out', async () => {
    // Given
    const score = await createScore();
    const code = await inviteTo(score.id);
    expire();

    // When
    const peek = await server.inject({ method: 'GET', url: `/invites/${code}` });

    // Then
    expect(peek.statusCode).toBe(410);
    expect(peek.json().error.code).toBe('invite_expired');
  });
});

describe('POST /invites/:code', () => {
  it('should put the accepter on the score, as a member', async () => {
    // Given
    const score = await createScore();
    const code = await inviteTo(score.id);
    const drummer = await signUp('drummer@example.com');

    // When
    const accepted = await accept(code, drummer.session);

    // Then
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toEqual({ id: score.id, name: 'Blackbird', role: 'member' });
    const roles = membersOf(score.id).map((row) => [row.accountId, row.role]);
    expect(roles).toContainEqual([drummer.id, 'member']);
    expect(roles).toHaveLength(2);
  });

  it('should make the score visible to them and nobody else', async () => {
    // Given
    const score = await createScore();
    const drummer = await signUp('drummer@example.com');
    const stranger = await signUp('stranger@example.com');

    // When
    await accept(await inviteTo(score.id), drummer.session);

    // Then — the whole point of the row.
    const theirs = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: drummer.session },
    });
    const nobody = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: stranger.session },
    });
    expect(theirs.json().map((s: { id: string }) => s.id)).toEqual([score.id]);
    expect(nobody.json()).toEqual([]);
  });

  it('should hand back no credential of any kind', async () => {
    // Given
    const score = await createScore();
    const drummer = await signUp('drummer@example.com');

    // When
    const accepted = await accept(await inviteTo(score.id), drummer.session);

    // Then — joining a score and getting it onto a machine are two different
    // acts; the second is the Clone button, which mints a token per machine.
    expect(accepted.body).not.toContain('token');
    expect(accepted.body).not.toContain('/git/');
  });

  it('should refuse an accept with no session', async () => {
    // Given
    const score = await createScore();
    const code = await inviteTo(score.id);

    // When — an invite adds an account to a score, so there has to be one.
    const anonymous = await accept(code, null);

    // Then
    expect(anonymous.statusCode).toBe(401);
    expect(membersOf(score.id)).toHaveLength(1);
    // Refused rather than silently dropped: the invite is still good once the
    // invitee has signed up.
    expect(handle.db.select().from(scoreInvites).get()?.acceptedAt).toBeNull();
  });

  it('should work once', async () => {
    // Given
    const score = await createScore();
    const code = await inviteTo(score.id);
    const drummer = await signUp('drummer@example.com');
    const bassist = await signUp('bassist@example.com');

    // When
    expect((await accept(code, drummer.session)).statusCode).toBe(201);
    const again = await accept(code, bassist.session);

    // Then
    expect(again.statusCode).toBe(410);
    expect(again.json().error.code).toBe('invite_accepted');
    expect(membersOf(score.id)).toHaveLength(2);
  });

  it('should tell a spent invite apart from a code that never existed', async () => {
    // Given
    const score = await createScore();
    const code = await inviteTo(score.id);
    const drummer = await signUp('drummer@example.com');
    await accept(code, drummer.session);
    const bassist = await signUp('bassist@example.com');

    // When
    const spent = await accept(code, bassist.session);
    const never = await accept('nosuchcode', bassist.session);

    // Then — the row is kept, as a spent claim is: "ask for another link" and
    // "that link is nonsense" are different sentences on screen.
    expect(spent.json().error.code).toBe('invite_accepted');
    expect(never.statusCode).toBe(404);
    expect(never.json().error.code).toBe('no_such_invite');
  });

  /**
   * Two bandmates opening the same forwarded link. Consumption is the UPDATE's
   * own WHERE rather than a read followed by a write, so this cannot end with
   * two members — which is the one outcome single-use exists to prevent.
   */
  it('should produce one membership and one refusal when two accepts race', async () => {
    // Given
    const score = await createScore();
    const code = await inviteTo(score.id);
    const drummer = await signUp('drummer@example.com');
    const bassist = await signUp('bassist@example.com');

    // When — better-sqlite3 is synchronous, so a race is these two calls back
    // to back; there is no interleaving for a promise to express.
    const outcomes = [
      acceptScoreInvite(handle.db, code, drummer.id),
      acceptScoreInvite(handle.db, code, bassist.id),
    ];

    // Then
    expect(outcomes.map((o) => o.status)).toEqual(['joined', 'accepted']);
    expect(membersOf(score.id)).toHaveLength(2);
  });

  it('should refuse somebody who is already on the score, without spending it', async () => {
    // Given the inviter opening their own link
    const score = await createScore();
    const code = await inviteTo(score.id);

    // When
    const mine = await accept(code, session);

    // Then
    expect(mine.statusCode).toBe(409);
    expect(mine.json().error.code).toBe('already_a_member');
    expect(membersOf(score.id)).toHaveLength(1);
    // Still there for whoever it was meant for.
    const drummer = await signUp('drummer@example.com');
    expect((await accept(code, drummer.session)).statusCode).toBe(201);
  });

  it('should refuse an invite that has run out, and leave it refusable', async () => {
    // Given
    const score = await createScore();
    const code = await inviteTo(score.id);
    const drummer = await signUp('drummer@example.com');
    expire();

    // When
    const accepted = await accept(code, drummer.session);

    // Then
    expect(accepted.statusCode).toBe(410);
    expect(accepted.json().error.code).toBe('invite_expired');
    // Not marked spent: "expired" stays the sentence on a second attempt.
    expect((await accept(code, drummer.session)).json().error.code).toBe('invite_expired');
    expect(membersOf(score.id)).toHaveLength(1);
  });
});

describe('housekeeping', () => {
  it('should drop a score’s dead invites as the next one is made', async () => {
    // Given
    const score = await createScore();
    const drummer = await signUp('drummer@example.com');
    await accept(await inviteTo(score.id), drummer.session);
    await inviteTo(score.id);
    expire();

    // When
    await inviteTo(score.id);

    // Then — only the newest survives: one spent, one expired, both collected.
    expect(handle.db.select().from(scoreInvites).all()).toHaveLength(1);
  });

  it('should sweep what outlived its expiry', async () => {
    // Given
    const score = await createScore();
    await inviteTo(score.id);
    expire();

    // When / Then
    expect(purgeExpiredInvites(handle.db)).toBe(1);
    expect(handle.db.select().from(scoreInvites).all()).toEqual([]);
  });

  it('should take a score’s invites with the score', async () => {
    // Given
    const score = await createScore();
    await inviteTo(score.id);

    // When
    handle.db.delete(scores).where(eq(scores.id, score.id)).run();

    // Then — the cascade, so a deleted score cannot leave a live way in.
    expect(handle.db.select().from(scoreInvites).all()).toEqual([]);
  });
});
