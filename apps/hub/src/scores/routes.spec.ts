import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app/app';
import { SESSION_COOKIE } from '../auth/cookie';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabaseHandle } from '../db/client';
import { scoreTokens } from '../db/schema';

const run = promisify(execFile);
const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');
const PUBLIC_URL = 'https://hub.example.com';
const CREDENTIALS = { email: 'player@example.com', password: 'a decent passphrase' };

let handle: HubDatabaseHandle;
let server: FastifyInstance;
let gitRoot: string;
let session: string;

async function createScore(name = 'Bridge rewrite'): Promise<LightMyRequestResponse> {
  return server.inject({
    method: 'POST',
    url: '/scores',
    payload: { name },
    cookies: { [SESSION_COOKIE]: session },
  });
}

beforeEach(async () => {
  gitRoot = await mkdtemp(path.join(tmpdir(), 'gpt-scores-'));

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
  handle.close();
  await rm(gitRoot, { recursive: true, force: true });
});

describe('POST /scores', () => {
  it('should hand back the three values companion asks for', async () => {
    // Given / When
    const response = await createScore();

    // Then — these are exactly the three fields of the Set up sync dialog.
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.url).toMatch(
      new RegExp(`^${PUBLIC_URL}/git/[a-z2-7]+/[a-z2-7]+\\.git$`)
    );
    expect(body.username).toMatch(/^[a-z2-7]+$/);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should build the clone url from the public origin, not the listen address', async () => {
    // Given / When
    const body = (await createScore()).json();

    // Then — the hub may sit behind a proxy, and this value is pasted into a
    // dialog and written into a .git/config.
    expect(body.url.startsWith(`${PUBLIC_URL}/`)).toBe(true);
  });

  it('should create a bare repository the returned url resolves to', async () => {
    // Given / When
    const body = (await createScore()).json();

    // Then
    const repository = path.join(gitRoot, body.username, `${body.id}.git`);
    expect((await stat(repository)).isDirectory()).toBe(true);
    const { stdout } = await run('git', ['--git-dir', repository, 'symbolic-ref', 'HEAD']);
    expect(stdout.trim()).toBe('refs/heads/main');
  });

  it('should keep the name the musician typed out of the url', async () => {
    // Given a name with spaces and punctuation
    const body = (await createScore('Bridge rewrite (take 2)')).json();

    // Then — decision 9: no score titles in clone urls.
    expect(body.name).toBe('Bridge rewrite (take 2)');
    expect(body.url).not.toContain('Bridge');
    expect(body.url).not.toContain('take');
  });

  it('should trim the name before storing it', async () => {
    // Given / When
    const body = (await createScore('   Untitled riff   ')).json();

    // Then
    expect(body.name).toBe('Untitled riff');
  });

  it('should refuse a name that is empty once trimmed', async () => {
    // Given / When
    const response = await createScore('    ');

    // Then
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_request');
  });

  it('should refuse the request when there is no session', async () => {
    // Given / When
    const response = await server.inject({
      method: 'POST',
      url: '/scores',
      payload: { name: 'Bridge rewrite' },
    });

    // Then
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('no_session');
    // And nothing was provisioned on the way to refusing it.
    expect(await readdir(gitRoot)).toEqual([]);
  });

  it('should give each score its own repository and its own token', async () => {
    // Given / When
    const first = (await createScore('First')).json();
    const second = (await createScore('Second')).json();

    // Then
    expect(first.id).not.toBe(second.id);
    expect(first.token).not.toBe(second.token);
    expect(first.url).not.toBe(second.url);
  });
});

describe('GET /scores', () => {
  it('should list a score without its token value', async () => {
    // Given
    const created = (await createScore()).json();

    // When
    const response = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: session },
    });

    // Then — the value does not exist any more; a row implying otherwise
    // would be a lie the user acts on.
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(created.token);
    const [row] = response.json();
    expect(row).toMatchObject({
      id: created.id,
      name: 'Bridge rewrite',
      url: created.url,
      tokens: [{ name: 'companion' }],
    });
    expect(row.tokens[0].id).toEqual(expect.any(String));
    expect(row.tokens[0].createdAt).toEqual(expect.any(String));
  });

  it('should be empty for a fresh account', async () => {
    // Given / When
    const response = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: session },
    });

    // Then — the state that matters most, per the design brief.
    expect(response.json()).toEqual([]);
  });

  it('should show the newest score first', async () => {
    // Given
    await createScore('Older');
    await createScore('Newer');

    // When
    const rows = (
      await server.inject({
        method: 'GET',
        url: '/scores',
        cookies: { [SESSION_COOKIE]: session },
      })
    ).json();

    // Then
    expect(rows.map((r: { name: string }) => r.name)).toEqual(['Newer', 'Older']);
  });

  it('should not show another account its neighbour scores', async () => {
    // Given one account with a score
    await createScore();

    // And a second account
    const other = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'other@example.com', password: 'another passphrase' },
    });
    const otherCookie = other.cookies.find((c) => c.name === SESSION_COOKIE);
    if (!otherCookie) throw new Error('signup issued no session cookie');

    // When
    const response = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: otherCookie.value },
    });

    // Then
    expect(response.json()).toEqual([]);
  });

  it('should refuse the request when there is no session', async () => {
    // Given / When
    const response = await server.inject({ method: 'GET', url: '/scores' });

    // Then
    expect(response.statusCode).toBe(401);
  });
});

