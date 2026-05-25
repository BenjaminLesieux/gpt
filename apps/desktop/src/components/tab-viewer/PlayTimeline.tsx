import { useState, useCallback } from 'react';
import {
  usePlayback,
  usePlayerPosition,
  usePlayerControls,
  useAlphaTabApi,
} from '@gpt/alphatab-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Pause, Play, Repeat, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Constants ────────────────────────────────────────────────────────────────

const SPEEDS = [0.5, 0.75, 1, 1.5] as const;
type Speed = (typeof SPEEDS)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function toScalar(value: number | readonly number[]): number {
  return typeof value === 'number' ? value : (value[0] ?? 0);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PlayTimeline() {
  const { state, play, pause, stop, isReadyForPlayback } = usePlayback();
  const { currentTime, endTime, progress } = usePlayerPosition();
  const { playbackSpeed, setPlaybackSpeed, isLooping, setIsLooping } = usePlayerControls();
  const { api } = useAlphaTabApi();

  // During scrub: show local value instead of live progress so the thumb
  // doesn't fight the user's drag.
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const displayValue = scrubValue !== null ? scrubValue : progress * 100;

  const isPlaying = state === 'playing';
  const disabled = !isReadyForPlayback;

  const handleValueChange = useCallback((value: number | readonly number[]) => {
    setScrubValue(toScalar(value));
  }, []);

  const handleValueCommitted = useCallback(
    (value: number | readonly number[]) => {
      const v = toScalar(value);
      setScrubValue(null);
      if (api && endTime > 0) {
        api.timePosition = (v / 100) * endTime;
      }
    },
    [api, endTime],
  );

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
      {/* Transport */}
      <ButtonGroup>
        <Tooltip>
          <TooltipTrigger render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              onClick={isPlaying ? pause : play}
              disabled={disabled}
            >
              {isPlaying
                ? <Pause className="size-3.5" />
                : <Play className="size-3.5" />}
            </Button>
          } />
          <TooltipContent>{isPlaying ? 'Pause' : 'Play'}</TooltipContent>
        </Tooltip>

        <ButtonGroupSeparator orientation="vertical" />

        <Tooltip>
          <TooltipTrigger render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Stop"
              onClick={stop}
              disabled={disabled || state === 'idle'}
            >
              <Square className="size-3.5" />
            </Button>
          } />
          <TooltipContent>Stop</TooltipContent>
        </Tooltip>
      </ButtonGroup>

      {/* Time display */}
      <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {formatTime(currentTime)}
        <span className="opacity-40"> / </span>
        {formatTime(endTime)}
      </span>

      {/* Scrub slider */}
      <div className="min-w-0 flex-1">
        <Slider
          min={0}
          max={100}
          step={0.01}
          value={[displayValue]}
          disabled={disabled || endTime === 0}
          onValueChange={handleValueChange}
          onValueCommitted={handleValueCommitted}
          aria-label="Playback position"
        />
      </div>

      {/* Loop */}
      <Tooltip>
        <TooltipTrigger render={
          <Button
            variant={isLooping ? 'outline' : 'ghost'}
            size="icon-sm"
            aria-label="Toggle loop"
            onClick={() => setIsLooping(!isLooping)}
            disabled={disabled}
            className={cn(isLooping && 'border-brand-border text-brand-bright')}
          >
            <Repeat className="size-3.5" />
          </Button>
        } />
        <TooltipContent>Loop</TooltipContent>
      </Tooltip>

      {/* Speed */}
      <ButtonGroup aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <Button
            key={s}
            variant={playbackSpeed === s ? 'outline' : 'ghost'}
            size="xs"
            onClick={() => setPlaybackSpeed(s as Speed)}
            disabled={disabled}
            aria-label={`${s}× speed`}
            className={cn(
              'font-mono',
              playbackSpeed === s && 'border-brand-border text-brand-bright',
            )}
          >
            {s}×
          </Button>
        ))}
      </ButtonGroup>
    </div>
  );
}

export default PlayTimeline;
