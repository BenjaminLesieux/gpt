import { describe, expect, it } from 'vitest';
import { clock, dateLocale, dayLabel, formatRelative, since, until } from './time';

/** Fixed reference so the assertions don't drift with the wall clock. */
const NOW = new Date(Date.UTC(2026, 6, 26, 12, 0, 0));
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe('formatRelative', () => {
  it('calls anything within the last minute "now"', () => {
    expect(formatRelative(ago(0), 'en', NOW)).toBe('now');
    expect(formatRelative(ago(44), 'en', NOW)).toBe('now');
  });

  it('picks the largest unit that still reads honestly', () => {
    expect(formatRelative(ago(4 * 60), 'en', NOW)).toMatch(/4\smin/);
    expect(formatRelative(ago(3 * 3600), 'en', NOW)).toMatch(/3\shr/);
    expect(formatRelative(ago(2 * 86400), 'en', NOW)).toMatch(/2\sdays/);
    expect(formatRelative(ago(3 * 7 * 86400), 'en', NOW)).toMatch(/3\swk/);
  });

  it('stays numeric so rows keep the same shape', () => {
    // `numeric: 'auto'` would say "yesterday" / "hier" here.
    expect(formatRelative(ago(86400), 'en', NOW)).toMatch(/1\sday/);
    expect(formatRelative(ago(86400), 'fr', NOW)).toMatch(/1\sj/);
  });

  it('follows the locale', () => {
    expect(formatRelative(ago(0), 'fr', NOW)).toBe('maintenant');
    expect(formatRelative(ago(4 * 60), 'fr', NOW)).toMatch(/4\smin/);
  });

  it('reads a future date as now rather than as a negative age', () => {
    expect(formatRelative(ago(-3600), 'en', NOW)).toBe('now');
  });
});

describe('since and until', () => {
  it('say it in prose, for inside a sentence', () => {
    expect(since(ago(21 * 60), 'en-GB', NOW)).toBe('21 minutes ago');
    expect(since(ago(21 * 60), 'fr', NOW)).toBe('il y a 21 minutes');
    expect(until(ago(-6.5 * 86400), 'en-GB', NOW)).toBe('in 6 days');
    expect(until(ago(-6.5 * 86400), 'fr', NOW)).toBe('dans 6 jours');
  });

  it('count seconds under a minute rather than a unit that is not true yet', () => {
    expect(since(ago(10), 'en-GB', NOW)).toBe('10 seconds ago');
    expect(until(ago(-30), 'en-GB', NOW)).toBe('in 30 seconds');
  });
});

describe('dayLabel', () => {
  const now = new Date('2026-09-19T23:50:00');

  it('is relative while someone would still say it that way', () => {
    expect(
      ['2026-09-19T23:42:00', '2026-09-18T21:31:00', '2026-09-15T22:04:00', '2026-09-04T19:55:00'].map(
        (at) => dayLabel(new Date(at), 'en-GB', now)
      )
    ).toEqual(['Today', 'Yesterday', 'Tuesday', '4 September']);
  });

  it('names the year only when it is not this one', () => {
    expect(dayLabel(new Date('2025-09-04T19:55:00'), 'en-GB', now)).toBe('4 September 2025');
  });

  it('capitalises what Intl gives in lower case', () => {
    expect(dayLabel(new Date('2026-09-18T21:31:00'), 'fr', now)).toBe('Hier');
    expect(dayLabel(new Date('2026-09-11T23:42:00'), 'fr', now)).toBe('11 septembre');
  });
});

describe('clock', () => {
  /**
   * These sit inside sentences in the interface's language. Left to the
   * browser, a French machine wrote an English row's time as `23:42`.
   */
  it('reads a twelve-hour clock in English, whatever the machine is set to', () => {
    expect(clock(new Date('2026-09-11T23:42:00'), 'en-GB')).toBe('11:42 pm');
    expect(clock(new Date('2026-09-11T21:00:00'), 'en-GB', { minutes: false })).toBe('9 pm');
  });

  it('keeps every other language on its own clock', () => {
    expect(clock(new Date('2026-09-11T23:42:00'), 'fr')).toBe('23:42');
  });
});

describe('dateLocale', () => {
  it('keeps English day-first', () => {
    expect(dateLocale('en')).toBe('en-GB');
    expect(dateLocale('fr')).toBe('fr');
  });
});
