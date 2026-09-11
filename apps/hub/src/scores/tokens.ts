import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { HubDatabase } from '../db/client';
import { scoreTokens, scores } from '../db/schema';
import { newId } from '../ids';

const TOKEN_BYTES = 32;

export interface MintedScoreToken {
  id: string;
  name: string;
  /** Handed to the caller once and never recoverable, mirroring companion. */
  token: string;
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

export function revokeScoreToken(db: HubDatabase, tokenId: string): void {
  db.delete(scoreTokens).where(eq(scoreTokens.id, tokenId)).run();
}

function hashToken(token: string): string {
  // As with sessions: 256 bits of randomness has nothing for a slow hash to
  // protect. This exists so the table cannot be replayed.
  return createHash('sha256').update(token).digest('hex');
}
