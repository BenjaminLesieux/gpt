import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { repositoryPath } from './repositories';
import { NAMED_REF, SCORE_ENTRY } from './versions';

const run = promisify(execFile);

/**
 * Reading a score's history, which until now nothing did: the hub held every
 * version and could show none of them.
 *
 * Everything here is a fact `git log` already knows. What a version *touched*
 * — tracks and bars — is not in this module: it needs the score parsed, which
 * is `../scores/scope.ts`, and it is derived separately so that a history
 * still lists when a blob refuses to parse.
 *
 * Lane assignment is not here either. The drawing is the client's, and the
 * client has the same parents and the same refs this returns.
 */

/** One version, as git records it. */
export interface Version {
  /** Full sha. The client keys on it; the short form is display only. */
  id: string;
  /** What the musician typed. Empty is ordinary and never invented over. */
  message: string;
  /** Whoever authored it. Accounts have no display name yet. */
  authorEmail: string;
  /** ISO 8601, with the author's offset — when *they* saved, not when it arrived. */
  at: string;
  /** One normally, two for a landing, none for the first version. */
  parents: string[];
}

/** A named line of work. */
export interface Branch {
  name: string;
  /** Full sha of its newest version. */
  tip: string;
  /** How many versions it holds that the main line does not. 0 once it lands. */
  ahead: number;
}

/**
 * A branch, with the two extra facts the branches screen needs and the
 * history page does not: where it left the main line, and when it was last
 * worked on.
 */
export interface BranchPoint extends Branch {
  /** `merge-base(main, tip)`, or null when the two share no history. */
  base: string | null;
  /** The tip's author date, ISO 8601 — when they saved, not when it arrived. */
  at: string;
}

export interface History {
  /** The main line's tip, or null when nothing has been pushed yet. */
  head: string | null;
  /** Newest first, topologically ordered — never by date, which lies in bursts. */
  versions: Version[];
  /** Every named line except the main one. */
  branches: Branch[];
  /** Across every branch, not just the page returned. */
  total: number;
}

/**
 * Field and record separators that cannot occur in the fields themselves.
 * A version's message is the one free-text field here and it may hold
 * newlines, so neither separator can be one.
 */
const FIELD = '\u0000';
const RECORD = '\u001e';
const FORMAT = ['%H', '%P', '%aE', '%aI', '%B'].join('%x00') + '%x1e';

/**
 * 40 rows fill the screen twice over, which is the point: the design states
 * the loaded edge in words rather than scrolling into a spinner.
 */
export const PAGE = 40;

/**
 * A history large enough to matter is still small — hundreds of versions, a
 * couple of hundred bytes each. The default 1MB buffer would truncate a long
 * one into a parse error rather than a short answer.
 */
const MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Null rather than a thrown error for a malformed id, exactly as
 * `repositoryPath` does: a bad id in a URL is a request to refuse.
 */
export async function readHistory(
  root: string,
  accountId: string,
  scoreId: string,
  page: { limit?: number; skip?: number } = {}
): Promise<History | null> {
  const repository = repositoryPath(root, accountId, scoreId);
  if (!repository) return null;

  const refs = await readBranches(repository);

  // An unborn ref is the ordinary state of a score between `POST /scores` and
  // the first push, not a fault. `git log` exits non-zero on it, so asking
  // for-each-ref first means the empty history costs one call and no throw.
  if (refs.length === 0) {
    return { head: null, versions: [], branches: [], total: 0 };
  }

  const limit = page.limit ?? PAGE;
  const skip = page.skip ?? 0;

  const [log, total] = await Promise.all([
    git(repository, [
      'log',
      '--all',
      // Topological, so a branch's versions stay contiguous instead of being
      // interleaved by the clock. Time is grouping in this design, not order.
      '--topo-order',
      `--max-count=${limit}`,
      `--skip=${skip}`,
      `--format=${FORMAT}`,
    ]),
    git(repository, ['rev-list', '--all', '--count']),
  ]);

  const main = refs.find((ref) => ref.name === mainName())?.tip ?? null;

  return {
    head: main,
    versions: parseLog(log),
    branches: await Promise.all(
      refs
        .filter((ref) => ref.name !== mainName())
        .map(async (ref) => ({
          name: ref.name,
          tip: ref.tip,
          ahead: await countAhead(repository, ref.name),
        }))
    ),
    total: Number.parseInt(total, 10) || 0,
  };
}

