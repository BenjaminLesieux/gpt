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
import { scoreMembers, scoreTokens } from '../db/schema';
import { addScoreMember } from './members';

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

/** A second person, with their account id and a session to act as them. */
async function signUp(email: string): Promise<{ id: string; session: string }> {
  const response = await server.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email, password: 'another decent passphrase' },
  });
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error('signup issued no session cookie');
  return { id: response.json().id, session: cookie.value };
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

  it('should make its creator a member of what they made', async () => {
    // Given / When
    const created = (await createScore()).json();

    // Then — without the membership row the score is invisible to everyone,
    // its creator included: `scores.account_id` is the repository's namespace
    // now, not permission to be there.
    const members = handle.db.select().from(scoreMembers).all();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      scoreId: created.id,
      accountId: created.username,
      role: 'owner',
    });
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
 * There is no way to be added to somebody else's score from outside yet — the
 * invite link is its own piece of work — so these write the membership row the
 * way that endpoint eventually will, and ask what every score route does with
 * it once it is there.
 */
describe('a score shared with a second person', () => {
  let drummer: { id: string; session: string };
  let shared: { id: string; username: string; url: string };

  beforeEach(async () => {
    drummer = await signUp('drummer@example.com');
    shared = (await createScore()).json();
    addScoreMember(handle.db, shared.id, drummer.id, 'member');
  });

  it('should list it for the person it was shared with', async () => {
    // Given / When
    const listed = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: drummer.session },
    });

    // Then
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({ id: shared.id, name: 'Bridge rewrite' });
  });

  it('should hand a member a clone url in the owner’s namespace', async () => {
    // Given / When
    const listed = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: drummer.session },
    });

    // Then — the repository did not move when the drummer was added to the
    // score. A url built from their own id names a directory that is not
    // there, which is a clone that fails on the first fetch.
    expect(listed.json()[0].url).toBe(shared.url);
    expect(listed.json()[0].url).not.toContain(drummer.id);
    const repository = path.join(gitRoot, shared.username, `${shared.id}.git`);
    expect((await stat(repository)).isDirectory()).toBe(true);
  });

  it('should mint a member their own token, against the owner’s repository', async () => {
    // Given / When
    const minted = await server.inject({
      method: 'POST',
      url: `/scores/${shared.id}/token`,
      payload: { name: 'Sam’s ThinkPad' },
      cookies: { [SESSION_COOKIE]: drummer.session },
    });

    // Then
    expect(minted.statusCode).toBe(201);
    expect(minted.json()).toMatchObject({
      id: shared.id,
      username: shared.username,
      url: shared.url,
      tokenName: 'Sam’s ThinkPad',
    });
  });

  it('should mint a member a clone claim', async () => {
    // Given / When
    const claimed = await server.inject({
      method: 'POST',
      url: `/scores/${shared.id}/clone-claims`,
      cookies: { [SESSION_COOKIE]: drummer.session },
    });

    // Then
    expect(claimed.statusCode).toBe(201);
    expect(claimed.json().scoreName).toBe('Bridge rewrite');
  });

  it('should still show the owner one row rather than two', async () => {
    // Given / When
    const listed = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: session },
    });

    // Then — the list is of scores, and a join that fanned out over members
    // would quietly say otherwise.
    expect(listed.json()).toHaveLength(1);
  });
});

describe('a score somebody is not a member of', () => {
  /** Every route that takes a score id in its path. */
  const routes = ['token', 'clone-claims'] as const;

  it.each(routes)('should answer /scores/:id/%s as if the score did not exist', async (route) => {
    // Given a score belonging to somebody else
    const created = (await createScore()).json();
    const stranger = await signUp('stranger@example.com');

    // When
    const theirs = await server.inject({
      method: 'POST',
      url: `/scores/${created.id}/${route}`,
      cookies: { [SESSION_COOKIE]: stranger.session },
    });
    const missing = await server.inject({
      method: 'POST',
      url: `/scores/nosuchscoreid/${route}`,
      cookies: { [SESSION_COOKIE]: stranger.session },
    });

    // Then — "no such score" and "not yours" stay indistinguishable, as they
    // are everywhere else in this codebase.
    expect(theirs.statusCode).toBe(404);
    expect(theirs.json()).toEqual(missing.json());
  });

  it('should not list it for them', async () => {
    // Given a score whose membership names somebody else entirely
    const created = (await createScore()).json();
    const stranger = await signUp('stranger@example.com');
    handle.db.delete(scoreMembers).where(eq(scoreMembers.scoreId, created.id)).run();
    addScoreMember(handle.db, created.id, stranger.id, 'member');

    // When the owner of the *row* — who is no longer a member — asks
    const listed = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: session },
    });

    // Then — membership decides, not `scores.account_id`. A score still in
    // someone's namespace is not a score they may read.
    expect(listed.json()).toEqual([]);
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