describe('the handoff', () => {
  it('should accept a push authenticated only by what POST /scores returned', async () => {
    // Given a hub whose public origin really is where it listens, so the url
    // it hands back is usable exactly as printed
    await server.close();
    const port = await freePort();
    server = Fastify();
    await server.register(app, {
      db: handle.db,
      cookieSecure: false,
      gitRoot,
      publicUrl: `http://127.0.0.1:${port}`,
    });
    await server.listen({ port, host: '127.0.0.1' });

    const signup = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'handoff@example.com', password: 'a decent passphrase' },
    });
    const cookie = signup.cookies.find((c) => c.name === SESSION_COOKIE);
    if (!cookie) throw new Error('signup issued no session cookie');

    const created = (
      await server.inject({
        method: 'POST',
        url: '/scores',
        payload: { name: 'Bridge rewrite' },
        cookies: { [SESSION_COOKIE]: cookie.value },
      })
    ).json();

    // When the three values are used the way companion uses them: the url as
    // the remote, the username and token as git's basic-auth pair.
    const remote = new URL(created.url);
    remote.username = created.username;
    remote.password = created.token;

    const workspace = await mkdtemp(path.join(tmpdir(), 'gpt-handoff-'));
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    await run('git', ['clone', '--quiet', remote.toString(), 'score'], { cwd: workspace, env });

    const clone = path.join(workspace, 'score');
    await writeFile(path.join(clone, 'score.gp'), '<?xml version="1.0"?><GPIF/>');
    await run('git', ['add', '-A'], { cwd: clone, env });
    await run(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'named version'],
      { cwd: clone, env }
    );
    await run('git', ['push', '--quiet', 'origin', 'HEAD:refs/heads/main'], { cwd: clone, env });

    // Then the version is on the server and nothing else was needed to put it
    // there — no session cookie, no second credential, no forge.
    const { stdout } = await run('git', [
      '--git-dir',
      path.join(gitRoot, created.username, `${created.id}.git`),
      'log',
      '--oneline',
      'refs/heads/main',
    ]);
    expect(stdout).toContain('named version');

    await rm(workspace, { recursive: true, force: true });
  });
});

describe('minting a token for a score that already exists', () => {
  /**
   * Creating a score rolls itself back if minting fails, so the only way to
   * reach this state is a crash between the two writes. Dropping the token
   * row reproduces exactly what that leaves behind.
   */
  async function stripToken(scoreId: string): Promise<void> {
    handle.db.delete(scoreTokens).where(eq(scoreTokens.scoreId, scoreId)).run();
  }

  it('lists the score with no token rather than hiding it', async () => {
    const created = await createScore();
    await stripToken(created.json().id);

    const listed = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].tokens).toEqual([]);
  });

  it('mints a token and hands back the whole triple', async () => {
    const created = await createScore();
    const id = created.json().id;
    await stripToken(id);

    const finished = await server.inject({
      method: 'POST',
      url: `/scores/${id}/token`,
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(finished.statusCode).toBe(201);
    expect(finished.json()).toMatchObject({
      id,
      name: 'Bridge rewrite',
      url: `${PUBLIC_URL}/git/${finished.json().username}/${id}.git`,
      tokenName: 'companion',
    });
    expect(finished.json().token).toEqual(expect.any(String));
  });

  /**
   * The refusal this replaced assumed a score lives on one computer. It does
   * not — and the first token cannot be handed over a second time, because
   * only its hash was kept.
   */
  it('mints a second token for a second machine rather than refusing', async () => {
    const created = await createScore();
    const id = created.json().id;

    const again = await server.inject({
      method: 'POST',
      url: `/scores/${id}/token`,
      payload: { name: 'Studio iMac' },
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(again.statusCode).toBe(201);
    expect(again.json().token).not.toBe(created.json().token);
    expect(again.json().tokenName).toBe('Studio iMac');
  });

  it('keeps a score with two tokens to one row, naming both', async () => {
    const created = await createScore();
    await server.inject({
      method: 'POST',
      url: `/scores/${created.json().id}/token`,
      payload: { name: 'Studio iMac' },
      cookies: { [SESSION_COOKIE]: session },
    });

    const listed = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].tokens.map((token: { name: string }) => token.name)).toEqual([
      'companion',
      'Studio iMac',
    ]);
  });

  it('falls back to a default name rather than refusing an unusable one', async () => {
    const created = await createScore();

    const again = await server.inject({
      method: 'POST',
      url: `/scores/${created.json().id}/token`,
      payload: { name: '   ' },
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(again.statusCode).toBe(201);
    expect(again.json().tokenName).toBe('companion');
  });

  it('answers the same for a score that is not yours as for one that does not exist', async () => {
    const created = await createScore();
    await stripToken(created.json().id);

    const stranger = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'someone@example.com', password: 'another passphrase' },
    });
    const theirSession = stranger.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';

    const theirs = await server.inject({
      method: 'POST',
      url: `/scores/${created.json().id}/token`,
      cookies: { [SESSION_COOKIE]: theirSession },
    });
    const missing = await server.inject({
      method: 'POST',
      url: '/scores/nosuchscoreid/token',
      cookies: { [SESSION_COOKIE]: theirSession },
    });

    expect(theirs.statusCode).toBe(404);
    expect(theirs.json()).toEqual(missing.json());
  });

  it('needs a session', async () => {
    const created = await createScore();

    const anonymous = await server.inject({
      method: 'POST',
      url: `/scores/${created.json().id}/token`,
    });

    expect(anonymous.statusCode).toBe(401);
  });
});

/**
 * The clone url is built from publicUrl, which has to be known before listen,
 * so the port cannot come from listening on 0.
 */
async function freePort(): Promise<number> {
  const probe = Fastify();
  const origin = await probe.listen({ port: 0, host: '127.0.0.1' });
  const { port } = new URL(origin);
  await probe.close();
  return Number(port);
}
