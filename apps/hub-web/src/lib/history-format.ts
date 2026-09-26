import type { Version, VersionScope } from './api';
import { layOut, type Row } from './lanes';
import i18n from './i18n';
import { ago as relative, dateLocale } from './relative-time';

/**
 * How the history reads.
 *
 * Time is grouping, never distance: versions arrive in bursts — eleven in one
 * evening, then nothing for three weeks — and a time-proportional axis renders
 * that as an unreadable clot next to a void. So the rows keep their
 * topological order and the dates become headers between them.
 *
 * Every string here is the musician's language. Never *commit*, never a sha as
 * a title, and an empty message stays empty rather than being given an
 * invented one.
 */

export type Entry =
  | { kind: 'day'; key: string; label: string }
  /** A burst inside a day: *Evening session · 11 versions between 9 and 11 pm*. */
  | { kind: 'session'; key: string; label: string }
  | ({ kind: 'version'; key: string } & Row);

/**
 * A day with this many versions in it was a session, not a series of
 * decisions. Below it the rows speak for themselves and a summary line is
 * noise; above it the reader needs to be told they are looking at one evening.
 */
const SESSION = 5;

/** The rows and the headers between them, in reading order. */
export function entries(versions: Version[], head: string | null, now = new Date()): Entry[] {
  const rows = layOut(versions, head);
  const out: Entry[] = [];

  let day: string | null = null;

  for (let index = 0; index < rows.length; index += 1) {
    const at = new Date(rows[index].version.at);
    const key = dayKey(at);

    if (key !== day) {
      day = key;
      out.push({ kind: 'day', key: `day-${key}`, label: dayLabel(at, now) });

      const sameDay = rows.slice(index).filter((row) => dayKey(new Date(row.version.at)) === key);
      const line = session(sameDay);
      if (line) out.push({ kind: 'session', key: `session-${key}`, label: line });
    }

    out.push({ kind: 'version', key: rows[index].version.id, ...rows[index] });
  }

  return out;
}

/** Local, not UTC: the boundary that matters is the reader's midnight. */
function dayKey(at: Date): string {
  return `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;
}

/**
 * Relative while it is still how someone would say it, absolute after that.
 * "Last Tuesday" and "Tuesday" are two different days and only one of them is
 * worth the ambiguity, so the weekday name stops at a week.
 */
function dayLabel(at: Date, now: Date): string {
  const days = Math.round((midnight(now).getTime() - midnight(at).getTime()) / 86_400_000);

  if (days <= 0) return i18n.t('time.today');
  if (days === 1) return i18n.t('time.yesterday');
  if (days < 7) return at.toLocaleDateString(dateLocale(), { weekday: 'long' });

  // Day first, assembled rather than formatted: `toLocaleDateString` would
  // give *September 4* under a US locale and the design reads *4 September*
  // everywhere. The month name still localizes; only the order is ours.
  const month = at.toLocaleDateString(dateLocale(), { month: 'long' });
  const stamp = `${at.getDate()} ${month}`;

  return at.getFullYear() === now.getFullYear() ? stamp : `${stamp} ${at.getFullYear()}`;
}

function midnight(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

function session(rows: Row[]): string | null {
  if (rows.length < SESSION) return null;

  // Rows are newest first, so the last one opened the session.
  const from = new Date(rows[rows.length - 1].version.at);
  const to = new Date(rows[0].version.at);

  const part = from.getHours() >= 17 ? 'evening' : from.getHours() >= 12 ? 'afternoon' : 'morning';

  return i18n.t(`history.session.${part}`, { count: rows.length, from: hour(from), to: hour(to) });
}

/**
 * English reads a twelve-hour clock with a lowercase meridiem, as the design
 * sets it; every other language keeps its own clock.
 */
function twelveHour(): boolean {
  return i18n.language === 'en';
}

/** Just the hour, for a span: *between 9 and 11 pm*. */
function hour(at: Date): string {
  return at
    .toLocaleTimeString(dateLocale(), { hour: 'numeric', hour12: twelveHour() })
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** The clock time on a row. */
export function time(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString(dateLocale(), { hour: 'numeric', minute: '2-digit', hour12: twelveHour() })
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * The narrow layout's time column: *20m*, *2h*, *1d*. Absolute times are the
 * first thing to go below 800px, and a relative one still answers the only
 * question that column is asked — how long ago.
 *
 * Terse on purpose, unlike [`since`]: this one is a 44px column, not prose.
 */
export function ago(iso: string, now = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return i18n.t('history.short.minutes', { n: minutes });
  if (minutes < 60 * 24) return i18n.t('history.short.hours', { n: Math.round(minutes / 60) });
  return i18n.t('history.short.days', { n: Math.round(minutes / (60 * 24)) });
}

/** *Yesterday at 9:31 pm* — the inspector's one long-form date. */
export function when(iso: string, now = new Date()): string {
  return i18n.t('time.dayAtTime', { day: dayLabel(new Date(iso), now), time: time(iso) });
}

/**
 * Initials from an email, because accounts have no display name yet.
 * `ben.lesieux@gmail.com` is BL; `sam@example.com` is SA. The full address
 * stays on the avatar's tooltip — this is a label, not an identity.
 */
export function initials(email: string): string {
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[^a-zA-Z0-9]+/).filter(Boolean);

  const letters =
    parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] ?? local).slice(0, 2);

  return letters.toUpperCase();
}

/**
 * What a version touched, in the row's own column: *Guitar 1 · 12 bars*.
 *
 * Names the tracks while there are few enough to read, counts them after
 * that. A version that changed no bars at all but moved the tempo is
 * *5 tracks · 0 bars* — it touched the whole song without touching a bar, and
 * saying nothing would read as an empty version.
 */
export function scopeText(scope: VersionScope | null): string {
  if (!scope) return '';

  const bars = i18n.t('history.bars', { count: scope.bars });

  if (scope.tracks.length === 0) {
    return scope.meta ? `${i18n.t('history.tracks', { count: scope.trackCount })} · ${bars}` : '';
  }

  const tracks =
    scope.tracks.length <= 2
      ? scope.tracks.map((track) => track.name).join(', ')
      : i18n.t('history.tracks', { count: scope.tracks.length });

  return `${tracks} · ${bars}`;
}

/** The same, shortened for 640px: the bar count loses its noun. */
export function shortScopeText(scope: VersionScope | null): string {
  if (!scope) return '';
  if (scope.tracks.length === 0) {
    if (!scope.meta) return '';
    return `${i18n.t('history.tracks', { count: scope.trackCount })} · ${scope.bars}`;
  }
  const tracks =
    scope.tracks.length === 1
      ? scope.tracks[0].name
      : i18n.t('history.tracks', { count: scope.tracks.length });
  return `${tracks} · ${scope.bars}`;
}

/** A version's short id. Metadata, never the title of a row. */
export function shortId(id: string): string {
  return id.slice(0, 7);
}

/**
 * The page header's *last version 21 minutes ago*. Prose rather than the
 * row column's `21m`, and it says *just now* under a minute instead of the
 * `0m` that column would show.
 */
export function since(iso: string, now = Date.now()): string {
  return relative(new Date(iso), now);
}
