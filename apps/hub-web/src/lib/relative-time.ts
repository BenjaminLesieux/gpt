import i18n from './i18n';

/**
 * How long ago something happened, in words, in the interface's language.
 *
 * These values are interpolated into sentences — *last version 21 minutes
 * ago* — so they follow the language the sentence is in, never the browser's
 * locale on its own: that produced "last version il y a 21 minutes".
 */

/**
 * The locale dates are formatted in. English goes through `en-GB` for its
 * day-first ordering; every other language is its own.
 */
export function dateLocale(language = i18n.language): string {
  return language === 'en' ? 'en-GB' : language;
}

function relative(): Intl.RelativeTimeFormat {
  return new Intl.RelativeTimeFormat(dateLocale(), { numeric: 'auto' });
}

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
    if (elapsed >= size) return relative().format(-Math.floor(elapsed / size), unit);
  }

  // Under a minute. The push queue is event-driven, so this is someone
  // saving in Guitar Pro in the next room right now.
  return i18n.t('time.justNow');
}

/**
 * How long something has left — an invite's expiry, which is the only value
 * in this app that points forwards. Same words in the other direction; a
 * *stops working −6 days ago* is what `ago` would make of it.
 */
export function until(when: Date, now = Date.now()): string {
  const left = when.getTime() - now;

  for (const [unit, size] of UNITS) {
    if (left >= size) return relative().format(Math.floor(left / size), unit);
  }

  return i18n.t('time.underAMinute');
}