/**
 * One version's score file. The bytes are what was committed and nothing is
 * re-encoded on the way out — the browser's player parses the same file
 * Guitar Pro wrote.
 *
 * Null covers a bad id, a commit that is not in this repository, and a commit
 * with no score in its tree. All three are "no such version" to the caller.
 */
export async function readVersionScore(
  root: string,
  accountId: string,
  scoreId: string,
  commit: string
): Promise<Buffer | null> {
  const repository = repositoryPath(root, accountId, scoreId);
  if (!repository) return null;
  if (!/^[0-9a-f]{7,64}$/.test(commit)) return null;

  try {
    const { stdout } = await run(
      'git',
      ['--git-dir', repository, 'cat-file', 'blob', `${commit}:${SCORE_ENTRY}`],
      { encoding: 'buffer', maxBuffer: MAX_BUFFER }
    );
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Every named line except the main one, with where it left main and when it
 * was last touched.
 *
 * Separate from `readHistory` rather than folded into it because the two
 * answer different questions: a history is a page of versions that happens to
 * mention its refs, and this is the refs themselves. Loading forty commits to
 * find out what two branches are doing is work nobody asked for.
 *
 * Null for a malformed id, as everywhere else here. An empty array is a score
 * with nothing but a main line, or nothing at all — both are ordinary.
 */
export async function readBranchPoints(
  root: string,
  accountId: string,
  scoreId: string
): Promise<BranchPoint[] | null> {
  const repository = repositoryPath(root, accountId, scoreId);
  if (!repository) return null;

  const refs = (await readBranches(repository)).filter((ref) => ref.name !== mainName());

  return Promise.all(
    refs.map(async (ref) => ({
      name: ref.name,
      tip: ref.tip,
      at: ref.at,
      ahead: await countAhead(repository, ref.name),
      base: await mergeBase(repository, ref.name),
    }))
  );
}

/** The main line's ref, short. Kept in one place so the two readers agree. */
function mainName(): string {
  return NAMED_REF.replace('refs/heads/', '');
}

interface Ref {
  name: string;
  tip: string;
  /** The tip's author date, which is when somebody last worked on this line. */
  at: string;
}

async function readBranches(repository: string): Promise<Ref[]> {
  const out = await git(repository, [
    'for-each-ref',
    '--format=%(refname:short)%00%(objectname)%00%(authordate:iso-strict)',
    'refs/heads',
  ]);

  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, tip, at] = line.split(FIELD);
      return { name, tip, at };
    });
}

/**
 * How far ahead of the main line each branch is. `rev-list --count main..x`
 * per branch rather than one walk of our own: a branch that has landed
 * answers 0 here, which is exactly the distinction the screen draws between
 * *in flight* and *landed* and is not one we should re-derive.
 */
async function countAhead(repository: string, name: string): Promise<number> {
  const out = await git(repository, ['rev-list', '--count', `${mainName()}..${name}`]).catch(
    () => '0'
  );
  return Number.parseInt(out, 10) || 0;
}

/**
 * Where a branch left the main line. This is the base of the diff that says
 * what the branch *touches*, and it is deliberately not the tip's parent: a
 * branch three versions long touches the union of those three minus whatever
 * it put back, which only `merge-base..tip` says.
 *
 * Null when the two lines share no history — a repository whose main ref does
 * not exist yet, or a branch pushed from an unrelated one. The caller reads
 * that as "nothing to compare against", the same as the first version does.
 */
async function mergeBase(repository: string, name: string): Promise<string | null> {
  return git(repository, ['merge-base', mainName(), name])
    .then((out) => out.trim() || null)
    .catch(() => null);
}

function parseLog(out: string): Version[] {
  return out
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.length > 0)
    .map((record) => {
      const [id, parents, authorEmail, at, message] = record.split(FIELD);
      return {
        id,
        // %B keeps the trailing newline git adds. Trimming the ends and not
        // the middle: a two-line message stays two lines.
        message: (message ?? '').trim(),
        authorEmail,
        at,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
      };
    });
}

async function git(repository: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['--git-dir', repository, ...args], {
    maxBuffer: MAX_BUFFER,
  });
  return stdout.trimEnd();
}
