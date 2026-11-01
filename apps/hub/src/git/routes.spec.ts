import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app/app';
import { migrateToLatest, openDatabase } from '../db/client';
import type { HubDatabaseHandle } from '../db/client';
import { addBandMember } from '../bands/bands';
import { accounts, bandMembers, bands, scorePushes, scoreTokens, scores } from '../db/schema';
import { mintScoreToken } from '../scores/tokens';
import { createRepository } from './repositories';

const run = promisify(execFile);
const MIGRATIONS = path.join(import.meta.dirname, '..', 'db', 'migrations');

const ACCOUNT = 'aaaabbbbccccdddd';
/** A second person in the same band. The drummer of ADR 0007. */
const DRUMMER = 'ddddrrrruuuummmm';
/** Somebody in another band entirely. */
const STRANGER = 'ssssttttrrrraaaa';
const BAND = 'bbbbaaaannnnaaaa';
const OTHER_BAND = 'bbbbaaaannnnoooo';
const SCORE_A = 'sssseeeeaaaaoooo';
const SCORE_B = 'ttttffffbbbbpppp';
/** The other band's score. */
const SCORE_C = 'ccccoooottttheee';

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

function cloneUrl(token: string, band = BAND, score = SCORE_A) {
  const { host } = new URL(origin);
  return `http://token:${token}@${host}/git/${band}/${score}.git`;
}

/** The activity stamps, read straight from the row the route writes. */
function readToken(id: string) {
  return handle.db.select().from(scoreTokens).where(eq(scoreTokens.id, id)).get();
}

/**
 * The push history, oldest first. Polled rather than read once: the rows are
 * written when the CGI exits, which is deliberately not ordered against the
 * client's `git push` returning — see `pushes.ts`.
 */
function readPushes() {
  return handle.db.select().from(scorePushes).orderBy(scorePushes.pushedAt).all();
}

