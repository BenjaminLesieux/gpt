import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepository } from './repositories';
import { NAMED_REF, SCORE_ENTRY, writeFirstVersion } from './versions';

const run = promisify(execFile);

const ACCOUNT = 'aaaabbbbccccdddd';
const SCORE = 'sssseeeeaaaaoooo';
const BYTES = Buffer.from('score bytes, as normalized');

let root: string;
let repository: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'gpt-versions-'));
  repository = await createRepository(root, ACCOUNT, SCORE);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function write(bytes: Uint8Array = BYTES, message = 'Imported') {
  return writeFirstVersion(root, ACCOUNT, SCORE, bytes, message);
}

describe('writeFirstVersion', () => {
  it('should put the tip on main, where companion looks for it', async () => {
    // Given / When
    const written = await write();

    // Then — companion's NAMED_REF, and the --initial-branch createRepository
    // already sets. A tip anywhere else transfers on clone and checks out
    // nothing.
    expect(written).toEqual({ status: 'written', commit: expect.any(String) });
    const { stdout } = await run('git', ['--git-dir', repository, 'rev-parse', NAMED_REF]);
    expect(stdout.trim()).toBe(written.status === 'written' ? written.commit : '');
  });

  it('should hold the score as one blob named score.gp at the tree root', async () => {
    // Given / When
    await write();

    // Then — the shape git.rs reads back: a single entry, mode 100644.
    const { stdout } = await run('git', ['--git-dir', repository, 'ls-tree', NAMED_REF]);
    const [line, ...rest] = stdout.trim().split('\n');
    expect(rest).toEqual([]);
    expect(line).toMatch(new RegExp(`^100644 blob [0-9a-f]{40}\\t${SCORE_ENTRY}$`));
  });

  it('should store the bytes it was handed, byte for byte', async () => {
    // Given
    const score = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x7f, 0x00]);

    // When
    await write(score);

    // Then
    const { stdout } = await run(
      'git',
      ['--git-dir', repository, 'cat-file', 'blob', `${NAMED_REF}:${SCORE_ENTRY}`],
      { encoding: 'buffer' }
    );
    expect(Buffer.compare(stdout as unknown as Buffer, score)).toBe(0);
  });

  it('should invent no other ref, refs/snapshots least of all', async () => {
    // Given / When
    await write();

    // Then — snapshots are local scratch on the companion side and a push
    // never carries them, so a repository holding one did not come from a
    // client and would not behave like one.
    const { stdout } = await run('git', ['--git-dir', repository, 'for-each-ref', '--format=%(refname)']);
    expect(stdout.trim().split('\n')).toEqual([NAMED_REF]);
  });

  it('should give the commit no parent and the message it was handed', async () => {
    // Given / When
    await write(BYTES, 'Imported');

    // Then
    const { stdout } = await run('git', [
      '--git-dir',
      repository,
      'log',
      '--format=%P|%s',
      NAMED_REF,
    ]);
    expect(stdout.trim()).toBe('|Imported');
  });

  it('should refuse a second import rather than replace the first', async () => {
    // Given
    const first = await write(Buffer.from('the first version'));

    // When
    const second = await write(Buffer.from('a second, later file'));

    // Then — the guard is update-ref asserting the ref is unborn as it
    // writes, so two racing imports cannot both believe they won.
    expect(second).toEqual({ status: 'already_has_versions' });
    const { stdout } = await run('git', ['--git-dir', repository, 'rev-parse', NAMED_REF]);
    expect(stdout.trim()).toBe(first.status === 'written' ? first.commit : '');
  });

  it('should write nothing when an id is not opaque', async () => {
    // Given / When
    const written = await writeFirstVersion(root, '../escape', SCORE, BYTES, 'Imported');

    // Then
    expect(written).toEqual({ status: 'invalid_id' });
  });

  it('should produce a repository a plain git clone can check out', async () => {
    // Given
    await write();
    const into = path.join(root, 'clone');

    // When
    await run('git', ['clone', '--quiet', repository, into]);

    // Then — the whole point of the shape: a clone of an imported score is a
    // working tree with the score in it, exactly as a pushed one is.
    expect(await readFile(path.join(into, SCORE_ENTRY))).toEqual(BYTES);
  });
});
