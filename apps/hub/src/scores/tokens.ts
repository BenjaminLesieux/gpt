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
 */
export interface ScoreTokenBearer {
  tokenId: string;
  scoreId: string;
  accountId: string;
}

export function readScoreToken(db: HubDatabase, token: string): ScoreTokenBearer | null {
  const row = db
    .select({
      tokenId: scoreTokens.id,
      scoreId: scores.id,
      accountId: scores.accountId,
    })
    .from(scoreTokens)
    .innerJoin(scores, eq(scoreTokens.scoreId, scores.id))
    .where(eq(scoreTokens.tokenHash, hashToken(token)))
    .get();

  return row ?? null;
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
    })
    .from(scoreTokens)
    .where(inArray(scoreTokens.scoreId, scoreIds))
    .orderBy(scoreTokens.createdAt)
    .all();

  for (const row of rows) {
    const list = byScore.get(row.scoreId) ?? [];
    list.push({ id: row.id, name: row.name, createdAt: row.createdAt });
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
