import { spawn } from 'node:child_process';
import { repositoryPath } from './repositories';

/**
 * Authoring a version server-side, which until now nothing did: every object
 * in every repository arrived through receive-pack. An imported score has no
 * client to push it, so the hub writes the first commit itself.
 *
 * The shape is not ours to choose — companion reads it back. A single blob at
 * the tree root named `score.gp`, mode 100644, with the tip on
 * `refs/heads/main`; see `SCORE_ENTRY` and `NAMED_REF` in
 * `apps/companion/src-tauri/src/git.rs`. `refs/snapshots` is local scratch on
 * the companion side and a push never carries it, so an import must not
 * invent one.
 */
export const SCORE_ENTRY = 'score.gp';
export const NAMED_REF = 'refs/heads/main';

const BLOB_MODE = '100644';

/**
 * commit-tree refuses to run without an identity, and a bare repository on a
 * server has no user to borrow one from. Naming the hub rather than reusing
 * companion's `companion@gitarpro.app` keeps the two sides' commits legible
 * to whoever later reads the history wondering where a version came from.
 */
const AUTHOR = { name: 'Gitarpro', email: 'hub@gitarpro.app' };

export type FirstVersion =
  | { status: 'written'; commit: string }
  | { status: 'invalid_id' }
  | { status: 'already_has_versions' };

/**
 * Writes `score` as the only version of a repository that has none.
 *
 * Whether the repository is empty is decided by `update-ref` and not by a
 * check of our own: passing the empty string as the expected old value makes
 * git assert the ref is unborn as it writes. Two imports racing therefore
 * produce one version and one refusal, where reading the ref first and
 * writing second would produce one lost import.
 */
export async function writeFirstVersion(
  root: string,
  accountId: string,
  scoreId: string,
  score: Uint8Array,
  message: string
): Promise<FirstVersion> {
  const repository = repositoryPath(root, accountId, scoreId);
  if (!repository) return { status: 'invalid_id' };

  const blob = await git(repository, ['hash-object', '-w', '--stdin'], score);
  const tree = await git(
    repository,
    ['mktree'],
    `${BLOB_MODE} blob ${blob}\t${SCORE_ENTRY}\n`
  );
  const commit = await git(repository, ['commit-tree', tree, '-m', message], undefined, {
    GIT_AUTHOR_NAME: AUTHOR.name,
    GIT_AUTHOR_EMAIL: AUTHOR.email,
    GIT_COMMITTER_NAME: AUTHOR.name,
    GIT_COMMITTER_EMAIL: AUTHOR.email,
  });

  try {
    await git(repository, ['update-ref', NAMED_REF, commit, '']);
  } catch {
    // The only way this fails in practice: something else got there first.
    // The objects just written are unreachable, which is what `git gc` is
    // for — a partial ref would be the version of this that mattered.
    return { status: 'already_has_versions' };
  }

  return { status: 'written', commit };
}

/**
 * `spawn` rather than `execFile` because two of these calls take their input
 * on stdin, and a score is binary — there is no string form of it to pass as
 * an argument.
 */
function git(
  repository: string,
  args: string[],
  input?: Uint8Array | string,
  env?: Record<string, string>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--git-dir', repository, ...args], {
      env: env ? { ...process.env, ...env } : process.env,
    });

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out).toString('utf8').trim());
        return;
      }
      reject(
        new Error(
          `git ${args[0]} exited ${code}: ${Buffer.concat(err).toString('utf8').trim()}`
        )
      );
    });

    // EPIPE when git has already rejected the input and closed stdin; the
    // exit code is the real answer and it is on its way.
    child.stdin.on('error', () => undefined);
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}
