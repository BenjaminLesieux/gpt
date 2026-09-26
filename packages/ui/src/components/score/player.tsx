import { useState } from 'react';
import { ChevronDown, Pause, Play, Repeat, Square } from 'lucide-react';
import {
  AlphaTab,
  darkTheme,
  usePlayback,
  usePlayerControls,
  usePlayerPosition,
  useScore,
  useSeek,
} from '@gpt/alphatab-react';
import { Button } from '../ui/button';
import { ButtonGroup } from '../ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Skeleton } from '../ui/skeleton';
import { Slider } from '../ui/slider';
import { Spinner } from '../ui/spinner';
import { cn } from '../../lib/utils';

export interface ScorePlayerLabels {
  play: string;
  pause: string;
  stop: string;
  position: string;
  loop: string;
  speed: string;
  allTracks: string;
  /** Shown in place of the score when alphaTab cannot read it. */
  failed: string;
  /** Shown while the soundfont, which arrives after the notation, loads. */
  loadingSounds: string;
}

export interface ScorePlayerProps {
  /** A URL alphaTab streams itself, or bytes already in hand. */
  src: string | Uint8Array;
  /** Names the version: a new one remounts rather than inheriting the last one's position. */
  identity: string;
  labels: ScorePlayerLabels;
  /** The track on screen, `null` for all. Omit to let the player keep its own. */
  track?: number | null;
  onTrackChange?(track: number | null): void;
  className?: string;
}

const SETTINGS = {
  ...darkTheme,
  core: { engine: 'svg' as const, logLevel: 'error' as const },
  player: {
    enablePlayer: true,
    enableElementHighlighting: true,
    // Each app's alphaTab Vite plugin emits it into `public/`.
    soundFont: '/soundfont/sonivox.sf2',
  },
};

const SPEEDS = [0.5, 0.75, 1] as const;

/** One version, rendered and playable. */
export function ScorePlayer({
  src,
  identity,
  labels,
  track: controlledTrack,
  onTrackChange,
  className,
}: ScorePlayerProps) {
  const [ownTrack, setOwnTrack] = useState<number | null>(null);
  const track = controlledTrack === undefined ? ownTrack : controlledTrack;
  const setTrack = (value: number | null) => {
    setOwnTrack(value);
    onTrackChange?.(value);
  };

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <AlphaTab.Root
        key={identity}
        src={src}
        tracks={track === null ? undefined : [track]}
        settings={SETTINGS}
      >
        <PlayerContent track={track} onTrackChange={setTrack} labels={labels} />
      </AlphaTab.Root>
    </div>
  );
}

interface TrackProps {
  track: number | null;
  onTrackChange(value: number | null): void;
  labels: ScorePlayerLabels;
}

function PlayerContent({ track, onTrackChange, labels }: TrackProps) {
  const { error } = useScore();

  return (
    <>
      {!error && (
        <>
          <ScoreToolbar track={track} onTrackChange={onTrackChange} labels={labels} />
          <PlaybackBar labels={labels} />
        </>
      )}

      <AlphaTab.Stage
        className="min-h-0 flex-1 overflow-auto bg-background"
        cursorClassNames={{
          bar: 'bg-accent/20',
          beat: 'bg-brand/80',
          selection: 'bg-brand-dim',
          highlightColor: 'oklch(65% 0.14 60)',
        }}
        loading={<ScoreSkeleton />}
        failed={() => (
          <div className="flex h-full items-center justify-center bg-background p-8">
            <p className="max-w-md text-center text-xs text-muted-foreground">{labels.failed}</p>
          </div>
        )}
      />
    </>
  );
}

/** The track names only exist once the score parses. */
function ScoreToolbar({ track, onTrackChange, labels }: TrackProps) {
  const { score } = useScore();
  const { isReadyForPlayback } = usePlayback();
  if (!score) return null;

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
      <TrackSelector
        tracks={score.tracks.map((entry) => entry.name)}
        value={track}
        onChange={onTrackChange}
        allTracks={labels.allTracks}
      />
      {!isReadyForPlayback && (
        <span role="status" className="ml-auto text-xs text-muted-foreground">
          {labels.loadingSounds}
        </span>
      )}
    </div>
  );
}

function TrackSelector({
  tracks,
  value,
  onChange,
  allTracks,
}: {
  tracks: string[];
  /** `null` renders every track. */
  value: number | null;
  onChange(value: number | null): void;
  allTracks: string;
}) {
  const label = value === null ? allTracks : (tracks[value] ?? '—');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="xs" className="text-muted-foreground" />}
      >
        {label}
        <ChevronDown data-icon="inline-end" className="opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onClick={() => onChange(null)}
          className={cn('text-xs', value === null && 'text-brand-bright')}
        >
          {allTracks}
        </DropdownMenuItem>
        {tracks.map((name, index) => (
          <DropdownMenuItem
            key={`${name}-${index}`}
            onClick={() => onChange(index)}
            className={cn('text-xs', value === index && 'text-brand-bright')}
          >
            {name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
}

/** The soundfont loads after the score renders, so the controls start disabled. */
function PlaybackBar({ labels }: { labels: ScorePlayerLabels }) {
  const { state, play, pause, stop, isReadyForPlayback } = usePlayback();
  const { currentTime, endTime } = usePlayerPosition();
  const { playbackSpeed, setPlaybackSpeed, isLooping, setIsLooping } = usePlayerControls();
  const seek = useSeek();
  const isPlaying = state === 'playing';

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-4">
      <ButtonGroup>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={isPlaying ? pause : play}
          disabled={!isReadyForPlayback}
          aria-label={isPlaying ? labels.pause : labels.play}
        >
          {!isReadyForPlayback ? (
            <Spinner />
          ) : isPlaying ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={stop}
          disabled={!isReadyForPlayback || state === 'idle'}
          aria-label={labels.stop}
        >
          <Square className="size-3.5" />
        </Button>
      </ButtonGroup>

      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatTime(currentTime)}
        <span className="opacity-40"> / </span>
        {formatTime(endTime)}
      </span>

      <Slider
        min={0}
        max={100}
        step={0.01}
        value={[seek.value]}
        disabled={seek.disabled}
        onValueChange={seek.onValueChange}
        onValueCommitted={seek.onValueCommitted}
        aria-label={labels.position}
        className="min-w-0 flex-1"
      />

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setIsLooping(!isLooping)}
        disabled={!isReadyForPlayback}
        aria-pressed={isLooping}
        aria-label={labels.loop}
        className={cn(isLooping && 'text-brand-bright')}
      >
        <Repeat className="size-3.5" />
      </Button>

      <ButtonGroup aria-label={labels.speed}>
        {SPEEDS.map((speed) => (
          <Button
            key={speed}
            variant="ghost"
            size="xs"
            onClick={() => setPlaybackSpeed(speed)}
            disabled={!isReadyForPlayback}
            aria-pressed={playbackSpeed === speed}
            className={cn('font-mono', playbackSpeed === speed && 'text-brand-bright')}
          >
            {speed}×
          </Button>
        ))}
      </ButtonGroup>
    </div>
  );
}

/** Static: hover and active states are the whole motion budget. */
function ScoreSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 bg-background p-4" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex flex-col gap-1.5">
          {[0, 1, 2, 3, 4, 5].map((line) => (
            <Skeleton key={line} className="h-px w-full rounded-none bg-border" />
          ))}
        </div>
      ))}
    </div>
  );
}
