import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app/app';
import { SESSION_COOKIE } from '../auth/cookie';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabaseHandle } from '../db/client';
import { companionCodes, companionTokens } from '../db/schema';
import { redeemCompanionCode } from './routes';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');
const PUBLIC_URL = 'https://hub.example.com';
const CREDENTIALS = {
  email: 'player@example.com',
  password: 'a decent passphrase',
};

let handle: HubDatabaseHandle;
let server: FastifyInstance;
let gitRoot: string;
let session: string;

beforeEach(async () => {
  gitRoot = await mkdtemp(path.join(tmpdir(), 'gpt-companion-'));
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

  session = await signUp(CREDENTIALS.email, CREDENTIALS.password);
});

afterEach(async () => {
  await server.close();
  handle?.close();
  await rm(gitRoot, { recursive: true, force: true });
});

async function signUp(email: string, password: string): Promise<string> {
  const signup = await server.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email, password },
  });
  const cookie = signup.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error('signup issued no session cookie');
  return cookie.value;
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

function mintCode(
  challenge: string,
  challengeMethod = 'S256',
  cookie = session,
) {
  return server.inject({
    method: 'POST',
    url: '/companion/codes',
    payload: { challenge, challengeMethod },
    cookies: { [SESSION_COOKIE]: cookie },
  });
}

function redeem(
  code: string,
  verifier: string,
  device?: string,
): Promise<LightMyRequestResponse> {
  return server.inject({
    method: 'POST',
    url: '/companion/tokens',
    payload: { code, verifier, device },
  });
}

/** The whole round trip: a companion token for the signed-in account. */
async function signIn(device = "Ben's MacBook"): Promise<string> {
  const { verifier, challenge } = pkce();
  const code = (await mintCode(challenge)).json().code;
  const redeemed = await redeem(code, verifier, device);
  expect(redeemed.statusCode).toBe(201);
  return redeemed.json().token;
}

