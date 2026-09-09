import * as path from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app/app';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabaseHandle } from '../db/client';
import { SESSION_COOKIE } from './cookie';
import { SESSION_TTL_MS, issueSession } from './sessions';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');

const CREDENTIALS = { email: 'player@example.com', password: 'a decent passphrase' };

let handle: HubDatabaseHandle;
let server: FastifyInstance;

async function buildApp(cookieSecure = false) {
  handle = openDatabase(':memory:');
  migrateToLatest(handle.db, MIGRATIONS);

  server = Fastify();
  await server.register(app, { db: handle.db, cookieSecure });
  await server.ready();

  return server;
}

function signup(body: InjectOptions['payload'] = CREDENTIALS): Promise<LightMyRequestResponse> {
  return server.inject({ method: 'POST', url: '/auth/signup', payload: body });
}

function sessionCookieOf(response: LightMyRequestResponse) {
  return response.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
}

beforeEach(async () => {
  await buildApp();
});

afterEach(async () => {
  await server.close();
  handle.close();
});

describe('POST /auth/signup', () => {
  it('should create the account and open a session when the credentials are new', async () => {
    // Given / When
    const response = await signup();

    // Then
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.stringMatching(/^[a-z2-7]+$/),
      email: 'player@example.com',
    });
    expect(sessionCookieOf(response)).toBeDefined();
  });

  it('should never echo the password or its hash when it answers', async () => {
    // Given / When
    const response = await signup();

    // Then
    expect(response.body).not.toContain(CREDENTIALS.password);
    expect(response.body).not.toContain('argon2');
  });

  it('should set the session cookie httpOnly, lax and path-wide', async () => {
    // Given / When
    const cookie = sessionCookieOf(await signup());

    // Then — the cookie is a bearer credential; script must not read it.
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  });

  it('should leave Secure off when the hub is serving plain http', async () => {
    // Given a dev hub on http://localhost, which is what M4's gate uses
    // When
    const cookie = sessionCookieOf(await signup());

    // Then — a Secure cookie over http is one the browser silently drops.
    expect(cookie).not.toHaveProperty('secure', true);
  });

  it('should mark the cookie Secure when the hub is serving https', async () => {
    // Given
    await server.close();
    handle.close();
    await buildApp(true);

    // When
    const cookie = sessionCookieOf(await signup());

    // Then
    expect(cookie).toMatchObject({ secure: true });
  });

  it('should normalise the email when it arrives cased and padded', async () => {
    // Given / When
    const response = await signup({ ...CREDENTIALS, email: '  Player@Example.COM ' });

    // Then
    expect(response.json().email).toBe('player@example.com');
  });

  it('should refuse a second account when the email is already taken', async () => {
    // Given
    await signup();

    // When
    const response = await signup();

    // Then
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('email_taken');
  });

  it('should refuse a second account when the email differs only in case', async () => {
    // Given
    await signup();

    // When
    const response = await signup({ ...CREDENTIALS, email: 'PLAYER@EXAMPLE.COM' });

    // Then — normalising before the unique index is what makes this a 409.
    expect(response.statusCode).toBe(409);
  });

  it('should refuse a password shorter than the minimum', async () => {
    // Given / When
    const response = await signup({ ...CREDENTIALS, password: 'short' });

    // Then
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({ code: 'invalid_request' });
    expect(response.json().error.message).toContain('password');
  });

  it('should refuse a body that is not an email at all', async () => {
    // Given / When
    const response = await signup({ email: 'not-an-email', password: 'a decent passphrase' });

    // Then
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_request');
  });

  it('should refuse the attempt after too many signups from one caller', async () => {
    // Given — signup provisions a real Forgejo user from M4 on
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signup({ ...CREDENTIALS, email: `player${attempt}@example.com` });
    }

    // When
    const response = await signup({ ...CREDENTIALS, email: 'one-too-many@example.com' });

    // Then
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('rate_limited');
  });
});

describe('POST /auth/login', () => {
  it('should open a session when the password matches', async () => {
    // Given
    await signup();

    // When
    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: CREDENTIALS,
    });

    // Then
    expect(response.statusCode).toBe(200);
    expect(sessionCookieOf(response)).toBeDefined();
  });

  it('should find the account when the email arrives cased differently', async () => {
    // Given
    await signup();

    // When
    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { ...CREDENTIALS, email: 'PLAYER@example.com' },
    });

    // Then
    expect(response.statusCode).toBe(200);
  });

  it('should reject the attempt when the password is wrong', async () => {
    // Given
    await signup();

    // When
    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { ...CREDENTIALS, password: 'a different passphrase' },
    });

    // Then
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_credentials');
    expect(sessionCookieOf(response)).toBeUndefined();
  });

  it('should give the same answer when the account does not exist', async () => {
    // Given nothing signed up
    // When
    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { ...CREDENTIALS, email: 'nobody@example.com' },
    });

    // Then — a distinguishable answer here is an enumeration oracle.
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_credentials');
  });
});

describe('GET /auth/me', () => {
  it('should name the account when the session cookie is current', async () => {
    // Given
    const created = await signup();
    const cookie = sessionCookieOf(created);
    if (!cookie) throw new Error('signup issued no session cookie');

    // When
    const response = await server.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [SESSION_COOKIE]: cookie.value },
    });

    // Then
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: created.json().id, email: 'player@example.com' });
  });

  it('should reject the request as sessionless when no cookie arrives', async () => {
    // Given / When
    const response = await server.inject({ method: 'GET', url: '/auth/me' });

    // Then
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('no_session');
  });

  it('should reject the request as invalid when the cookie names no session', async () => {
    // Given a forged or tampered cookie
    // When
    const response = await server.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [SESSION_COOKIE]: 'not-a-token-we-ever-issued' },
    });

    // Then — distinct from both no_session and session_expired.
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_session');
  });

  it('should reject the request as expired when the session has run out', async () => {
    // Given a session issued long enough ago to have lapsed
    const created = await signup();
    const issuedAt = new Date(Date.now() - SESSION_TTL_MS - 1);
    const stale = issueSession(handle.db, created.json().id, issuedAt);

    // When
    const response = await server.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [SESSION_COOKIE]: stale.token },
    });

    // Then
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('session_expired');
  });

  it('should clear the cookie when it rejects a session that is gone', async () => {
    // Given / When
    const response = await server.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [SESSION_COOKIE]: 'not-a-token-we-ever-issued' },
    });

    // Then — keeping it only guarantees the same 401 next time.
    expect(sessionCookieOf(response)?.value).toBe('');
  });
});

describe('POST /auth/logout', () => {
  it('should end the session when it is presented', async () => {
    // Given
    const cookie = sessionCookieOf(await signup());
    if (!cookie) throw new Error('signup issued no session cookie');

    // When
    const response = await server.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { [SESSION_COOKIE]: cookie.value },
    });

    // Then
    expect(response.statusCode).toBe(204);
    const after = await server.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [SESSION_COOKIE]: cookie.value },
    });
    expect(after.json().error.code).toBe('invalid_session');
  });

  it('should succeed when there is no session to end', async () => {
    // Given / When
    const response = await server.inject({ method: 'POST', url: '/auth/logout' });

    // Then — a caller ending a session it no longer holds got what it wanted.
    expect(response.statusCode).toBe(204);
  });
});

describe('the app shell', () => {
  it('should answer an unknown route in the standard error shape', async () => {
    // Given / When
    const response = await server.inject({ method: 'GET', url: '/nope' });

    // Then
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
  });

  it('should still serve health when the whole app is assembled', async () => {
    // Given / When
    const response = await server.inject({ method: 'GET', url: '/health' });

    // Then
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
