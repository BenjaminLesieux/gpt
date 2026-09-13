import { createHash, randomBytes } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { HubDatabase } from '../db/client';
import { scoreTokens, scores } from '../db/schema';
import { newId } from '../ids';

const TOKEN_BYTES = 32;

/**
 * What a token is called when nobody said. Every token names the device that
 * holds it — one score reached from a laptop and a studio machine has two,
 * and the name is the only thing that tells them apart in the score list or,
 * later, in a history of who pushed what.
 */
export const DEFAULT_TOKEN_NAME = 'companion';

const MAX_TOKEN_NAME = 80;

export interface MintedScoreToken {
  id: string;
  name: string;
  /** Handed to the caller once and never recoverable, mirroring companion. */
  token: string;
}

/** A token as anyone but its holder ever sees it. */
export interface ScoreTokenSummary {
  id: string;
  name: string;
  createdAt: Date;
  /** Null until the machine holding this credential first connects. */
  lastUsedAt: Date | null;
  /** Null until it pushes. See the column comments in `schema.ts`. */
  lastPushedAt: Date | null;
}

/**
 * Trims a device name down to something that can sit in a table cell, and
 * falls back rather than refusing: the name is a label, and a clone that
 * failed over a bad one would be a worse trade than a clone called
 * `companion`.
 */
export function deviceName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_TOKEN_NAME;
  const trimmed = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TOKEN_NAME);
  return trimmed.length > 0 ? trimmed : DEFAULT_TOKEN_NAME;
}

export function mintScoreToken(
  db: HubDatabase,
  scoreId: string,
  name: string,
  now: Date = new Date()
): MintedScoreToken {
  // Companion sends this as a git Basic-auth password, so base64url keeps it
  // out of trouble in a URL and clear of the colon that splits the header.
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const id = newId();

  db.insert(scoreTokens)
    .values({ id, scoreId, name, tokenHash: hashToken(token), createdAt: now })
    .run();

  return { id, name, token };
}

/**
 * Both ids, because the git route has to decide whether this token may touch
 * the account *and* the score named in the path — one lookup rather than two.
 *
 * `lastUsedAt` rides along for the same reason: the route stamps activity on
 * every request, and carrying the current value here lets it skip the write
 * when the last one was seconds ago, without a second read.
 */
export interface ScoreTokenBearer {
  tokenId: string;
  scoreId: string;
  accountId: string;
  lastUsedAt: Date | null;
}

export function readScoreToken(db: HubDatabase, token: string): ScoreTokenBearer | null {
  const row = db
    .select({
      tokenId: scoreTokens.id,
      scoreId: scores.id,
      accountId: scores.accountId,
      lastUsedAt: scoreTokens.lastUsedAt,
    })
    .from(scoreTokens)
    .innerJoin(scores, eq(scoreTokens.scoreId, scores.id))
    .where(eq(scoreTokens.tokenHash, hashToken(token)))
    .get();

  return row ?? null;
}

/**
 * How stale `lastUsedAt` has to be before a connection is worth writing down.
 *
 * One push is several requests — a ref advertisement, then receive-pack — and
 * the queue in `push.rs` retries on a backoff, so an unthrottled stamp would
 * write on every one of them. Nothing reads this to a finer resolution than
 * "2h ago", so a minute of drift costs nothing and most requests cost no write.
 */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Records that a credential was used, and — when the request was a push — that
 * versions arrived through it.
 *
 * This is the only thing that separates a token that was *issued* from a
 * machine that actually has the score. Creating a score mints a token inline,
 * so without this every score would claim to be on a computer from the moment
 * it was named.
 */
export function touchScoreToken(
  db: HubDatabase,
  bearer: ScoreTokenBearer,
  pushed: boolean,
  now: Date = new Date()
): void {
  // A push is rare and always worth recording exactly; a connection is not.
  if (!pushed && bearer.lastUsedAt && now.getTime() - bearer.lastUsedAt.getTime() < TOUCH_INTERVAL_MS) {
    return;
  }

  db.update(scoreTokens)
    .set(pushed ? { lastUsedAt: now, lastPushedAt: now } : { lastUsedAt: now })
    .where(eq(scoreTokens.id, bearer.tokenId))
    .run();
}

/**
 * Every token of every score named, in one query rather than one per score.
 * A score with two devices is one row with two tokens, never two rows — the
 * list is of scores, and a join that fanned out would quietly say otherwise.
 */
export function listScoreTokens(
  db: HubDatabase,
  scoreIds: string[]
): Map<string, ScoreTokenSummary[]> {
  const byScore = new Map<string, ScoreTokenSummary[]>();
  if (scoreIds.length === 0) return byScore;

  const rows = db
    .select({
      id: scoreTokens.id,
      scoreId: scoreTokens.scoreId,
      name: scoreTokens.name,
      createdAt: scoreTokens.createdAt,
      lastUsedAt: scoreTokens.lastUsedAt,
      lastPushedAt: scoreTokens.lastPushedAt,
    })
    .from(scoreTokens)
    .where(inArray(scoreTokens.scoreId, scoreIds))
    .orderBy(scoreTokens.createdAt)
    .all();

  for (const row of rows) {
    const list = byScore.get(row.scoreId) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      lastPushedAt: row.lastPushedAt,
    });
    byScore.set(row.scoreId, list);
  }

  return byScore;
}

export function revokeScoreToken(db: HubDatabase, tokenId: string): void {
  db.delete(scoreTokens).where(eq(scoreTokens.id, tokenId)).run();
}

function hashToken(token: string): string {
  // As with sessions: 256 bits of randomness has nothing for a slow hash to
  // protect. This exists so the table cannot be replayed.
  return createHash('sha256').update(token).digest('hex');
}
