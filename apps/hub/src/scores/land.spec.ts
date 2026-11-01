import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { exporter, importer, Settings } from '@coderline/alphatab';
import type { Score } from '@gpt/gpt-core';
import Fastify from 'fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app/app';
import { SESSION_COOKIE } from '../auth/cookie';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabaseHandle } from '../db/client';
import { repositoryPath } from '../git/repositories';
import { MAIN_REF, SCORE_ENTRY, writeLanding } from '../git/versions';

/**
 * Landing a branch, over real repositories pushed to the way companion pushes
 * and real Guitar Pro files, as in `branches.spec.ts`.
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
  'sample.gp',
);
const CREDENTIALS = {
  email: 'player@example.com',
  password: 'a decent passphrase',
};

const BASS = { track: 0, bar: 4, name: 'Electric Bass' };
const GUITAR = { track: 1, bar: 4, name: 'Clean Guitar' };

let handle: HubDatabaseHandle;
let server: FastifyInstance;
let gitRoot: string;
let work: string;
let origin: string;
let session: string;
let sample: Buffer;
let score: { id: string; owner: string; token: string };

async function git(...args: string[]) {
  return run('git', args, {
    cwd: work,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
  });
}

function bare(...args: string[]) {
  const repository = repositoryPath(gitRoot, score.owner, score.id);
  if (!repository) throw new Error('bad repository path');
  return run('git', ['--git-dir', repository, ...args], { encoding: 'buffer' });
}

async function mainTip(): Promise<string> {
  return (await bare('rev-parse', MAIN_REF)).stdout.toString().trim();
}

async function mainScore(): Promise<Score> {
  const { stdout } = await bare(
    'cat-file',
    'blob',
    `${MAIN_REF}:${SCORE_ENTRY}`,
  );
  return importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(stdout));
}

async function createScore(name = 'Nightswim') {
  const created = await server.inject({
    method: 'POST',
    url: '/scores',
    payload: { name },
    cookies: { [SESSION_COOKIE]: session },
  });
  const { id, username, token } = created.json();
  return { id, owner: username as string, token: token as string };
}

async function cloneScore() {
  score = await createScore();
  const { host } = new URL(origin);

  await run('git', [
    'clone',
    '--quiet',
    `http://${score.owner}:${score.token}@${host}/git/${score.owner}/${score.id}.git`,
    work,
  ]);
  await git('config', 'user.email', CREDENTIALS.email);
  await git('config', 'user.name', 'Ben');
  await git('symbolic-ref', 'HEAD', MAIN_REF);
}

type Edit = { track: number; bar: number; shift?: number };

function frets(from: Score, edit: Edit): number[] {
  return from.tracks[edit.track].staves[0].bars[
    edit.bar
  ].voices[0].beats.flatMap((beat) => beat.notes.map((note) => note.fret));
}

function edited(...edits: Edit[]): Buffer {
  const parsed = importer.ScoreLoader.loadScoreFromBytes(
    new Uint8Array(sample),
  );

  for (const edit of edits) {
    for (const beat of parsed.tracks[edit.track].staves[0].bars[edit.bar]
      .voices[0].beats) {
      for (const note of beat.notes)
        note.fret = (note.fret + (edit.shift ?? 3)) % 20;
    }
  }

  parsed.finish(new Settings());
  return Buffer.from(new exporter.Gp7Exporter().export(parsed, null));
}

/** What a bar's frets read once `edit` has been applied to the fixture. */
function expectedFrets(edit: Edit): number[] {
  const original = importer.ScoreLoader.loadScoreFromBytes(
    new Uint8Array(sample),
  );
  return frets(original, edit).map((fret) => (fret + (edit.shift ?? 3)) % 20);
}

async function version(message: string, bytes: Buffer): Promise<string> {
  await writeFile(path.join(work, SCORE_ENTRY), bytes);
  await git('add', SCORE_ENTRY);
  await git('commit', '--quiet', '-m', message);
  const { stdout } = await git('rev-parse', 'HEAD');
  return stdout.trim();
}

/** A branch off main's current tip holding one version, pushed. */
async function branch(name: string, bytes: Buffer): Promise<string> {
  await git('checkout', '--quiet', 'main');
  await git('checkout', '--quiet', '-b', name);
  const tip = await version(`work on ${name}`, bytes);
  await git('push', '--quiet', 'origin', name);
  await git('checkout', '--quiet', 'main');
  return tip;
}

function basic(token: string, owner = score.owner): string {
  return `Basic ${Buffer.from(`${owner}:${token}`).toString('base64')}`;
}

function landBranch(
  name: string,
  options: { body?: object; token?: string; on?: FastifyInstance } = {},
): Promise<LightMyRequestResponse> {
  return (options.on ?? server).inject({
    method: 'POST',
    url: `/scores/${score.id}/branches/${encodeURIComponent(name)}/land`,
    payload: options.body ?? {},
    ...(options.token
      ? { headers: { authorization: basic(options.token) } }
      : { cookies: { [SESSION_COOKIE]: session } }),
  });
}

