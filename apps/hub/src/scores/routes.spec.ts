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
import { addBandMember } from '../bands/bands';
import { bandMembers, scoreTokens } from '../db/schema';

const run = promisify(execFile);
const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');
const PUBLIC_URL = 'https://hub.example.com';
const CREDENTIALS = { email: 'player@example.com', password: 'a decent passphrase' };

let handle: HubDatabaseHandle;
let server: FastifyInstance;
let gitRoot: string;
let session: string;
let playerId: string;

async function createScore(
  name = 'Bridge rewrite',
  { bandId, cookie = session }: { bandId?: string; cookie?: string } = {}
): Promise<LightMyRequestResponse> {
  return server.inject({
    method: 'POST',
    url: '/scores',
    payload: { name, bandId },
    cookies: { [SESSION_COOKIE]: cookie },
  });
}

/** The band signup made for whoever holds this session. */
async function bandOf(cookie: string): Promise<string> {
  const response = await server.inject({
    method: 'GET',
    url: '/bands',
    cookies: { [SESSION_COOKIE]: cookie },
  });
  return response.json()[0].id;
}

/** A second person, with their account id, a session to act as them, and their band of one. */
async function signUp(email: string): Promise<{ id: string; session: string; bandId: string }> {
  const response = await server.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email, password: 'another decent passphrase' },
  });
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error('signup issued no session cookie');
  return { id: response.json().id, session: cookie.value, bandId: await bandOf(cookie.value) };
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
  playerId = signup.json().id;
});

