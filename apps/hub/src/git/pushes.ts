import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { HubDatabase } from '../db/client';
import { scorePushes } from '../db/schema';
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