function asCompanion(method: 'GET' | 'POST', url: string, token: string) {
  return server.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function createScore(
  name = 'Blackbird',
  cookie = session,
): Promise<{ id: string; username: string }> {
  const created = await server.inject({
    method: 'POST',
    url: '/scores',
    payload: { name },
    cookies: { [SESSION_COOKIE]: cookie },
  });
  return created.json();
}

describe('POST /companion/codes', () => {
  it('mints a code and writes down only its hash', async () => {
    const { challenge } = pkce();

    const response = await mintCode(challenge);

    expect(response.statusCode).toBe(201);
    const [row] = handle.db.select().from(companionCodes).all();
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).not.toBe(response.json().code);
    expect(row.challenge).toBe(challenge);
  });

  it('refuses a plain challenge rather than downgrading', async () => {
    const { verifier } = pkce();

    const response = await mintCode(verifier, 'plain');

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('unsupported_challenge_method');
    expect(handle.db.select().from(companionCodes).all()).toEqual([]);
  });

  it('refuses a challenge with no method', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/companion/codes',
      payload: { challenge: pkce().challenge },
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(response.statusCode).toBe(400);
  });

  it('needs a session', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/companion/codes',
      payload: { challenge: pkce().challenge, challengeMethod: 'S256' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /companion/tokens', () => {
  it('spends the code for a token and the account email, and keeps only its hash', async () => {
    const { verifier, challenge } = pkce();
    const code = (await mintCode(challenge)).json().code;

    const redeemed = await redeem(code, verifier, "Ben's MacBook");

    expect(redeemed.statusCode).toBe(201);
    expect(redeemed.json()).toEqual({
      token: expect.any(String),
      email: CREDENTIALS.email,
    });
    const [row] = handle.db.select().from(companionTokens).all();
    expect(row.device).toBe("Ben's MacBook");
    expect(row.tokenHash).not.toBe(redeemed.json().token);
  });

  it('refuses a wrong verifier and leaves the code spendable', async () => {
    const { verifier, challenge } = pkce();
    const code = (await mintCode(challenge)).json().code;

    const wrong = await redeem(code, pkce().verifier);

    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.code).toBe('wrong_verifier');
    expect((await redeem(code, verifier)).statusCode).toBe(201);
  });

  it('refuses an expired code', async () => {
    const { verifier, challenge } = pkce();
    const code = (await mintCode(challenge)).json().code;
    handle.db
      .update(companionCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .run();

    const redeemed = await redeem(code, verifier);

    expect(redeemed.statusCode).toBe(410);
    expect(redeemed.json().error.code).toBe('code_expired');
  });

  it('refuses a spent code', async () => {
    const { verifier, challenge } = pkce();
    const code = (await mintCode(challenge)).json().code;
    await redeem(code, verifier);

    const again = await redeem(code, verifier);

    expect(again.statusCode).toBe(410);
    expect(again.json().error.code).toBe('code_redeemed');
    expect(handle.db.select().from(companionTokens).all()).toHaveLength(1);
  });

  it('refuses a code that names nothing', async () => {
    const redeemed = await redeem('nosuchcode', pkce().verifier);

    expect(redeemed.statusCode).toBe(404);
    expect(redeemed.json().error.code).toBe('no_such_code');
  });

  it('produces one token and one refusal when two redemptions race', async () => {
    const { verifier, challenge } = pkce();
    const code = (await mintCode(challenge)).json().code;

    // better-sqlite3 is synchronous, so a race is these two calls back to back.
    const outcomes = [
      redeemCompanionCode(handle.db, code, verifier),
      redeemCompanionCode(handle.db, code, verifier),
    ];

    expect(outcomes.map((o) => o.status)).toEqual(['valid', 'redeemed']);
  });
});

describe('a companion token', () => {
  it('says whose it is', async () => {
    const token = await signIn();

    const me = await asCompanion('GET', '/companion/me', token);

    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ email: CREDENTIALS.email });
  });

  it('lists the scores the account is a member of, and no one else’s', async () => {
    const score = await createScore();
    await createScore(
      'Not yours',
      await signUp('someone@example.com', 'another passphrase'),
    );
    const token = await signIn();

    const scores = await asCompanion('GET', '/companion/scores', token);

    expect(scores.json()).toEqual([
      {
        id: score.id,
        name: 'Blackbird',
        url: `${PUBLIC_URL}/git/${score.username}/${score.id}.git`,
        createdAt: expect.any(String),
      },
    ]);
  });

  it('mints a score token that opens the git route, named after the device', async () => {
    const score = await createScore();
    const token = await signIn('Studio iMac');

    const minted = await asCompanion(
      'POST',
      `/companion/scores/${score.id}/token`,
      token,
    );

    expect(minted.statusCode).toBe(201);
    const body = minted.json();
    expect(body).toMatchObject({
      url: `${PUBLIC_URL}/git/${body.username}/${score.id}.git`,
    });
    expect(body.tokenName).toBe('Studio iMac');
    const git = await server.inject({
      method: 'GET',
      url: `/git/${body.username}/${score.id}.git/info/refs?service=git-upload-pack`,
      headers: {
        authorization: `Basic ${Buffer.from(`x:${body.token}`).toString('base64')}`,
      },
    });
    expect(git.statusCode).toBe(200);
  });

  it('mints nothing for a score the account is not on', async () => {
    const token = await signIn();

    const minted = await asCompanion(
      'POST',
      '/companion/scores/nosuchscore/token',
      token,
    );

    expect(minted.statusCode).toBe(404);
  });

  it('cannot push', async () => {
    const score = await createScore();
    const token = await signIn();

    const push = await server.inject({
      method: 'GET',
      url: `/git/${score.username}/${score.id}.git/info/refs?service=git-receive-pack`,
      headers: {
        authorization: `Basic ${Buffer.from(`x:${token}`).toString('base64')}`,
      },
    });

    expect(push.statusCode).toBe(401);
  });

  it('is refused once revoked', async () => {
    const token = await signIn();
    const [device] = (
      await server.inject({
        method: 'GET',
        url: '/companion/tokens',
        cookies: { [SESSION_COOKIE]: session },
      })
    ).json();

    const revoked = await server.inject({
      method: 'DELETE',
      url: `/companion/tokens/${device.id}`,
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(revoked.statusCode).toBe(204);
    const me = await asCompanion('GET', '/companion/me', token);
    expect(me.statusCode).toBe(401);
    expect(me.json().error.code).toBe('token_revoked');
  });

  it('is refused when it names nothing, or is missing', async () => {
    expect(
      (await asCompanion('GET', '/companion/me', 'nosuchtoken')).statusCode,
    ).toBe(401);
    expect(
      (await server.inject({ method: 'GET', url: '/companion/me' })).statusCode,
    ).toBe(401);
  });
});

describe('devices', () => {
  it('lists the account’s live companion tokens and stamps their use', async () => {
    const token = await signIn("Ben's MacBook");
    await asCompanion('GET', '/companion/me', token);

    const list = await server.inject({
      method: 'GET',
      url: '/companion/tokens',
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(list.json()).toEqual([
      {
        id: expect.any(String),
        device: "Ben's MacBook",
        createdAt: expect.any(String),
        lastUsedAt: expect.any(String),
      },
    ]);
  });

  it('cannot revoke another account’s device', async () => {
    await signIn();
    const [device] = handle.db.select().from(companionTokens).all();
    const stranger = await signUp('someone@example.com', 'another passphrase');

    const revoked = await server.inject({
      method: 'DELETE',
      url: `/companion/tokens/${device.id}`,
      cookies: { [SESSION_COOKIE]: stranger },
    });

    expect(revoked.statusCode).toBe(404);
    expect(
      handle.db.select().from(companionTokens).all()[0].revokedAt,
    ).toBeNull();
  });
});
