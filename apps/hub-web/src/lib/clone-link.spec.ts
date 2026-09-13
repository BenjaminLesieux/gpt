import { describe, expect, it } from 'vitest';
import { cloneLink } from './clone-link';

const CODE = 'Ml9_3Qh0-Zt4aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';

describe('cloneLink', () => {
  it('carries the origin and the claim, and nothing else', () => {
    const link = new URL(cloneLink('https://hub.example.com', CODE));

    expect(link.protocol).toBe('gitarpro:');
    expect(link.host).toBe('adopt');
    expect([...link.searchParams.keys()].sort()).toEqual(['claim', 'hub']);
    expect(link.searchParams.get('hub')).toBe('https://hub.example.com');
    expect(link.searchParams.get('claim')).toBe(CODE);
  });

  /**
   * The whole reason the claim exists. A custom-scheme URL is handed to the
   * OS and may reach an app that is not ours; a token there would be a token
   * somewhere we do not control.
   */
  it('never carries a credential', () => {
    const link = cloneLink('https://hub.example.com', CODE);

    expect(link).not.toContain('token');
    expect(link).not.toContain('username');
    expect(link).not.toContain('.git');
  });

  it('escapes an origin rather than letting it add parameters', () => {
    const link = new URL(cloneLink('https://hub.example.com/?claim=elsewhere', CODE));

    expect(link.searchParams.get('claim')).toBe(CODE);
    expect(link.searchParams.get('hub')).toBe('https://hub.example.com/?claim=elsewhere');
  });
});
