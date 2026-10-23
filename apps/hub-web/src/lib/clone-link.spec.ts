import { describe, expect, it } from 'vitest';
import { cloneLink, openLink } from './clone-link';

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

describe('openLink', () => {
  it('names the hub, the score and the branch, and nothing else', () => {
    const link = new URL(openLink('https://hub.example.com', 's9q3v1', 'new chorus/sam'));

    expect(link.protocol).toBe('gitarpro:');
    expect(link.host).toBe('open');
    expect([...link.searchParams.keys()].sort()).toEqual(['branch', 'hub', 'score']);
    expect(link.searchParams.get('hub')).toBe('https://hub.example.com');
    expect(link.searchParams.get('score')).toBe('s9q3v1');
    expect(link.searchParams.get('branch')).toBe('new chorus/sam');
  });

  it('escapes a branch name rather than letting it add parameters', () => {
    const link = new URL(openLink('https://hub.example.com', 's9q3v1', 'x&score=other'));

    expect(link.searchParams.get('score')).toBe('s9q3v1');
    expect(link.searchParams.get('branch')).toBe('x&score=other');
  });
});
