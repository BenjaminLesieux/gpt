/**
 * Compact, locale-aware relative time — "now", "4 min", "2 hr", "3 days".
 *
 * The panel is 420px wide and every version row carries one of these, so they
 * stay narrow: `narrow` style, and the unit is the largest that still reads
 * honestly.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Largest unit first: the first threshold an elapsed span clears wins. */
const UNITS: [seconds: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [YEAR, 'year'],
  [MONTH, 'month'],
  [WEEK, 'week'],
  [DAY, 'day'],
  [HOUR, 'hour'],
  [MINUTE, 'minute'],
];

/** Below this, "now" is truer than "1 min". */
const JUST_NOW = 45;

const formatters = new Map<string, Intl.RelativeTimeFormat>();

/**
 * `numeric: 'always'` keeps every row the same shape — `auto` swaps in
 * "yesterday" and "last week", which are both longer and inconsistent with the
 * numbers above them. The one exception is zero, where "now" is the point.
 */
function formatter(locale: string, numeric: 'always' | 'auto'): Intl.RelativeTimeFormat {
  const key = `${locale}:${numeric}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.RelativeTimeFormat(locale, { numeric, style: 'short' });
    formatters.set(key, cached);
  }
  return cached;
}

/** `timestamp` is unix seconds, matching the host's `Version.timestamp`. */
export function formatRelative(timestamp: number, locale: string, now = Date.now()): string {
  const elapsed = Math.round(now / 1000) - timestamp;

  // Clocks drift and a commit written a tick ago can read as the future.
  if (elapsed < JUST_NOW) return formatter(locale, 'auto').format(0, 'second');

  const format = formatter(locale, 'always');
  for (const [seconds, unit] of UNITS) {
    if (elapsed >= seconds) return format.format(-Math.floor(elapsed / seconds), unit);
  }
  return formatter(locale, 'auto').format(0, 'second');
}
