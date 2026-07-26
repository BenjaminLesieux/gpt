import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, Repeat, Square } from 'lucide-react';
import {
  useAlphaTabApi,
  usePlayback,
  usePlayerControls,
  usePlayerPosition,
} from '@gpt/alphatab-react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const SPEEDS = [0.5, 0.75, 1] as const;

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function toScalar(value: number | readonly number[]): number {
  return typeof value === 'number' ? value : (value[0] ?? 0);
}

/**
 * Transport for the version on screen. Must live inside an `<AlphaTab.Root>`.
 *
 * The soundfont loads asynchronously after the score renders, so the controls
 * spend their first seconds disabled — `isReadyForPlayback` is what says the
 * synth can actually make sound.
 */
export function PlaybackBar() {
  const { t } = useTranslation();
  const { state, play, pause, stop, isReadyForPlayback } = usePlayback();
  const { currentTime, endTime, progress } = usePlayerPosition();
  const { playbackSpeed, setPlaybackSpeed, isLooping, setIsLooping } = usePlayerControls();
  const { api } = useAlphaTabApi();

  // While scrubbing, the thumb follows the pointer rather than the player —
  // otherwise position events fight the drag.
  const [scrub, setScrub] = useState<number | null>(null);
  const position = scrub ?? progress * 100;
  const isPlaying = state === 'playing';

  const commitScrub = useCallback(
    (value: number | readonly number[]) => {
      const percent = toScalar(value);
      setScrub(null);
      if (api && endTime > 0) api.timePosition = (percent / 100) * endTime;
    },
    [api, endTime],
  );

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-4">
      <ButtonGroup>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={isPlaying ? pause : play}
          disabled={!isReadyForPlayback}
          aria-label={isPlaying ? t('extended.playback.pause') : t('extended.playback.play')}
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
          aria-label={t('extended.playback.stop')}
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
        value={[position]}
        disabled={!isReadyForPlayback || endTime === 0}
        onValueChange={(value) => setScrub(toScalar(value))}
        onValueCommitted={commitScrub}
        aria-label={t('extended.playback.position')}
        className="min-w-0 flex-1"
      />

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setIsLooping(!isLooping)}
        disabled={!isReadyForPlayback}
        aria-pressed={isLooping}
        aria-label={t('extended.playback.loop')}
        className={cn(isLooping && 'text-brand-bright')}
      >
        <Repeat className="size-3.5" />
      </Button>

      <ButtonGroup aria-label={t('extended.playback.speed')}>
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
