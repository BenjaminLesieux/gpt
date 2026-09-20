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
import { cloneClaims, scoreTokens, scores } from '../db/schema';
import { CLAIM_TTL_MS, purgeExpiredClaims, redeemCloneClaim } from './claims';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');
const PUBLIC_URL = 'https://hub.example.com';
const CREDENTIALS = { email: 'player@example.com', password: 'a decent passphrase' };

let handle: HubDatabaseHandle;
let server: FastifyInstance;
let gitRoot: string;
let session: string;

beforeEach(async () => {
  gitRoot = await mkdtemp(path.join(tmpdir(), 'gpt-claims-'));

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

  const signup = await server.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: CREDENTIALS,
  });
  const cookie = signup.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error('signup issued no session cookie');
  session = cookie.value;
});

afterEach(async () => {
  await server.close();
  handle?.close();
  await rm(gitRoot, { recursive: true, force: true });
});

async function createScore(name = 'Blackbird'): Promise<{ id: string; token: string }> {
  const created = await server.inject({
    method: 'POST',
    url: '/scores',
    payload: { name },
    cookies: { [SESSION_COOKIE]: session },
  });
  return created.json();
}

/** The whole of what the browser puts in the link. */
async function claimFor(scoreId: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: `/scores/${scoreId}/clone-claims`,
    cookies: { [SESSION_COOKIE]: session },
  });
  expect(response.statusCode).toBe(201);
  return response.json().code;
}

function redeem(code: string, device?: string): Promise<LightMyRequestResponse> {
  return server.inject({
    method: 'POST',
    url: `/claims/${encodeURIComponent(code)}`,
    payload: device === undefined ? {} : { device },
  });
}

/** Drags every live claim's expiry into the past. These tests make one at a
 * time, so there is nothing to be selective about and nothing to wait for. */
function expire(): void {
  handle.db
    .update(cloneClaims)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .run();
}

describe('POST /scores/:id/clone-claims', () => {
  it('hands back a code and when it stops working, and no credential', async () => {
    const score = await createScore();

    const response = await server.inject({
      method: 'POST',
      url: `/scores/${score.id}/clone-claims`,
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(body.scoreName).toBe('Blackbird');
    // The value that ends up in a gitarpro:// URL is a claim and nothing else.
    expect(body).not.toHaveProperty('token');
    expect(body).not.toHaveProperty('url');
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(CLAIM_TTL_MS);
  });

  it('never writes the code down, only its hash', async () => {
    const score = await createScore();

    const code = await claimFor(score.id);

    const rows = handle.db.select().from(cloneClaims).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].codeHash).not.toBe(code);
    expect(rows[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].redeemedAt).toBeNull();
  });

  it('answers the same for a score that is not yours as for one that does not exist', async () => {
    const score = await createScore();
    const stranger = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'someone@example.com', password: 'another passphrase' },
    });
    const theirSession = stranger.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';

    const theirs = await server.inject({
      method: 'POST',
      url: `/scores/${score.id}/clone-claims`,
      cookies: { [SESSION_COOKIE]: theirSession },
    });
    const missing = await server.inject({
      method: 'POST',
      url: '/scores/nosuchscoreid/clone-claims',
      cookies: { [SESSION_COOKIE]: theirSession },
    });

    expect(theirs.statusCode).toBe(404);
    expect(theirs.json()).toEqual(missing.json());
  });

  it('needs a session', async () => {
    const score = await createScore();

    const anonymous = await server.inject({
      method: 'POST',
      url: `/scores/${score.id}/clone-claims`,
    });

    expect(anonymous.statusCode).toBe(401);
  });
});

describe('GET /claims/:code', () => {
  it('names the score and the hub, and consumes nothing', async () => {
    const score = await createScore();
    const code = await claimFor(score.id);

    const peek = await server.inject({ method: 'GET', url: `/claims/${code}` });

    expect(peek.statusCode).toBe(200);
    expect(peek.json()).toEqual({ scoreName: 'Blackbird', hubName: 'hub.example.com' });
    // The confirmation dialog is shown before the user has agreed to
    // anything, so cancelling it must leave the claim spendable.
    expect((await redeem(code)).statusCode).toBe(201);
  });

  it('hands back no credential of any kind', async () => {
    const score = await createScore();
    const code = await claimFor(score.id);

    const peek = await server.inject({ method: 'GET', url: `/claims/${code}` });

    expect(peek.body).not.toContain('token');
    expect(peek.body).not.toContain('/git/');
  });

  it('refuses a code that names nothing', async () => {
    const peek = await server.inject({ method: 'GET', url: '/claims/nosuchcode' });

    expect(peek.statusCode).toBe(404);
    expect(peek.json().error.code).toBe('no_such_claim');
  });

  it('refuses a claim that has run out', async () => {
    const score = await createScore();
    const code = await claimFor(score.id);
    expire();

    const peek = await server.inject({ method: 'GET', url: `/claims/${code}` });

    expect(peek.statusCode).toBe(410);
    expect(peek.json().error.code).toBe('claim_expired');
  });
});

