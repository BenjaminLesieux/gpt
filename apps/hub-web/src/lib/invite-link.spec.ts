import { describe, expect, it } from 'vitest';
import { inviteLink } from './invite-link';

const CODE = 'Ml9_3Qh0-Zt4aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';

describe('inviteLink', () => {
  it('lands on the client route the accept screen answers for', () => {
    const link = new URL(inviteLink('https://hub.example.com', CODE));

    expect(link.origin).toBe('https://hub.example.com');
    expect(link.pathname).toBe(`/join/${CODE}`);
    expect(link.search).toBe('');
  });

  /**
   * The hub answers `/invites/*` with JSON. A link under that prefix would
   * reach a 404 body rather than the app, for everyone it was sent to.
   */
  it('stays out of the API prefix', () => {
    expect(inviteLink('https://hub.example.com', CODE)).not.toContain('/invites/');
  });

  it('escapes a code rather than letting it change the path', () => {
    const link = new URL(inviteLink('https://hub.example.com', '../../scores'));

    expect(link.pathname).toBe('/join/..%2F..%2Fscores');
  });
});
