import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { desc, eq } from 'drizzle-orm';
import type { HubDatabase } from '../db/client';
import { accounts, scorePushes, scoreTokens } from '../db/schema';
import { newId } from '../ids';
import type { ScoreTokenBearer } from '../scores/tokens';

const run = promisify(execFile);

// As in `history.ts`: written as an escape, because a real NUL byte in the
// source makes git classify the file as binary.
const FIELD = '\u0000';

/**
 * Every branch tip, by full ref name.
 *
 * `refs/heads` and nothing else. The route also accepts `refs/snapshots/*`,
 * which is where companion parks autosaves nobody named — a history of who
 * pushed what is a history of versions a person made, and an autosave is not
 * one. Widening the pattern is the whole change if that stops being true.
 */
export async function readHeads(repository: string): Promise<Map<string, string>> {
  // Empty output, not a failure, for a repository with no branches yet: the
  // ordinary state between `POST /scores` and the first push.
  const { stdout } = await run('git', [
    '--git-dir',
    repository,
    'for-each-ref',
    '--format=%(refname)%00%(objectname)',
    'refs/heads',
  ]);

  return new Map(
    stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(FIELD) as [string, string])
  );
}

/**
 * Writes one row per ref that moved, by comparing the tips read before the
 * push against the tips now.
 *
 * Read *after* receive-pack has exited, which is the whole difference from
 * `last_pushed_at`: that stamp is written early and deliberately counts a push
 * that then failed, because somebody tried. This records what actually moved,
 * so a rejected push — a non-fast-forward, a hook that said no — leaves the
 * refs where they were and produces no rows without needing to be told the
 * push failed.
 *
 * A ref that disappeared is not recorded: `new_oid` is NOT NULL because every
 * reader of this table resolves a version from it, and companion has never
 * deleted a ref. A push that deletes one is the case to revisit it for.
 */
export async function recordPush(
  db: HubDatabase,
  repository: string,
  bearer: ScoreTokenBearer,
  before: Map<string, string>,
  now: Date = new Date()
): Promise<void> {
  const rows = [];

  for (const [ref, newOid] of await readHeads(repository)) {
    const oldOid = before.get(ref) ?? null;
    if (oldOid === newOid) continue;

    rows.push({
      id: newId(),
      scoreId: bearer.scoreId,
      tokenId: bearer.tokenId,
      ref,
      oldOid,
      newOid,
      pushedAt: now,
    });
  }

  if (rows.length > 0) db.insert(scorePushes).values(rows).run();
}

/** Who put a branch on the hub, and when it arrived. */
export interface RefPush {
  /**
   * The address on the account whose credential pushed. Null once that device
   * is revoked — `token_id` is nulled rather than cascaded, so the push
   * survives the laptop and the person behind it does not.
   */
  email: string | null;
  at: Date;
}

/**
 * The newest push to each of a score's refs, by full ref name.
 *
 * One pass over the score's pushes rather than a query per branch: the index
 * is `(score_id, pushed_at)` and not `(score_id, ref, ...)`, so a per-branch
 * query for a line nobody has touched in months walks the same rows anyway.
 * Doing it once is the same work for one branch and a fraction of it for six.
 *
 * That still scales with a score's whole push history rather than with its
 * branches. A score busy enough for that to matter wants
 * `(score_id, ref, pushed_at)` and a query per ref, not a cleverer fold.
 */
export function lastPushByRef(db: HubDatabase, scoreId: string): Map<string, RefPush> {
  const rows = db
    .select({
      ref: scorePushes.ref,
      at: scorePushes.pushedAt,
      email: accounts.email,
    })
    .from(scorePushes)
    // Both joins are left: a revoked device leaves `token_id` null, and the
    // row is still "somebody pushed this", which is the fact being read.
    .leftJoin(scoreTokens, eq(scorePushes.tokenId, scoreTokens.id))
    .leftJoin(accounts, eq(scoreTokens.accountId, accounts.id))
    .where(eq(scorePushes.scoreId, scoreId))
    .orderBy(desc(scorePushes.pushedAt))
    .all();

  const newest = new Map<string, RefPush>();
  // Newest first, so the first row for a ref is the one to keep.
  for (const row of rows) {
    if (!newest.has(row.ref)) newest.set(row.ref, { email: row.email, at: row.at });
  }
  return newest;
}