describe('POST /claims/:code', () => {
  it('mints the triple the companion needs', async () => {
    const score = await createScore();
    const code = await claimFor(score.id);

    const redeemed = await redeem(code);

    expect(redeemed.statusCode).toBe(201);
    const body = redeemed.json();
    expect(body.name).toBe('Blackbird');
    expect(body.url).toBe(`${PUBLIC_URL}/git/${body.username}/${score.id}.git`);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('mints a second token rather than re-sending the first', async () => {
    const score = await createScore();

    const redeemed = (await redeem(await claimFor(score.id))).json();

    // The first token's value is gone; this is a different credential, which
    // is what makes the second machine revocable on its own.
    expect(redeemed.token).not.toBe(score.token);
    const tokens = handle.db
      .select()
      .from(scoreTokens)
      .where(eq(scoreTokens.scoreId, score.id))
      .all();
    expect(tokens).toHaveLength(2);
  });

  it('names the token after the machine that redeemed it', async () => {
    const score = await createScore();

    const redeemed = (await redeem(await claimFor(score.id), "Ben's MacBook")).json();

    expect(redeemed.tokenName).toBe("Ben's MacBook");
  });

  it('works once', async () => {
    const score = await createScore();
    const code = await claimFor(score.id);

    expect((await redeem(code)).statusCode).toBe(201);
    const again = await redeem(code);

    expect(again.statusCode).toBe(410);
    expect(again.json().error.code).toBe('claim_redeemed');
    expect(
      handle.db.select().from(scoreTokens).where(eq(scoreTokens.scoreId, score.id)).all()
    ).toHaveLength(2);
  });

  /**
   * Two machines opening the same link. Consumption is the UPDATE's own WHERE
   * rather than a read followed by a write, so this cannot end with two
   * tokens — which would be the one outcome the single-use rule exists to
   * prevent.
   */
  it('produces one token and one refusal when two redemptions race', async () => {
    const score = await createScore();
    const code = await claimFor(score.id);

    // better-sqlite3 is synchronous, so a race is these two calls back to
    // back — there is no interleaving for a promise to express.
    const outcomes = [redeemCloneClaim(handle.db, code), redeemCloneClaim(handle.db, code)];

    expect(outcomes.map((o) => o.status)).toEqual(['valid', 'redeemed']);
  });

  it('refuses a claim that has run out, and leaves it refusable', async () => {
    const score = await createScore();
    const code = await claimFor(score.id);
    expire();

    const redeemed = await redeem(code);

    expect(redeemed.statusCode).toBe(410);
    expect(redeemed.json().error.code).toBe('claim_expired');
    // Not marked spent: "expired" stays the sentence on a second attempt.
    expect((await redeem(code)).json().error.code).toBe('claim_expired');
    expect(
      handle.db.select().from(scoreTokens).where(eq(scoreTokens.scoreId, score.id)).all()
    ).toHaveLength(1);
  });

  it('refuses a code that names nothing', async () => {
    const redeemed = await redeem('nosuchcode');

    expect(redeemed.statusCode).toBe(404);
    expect(redeemed.json().error.code).toBe('no_such_claim');
  });

  it('accepts a token that only ever existed in its response', async () => {
    const score = await createScore();
    const redeemed = (await redeem(await claimFor(score.id))).json();

    // The proof that the minted credential is real: it opens the git route
    // the url points at.
    const git = await server.inject({
      method: 'GET',
      url: `/git/${redeemed.username}/${score.id}.git/info/refs?service=git-upload-pack`,
      headers: {
        authorization: `Basic ${Buffer.from(`x:${redeemed.token}`).toString('base64')}`,
      },
    });

    expect(git.statusCode).toBe(200);
  });
});

describe('housekeeping', () => {
  it('drops a score’s dead claims as the next one is made', async () => {
    const score = await createScore();
    const first = await claimFor(score.id);
    await redeem(first);
    await claimFor(score.id);
    expire();

    await claimFor(score.id);

    // Only the newest survives: one spent, one expired, both collected.
    expect(handle.db.select().from(cloneClaims).all()).toHaveLength(1);
  });

  it('sweeps what outlived its expiry', async () => {
    const score = await createScore();
    await claimFor(score.id);
    expire();

    expect(purgeExpiredClaims(handle.db)).toBe(1);
    expect(handle.db.select().from(cloneClaims).all()).toEqual([]);
  });

  it('takes a score’s claims with the score', async () => {
    const score = await createScore();
    await claimFor(score.id);

    handle.db.delete(scores).where(eq(scores.id, score.id)).run();

    // The cascade, so a deleted score cannot leave a live capability behind.
    expect(handle.db.select().from(cloneClaims).all()).toEqual([]);
  });
});
