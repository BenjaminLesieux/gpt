import rateLimit from '@fastify/rate-limit';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errorBody } from '../app/errors';
import type { HubDatabase } from '../db/client';
import { accounts } from '../db/schema';
import { newId } from '../ids';
import { SESSION_COOKIE, sessionCookie } from './cookie';
import { hashPassword, spendVerificationBudget, verifyPassword } from './passwords';
import { issueSession, revokeSession } from './sessions';
import { requireAccount } from './session-guard';

export interface AuthRoutesOptions {
  db: HubDatabase;
  /** Only ever false over plain-http development. */
  cookieSecure: boolean;
}

/**
 * Signup provisions a Forgejo user from M4 on, so an unthrottled signup is an
 * abuse amplifier against a remote system rather than just noise in a table.
 * That is why the tighter of the two limits is the one on signup.
 */
const SIGNUP_LIMIT = { max: 5, timeWindow: '1 hour' };
const LOGIN_LIMIT = { max: 10, timeWindow: '15 minutes' };

const credentials = z.object({
  email: z
    .string()
    .max(254)
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.email()),
  /**
   * Ten rather than eight because v1 ships no password reset: a weak password
   * here is not something the owner can quietly fix later. The ceiling is
   * only there so a megabyte of body cannot buy a megabyte of argon2.
   */
  password: z.string().min(10).max(256),
});

export async function authRoutes(fastify: FastifyInstance, opts: AuthRoutesOptions) {
  const { db, cookieSecure } = opts;

  await fastify.register(rateLimit, {
    // Nothing is limited unless a route asks for it by name, so adding a
    // route to this scope never silently throttles it.
    global: false,
    // The builder has to return an Error carrying statusCode, not a body:
    // rate-limit throws whatever it gets, and the app's error handler is
    // what turns it into the standard shape.
    errorResponseBuilder: (_request, context) =>
      Object.assign(new Error(`Too many attempts. Try again in ${context.after}.`), {
        statusCode: 429,
        code: 'rate_limited',
      }),
  });

  fastify.post('/signup', { config: { rateLimit: SIGNUP_LIMIT } }, async (request, reply) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidRequest(parsed.error));

    const { email, password } = parsed.data;
    const account = {
      id: newId(),
      email,
      passwordHash: await hashPassword(password),
      createdAt: new Date(),
    };

    try {
      db.insert(accounts).values(account).run();
    } catch (error) {
      // Checking first and inserting second would still race; the unique
      // index is the only thing that actually decides.
      if (isUniqueViolation(error)) {
        return reply.code(409).send(errorBody('email_taken', 'That email already has an account.'));
      }
      throw error;
    }

    const session = issueSession(db, account.id);
    reply.setCookie(SESSION_COOKIE, session.token, sessionCookie(cookieSecure, session.expiresAt));

    return reply.code(201).send({ id: account.id, email: account.email });
  });

  fastify.post('/login', { config: { rateLimit: LOGIN_LIMIT } }, async (request, reply) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidRequest(parsed.error));

    const { email, password } = parsed.data;
    const account = db.select().from(accounts).where(eq(accounts.email, email)).get();

    if (!account) {
      // Same cost as a real verify, or the response time answers "does this
      // address have an account here".
      await spendVerificationBudget(password);
      return reply.code(401).send(invalidCredentials());
    }

    if (!(await verifyPassword(account.passwordHash, password))) {
      return reply.code(401).send(invalidCredentials());
    }

    const session = issueSession(db, account.id);
    reply.setCookie(SESSION_COOKIE, session.token, sessionCookie(cookieSecure, session.expiresAt));

    return reply.send({ id: account.id, email: account.email });
  });

  fastify.post('/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) revokeSession(db, token);

    // Idempotent on purpose: a caller trying to end a session it no longer
    // has should not have to care why.
    reply.clearCookie(SESSION_COOKIE, sessionCookie(cookieSecure));
    return reply.code(204).send();
  });

  fastify.get('/me', async (request, reply) => {
    const account = requireAccount(db, request, reply, cookieSecure);
    if (!account) return reply;

    return reply.send(account);
  });
}

function invalidCredentials() {
  // One message for "no such account" and for "wrong password": telling them
  // apart is the enumeration leak spendVerificationBudget closes on timing.
  return errorBody('invalid_credentials', 'That email and password do not match.');
}

function invalidRequest(error: z.ZodError) {
  const issue = error.issues[0];
  const where = issue.path.join('.');
  return errorBody('invalid_request', where ? `${where}: ${issue.message}` : issue.message);
}

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps driver errors, so the SQLite code can be a cause or two down.
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if ('code' in current && current.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  }
  return false;
}
