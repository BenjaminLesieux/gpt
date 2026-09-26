import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { exporter, importer, Settings } from '@coderline/alphatab';
import Fastify from 'fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app/app';
import { SESSION_COOKIE } from '../auth/cookie';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabaseHandle } from '../db/client';
import { NAMED_REF, SCORE_ENTRY } from '../git/versions';

/**
 * `GET /scores/:id/branches`, over real repositories reached the way companion
 * reaches them.
 *
 * This spec listens on a socket and pushes over HTTP with a score token rather
 * than cloning the bare directory, which `history.spec.ts` does. It costs a
 * real server and it buys the one thing a file clone cannot produce: the
 * `score_pushes` rows the route writes, without which *who last pushed* is a
 * join with nothing on the other side.
 *
 * The score files are real too. Two branches touching different tracks is the
 * case the whole feature exists for, and it cannot be asserted with `git
 * commit --allow-empty` — it needs two Guitar Pro files that actually differ
 * in different tracks, so the fixture is re-exported with one bar moved.
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
const CREDENTIALS = { email: 'player@example.com', password: 'a decent passphrase' };

/**
 * Tracks of the fixture, and a bar in each that has notes in it. Bumping a bar
 * with no notes exports byte-identical and diffs to nothing, which reads as a
 * broken assertion rather than as the empty edit it is.
 */
const BASS = { track: 0, bar: 4, name: 'Electric Bass' };
const GUITAR = { track: 1, bar: 4, name: 'Clean Guitar' };

let handle: HubDatabaseHandle;
let server: FastifyInstance;
let gitRoot: string;
let work: string;
let origin: string;
let session: string;
let sample: Buffer;

async function git(...args: string[]) {
  return run('git', args, {
    cwd: work,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/** A score, plus a clone of it wired to push over HTTP with its own token. */
async function createScore(name = 'Nightswim'): Promise<string> {
  const created = await server.inject({
    method: 'POST',
    url: '/scores',
    payload: { name },
    cookies: { [SESSION_COOKIE]: session },
  });

  const { id, username, token } = created.json();
  const { host } = new URL(origin);

  await run('git', [
    'clone',
    '--quiet',
    `http://${username}:${token}@${host}/git/${username}/${id}.git`,
    work,
  ]);
  await git('config', 'user.email', CREDENTIALS.email);
  await git('config', 'user.name', 'Ben');
  // Cloning a repository with no commits leaves the local branch named after
  // whatever this machine's `init.defaultBranch` is, which on a developer's
  // laptop is often not the one the hub serves.
  await git('symbolic-ref', 'HEAD', NAMED_REF);

  return id;
}

/**
 * The fixture with one bar of one track moved, exported back to Guitar Pro.
 *
 * Re-exporting without an edit is byte-different from the fixture but diffs to
 * nothing, so both branches start from a version written the same way. What
 * separates them is the track they touch and only that.
 */
function edited(edit?: { track: number; bar: number }): Buffer {
  const score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(sample));

  if (edit) {
    for (const beat of score.tracks[edit.track].staves[0].bars[edit.bar].voices[0].beats) {
      for (const note of beat.notes) note.fret = (note.fret + 3) % 20;
    }
  }

  score.finish(new Settings());
  return Buffer.from(new exporter.Gp7Exporter().export(score, null));
}

/** One version, from bytes. Returns its sha. */
async function version(message: string, bytes: Buffer): Promise<string> {
  await writeFile(path.join(work, SCORE_ENTRY), bytes);
  await git('add', SCORE_ENTRY);
  await git('commit', '--quiet', '-m', message);
  const { stdout } = await git('rev-parse', 'HEAD');
  return stdout.trim();
}

function branches(id: string, cookie = session): Promise<LightMyRequestResponse> {
  return server.inject({
    method: 'GET',
    url: `/scores/${id}/branches`,
    cookies: { [SESSION_COOKIE]: cookie },
  });
}

/** Just the track names, which is what *are these two in each other's way* is. */
function touched(branch: { scope: { tracks: { name: string }[] } | null }): string[] {
  return (branch.scope?.tracks ?? []).map((track) => track.name);
}

beforeEach(async () => {
  gitRoot = await mkdtemp(path.join(tmpdir(), 'gpt-branches-'));
  work = path.join(await mkdtemp(path.join(tmpdir(), 'gpt-work-')), 'clone');
  sample = await readFile(FIXTURE);

  handle = openDatabase(':memory:');
  migrateToLatest(handle.db, MIGRATIONS);

  server = Fastify();
  await server.register(app, {
    db: handle.db,
    cookieSecure: false,
    gitRoot,
    publicUrl: 'http://localhost',
  });
  origin = await server.listen({ port: 0, host: '127.0.0.1' });

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
  await rm(path.dirname(work), { recursive: true, force: true });
});

describe('a score with no branches', () => {
  it('is an empty list rather than an error', async () => {
    const id = await createScore();

    const response = await branches(id);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ branches: [] });
  });

  it('does not list the main line as one', async () => {
    const id = await createScore();
    await version('first pass at the whole thing', edited());
    await git('push', '--quiet', 'origin', 'main');

    expect((await branches(id)).json().branches).toEqual([]);
  });
});

