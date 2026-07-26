import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TabDiff, darkTheme } from '@gpt/alphatab-react';
import type { Version } from '@/lib/ipc';
import { StageMessage, StageSpinner } from './ScoreStage';
import { TrackSelector } from './TrackSelector';
import { useVersionDiff } from './useVersionBytes';

const SETTINGS = {
  ...darkTheme,
  core: { engine: 'svg' as const, logLevel: 'error' as const },
  // Two rendered scores side by side, and nothing to play: the synth would
  // only cost startup time here.
  player: { enablePlayer: false },
};

interface DiffStageProps {
  fileId: string;
  base: Version;
  head: Version;
}

/** Two versions of the same file, bar-for-bar. */
export function DiffStage({ fileId, base, head }: DiffStageProps) {
  const { t } = useTranslation();
  const { diff, baseBytes, headBytes, loading, error } = useVersionDiff(fileId, base.id, head.id);
  const [track, setTrack] = useState(0);

  const trackNames = useMemo(() => diff?.tracks.map((entry) => entry.trackName) ?? [], [diff]);
  // gpt-core's own summary is a fixed English sentence across all tracks; the
  // toolbar counts only what the selected track shows.
  const counts = useMemo(() => {
    const bars = diff?.tracks[track]?.bars ?? [];
    return {
      changed: bars.filter((bar) => bar.type === 'changed').length,
      added: bars.filter((bar) => bar.type === 'added').length,
      removed: bars.filter((bar) => bar.type === 'removed').length,
    };
  }, [diff, track]);

  if (loading) return <StageSpinner label={t('extended.stage.computingDiff')} />;
  if (error) return <StageMessage message={error} />;
  if (!diff || !baseBytes || !headBytes) {
    return <StageMessage message={t('extended.stage.noDiff')} />;
  }

  const isIdentical = counts.changed + counts.added + counts.removed === 0;

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-2">
        <TrackSelector
          tracks={trackNames}
          value={track}
          onChange={(value) => setTrack(value ?? 0)}
        />
        {isIdentical ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            {t('extended.stage.identical')}
          </span>
        ) : (
          <span className="flex items-center gap-2.5 font-mono text-[10px]">
            {counts.changed > 0 && (
              <span className="text-diff-changed">
                {t('extended.stage.changedBars', { count: counts.changed })}
              </span>
            )}
            {counts.added > 0 && (
              <span className="text-diff-added">
                {t('extended.stage.addedBars', { count: counts.added })}
              </span>
            )}
            {counts.removed > 0 && (
              <span className="text-diff-removed">
                {t('extended.stage.removedBars', { count: counts.removed })}
              </span>
            )}
          </span>
        )}
      </div>

      <TabDiff
        base={baseBytes}
        head={headBytes}
        diff={diff}
        trackIndex={track}
        settings={SETTINGS}
        baseLabel={versionLabel(base, t('extended.timeline.autoSnapshot'))}
        headLabel={versionLabel(head, t('extended.timeline.autoSnapshot'))}
        style={{ flex: 1, minHeight: 0 }}
      />
    </>
  );
}

function versionLabel(version: Version, snapshotLabel: string): string {
  return version.kind === 'named' ? version.message : snapshotLabel;
}
