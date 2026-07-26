import { describe, expect, it } from 'vitest';
import { formatRelative } from './time';

/** Fixed reference so the assertions don't drift with the wall clock. */
const NOW = Date.UTC(2026, 6, 26, 12, 0, 0);
const at = (secondsAgo: number) => Math.round(NOW / 1000) - secondsAgo;

describe('formatRelative', () => {
  it('calls anything within the last minute "now"', () => {
    expect(formatRelative(at(0), 'en', NOW)).toBe('now');
    expect(formatRelative(at(44), 'en', NOW)).toBe('now');
  });

  it('picks the largest unit that still reads honestly', () => {
    expect(formatRelative(at(4 * 60), 'en', NOW)).toMatch(/4\smin/);
    expect(formatRelative(at(3 * 3600), 'en', NOW)).toMatch(/3\shr/);
    expect(formatRelative(at(2 * 86400), 'en', NOW)).toMatch(/2\sdays/);
    expect(formatRelative(at(3 * 7 * 86400), 'en', NOW)).toMatch(/3\swk/);
  });

  it('stays numeric so rows keep the same shape', () => {
    // `numeric: 'auto'` would say "yesterday" / "hier" here.
    expect(formatRelative(at(86400), 'en', NOW)).toMatch(/1\sday/);
    expect(formatRelative(at(86400), 'fr', NOW)).toMatch(/1\sj/);
  });

  it('follows the locale', () => {
    expect(formatRelative(at(0), 'fr', NOW)).toBe('maintenant');
    expect(formatRelative(at(4 * 60), 'fr', NOW)).toMatch(/4\smin/);
  });

  it('reads a future timestamp as now rather than as a negative age', () => {
    expect(formatRelative(at(-3600), 'en', NOW)).toBe('now');
  });
});
