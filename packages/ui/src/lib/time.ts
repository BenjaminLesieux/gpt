/**
 * Saying *when*, in the interface's language.
 *
 * Every function takes a `Date` and a locale and leans on `Intl` for the
 * words, so this module carries no copy of its own. A sentence around one of
 * these values — *last version 21 minutes ago* — is the app's to translate.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Largest unit first: the first threshold a span clears wins. */
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

type Numeric = 'always' | 'auto';
type Style = 'long' | 'short';

const formatters = new Map<string, Intl.RelativeTimeFormat>();

function formatter(locale: string, numeric: Numeric, style: Style): Intl.RelativeTimeFormat {
  const key = `${locale}:${numeric}:${style}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.RelativeTimeFormat(locale, { numeric, style });
    formatters.set(key, cached);
  }
  return cached;
}

/**
 * The locale a language's dates are formatted in. English goes through
 * `en-GB`, so it reads *4 September* rather than *September 4*.
 */
export function dateLocale(language: string): string {
  return language === 'en' ? 'en-GB' : language;
}

/**
 * Compact relative time for a row — "now", "4 min ago", "3 days ago".
 *
 * `numeric: 'always'` keeps every row the same shape: `auto` swaps in
 * "yesterday" and "last week", which are longer and inconsistent with the
 * numbers above them. The one exception is zero, where "now" is the point.
 */
export function formatRelative(date: Date, locale: string, now = new Date()): string {
  const elapsed = Math.round((now.getTime() - date.getTime()) / 1000);

  // Clocks drift and a version written a tick ago can read as the future.
  if (elapsed < JUST_NOW) return formatter(locale, 'auto', 'short').format(0, 'second');

  const format = formatter(locale, 'always', 'short');
  for (const [seconds, unit] of UNITS) {
    if (elapsed >= seconds) return format.format(-Math.floor(elapsed / seconds), unit);
  }
  return formatter(locale, 'auto', 'short').format(0, 'second');
}

/** A signed span in prose, the largest unit first; seconds under a minute. */
function prose(seconds: number, locale: string): string {
  const format = formatter(locale, 'auto', 'long');
  const size = Math.abs(seconds);
  for (const [span, unit] of UNITS) {
    if (size >= span) return format.format(Math.sign(seconds) * Math.floor(size / span), unit);
  }
  return format.format(seconds, 'second');
}

/** *21 minutes ago* — prose, for inside a sentence. */
export function since(date: Date, locale: string, now = new Date()): string {
  return prose(-Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000)), locale);
}

/** *in 6 days* — the same words pointing forwards, for an expiry. */
export function until(date: Date, locale: string, now = new Date()): string {
  return prose(Math.max(0, Math.floor((date.getTime() - now.getTime()) / 1000)), locale);
}

function midnight(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

/**
 * A day as a header names it: *Today*, *Yesterday*, then the weekday while it
 * is still how someone would say it, then the date. "Last Tuesday" and
 * "Tuesday" are two different days, so the weekday stops at a week.
 */
export function dayLabel(date: Date, locale: string, now = new Date()): string {
  const days = Math.round((midnight(now).getTime() - midnight(date).getTime()) / 86_400_000);

  if (days <= 1) {
    const word = formatter(locale, 'auto', 'long').format(days <= 0 ? 0 : -1, 'day');
    return word.charAt(0).toLocaleUpperCase(locale) + word.slice(1);
  }
  if (days < 7) return date.toLocaleDateString(locale, { weekday: 'long' });

  // Day first, assembled rather than formatted: a US locale would give
  // *September 4*. The month name still localizes; only the order is ours.
  const month = date.toLocaleDateString(locale, { month: 'long' });
  const stamp = `${date.getDate()} ${month}`;

  return date.getFullYear() === now.getFullYear() ? stamp : `${stamp} ${date.getFullYear()}`;
}

/**
 * The time of day. English reads *9:31 pm*, a twelve-hour clock with a
 * lowercase meridiem, as the design sets it; every other language keeps its
 * own clock. `minutes: false` gives just the hour, for a span.
 */
export function clock(date: Date, locale: string, { minutes = true } = {}): string {
  return date
    .toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: minutes ? '2-digit' : undefined,
      hour12: locale.startsWith('en') ? true : undefined,
    })
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
