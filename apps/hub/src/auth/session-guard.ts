import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { errorBody } from '../app/errors';
import type { HubDatabase } from '../db/client';
import { accounts } from '../db/schema';
import { SESSION_COOKIE, sessionCookie } from './cookie';
import { readSession } from './sessions';

export interface AuthenticatedAccount {
  id: string;
  email: string;
}

/**
 * Answers the request itself and returns null when there is no caller, so a
 * protected handler opens with a guard clause rather than a wrapper:
 *
 *   const account = requireAccount(db, request, reply, secure);
 *   if (!account) return;
 *
 * A preHandler would hide the same check behind an `account?` that every
 * handler then has to narrow, which is more machinery for less clarity.
 */
export function requireAccount(
  db: HubDatabase,
  request: FastifyRequest,
  reply: FastifyReply,
  cookieSecure: boolean
): AuthenticatedAccount | null {
  const token = request.cookies[SESSION_COOKIE];

  if (!token) {
    reply.code(401).send(errorBody('no_session', 'This route needs a session cookie.'));
    return null;
  }

  const lookup = readSession(db, token);

  if (lookup.status !== 'valid') {
    // The cookie is worthless either way, and leaving it in the browser only
    // guarantees the same 401 on the next request.
    reply.clearCookie(SESSION_COOKIE, sessionCookie(cookieSecure));

    if (lookup.status === 'expired') {
      reply.code(401).send(errorBody('session_expired', 'This session has expired; sign in again.'));
    } else {
      reply.code(401).send(errorBody('invalid_session', 'This session cookie names no session.'));
    }

    return null;
  }

  const account = db
    .select({ id: accounts.id, email: accounts.email })
    .from(accounts)
    .where(eq(accounts.id, lookup.accountId))
    .get();

  if (!account) {
    // The cascade should have taken the session with the account. Reaching
    // here means it did not, so treat the session as gone.
    reply.clearCookie(SESSION_COOKIE, sessionCookie(cookieSecure));
    reply.code(401).send(errorBody('invalid_session', 'This session cookie names no session.'));
    return null;
  }

  return account;
}