async function listed(name: string) {
  const response = await server.inject({
    method: 'GET',
    url: `/scores/${score.id}/branches`,
    cookies: { [SESSION_COOKIE]: session },
  });
  return response
    .json()
    .branches.find((b: { name: string }) => b.name === name);
}

async function boot(mergeWrites: boolean): Promise<FastifyInstance> {
  const instance = Fastify();
  await instance.register(app, {
    db: handle.db,
    cookieSecure: false,
    gitRoot,
    publicUrl: 'http://localhost',
    mergeWrites,
  });
  return instance;
}

beforeEach(async () => {
  gitRoot = await mkdtemp(path.join(tmpdir(), 'gpt-land-'));
  work = path.join(await mkdtemp(path.join(tmpdir(), 'gpt-work-')), 'clone');
  sample = await readFile(FIXTURE);

  handle = openDatabase(':memory:');
  migrateToLatest(handle.db, MIGRATIONS);

  server = await boot(true);
  origin = await server.listen({ port: 0, host: '127.0.0.1' });

  const signup = await server.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: CREDENTIALS,
  });
  const cookie = signup.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error('signup issued no session cookie');
  session = cookie.value;

  await cloneScore();
  await version('first pass at the whole thing', edited());
  await git('push', '--quiet', 'origin', 'main');
});

afterEach(async () => {
  await server.close();
  handle?.close();
  await rm(gitRoot, { recursive: true, force: true });
  await rm(path.dirname(work), { recursive: true, force: true });
});

describe('two branches on different tracks', () => {
  it('land one after the other, and main ends up holding both parts', async () => {
    const bassTip = await branch('bass-line', edited(BASS));
    const guitarTip = await branch('guitar-fix', edited(GUITAR));

    const first = await landBranch('bass-line');
    expect(first.statusCode).toBe(200);
    // Main had not moved, so the first one is the branch's own tip.
    expect(first.json()).toEqual({
      status: 'landed',
      commit: bassTip,
      dryRun: false,
    });

    const second = await landBranch('guitar-fix');
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ status: 'landed', dryRun: false });

    const commit = second.json().commit;
    expect(await mainTip()).toBe(commit);
    const parents = (
      await bare('rev-list', '--parents', '-n', '1', commit)
    ).stdout
      .toString()
      .trim()
      .split(' ')
      .slice(1);
    expect(parents).toEqual([bassTip, guitarTip]);

    const merged = await mainScore();
    expect(frets(merged, BASS)).toEqual(expectedFrets(BASS));
    expect(frets(merged, GUITAR)).toEqual(expectedFrets(GUITAR));

    const listedGuitar = await listed('guitar-fix');
    expect(listedGuitar).toMatchObject({
      ahead: 0,
      landing: null,
      askFirst: false,
    });
  });

  it('race through one queue, so both land rather than one being lost', async () => {
    await branch('bass-line', edited(BASS));
    await branch('guitar-fix', edited(GUITAR));

    const [a, b] = await Promise.all([
      landBranch('bass-line'),
      landBranch('guitar-fix'),
    ]);

    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect([a.json().status, b.json().status]).toEqual(['landed', 'landed']);

    const merged = await mainScore();
    expect(frets(merged, BASS)).toEqual(expectedFrets(BASS));
    expect(frets(merged, GUITAR)).toEqual(expectedFrets(GUITAR));
  });
});

describe('landing against a main that moved underneath it', () => {
  it('is refused by update-ref, and main stays where the other landing put it', async () => {
    const stale = await mainTip();
    const tip = await branch('bass-line', edited(BASS));

    // Somebody else's version reaches main between the read and the write.
    const moved = await version('meanwhile on main', edited(GUITAR));
    await git('push', '--quiet', 'origin', 'main');

    const written = await writeLanding(gitRoot, score.owner, score.id, {
      from: stale,
      tip,
      merged: edited(BASS, GUITAR),
      message: 'bass-line landed',
    });

    expect(written).toEqual({ status: 'main_moved' });
    expect(await mainTip()).toBe(moved);
  });
});

describe('a conflicting merge', () => {
  it('writes nothing and names the bar and the track', async () => {
    const tip = await branch('bass-a', edited({ ...BASS, shift: 3 }));
    await version('the same bar, another way', edited({ ...BASS, shift: 5 }));
    await git('push', '--quiet', 'origin', 'main');
    const before = await mainTip();

    const response = await landBranch('bass-a');

    expect(response.statusCode).toBe(200);
    const outcome = response.json();
    expect(outcome.status).toBe('conflicts');
    expect(
      outcome.conflicts.map((c: { bar: number; track: string }) => [
        c.bar,
        c.track,
      ]),
    ).toEqual([[BASS.bar + 1, BASS.name]]);
    expect(typeof outcome.conflicts[0].description).toBe('string');
    expect(await mainTip()).toBe(before);

    expect((await listed('bass-a')).landing).toEqual({ ...outcome, tip });
  });
});

