import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from '@gpt/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpt/ui/tooltip';
import type { ScoreToken } from '@/lib/api';

/**
 * The machines a score is actually on, as one square each.
 *
 * The distinction this component exists to hold: a `ScoreToken` is a
 * credential that was *issued*, and `POST /scores` issues one inline with the
 * score row. Rendering the token list straight out therefore claimed every
 * score was on a computer from the moment it was named. Only `lastUsedAt`
 * says a machine ever answered, so only that is drawn.
 */

/** Beyond this, the group collapses into a count. */
const SHOWN = 3;

/** A machine quiet for longer than this is history rather than activity. */
const STALE_MS = 14 * 24 * 60 * 60 * 1000;

/** Square, not round: 2px on controls and chips, no pills, ever. */
const SQUARE = 'size-6 rounded-sm after:rounded-sm';

export function DeviceAvatars({ tokens }: { tokens: ScoreToken[] }) {
  const devices = activeDevices(tokens);

  if (devices.length === 0) {
    // Not an error and not unfinished — a score can sit here happily until
    // someone presses Clone. Saying so beats an empty cell that reads as a
    // rendering fault.
    return <span className="text-sm text-muted-foreground">Not on a computer yet</span>;
  }

  const shown = devices.slice(0, SHOWN);
  const rest = devices.length - shown.length;

  return (
    // The primitive overlaps its children; squares that overlap read as a
    // stack of cards rather than a row of machines, so they are spaced instead.
    <AvatarGroup className="items-center space-x-0 gap-1 *:data-[slot=avatar]:ring-0">
      {shown.map((device) => (
        <Tooltip key={device.id}>
          <TooltipTrigger
            render={
              <Avatar
                size="sm"
                // A div is not in the tab order, and the name of the machine
                // lives only in the tooltip this opens.
                tabIndex={0}
                className={`${SQUARE} ${device.stale ? 'opacity-50' : ''}`}
              />
            }
          >
            <AvatarFallback className="rounded-sm bg-popover font-mono text-xs tracking-tight text-foreground">
              {monogram(device.name)}
            </AvatarFallback>
          </TooltipTrigger>
          <TooltipContent>{describe(device)}</TooltipContent>
        </Tooltip>
      ))}
      {rest > 0 && (
        <AvatarGroupCount className={`${SQUARE} bg-popover font-mono text-xs text-muted-foreground`}>
          +{rest}
        </AvatarGroupCount>
      )}
      {/* The squares carry no text of their own, so without this the cell is
          silent to a screen reader and unreachable to anyone not hovering. */}
      <span className="sr-only">{devices.map(describe).join('. ')}</span>
    </AvatarGroup>
  );
}

interface Device {
  id: string;
  name: string;
  /** Most recent of the two stamps — what "last seen" means for a machine. */
  seenAt: Date;
  pushedAt: Date | null;
  stale: boolean;
}

/**
 * Machines that have answered, most recently active first, so the leftmost
 * square is the one the question "who's on this?" is really asking about.
 */
function activeDevices(tokens: ScoreToken[], now = Date.now()): Device[] {
  return tokens
    .filter((token) => token.lastUsedAt !== null)
    .map((token) => {
      const pushedAt = token.lastPushedAt ? new Date(token.lastPushedAt) : null;
      const used = new Date(token.lastUsedAt as string);
      const seenAt = pushedAt && pushedAt > used ? pushedAt : used;
      return {
        id: token.id,
        name: token.name,
        seenAt,
        pushedAt,
        stale: now - seenAt.getTime() > STALE_MS,
      };
    })
    .sort((a, b) => b.seenAt.getTime() - a.seenAt.getTime());
}

/**
 * Initials, because there are no photographs here and there never will be.
 * Two words give their first letters; one word gives its first two, so
 * `companion` — the name a token gets when nobody said — still reads as a
 * label rather than a single ambiguous letter.
 */
function monogram(name: string): string {
  const words = name.split(/[\s_-]+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** What the square means, in the product's own words — never "pushed". */
function describe(device: Device): string {
  return device.pushedAt
    ? `${device.name} — last version ${ago(device.pushedAt)}`
    : `${device.name} — has the score, no versions saved from it yet`;
}

/**
 * Pinned to English rather than the browser's locale. This value is
 * interpolated into an English sentence, and `undefined` here produced
 * "last version il y a 21 minutes" on a French machine. The Created column
 * localises its dates because a bare date survives it; a fragment inside a
 * sentence does not.
 */
const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

function ago(when: Date, now = Date.now()): string {
  const elapsed = now - when.getTime();

  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return RELATIVE.format(-Math.floor(elapsed / size), unit);
  }

  // Under a minute. The push queue is event-driven, so this is someone
  // saving in Guitar Pro in the next room right now.
  return 'just now';
}
