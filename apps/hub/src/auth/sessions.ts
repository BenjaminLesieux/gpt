import { createHash, randomBytes } from 'node:crypto';
import { eq, lte } from 'drizzle-orm';
import type { HubDatabase } from '../db/client';
import { sessions } from '../db/schema';

/** Long enough that a working session survives a week of not playing. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN_BYTES = 32;

export interface IssuedSession {
  /** Goes in the cookie and is never written down. */
  token: string;
  expiresAt: Date;
}

/**
 * Three outcomes, not two. A caller with no cookie, a caller with a cookie
 * that names no session, and a caller whose session has simply run out are
 * different situations for whoever is reading the logs.
 */
export type SessionLookup =
  | { status: 'valid'; accountId: string; expiresAt: Date }
  | { status: 'expired' }
  | { status: 'unknown' };

export function issueSession(
  db: HubDatabase,
  accountId: string,
  now: Date = new Date()
): IssuedSession {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  db.insert(sessions)
    .values({ tokenHash: hashToken(token), accountId, createdAt: now, expiresAt })
    .run();

  return { token, expiresAt };
}

export function readSession(
  db: HubDatabase,
  token: string,
  now: Date = new Date()
): SessionLookup {
  const tokenHash = hashToken(token);
  const row = db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).get();

  if (!row) return { status: 'unknown' };

  if (row.expiresAt.getTime() <= now.getTime()) {
    // Reading a dead session is the cheapest moment to collect it.
    db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
    return { status: 'expired' };
  }

  return { status: 'valid', accountId: row.accountId, expiresAt: row.expiresAt };
}

export function revokeSession(db: HubDatabase, token: string): void {
  db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}

/**
 * Sessions nobody comes back for are never read, so they are never collected
 * by readSession. Run at boot, which for a single-operator hub is often
 * enough.
 */
export function purgeExpiredSessions(db: HubDatabase, now: Date = new Date()): number {
  return db.delete(sessions).where(lte(sessions.expiresAt, now)).run().changes;
}

function hashToken(token: string): string {
  // Not a password hash: the token is 256 bits of randomness, so there is
  // nothing to slow an attacker down over. This exists so the table cannot
  // be replayed, and sha256 is enough for that.
  return createHash('sha256').update(token).digest('hex');
}
