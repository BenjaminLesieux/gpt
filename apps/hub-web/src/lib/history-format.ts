import { clock, dateLocale, dayLabel } from '@gpt/ui/lib/time';
import type { Version, VersionScope } from './api';
import { layOut, type Row } from './lanes';
import i18n from './i18n';

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
      const label = dayLabel(at, dateLocale(i18n.language), now);
      out.push({ kind: 'day', key: `day-${key}`, label });

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

function session(rows: Row[]): string | null {
  if (rows.length < SESSION) return null;

  // Rows are newest first, so the last one opened the session.
  const from = new Date(rows[rows.length - 1].version.at);
  const to = new Date(rows[0].version.at);

  const part = from.getHours() >= 17 ? 'evening' : from.getHours() >= 12 ? 'afternoon' : 'morning';

  return i18n.t(`history.session.${part}`, { count: rows.length, from: hour(from), to: hour(to) });
}

/** Just the hour, for a span: *between 9 and 11 pm*. */
function hour(at: Date): string {
  return clock(at, dateLocale(i18n.language), { minutes: false });
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