describe('two branches touching different tracks', () => {
  it('report scopes that do not overlap', async () => {
    const id = await createScore();
    await version('first pass at the whole thing', edited());
    await git('push', '--quiet', 'origin', 'main');

    await git('checkout', '--quiet', '-b', 'bass-line');
    await version('bass follows the kick now', edited(BASS));
    await git('checkout', '--quiet', 'main');
    await git('checkout', '--quiet', '-b', 'guitar-fix');
    await version('wrong note in the second chorus', edited(GUITAR));
    await git('push', '--quiet', 'origin', 'bass-line', 'guitar-fix');

    const list = (await branches(id)).json().branches;
    const bass = list.find((b: { name: string }) => b.name === 'bass-line');
    const guitar = list.find((b: { name: string }) => b.name === 'guitar-fix');

    expect(touched(bass)).toEqual([BASS.name]);
    expect(touched(guitar)).toEqual([GUITAR.name]);
    // The whole point: nobody declared a track, and these two can be worked on
    // the same evening without either of them finding out the hard way.
    expect(touched(bass).filter((name) => touched(guitar).includes(name))).toEqual([]);
  });

  it("report the same track when they are in fact in each other's way", async () => {
    const id = await createScore();
    await version('first pass at the whole thing', edited());
    await git('push', '--quiet', 'origin', 'main');

    await git('checkout', '--quiet', '-b', 'bass-line');
    await version('bass follows the kick now', edited(BASS));
    await git('checkout', '--quiet', 'main');
    await git('checkout', '--quiet', '-b', 'bass-again');
    await version('other idea for the same bar', edited({ track: BASS.track, bar: 6 }));
    await git('push', '--quiet', 'origin', 'bass-line', 'bass-again');

    const list = (await branches(id)).json().branches;

    for (const branch of list) expect(touched(branch)).toEqual([BASS.name]);
  });
});

describe('a branch', () => {
  it('is measured from where it left main, not from its own parent', async () => {
    const id = await createScore();
    await version('first pass at the whole thing', edited());
    await git('push', '--quiet', 'origin', 'main');

    await git('checkout', '--quiet', '-b', 'bass-line');
    await version('bass follows the kick now', edited(BASS));
    // A second version on the same branch that puts the first one back. Folding
    // the per-version scopes would say two touched bars; the range says none.
    await version('no, the first one was right', edited());
    await git('push', '--quiet', 'origin', 'bass-line');

    const [branch] = (await branches(id)).json().branches;

    expect(branch.ahead).toBe(2);
    expect(touched(branch)).toEqual([]);
    expect(branch.scope.bars).toBe(0);
  });

  it('says who last pushed it, and when it was last worked on', async () => {
    const id = await createScore();
    await version('first pass at the whole thing', edited());
    await git('push', '--quiet', 'origin', 'main');

    await git('checkout', '--quiet', '-b', 'bass-line');
    const tip = await version('bass follows the kick now', edited(BASS));
    await git('push', '--quiet', 'origin', 'bass-line');

    const [branch] = (await branches(id)).json().branches;

    expect(branch).toMatchObject({ name: 'bass-line', tip, ahead: 1 });
    expect(branch.pushedBy).toBe(CREDENTIALS.email);
    expect(Number.isNaN(Date.parse(branch.at))).toBe(false);
  });

  it('is nothing ahead and touches nothing once it has landed', async () => {
    const id = await createScore();
    await version('first pass at the whole thing', edited());
    await git('push', '--quiet', 'origin', 'main');

    await git('checkout', '--quiet', '-b', 'bass-line');
    await version('bass follows the kick now', edited(BASS));
    await git('checkout', '--quiet', 'main');
    await git('merge', '--quiet', '--no-ff', '-m', 'Bass line landed', 'bass-line');
    await git('push', '--quiet', 'origin', 'main', 'bass-line');

    const [branch] = (await branches(id)).json().branches;

    expect(branch.ahead).toBe(0);
    // merge-base is the branch's own tip once main contains it, so there is
    // nothing left that this line has and main does not.
    expect(touched(branch)).toEqual([]);
  });
});

describe('a branch pushed before there is a main line', () => {
  it('is the whole of its own tip, having nothing to be measured against', async () => {
    const id = await createScore();

    await git('checkout', '--quiet', '-b', 'bass-line');
    await version('starting somewhere other than the top', edited(BASS));
    await git('push', '--quiet', 'origin', 'bass-line');

    const [branch] = (await branches(id)).json().branches;

    // No merge-base to diff from, so the reading is the one the first version
    // gets: all of it arrived at once. The fixture is four tracks.
    expect(branch.scope.trackCount).toBe(4);
    expect(branch.scope.bars).toBeGreaterThan(0);
  });
});

describe('a branch whose tip will not parse', () => {
  it('still lists, and says nothing about what it touched', async () => {
    const id = await createScore();
    await version('first pass at the whole thing', edited());
    await git('push', '--quiet', 'origin', 'main');

    await git('checkout', '--quiet', '-b', 'from-an-older-guitar-pro');
    await version('saved from something we cannot read', Buffer.from('not a guitar pro file'));
    await git('push', '--quiet', 'origin', 'from-an-older-guitar-pro');

    const response = await branches(id);
    const [branch] = response.json().branches;

    // Never a 500, and never a silently empty diff — the branch is here with
    // its name and its author, and `null` is the screen's cue to say so in
    // words rather than to draw *0 bars*.
    expect(response.statusCode).toBe(200);
    expect(branch.name).toBe('from-an-older-guitar-pro');
    expect(branch.ahead).toBe(1);
    expect(branch.pushedBy).toBe(CREDENTIALS.email);
    expect(branch.scope).toBeNull();
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

    const response = await branches(id, cookie.value);

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('no_such_score');
  });
});
