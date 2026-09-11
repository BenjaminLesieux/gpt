import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepository, repositoryPath } from './repositories';

const run = promisify(execFile);

describe('repositoryPath', () => {
  const root = '/srv/gitarpro';

  it('should place a repository under its account when both ids are opaque', () => {
    // Given / When
    const resolved = repositoryPath(root, 'aaaabbbbccccdddd', 'sssseeeeaaaaoooo');

    // Then
    expect(resolved).toBe('/srv/gitarpro/aaaabbbbccccdddd/sssseeeeaaaaoooo.git');
  });

  it.each([
    ['a traversal segment', '../../etc'],
    ['a slash', 'aaaabbbb/cccc'],
    ['a dot', 'aaaa.bbbb.cccc'],
    ['characters outside base32', 'AAAABBBBCCCC1890'],
    ['something too short to be an id', 'abc'],
    ['nothing at all', ''],
  ])('should refuse %s in the account position', (_label, account) => {
    // Given / When / Then — this is the guard that makes traversal
    // impossible rather than merely unreachable from today's routes.
    expect(repositoryPath(root, account, 'sssseeeeaaaaoooo')).toBeNull();
  });

  it('should refuse a traversal segment in the score position', () => {
    // Given / When / Then
    expect(repositoryPath(root, 'aaaabbbbccccdddd', '../../etc')).toBeNull();
  });
});

describe('createRepository', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'gpt-repo-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('should point HEAD at main when it creates a repository', async () => {
    // Given / When
    const repository = await createRepository(root, 'aaaabbbbccccdddd', 'sssseeeeaaaaoooo');

    // Then — the git default is refs/heads/master, and companion pushes main;
    // a clone of a master-headed repository checks out nothing.
    const { stdout } = await run('git', ['--git-dir', repository, 'symbolic-ref', 'HEAD']);
    expect(stdout.trim()).toBe('refs/heads/main');
  });

  it('should enable receive-pack so a push is not refused', async () => {
    // Given / When
    const repository = await createRepository(root, 'aaaabbbbccccdddd', 'sssseeeeaaaaoooo');

    // Then — git-http-backend serves fetch by default and declines push.
    const { stdout } = await run('git', ['--git-dir', repository, 'config', 'http.receivepack']);
    expect(stdout.trim()).toBe('true');
  });

  it('should refuse to create anything when an id is not opaque', async () => {
    // Given / When / Then
    await expect(createRepository(root, '../escape', 'sssseeeeaaaaoooo')).rejects.toThrow(
      /Refusing/
    );
  });
});