describe('with MERGE_WRITES off', () => {
  it('computes the merge, says it is clean, and writes nothing', async () => {
    await branch('bass-line', edited(BASS));
    await version('meanwhile on main', edited(GUITAR));
    await git('push', '--quiet', 'origin', 'main');
    const before = await mainTip();

    const dry = await boot(false);
    try {
      const response = await landBranch('bass-line', { on: dry });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'clean', dryRun: true });
      expect(await mainTip()).toBe(before);
    } finally {
      await dry.close();
    }
  });
});

describe('a branch that asks the band first', () => {
  it('waits when clean, and lands on an override', async () => {
    const tip = await branch('ideas/bass', edited(BASS));

    const set = await server.inject({
      method: 'PUT',
      url: `/scores/${score.id}/branches/${encodeURIComponent('ideas/bass')}/ask-first`,
      payload: { askFirst: true },
      headers: { authorization: basic(score.token) },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ askFirst: true });

    const before = await mainTip();
    const held = await landBranch('ideas/bass', { token: score.token });
    expect(held.json()).toEqual({ status: 'waiting' });
    expect(await mainTip()).toBe(before);
    expect(await listed('ideas/bass')).toMatchObject({
      askFirst: true,
      landing: { status: 'waiting', tip },
    });

    const overridden = await landBranch('ideas/bass', {
      body: { override: true },
    });
    expect(overridden.json()).toEqual({
      status: 'landed',
      commit: tip,
      dryRun: false,
    });
    expect(await listed('ideas/bass')).toMatchObject({
      ahead: 0,
      landing: null,
    });
  });
});

describe('a branch whose tip will not parse', () => {
  it('is unreadable, never a 500, and nothing is written', async () => {
    await branch(
      'from-an-older-guitar-pro',
      Buffer.from('not a guitar pro file'),
    );
    await version('meanwhile on main', edited(GUITAR));
    await git('push', '--quiet', 'origin', 'main');
    const before = await mainTip();

    const response = await landBranch('from-an-older-guitar-pro');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'unreadable' });
    expect(await mainTip()).toBe(before);
  });
});

describe('nothing to land', () => {
  it('is up to date once a branch has landed', async () => {
    await branch('bass-line', edited(BASS));
    await landBranch('bass-line');

    expect((await landBranch('bass-line')).json()).toEqual({
      status: 'up_to_date',
    });
  });

  it('is no such branch for main itself and for a name nobody pushed', async () => {
    for (const name of ['main', 'nobody-pushed-this']) {
      const response = await landBranch(name);
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('no_such_branch');
    }
  });
});

describe('a score token', () => {
  it('lands its own score and is refused on another', async () => {
    await branch('bass-line', edited(BASS));
    const other = await createScore('Somebody else');

    const refused = await landBranch('bass-line', { token: other.token });
    expect(refused.statusCode).toBe(404);
    expect(refused.json().error.code).toBe('no_such_score');

    const askFirst = await server.inject({
      method: 'PUT',
      url: `/scores/${score.id}/branches/bass-line/ask-first`,
      payload: { askFirst: true },
      headers: { authorization: basic(other.token) },
    });
    expect(askFirst.statusCode).toBe(404);

    const branches = (token: string) =>
      server.inject({
        method: 'GET',
        url: `/scores/${score.id}/branches`,
        headers: { authorization: basic(token) },
      });
    expect((await branches(other.token)).statusCode).toBe(404);
    const own = await branches(score.token);
    expect(own.statusCode).toBe(200);
    expect(own.json().branches[0]).toMatchObject({
      name: 'bass-line',
      askFirst: false,
    });

    const bogus = await landBranch('bass-line', { token: 'not-a-token' });
    expect(bogus.statusCode).toBe(401);

    expect(
      (await landBranch('bass-line', { token: score.token })).json().status,
    ).toBe('landed');
  });

  it("reads its own score's branches and is refused on another", async () => {
    await branch('bass-line', edited(BASS));
    const other = await createScore('Somebody else');
    const read = (token: string) =>
      server.inject({
        method: 'GET',
        url: `/scores/${score.id}/branches`,
        headers: { authorization: basic(token) },
      });

    const own = await read(score.token);
    expect(own.statusCode).toBe(200);
    expect(own.json().branches).toMatchObject([
      { name: 'bass-line', askFirst: false },
    ]);

    const refused = await read(other.token);
    expect(refused.statusCode).toBe(404);
    expect(refused.json().error.code).toBe('no_such_score');
  });
});