/** A version in a clone, returning its sha. */
async function commit(clone: string, message: string): Promise<string> {
  await writeFile(path.join(clone, 'score.gp'), message);
  await git(clone, 'add', '-A');
  await git(clone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', message);
  const { stdout } = await git(clone, 'rev-parse', 'HEAD');
  return stdout.trim();
}

beforeEach(async () => {
  gitRoot = await mkdtemp(path.join(tmpdir(), 'gpt-git-'));
  workspace = await mkdtemp(path.join(tmpdir(), 'gpt-work-'));

  handle = openDatabase(':memory:');
  migrateToLatest(handle.db, MIGRATIONS);
  handle.db.insert(accounts).values([
    {
      id: ACCOUNT,
      email: 'player@example.com',
      passwordHash: 'not-a-real-hash',
      createdAt: new Date(),
    },
    {
      id: DRUMMER,
      email: 'sam@example.com',
      passwordHash: 'not-a-real-hash',
      createdAt: new Date(),
    },
    {
      id: STRANGER,
      email: 'kim@example.com',
      passwordHash: 'not-a-real-hash',
      createdAt: new Date(),
    },
  ]).run();
  handle.db.insert(bands).values([
    { id: BAND, name: 'The band', createdAt: new Date() },
    { id: OTHER_BAND, name: 'Another band', createdAt: new Date() },
  ]).run();
  addBandMember(handle.db, BAND, ACCOUNT, 'owner');
  addBandMember(handle.db, BAND, DRUMMER, 'member');
  addBandMember(handle.db, OTHER_BAND, STRANGER, 'owner');
  handle.db.insert(scores).values([
    { id: SCORE_A, bandId: BAND, name: 'Bridge rewrite', createdAt: new Date() },
    { id: SCORE_B, bandId: BAND, name: 'Untitled riff', createdAt: new Date() },
    { id: SCORE_C, bandId: OTHER_BAND, name: 'Their song', createdAt: new Date() },
  ]).run();

  await createRepository(gitRoot, BAND, SCORE_A);
  await createRepository(gitRoot, BAND, SCORE_B);
  await createRepository(gitRoot, OTHER_BAND, SCORE_C);

  server = Fastify();
  await server.register(app, {
    db: handle.db,
    cookieSecure: false,
    gitRoot,
    // Clone urls are not what this spec exercises; git is pointed at `origin`.
    publicUrl: 'http://localhost',
  });
  origin = await server.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  await server.close();
  handle?.close();
  await rm(gitRoot, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

describe('the git endpoint', () => {
  it('should challenge for credentials when none arrive', async () => {
    // Given / When
    const response = await fetch(
      `${origin}/git/${BAND}/${SCORE_A}.git/info/refs?service=git-upload-pack`
    );

    // Then — without the challenge git gives up rather than asking.
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Basic');
  });

  it('should refuse a token that was never issued', async () => {
    // Given / When
    const response = await fetch(
      `${origin}/git/${BAND}/${SCORE_A}.git/info/refs?service=git-upload-pack`,
      { headers: { Authorization: `Basic ${Buffer.from('token:made-up').toString('base64')}` } }
    );

    // Then
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_token');
  });

  it('should accept a push of a named version when the token matches', async () => {
    // Given
    const { token } = mintScoreToken(handle.db, SCORE_A, ACCOUNT, 'companion');
    await git(workspace, 'clone', '--quiet', cloneUrl(token), 'score');
    const clone = path.join(workspace, 'score');
    await writeFile(path.join(clone, 'score.gp'), '<?xml version="1.0"?><GPIF/>');
    await git(clone, 'add', '-A');
    await git(clone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'named version');

    // When
    await git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');

    // Then
    const { stdout } = await git(gitRoot, '--git-dir', path.join(gitRoot, BAND, `${SCORE_A}.git`), 'for-each-ref', '--format=%(refname)');
    expect(stdout).toContain('refs/heads/main');
  });

  it('should accept the snapshots ref as well as main', async () => {
    // Given — companion keeps silent snapshots on their own ref namespace
    const { token } = mintScoreToken(handle.db, SCORE_A, ACCOUNT, 'companion');
    await git(workspace, 'clone', '--quiet', cloneUrl(token), 'score');
    const clone = path.join(workspace, 'score');
    await git(clone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'snap');

    // When
    await git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/snapshots/latest');

    // Then
    const { stdout } = await git(gitRoot, '--git-dir', path.join(gitRoot, BAND, `${SCORE_A}.git`), 'for-each-ref', '--format=%(refname)');
    expect(stdout).toContain('refs/snapshots/latest');
  });

  it('should serve a clone back with its content', async () => {
    // Given a repository that has been pushed to
    const { token } = mintScoreToken(handle.db, SCORE_A, ACCOUNT, 'companion');
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

  it('should record the device as having pushed, having minted nothing new', async () => {
    // Given a credential that has never been used — the state POST /scores
    // leaves every score in, since it mints a token inline with the row.
    const { id, token } = mintScoreToken(handle.db, SCORE_A, ACCOUNT, "Ben's MacBook");
    expect(readToken(id)).toMatchObject({ lastUsedAt: null, lastPushedAt: null });

    // When a real push goes through the route
    await git(workspace, 'clone', '--quiet', cloneUrl(token), 'score');
    const clone = path.join(workspace, 'score');
    await writeFile(path.join(clone, 'score.gp'), '<?xml version="1.0"?><GPIF/>');
    await git(clone, 'add', '-A');
    await git(clone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'named version');
    await git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');

    // Then — this is the only place the hub ever learns that a score is
    // really on a computer, and that someone is really working on it.
    const row = readToken(id);
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
    expect(row?.lastPushedAt).toBeInstanceOf(Date);
  });

  it('should record a clone as a connection and not as a push', async () => {
    // Given
    const { id, token } = mintScoreToken(handle.db, SCORE_A, ACCOUNT, 'Studio iMac');

    // When the score is fetched onto the machine but nothing comes back
    await git(workspace, 'clone', '--quiet', cloneUrl(token), 'score');

    // Then — the score is on that computer, which the list should say; but
    // nobody has played anything into it, which it must not say.
    const row = readToken(id);
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
    expect(row?.lastPushedAt).toBeNull();
  });

  it('should refuse a valid token aimed at another score', async () => {
    // Given a token minted for one score
    const { token } = mintScoreToken(handle.db, SCORE_A, ACCOUNT, 'companion');

    // When it is pointed at a sibling in the same band
    const failure = await git(workspace, 'clone', '--quiet', cloneUrl(token, BAND, SCORE_B), 'nope')
      .catch((error: Error) => error);

    // Then
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toMatch(/403/);
  });

  it("should let a second member of the band push to the band's score", async () => {
    // Given the drummer's own credential for a score the band owns
    const { id, token } = mintScoreToken(handle.db, SCORE_A, DRUMMER, "Sam's laptop");

    // When they clone and push through the band's path
    await git(workspace, 'clone', '--quiet', cloneUrl(token), 'score');
    const clone = path.join(workspace, 'score');
    await writeFile(path.join(clone, 'score.gp'), 'drums');
    await git(clone, 'add', '-A');
    await git(clone, '-c', 'user.email=sam@example.com', '-c', 'user.name=Sam', 'commit', '-qm', 'drums');
    await git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');

    // Then — nobody shared the score with them; being in the band is enough.
    const { stdout } = await git(gitRoot, '--git-dir', path.join(gitRoot, BAND, `${SCORE_A}.git`), 'for-each-ref', '--format=%(refname)');
    expect(stdout).toContain('refs/heads/main');
    expect(readToken(id)?.lastPushedAt).toBeInstanceOf(Date);
  });

  it("should refuse a band's token at another band's repository", async () => {
    // Given a valid token for a score in the band
    const { token } = mintScoreToken(handle.db, SCORE_A, ACCOUNT, 'companion');

    // When it is pointed at the other band's score
    const failure = await git(workspace, 'clone', '--quiet', cloneUrl(token, OTHER_BAND, SCORE_C), 'nope')
      .catch((error: Error) => error);

    // Then
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toMatch(/403/);
  });

  it("should refuse a path whose first segment is not the score's band", async () => {
    // Given a valid token, and its own score under segments that are not its band
    const { token } = mintScoreToken(handle.db, SCORE_A, ACCOUNT, 'companion');
    const auth = { Authorization: `Basic ${Buffer.from(`token:${token}`).toString('base64')}` };

    // When the segment is the holder's account, or a band the score is not in
    const statuses = await Promise.all(
      [ACCOUNT, OTHER_BAND].map(async (segment) => {
        const response = await fetch(
          `${origin}/git/${segment}/${SCORE_A}.git/info/refs?service=git-upload-pack`,
          { headers: auth }
        );
        return response.status;
      })
    );

    // Then — the path is where the band keeps the repository, not who is asking.
    expect(statuses).toEqual([403, 403]);
  });

  it("should refuse a token whose holder is not in the score's band", async () => {
    // Given a token for the other band's score, held by someone outside it
    const { token } = mintScoreToken(handle.db, SCORE_C, ACCOUNT, 'companion');

    // When it is used on the very repository it names
    const response = await fetch(
      `${origin}/git/${OTHER_BAND}/${SCORE_C}.git/info/refs?service=git-upload-pack`,
      { headers: { Authorization: `Basic ${Buffer.from(`token:${token}`).toString('base64')}` } }
    );

    // Then — the row exists, and without the membership behind it it is no
    // credential at all.
    expect(response.status).toBe(401);
  });

  it('should stop honouring a token once its holder leaves the band', async () => {
    // Given a credential that worked
    const { token } = mintScoreToken(handle.db, SCORE_A, DRUMMER, "Sam's laptop");

    // When the membership goes
    handle.db.delete(bandMembers).where(eq(bandMembers.accountId, DRUMMER)).run();

    // Then it is not a credential any more. Asserted over fetch rather than
    // through git, which reports a URL's rejected credentials as its own
    // message and never shows the status.
    const response = await fetch(
      `${origin}/git/${BAND}/${SCORE_A}.git/info/refs?service=git-upload-pack`,
      { headers: { Authorization: `Basic ${Buffer.from(`token:${token}`).toString('base64')}` } }
    );
    expect(response.status).toBe(401);
  });

  it('should record what each push moved, and which credential moved it', async () => {
    // Given a device credential and an empty repository
    const { id, token } = mintScoreToken(handle.db, SCORE_A, ACCOUNT, "Ben's MacBook");
    await git(workspace, 'clone', '--quiet', cloneUrl(token), 'score');
    const clone = path.join(workspace, 'score');
    const first = await commit(clone, 'first version');

    // When the first version lands on a ref that did not exist
    await git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');

    // Then — a null old oid, because there is no `old..new` to ask git for.
    await expect.poll(() => readPushes().length).toBe(1);
    expect(readPushes()[0]).toMatchObject({
      scoreId: SCORE_A,
      tokenId: id,
      ref: 'refs/heads/main',
      oldOid: null,
      newOid: first,
    });

    // When a second version lands on top
    const second = await commit(clone, 'second version');
    await git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');

    // Then both ends of the range are on the row, which is the whole point:
    // the repository can be asked what moved, rather than told.
    await expect.poll(() => readPushes().length).toBe(2);
    expect(readPushes()[1]).toMatchObject({ oldOid: first, newOid: second });
  });

  it('should record a branch and leave the snapshots namespace out of it', async () => {
    // Given
    const { token } = mintScoreToken(handle.db, SCORE_A, ACCOUNT, 'companion');
    await git(workspace, 'clone', '--quiet', cloneUrl(token), 'score');
    const clone = path.join(workspace, 'score');
    const tip = await commit(clone, 'solo');

    // When a branch is pushed
    await git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/heads/solo-take-2');
    await expect.poll(() => readPushes().length).toBe(1);
    expect(readPushes()[0]).toMatchObject({ ref: 'refs/heads/solo-take-2', newOid: tip });

    // When an autosave is parked on the ref namespace the route also accepts,
    // and a second branch pushed behind it
    await git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/snapshots/latest');
    await git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/heads/solo-take-3');

    // Then the snapshot is not history and the branch behind it is. The
    // second branch is what makes this an assertion rather than a race: the
    // snapshot was seen and skipped, not merely still in flight.
    await expect.poll(() => readPushes().length).toBe(2);
    expect(readPushes().map((row) => row.ref)).toEqual([
      'refs/heads/solo-take-2',
      'refs/heads/solo-take-3',
    ]);
  });

  it('should write no history for a push receive-pack refuses', async () => {
    // Given a landed version, and a repository that will not rewind a branch
    const bare = path.join(gitRoot, BAND, `${SCORE_A}.git`);
    const { token } = mintScoreToken(handle.db, SCORE_A, ACCOUNT, 'companion');
    await git(workspace, 'clone', '--quiet', cloneUrl(token), 'score');
    const clone = path.join(workspace, 'score');
    const landed = await commit(clone, 'first version');
    await git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
    await expect.poll(() => readPushes().length).toBe(1);
    await git(gitRoot, '--git-dir', bare, 'config', 'receive.denyNonFastForwards', 'true');

    // When a forced rewrite is pushed at it and receive-pack says no
    await git(clone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--amend', '-m', 'rewritten');
    const { stdout } = await git(clone, 'rev-parse', 'HEAD');
    const rewritten = stdout.trim();
    const failure = await git(clone, 'push', '--force', '--quiet', 'origin', 'HEAD:refs/heads/main')
      .catch((error: Error) => error);

    // Then the ref never moved and neither did the history. `last_pushed_at`
    // counts this as activity and is right to; this table must not.
    // `remote rejected`, not `rejected`: --force turns off the client's own
    // fast-forward check, so this push really did reach receive-pack and come
    // back refused. A client-side refusal would test nothing here.
    expect(String(failure)).toContain('remote rejected');
    await git(clone, 'push', '--quiet', 'origin', `${landed}:refs/heads/plan-b`);
    await expect.poll(() => readPushes().length).toBe(2);
    expect(readPushes().some((row) => row.newOid === rewritten)).toBe(false);
  });

  it('should refuse a traversal attempt carrying a real token', async () => {
    // Given a genuine token and a path that tries to escape the git root
    const { token } = mintScoreToken(handle.db, SCORE_A, ACCOUNT, 'companion');

    // When
    const response = await fetch(`${origin}/git/${BAND}/..%2f..%2fetc.git/info/refs`, {
      headers: { Authorization: `Basic ${Buffer.from(`token:${token}`).toString('base64')}` },
    });

    // Then — refused by the comparison against the token's own score, before
    // any path is built. repositories.spec covers the guard underneath.
    expect(response.status).toBe(403);
  });
});
