import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import Fastify from 'fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app/app';
import { SESSION_COOKIE } from '../auth/cookie';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabaseHandle } from '../db/client';
import { versionScopes } from '../db/schema';
import { SCORE_ENTRY } from '../git/versions';

/**
 * The history endpoint, against real repositories rather than a stub.
 *
 * Everything under test here is a shape git produces — topological order, the
 * parents of a landing, how far ahead a branch is — and a fake git would let
 * every one of those drift without failing. The repositories are built with
 * the same commands companion pushes, so what is asserted is what a band's
 * repository actually looks like.
 */

const run = promisify(execFile);
const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');
const FIXTURE = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'gpt-core',
  'src',
  '__fixtures__',
  'sample.gp'
);
const PUBLIC_URL = 'https://hub.example.com';
const CREDENTIALS = { email: 'player@example.com', password: 'a decent passphrase' };

let handle: HubDatabaseHandle;
let server: FastifyInstance;
let gitRoot: string;
let session: string;
let accountId: string;
let work: string;
let sample: Buffer;

async function createScore(name = 'Nightswim'): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/scores',
    payload: { name },
    cookies: { [SESSION_COOKIE]: session },
  });
  return response.json().id;
}

function history(id: string, query = ''): Promise<LightMyRequestResponse> {
  return server.inject({
    method: 'GET',
    url: `/scores/${id}/history${query}`,
    cookies: { [SESSION_COOKIE]: session },
  });
}

/**
 * A working clone that pushes, which is the only way versions ever reach a
 * repository in production. Writing commits into the bare repository directly
 * would test a state the hub cannot actually be in.
 */
async function clone(scoreId: string): Promise<void> {
  const bare = path.join(gitRoot, accountId, `${scoreId}.git`);
  await run('git', ['clone', '--quiet', bare, work]);
  await run('git', ['-C', work, 'config', 'user.email', 'ben.lesieux@gmail.com']);
  await run('git', ['-C', work, 'config', 'user.name', 'Ben']);
}

/**
 * One version, by the author given. Returns its sha.
 *
 * `--allow-empty` because most of these tests are about order, authorship and
 * parents rather than content, and re-saving a score that did not change is
 * something the companion's snapshot loop produces anyway.
 */
async function version(
  message: string,
  { email = 'ben.lesieux@gmail.com', score = sample }: { email?: string; score?: Buffer } = {}
): Promise<string> {
  await writeScore(score);
  await run('git', ['-C', work, 'add', SCORE_ENTRY]);
  await run('git', ['-C', work, 'commit', '--quiet', '--allow-empty', '-m', message], {
    env: { ...process.env, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email },
  });
  const { stdout } = await run('git', ['-C', work, 'rev-parse', 'HEAD']);
  return stdout.trim();
}

async function writeScore(bytes: Buffer): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(work, SCORE_ENTRY), bytes);
}

async function push(...refs: string[]): Promise<void> {
  await run('git', ['-C', work, 'push', '--quiet', 'origin', ...refs]);
}

beforeEach(async () => {
  gitRoot = await mkdtemp(path.join(tmpdir(), 'gpt-history-'));
  work = path.join(await mkdtemp(path.join(tmpdir(), 'gpt-work-')), 'clone');
  sample = await readFile(FIXTURE);

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
  accountId = signup.json().id;
});

afterEach(async () => {
  handle.close();
  await server.close();
  await rm(gitRoot, { recursive: true, force: true });
  await rm(path.dirname(work), { recursive: true, force: true });
});

describe('a score with nothing pushed to it', () => {
  it('is an empty history rather than an error', async () => {
    const id = await createScore();

    const response = await history(id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ head: null, total: 0, branches: [], versions: [] });
  });
});

describe('a straight line of versions', () => {
  it('lists them newest first, with who wrote each one', async () => {
    const id = await createScore();
    await clone(id);
    await version('first pass at the whole thing');
    await version('quieter intro, one guitar only', { email: 'sam@example.com' });
    const newest = await version('try the 7th in the bridge');
    await push('main');

    const body = history(id);
    const { head, total, versions } = (await body).json();

    expect(head).toBe(newest);
    expect(total).toBe(3);
    expect(versions.map((v: { message: string }) => v.message)).toEqual([
      'try the 7th in the bridge',
      'quieter intro, one guitar only',
      'first pass at the whole thing',
    ]);
    expect(versions[1].authorEmail).toBe('sam@example.com');
    // The first version has no parent; every other one has exactly one.
    expect(versions[2].parents).toEqual([]);
    expect(versions[0].parents).toEqual([versions[1].id]);
  });

  it('keeps an empty message empty instead of inventing one', async () => {
    const id = await createScore();
    await clone(id);
    // `--allow-empty-message` is how a two-second panel entry with nothing
    // typed in it reaches the hub.
    await writeScore(sample);
    await run('git', ['-C', work, 'add', SCORE_ENTRY]);
    await run('git', [
      '-C',
      work,
      'commit',
      '--quiet',
      '--allow-empty-message',
      '-m',
      '',
    ]);
    await push('main');

    expect((await history(id)).json().versions[0].message).toBe('');
  });

  it('pages, and says how many there are in total', async () => {
    const id = await createScore();
    await clone(id);
    for (let n = 0; n < 5; n += 1) await version(`take ${n}`);
    await push('main');

    const first = (await history(id, '?limit=2')).json();
    expect(first.total).toBe(5);
    expect(first.versions.map((v: { message: string }) => v.message)).toEqual([
      'take 4',
      'take 3',
    ]);

    const next = (await history(id, '?limit=2&skip=2')).json();
    expect(next.versions.map((v: { message: string }) => v.message)).toEqual([
      'take 2',
      'take 1',
    ]);
  });

  it('refuses a page size it will not serve', async () => {
    const id = await createScore();

    const response = await history(id, '?limit=5000');

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_request');
  });
});

