import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlphaTab, darkTheme, useScore } from '@gpt/alphatab-react';
import { Spinner } from '@gpt/ui/spinner';
import type { Version } from '@/lib/ipc';
import { useVersionBytes } from './useVersionBytes';
import { PlaybackBar } from './PlaybackBar';
import { TrackSelector } from './TrackSelector';

const SETTINGS = {
  ...darkTheme,
  core: { engine: 'svg' as const, logLevel: 'error' as const },
  player: {
    enablePlayer: true,
    enableElementHighlighting: true,
    soundFont: '/soundfont/sonivox.sf2',
  },
};

interface ScoreStageProps {
  fileId: string;
  version: Version;
}

/** One version, rendered and playable. */
export function ScoreStage({ fileId, version }: ScoreStageProps) {
  const { t } = useTranslation();
  const { bytes, loading, error } = useVersionBytes(fileId, version.id);
  const [track, setTrack] = useState<number | null>(null);

  if (loading) return <StageSpinner label={t('extended.stage.loadingScore')} />;
  if (error || !bytes) return <StageMessage message={error ?? t('extended.stage.noScore')} />;

  return (
    <AlphaTab.Root
      // A new version is a new score: remounting keeps the player from
      // inheriting the previous one's position and soundfont state.
      key={version.id}
      src={bytes}
      tracks={track === null ? undefined : [track]}
      settings={SETTINGS}
    >
      <StageContent track={track} onTrackChange={setTrack} />
    </AlphaTab.Root>
  );
}

/**
 * Inside `<AlphaTab.Root>`: whether the bytes parsed is only known here, and
 * reading it from the score state means it resets with the remount rather
 * than outliving the version it belongs to.
 */
function StageContent({
  track,
  onTrackChange,
}: {
  track: number | null;
  onTrackChange(value: number | null): void;
}) {
  const { t } = useTranslation();
  const { error } = useScore();

  return (
    <>
      {!error && (
        <>
          <ScoreToolbar track={track} onTrackChange={onTrackChange} />
          <PlaybackBar />
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
        failed={() => (
          <div className="flex h-full bg-background">
            <StageMessage message={t('extended.stage.noScore')} />
          </div>
        )}
      />
    </>
  );
}

/** Inside `<AlphaTab.Root>`: the track names only exist once the score parses. */
function ScoreToolbar({
  track,
  onTrackChange,
}: {
  track: number | null;
  onTrackChange(value: number | null): void;
}) {
  const { score } = useScore();
  if (!score) return null;

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
      <TrackSelector
        tracks={score.tracks.map((entry) => entry.name)}
        value={track}
        onChange={onTrackChange}
        allowAll
      />
    </div>
  );
}

export function StageSpinner({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
      <Spinner />
      {label}
    </div>
  );
}

export function StageMessage({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="max-w-md text-center text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
