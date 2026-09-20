/**
 * How long ago something happened, in words.
 *
 * Pinned to English rather than the browser's locale, and that is deliberate.
 * These values are interpolated into English sentences — *last version 21
 * minutes ago* — and `undefined` here produced "last version il y a 21
 * minutes" on a French machine. A bare date survives localisation; a fragment
 * inside a sentence does not.
 *
 * The same reasoning covers the history's day headers and clock times: the
 * interface is English, so `Vendredi` between `Today` and `Yesterday` is not
 * localisation, it is one row in the wrong language.
 */

/** The locale every date and time in this app is formatted in. */
export const LOCALE = 'en-GB';

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

export function ago(when: Date, now = Date.now()): string {
  const elapsed = now - when.getTime();

  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return RELATIVE.format(-Math.floor(elapsed / size), unit);
  }

  // Under a minute. The push queue is event-driven, so this is someone
  // saving in Guitar Pro in the next room right now.
  return 'just now';
}

/**
 * How long something has left — an invite's expiry, which is the only value
 * in this app that points forwards. Same words in the other direction; a
 * *stops working −6 days ago* is what `ago` would make of it.
 */
export function until(when: Date, now = Date.now()): string {
  const left = when.getTime() - now;

  for (const [unit, size] of UNITS) {
    if (left >= size) return RELATIVE.format(Math.floor(left / size), unit);
  }

  return 'in under a minute';
}
