import { describe, expect, it } from 'vitest';
import { servesShell } from './web';

/**
 * Which URLs the app shell answers for.
 *
 * The case that makes this worth a test of its own: `/scores/<id>` is both a
 * page a musician links their band to *and* a path inside the JSON API's
 * prefix. Getting the split wrong is not a 404 anybody reports — it is a
 * browser tab showing a wall of JSON.
 */

describe('a score page', () => {
  it('is the app, not the API', () => {
    expect(servesShell('GET', '/scores/siion5dajszc6fxoogk6igq6ri')).toBe(true);
  });

  it('is still the app after a reload with a query on it', () => {
    expect(servesShell('GET', '/scores/siion5dajszc6fxoogk6igq6ri?selected=a3f9c12')).toBe(true);
  });
});

describe('the API under the same prefix', () => {
  it('keeps every path that hangs below a score', () => {
    // The rule this pins: score-scoped data lives one segment deeper than
    // the page, and that is the only thing keeping the two apart.
    for (const url of [
      '/scores',
      '/scores/siion5dajszc6fxoogk6igq6ri/history',
      '/scores/siion5dajszc6fxoogk6igq6ri/members',
      '/scores/siion5dajszc6fxoogk6igq6ri/versions/a3f9c12/score.gp',
    ]) {
      expect(servesShell('GET', url), url).toBe(false);
    }
  });

  it('never answers a write with HTML', () => {
    // A POST to a score's page is a client mistake, and a 404 that parses as
    // JSON is the only useful answer to it.
    expect(servesShell('POST', '/scores/siion5dajszc6fxoogk6igq6ri')).toBe(false);
  });

  it('leaves the other prefixes alone', () => {
    for (const url of ['/auth/me', '/git/x/y.git/info/refs', '/health', '/invites/abc']) {
      expect(servesShell('GET', url), url).toBe(false);
    }
  });
});

describe('a client route outside every prefix', () => {
  it('is the app', () => {
    for (const url of ['/', '/login', '/credentials']) {
      expect(servesShell('GET', url), url).toBe(true);
    }
  });
});
