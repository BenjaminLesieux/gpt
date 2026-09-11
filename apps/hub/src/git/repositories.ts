import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The charset `newId` produces, and the only thing accepted into a filesystem
 * path. Validating here rather than escaping later is what makes traversal
 * impossible instead of merely unlikely.
 */
const OPAQUE_ID = /^[a-z2-7]{8,64}$/;

/**
 * Null rather than a thrown error: a malformed id in a URL is a request to
 * refuse, not an exception to handle.
 */
export function repositoryPath(
  root: string,
  accountId: string,
  scoreId: string
): string | null {
  if (!OPAQUE_ID.test(accountId) || !OPAQUE_ID.test(scoreId)) return null;
  return path.join(root, accountId, `${scoreId}.git`);
}

export async function createRepository(
  root: string,
  accountId: string,
  scoreId: string
): Promise<string> {
  const repository = repositoryPath(root, accountId, scoreId);
  if (!repository) {
    throw new Error(`Refusing to create a repository at ${accountId}/${scoreId}`);
  }

  await mkdir(path.dirname(repository), { recursive: true });

  // --initial-branch matters: the default leaves HEAD on refs/heads/master,
  // and companion pushes main. A clone of such a repository transfers every
  // object and then fails to check anything out.
  await run('git', ['init', '--quiet', '--bare', '--initial-branch=main', repository]);

  // git-http-backend serves fetch by default and refuses push unless told
  // otherwise. Setting it in the repository is explicit, where relying on
  // http-backend's REMOTE_USER heuristic is not.
  await run('git', ['--git-dir', repository, 'config', 'http.receivepack', 'true']);

  return repository;
}