afterEach(async () => {
  await server.close();
  handle?.close();
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

  it('should put the score in its creator’s band when none is named', async () => {
    // Given / When
    const created = (await createScore()).json();

    // Then — the repository lives under the band, not the person, so it stays
    // put whoever joins or leaves.
    const bandId = await bandOf(session);
    expect(created.username).toBe(bandId);
    expect(created.url).toBe(`${PUBLIC_URL}/git/${bandId}/${created.id}.git`);
  });

  it('should put the score in the band it names, when the caller is in it', async () => {
    // Given a player who has joined a drummer's band
    const drummer = await signUp('drummer@example.com');
    addBandMember(handle.db, drummer.bandId, playerId, 'member');

    // When
    const created = (await createScore('Band song', { bandId: drummer.bandId })).json();

    // Then — it is the band's, so the drummer has it too.
    expect(created.username).toBe(drummer.bandId);
    const theirs = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: drummer.session },
    });
    expect(theirs.json().map((s: { id: string }) => s.id)).toEqual([created.id]);
  });

  it('should refuse a band the caller is not in, as if it did not exist', async () => {
    // Given somebody else's band
    const stranger = await signUp('stranger@example.com');

    // When
    const theirs = await createScore('Not mine', { bandId: stranger.bandId });
    const missing = await createScore('Not mine', { bandId: 'nosuchbandid' });

    // Then
    expect(theirs.statusCode).toBe(404);
    expect(theirs.json().error.code).toBe('no_such_band');
    expect(theirs.json()).toEqual(missing.json());
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
 * These write the band membership directly, as accepting an invite does, and
 * ask what every score route does with it once it is there.
 */
describe('a score shared with a second person', () => {
  let drummer: { id: string; session: string; bandId: string };
  let shared: { id: string; username: string; url: string };

  beforeEach(async () => {
    drummer = await signUp('drummer@example.com');
    shared = (await createScore()).json();
    addBandMember(handle.db, await bandOf(session), drummer.id, 'member');
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

  it('should hand a member a clone url in the band’s namespace', async () => {
    // Given / When
    const listed = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: drummer.session },
    });

    // Then — the repository did not move when the drummer joined the band. A
    // url built from their own id, or their own band's, names a directory that
    // is not there, which is a clone that fails on the first fetch.
    expect(listed.json()[0].url).toBe(shared.url);
    expect(listed.json()[0].url).not.toContain(drummer.id);
    expect(listed.json()[0].url).not.toContain(drummer.bandId);
    const repository = path.join(gitRoot, shared.username, `${shared.id}.git`);
    expect((await stat(repository)).isDirectory()).toBe(true);
  });

  it('should mint a member their own token, against the band’s repository', async () => {
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

  it('should put the member’s own account on the token they mint', async () => {
    // Given / When
    await server.inject({
      method: 'POST',
      url: `/scores/${shared.id}/token`,
      payload: { name: 'Sam’s ThinkPad' },
      cookies: { [SESSION_COOKIE]: drummer.session },
    });

    // Then — the repository is the band's and the credential is the member's.
    // This column is what a push can be attributed to a person by; written
    // with the creator's id it would name the wrong person forever.
    const row = handle.db
      .select()
      .from(scoreTokens)
      .where(eq(scoreTokens.name, 'Sam’s ThinkPad'))
      .get();
    expect(row?.accountId).toBe(drummer.id);
  });

  it('should attribute a redeemed claim to whoever made it', async () => {
    // Given a claim the drummer held out
    const claimed = await server.inject({
      method: 'POST',
      url: `/scores/${shared.id}/clone-claims`,
      cookies: { [SESSION_COOKIE]: drummer.session },
    });

    // When it is redeemed by an app that carries no session at all
    const redeemed = await server.inject({
      method: 'POST',
      url: `/claims/${encodeURIComponent(claimed.json().code)}`,
      payload: { device: 'Sam’s ThinkPad' },
    });

    // Then — the claim is the only thing that knew who this machine is
    // acting for, and the score's creator is the wrong answer.
    expect(redeemed.statusCode).toBe(201);
    const row = handle.db
      .select()
      .from(scoreTokens)
      .where(eq(scoreTokens.name, 'Sam’s ThinkPad'))
      .get();
    expect(row?.accountId).toBe(drummer.id);
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

describe('a score in a band somebody is not in', () => {
  /** Every POST route that takes a score id in its path. */
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

  it('should keep a member of one band out of another band’s score', async () => {
    // Given band A, with a score of its own, and a score in band B
    const bandA = await signUp('bandA@example.com');
    const ownScore = (await createScore('Ours', { cookie: bandA.session })).json();
    const bandBScore = (await createScore()).json();

    // When band A's member reaches for band B's score
    const answers = await Promise.all(
      [
        { method: 'GET' as const, url: `/scores/${bandBScore.id}/history` },
        { method: 'POST' as const, url: `/scores/${bandBScore.id}/token` },
        { method: 'GET' as const, url: '/scores/nosuchscoreid/history' },
        { method: 'POST' as const, url: '/scores/nosuchscoreid/token' },
      ].map((request) =>
        server.inject({ ...request, cookies: { [SESSION_COOKIE]: bandA.session } })
      )
    );

    // Then — being in *a* band is not being in this one.
    const [history, token, noHistory, noToken] = answers;
    expect(history.statusCode).toBe(404);
    expect(history.json()).toEqual(noHistory.json());
    expect(token.statusCode).toBe(404);
    expect(token.json()).toEqual(noToken.json());
    // And their own band's score is still theirs.
    const own = await server.inject({
      method: 'GET',
      url: `/scores/${ownScore.id}/history`,
      cookies: { [SESSION_COOKIE]: bandA.session },
    });
    expect(own.statusCode).toBe(200);
  });

  it('should stop listing it for somebody who left the band', async () => {
    // Given a score whose band no longer has its creator in it
    const created = (await createScore()).json();
    const stranger = await signUp('stranger@example.com');
    const bandId = await bandOf(session);
    handle.db.delete(bandMembers).where(eq(bandMembers.bandId, bandId)).run();
    addBandMember(handle.db, bandId, stranger.id, 'member');

    // When
    const creator = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: session },
    });
    const member = await server.inject({
      method: 'GET',
      url: '/scores',
      cookies: { [SESSION_COOKIE]: stranger.session },
    });

    // Then — band membership decides, not who made it.
    expect(creator.json()).toEqual([]);
    expect(member.json().map((s: { id: string }) => s.id)).toEqual([created.id]);
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
