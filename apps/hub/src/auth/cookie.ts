import type { CookieSerializeOptions } from '@fastify/cookie';

export const SESSION_COOKIE = 'gp_session';

/**
 * SameSite=Lax rather than Strict: the hub is an API companion talks to
 * directly, and Strict would break the first request after any future
 * link-in from a web page without buying anything against CSRF that the
 * absence of form posts does not already.
 */
export function sessionCookie(secure: boolean, expires?: Date): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires,
  };
}
