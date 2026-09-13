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
import { normalizeGp } from '../git/normalize';
import { NAMED_REF, SCORE_ENTRY } from '../git/versions';
import { addScoreMember } from './members';

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
let sample: Buffer;

async function createScore(name = 'Bridge rewrite'): Promise<LightMyRequestResponse> {
  return server.inject({
    method: 'POST',
    url: '/scores',
    payload: { name },
    cookies: { [SESSION_COOKIE]: session },
  });
}

function importScore(
  id: string,
  payload: Buffer,
  // Null rather than undefined for "no session": undefined would take the
  // default and quietly authenticate the request this asks about.
  cookie: string | null = session
): Promise<LightMyRequestResponse> {
  return server.inject({
    method: 'POST',
    url: `/scores/${id}/import`,
    headers: { 'content-type': 'application/octet-stream' },
    payload,
    ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}),
  });
}

beforeEach(async () => {
  sample = await readFile(FIXTURE);
  gitRoot = await mkdtemp(path.join(tmpdir(), 'gpt-import-'));

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

/** The blob on main, as bytes. */
async function storedScore(username: string, id: string): Promise<Buffer> {
  const repository = path.join(gitRoot, username, `${id}.git`);
  const { stdout } = await run(
    'git',
    ['--git-dir', repository, 'cat-file', 'blob', `${NAMED_REF}:${SCORE_ENTRY}`],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  );
  return stdout as unknown as Buffer;
}

describe('POST /scores/:id/import', () => {
  it('should give an empty score its first version', async () => {
    // Given
    const created = (await createScore()).json();

    // When
    const response = await importScore(created.id, sample);

    // Then
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: created.id,
      name: 'Bridge rewrite',
      version: expect.stringMatching(/^[0-9a-f]{40}$/),
      message: 'Imported',
    });
  });

  it('should normalize the file before committing it', async () => {
    // Given a real Guitar Pro save, whose zip headers carry its save time
    const created = (await createScore()).json();

    // When
    await importScore(created.id, sample);

    // Then — the stored bytes are not the uploaded bytes, and normalizing
    // them again changes nothing: they are already in the form the
    // companion's next save will hash to. Without this the first save after
    // an import reads as a musical change when nothing changed.
    const stored = await storedScore(created.username, created.id);
    expect(Buffer.compare(stored, sample)).not.toBe(0);
    expect(Buffer.compare(normalizeGp(stored), stored)).toBe(0);
  });

  it('should make a version the companion can pull', async () => {
    // Given
    const created = (await createScore()).json();
    await importScore(created.id, sample);
    const into = path.join(gitRoot, 'clone');

    // When — what companion's adopt does, in its simplest form.
    await run('git', [
      'clone',
      '--quiet',
      path.join(gitRoot, created.username, `${created.id}.git`),
      into,
    ]);

    // Then
    const checkedOut = await readFile(path.join(into, SCORE_ENTRY));
    expect(Buffer.compare(checkedOut, normalizeGp(sample))).toBe(0);
  });

  it('should refuse a score that already has a version', async () => {
    // Given
    const created = (await createScore()).json();
    const first = await importScore(created.id, sample);

    // When
    const second = await importScore(created.id, Buffer.from('a different file'));

    // Then — import starts a history; it does not add to one.
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('already_has_versions');
    const stored = await storedScore(created.username, created.id);
    expect(Buffer.compare(stored, normalizeGp(sample))).toBe(0);
    expect(first.statusCode).toBe(201);
  });

  it('should refuse an empty body', async () => {
    // Given
    const created = (await createScore()).json();

    // When
    const response = await importScore(created.id, Buffer.alloc(0));

    // Then
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('empty_score');
  });

  it('should answer the same for a score that is not yours and one that does not exist', async () => {
    // Given someone else's score
    const created = (await createScore()).json();
    const stranger = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'other@example.com', password: 'another decent passphrase' },
    });
    const theirSession = stranger.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';

    // When
    const theirs = await importScore(created.id, sample, theirSession);
    const missing = await importScore('nosuchscoreid', sample, theirSession);

    // Then — which one it is is not this caller's business.
    expect(theirs.statusCode).toBe(404);
    expect(theirs.json()).toEqual(missing.json());
  });

  it('should leave the repository empty when it refuses the caller', async () => {
    // Given
    const created = (await createScore()).json();

    // When
    const anonymous = await importScore(created.id, sample, null);

    // Then
    expect(anonymous.statusCode).toBe(401);
    const repository = path.join(gitRoot, created.username, `${created.id}.git`);
    const { stdout } = await run('git', [
      '--git-dir',
      repository,
      'for-each-ref',
      '--format=%(refname)',
    ]);
    expect(stdout.trim()).toBe('');
  });

  it('should refuse a body that is not sent as a file', async () => {
    // Given
    const created = (await createScore()).json();

    // When — content-type parsers are inherited, so a JSON body reaches the
    // handler parsed rather than being refused by the framework.
    const response = await server.inject({
      method: 'POST',
      url: `/scores/${created.id}/import`,
      payload: { score: 'not a file' },
      cookies: { [SESSION_COOKIE]: session },
    });

    // Then
    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe('not_a_file');
  });

  it('should let a member import, into the owner’s repository', async () => {
    // Given a score shared with a second person — written the way the invite
    // link eventually will, since there is no endpoint for it yet.
    const created = (await createScore()).json();
    const drummer = await server.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'drummer@example.com', password: 'another decent passphrase' },
    });
    const theirSession = drummer.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';
    addScoreMember(handle.db, created.id, drummer.json().id, 'member');

    // When
    const response = await importScore(created.id, sample, theirSession);

    // Then — the bytes land in the one repository this score has, which sits
    // under the owner's account segment. The importer's own id names no
    // directory here, so passing it would write nowhere.
    expect(response.statusCode).toBe(201);
    const stored = await storedScore(created.username, created.id);
    expect(Buffer.compare(stored, normalizeGp(sample))).toBe(0);
  });

  it('should still parse json on the routes it shares a prefix with', async () => {
    // Given / When — the parser added for imports is scoped, so creating a
    // score still reads a JSON body.
    const response = await createScore('Still JSON');

    // Then
    expect(response.statusCode).toBe(201);
    expect(response.json().name).toBe('Still JSON');
  });
});
