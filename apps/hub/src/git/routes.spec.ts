import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app/app';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabaseHandle } from '../db/client';
import { accounts, scores } from '../db/schema';
import { mintScoreToken } from '../scores/tokens';
import { createRepository } from './repositories';

const run = promisify(execFile);
const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');

const ACCOUNT = 'aaaabbbbccccdddd';
const SCORE_A = 'sssseeeeaaaaoooo';
const SCORE_B = 'ttttffffbbbbpppp';

/**
 * Real git against real bare repositories in a tempdir, over a real socket.
 * The whole point of this module is that it speaks a wire protocol correctly,
 * and a mocked child process would assert nothing about that — the same
 * reasoning the Rust suite uses for its bare-repo remotes.
 */
let handle: HubDatabaseHandle;
let server: FastifyInstance;
let gitRoot: string;
let workspace: string;
let origin: string;

async function git(cwd: string, ...args: string[]) {
  return run('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
  });
}

function cloneUrl(token: string, account = ACCOUNT, score = SCORE_A) {
  const { host } = new URL(origin);
  return `http://token:${token}@${host}/git/${account}/${score}.git`;
}

beforeEach(async () => {
  gitRoot = await mkdtemp(path.join(tmpdir(), 'gpt-git-'));
  workspace = await mkdtemp(path.join(tmpdir(), 'gpt-work-'));

  handle = openDatabase(':memory:');
  migrateToLatest(handle.db, MIGRATIONS);
  handle.db.insert(accounts).values({
    id: ACCOUNT,
    email: 'player@example.com',
    passwordHash: 'not-a-real-hash',
    createdAt: new Date(),
  }).run();
  handle.db.insert(scores).values([
    { id: SCORE_A, accountId: ACCOUNT, name: 'Bridge rewrite', createdAt: new Date() },
    { id: SCORE_B, accountId: ACCOUNT, name: 'Untitled riff', createdAt: new Date() },
  ]).run();

  await createRepository(gitRoot, ACCOUNT, SCORE_A);
  await createRepository(gitRoot, ACCOUNT, SCORE_B);

  server = Fastify();
  await server.register(app, { db: handle.db, cookieSecure: false, gitRoot });
  origin = await server.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  await server.close();
  handle.close();
  await rm(gitRoot, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

describe('the git endpoint', () => {
  it('should challenge for credentials when none arrive', async () => {
    // Given / When
    const response = await fetch(
      `${origin}/git/${ACCOUNT}/${SCORE_A}.git/info/refs?service=git-upload-pack`
    );

    // Then — without the challenge git gives up rather than asking.
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Basic');
  });

  it('should refuse a token that was never issued', async () => {
    // Given / When
    const response = await fetch(
      `${origin}/git/${ACCOUNT}/${SCORE_A}.git/info/refs?service=git-upload-pack`,
      { headers: { Authorization: `Basic ${Buffer.from('token:made-up').toString('base64')}` } }
    );

    // Then
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_token');
  });

  it('should accept a push of a named version when the token matches', async () => {
    // Given
    const { token } = mintScoreToken(handle.db, SCORE_A, 'companion');
    await git(workspace, 'clone', '--quiet', cloneUrl(token), 'score');
    const clone = path.join(workspace, 'score');
    await writeFile(path.join(clone, 'score.gp'), '<?xml version="1.0"?><GPIF/>');
    await git(clone, 'add', '-A');
    await git(clone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'named version');

    // When
    await git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');

    // Then
    const { stdout } = await git(gitRoot, '--git-dir', path.join(gitRoot, ACCOUNT, `${SCORE_A}.git`), 'for-each-ref', '--format=%(refname)');
    expect(stdout).toContain('refs/heads/main');
  });

  it('should accept the snapshots ref as well as main', async () => {
    // Given — companion keeps silent snapshots on their own ref namespace
    const { token } = mintScoreToken(handle.db, SCORE_A, 'companion');
    await git(workspace, 'clone', '--quiet', cloneUrl(token), 'score');
    const clone = path.join(workspace, 'score');
    await git(clone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'snap');

    // When
    await git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/snapshots/latest');

    // Then
    const { stdout } = await git(gitRoot, '--git-dir', path.join(gitRoot, ACCOUNT, `${SCORE_A}.git`), 'for-each-ref', '--format=%(refname)');
    expect(stdout).toContain('refs/snapshots/latest');
  });

  it('should serve a clone back with its content', async () => {
    // Given a repository that has been pushed to
    const { token } = mintScoreToken(handle.db, SCORE_A, 'companion');
    await git(workspace, 'clone', '--quiet', cloneUrl(token), 'first');
    const first = path.join(workspace, 'first');
    await writeFile(path.join(first, 'score.gp'), '<?xml version="1.0"?><GPIF/>');
    await git(first, 'add', '-A');
    await git(first, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'named version');
    await git(first, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');

    // When
    await git(workspace, 'clone', '--quiet', cloneUrl(token), 'second');

    // Then — a bare repo whose HEAD pointed at master would transfer every
    // object and check out nothing.
    const { stdout } = await git(path.join(workspace, 'second'), 'log', '--oneline');
    expect(stdout).toContain('named version');
  });

  it('should refuse a valid token aimed at another score', async () => {
    // Given a token minted for one score
    const { token } = mintScoreToken(handle.db, SCORE_A, 'companion');

    // When it is pointed at a sibling in the same account
    const failure = await git(workspace, 'clone', '--quiet', cloneUrl(token, ACCOUNT, SCORE_B), 'nope')
      .catch((error: Error) => error);

    // Then
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toMatch(/403/);
  });

  it('should refuse a traversal attempt carrying a real token', async () => {
    // Given a genuine token and a path that tries to escape the git root
    const { token } = mintScoreToken(handle.db, SCORE_A, 'companion');

    // When
    const response = await fetch(`${origin}/git/${ACCOUNT}/..%2f..%2fetc.git/info/refs`, {
      headers: { Authorization: `Basic ${Buffer.from(`token:${token}`).toString('base64')}` },
    });

    // Then — refused by the comparison against the token's own score, before
    // any path is built. repositories.spec covers the guard underneath.
    expect(response.status).toBe(403);
  });
});