/**
 * Branch names here are ref-safe. The design writes them with spaces — *Bass
 * line*, *New drums* — and a git ref cannot contain one, so whoever builds
 * branching owes the product a decision: slug the ref and carry the display
 * name beside it, or make the musician type a name git will take. The hub
 * reports whatever ref exists and does not invent either.
 */
describe('a branch', () => {
  it('reports how far ahead it is while it is in flight', async () => {
    const id = await createScore();
    await clone(id);
    await version('first pass at the whole thing');
    await push('main');
    await run('git', ['-C', work, 'checkout', '--quiet', '-b', 'bass-line']);
    await version('bass follows the kick now');
    await version('walking bit under the chorus');
    await push('main', 'bass-line');

    const { branches, versions } = (await history(id)).json();

    expect(branches).toEqual([{ name: 'bass-line', tip: versions[0].id, ahead: 2 }]);
    // Every version is listed once, whichever line it is on.
    expect(versions).toHaveLength(3);
  });

  it('is zero ahead once it has landed, and the landing has two parents', async () => {
    const id = await createScore();
    await clone(id);
    await version('first pass at the whole thing');
    await run('git', ['-C', work, 'checkout', '--quiet', '-b', 'bass-line']);
    const tip = await version('bass follows the kick now');
    await run('git', ['-C', work, 'checkout', '--quiet', 'main']);
    await version('chorus lift, octave up on the lead');
    await run('git', [
      '-C',
      work,
      'merge',
      '--quiet',
      '--no-ff',
      '-m',
      'Bass line landed',
      'bass-line',
    ]);
    await push('main', 'bass-line');

    const { branches, versions } = (await history(id)).json();

    expect(branches).toEqual([{ name: 'bass-line', tip, ahead: 0 }]);

    const landing = versions[0];
    expect(landing.message).toBe('Bass line landed');
    expect(landing.parents).toHaveLength(2);
    expect(landing.parents).toContain(tip);
  });
});

describe('what a version touched', () => {
  it('names the tracks and counts the bars, derived from the files', async () => {
    const id = await createScore();
    await clone(id);
    await version('first pass at the whole thing');
    await push('main');

    const { versions } = (await history(id)).json();

    // The first version has no parent to diff against, so it is the whole
    // score: the fixture is 36 bars across 4 tracks.
    expect(versions[0].scope.trackCount).toBe(4);
    expect(versions[0].scope.bars).toBeGreaterThan(0);
    expect(versions[0].scope.tracks.length).toBeGreaterThan(0);
  });

  it('is null for a version whose file cannot be read as a score', async () => {
    const id = await createScore();
    await clone(id);
    await version('not a guitar pro file at all', { score: Buffer.from('nonsense') });
    await push('main');

    const { versions } = (await history(id)).json();

    // The row still lists. It just has nothing to say about what it changed,
    // which is the truth rather than a zero.
    expect(versions[0].message).toBe('not a guitar pro file at all');
    expect(versions[0].scope).toBeNull();
  });

  it('is cached, so a second read does not parse anything again', async () => {
    const id = await createScore();
    await clone(id);
    await version('first pass at the whole thing');
    await push('main');

    const first = (await history(id)).json().versions[0].scope;
    const cached = handle.db.select().from(versionScopes).all();

    expect(cached).toHaveLength(1);
    expect((await history(id)).json().versions[0].scope).toEqual(first);
  });
});

describe("a version's score file", () => {
  it('is served byte for byte', async () => {
    const id = await createScore();
    await clone(id);
    const commit = await version('first pass at the whole thing');
    await push('main');

    const response = await server.inject({
      method: 'GET',
      url: `/scores/${id}/versions/${commit}/score.gp`,
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/octet-stream');
    expect(Buffer.compare(response.rawPayload, sample)).toBe(0);
  });

  it('is a 404 for a commit this score does not have', async () => {
    const id = await createScore();

    const response = await server.inject({
      method: 'GET',
      url: `/scores/${id}/versions/${'0'.repeat(40)}/score.gp`,
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('no_such_version');
  });
});

describe('someone who is not on the score', () => {
  it('gets the same answer as for a score that does not exist', async () => {
    const id = await createScore();

    const stranger = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'stranger@example.com', password: 'another decent passphrase' },
    });
    const cookie = stranger.cookies.find((c) => c.name === SESSION_COOKIE);
    if (!cookie) throw new Error('signup issued no session cookie');

    for (const url of [
      `/scores/${id}/history`,
      `/scores/${id}/members`,
      `/scores/${id}/versions/${'0'.repeat(40)}/score.gp`,
    ]) {
      const response = await server.inject({
        method: 'GET',
        url,
        cookies: { [SESSION_COOKIE]: cookie.value },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('no_such_score');
    }
  });
});

describe('the score page', () => {
  it('names everyone on it', async () => {
    const id = await createScore();

    const response = await server.inject({
      method: 'GET',
      url: `/scores/${id}/members`,
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id,
      name: 'Nightswim',
      role: 'owner',
      members: [{ email: CREDENTIALS.email, role: 'owner' }],
    });
  });
});
