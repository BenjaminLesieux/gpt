import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScorePlayer } from '@gpt/ui/score/player';
import { Spinner } from '@gpt/ui/spinner';
import type { Version } from '@/lib/ipc';
import { useVersionBytes } from './useVersionBytes';

interface ScoreStageProps {
  fileId: string;
  version: Version;
}

/** One version, rendered and playable, once its bytes are here. */
export function ScoreStage({ fileId, version }: ScoreStageProps) {
  const { t } = useTranslation();
  const { bytes, loading, error } = useVersionBytes(fileId, version.id);
  // Here rather than in the player, which unmounts while each version's bytes
  // load: the chosen track carries from one version to the next.
  const [track, setTrack] = useState<number | null>(null);

  if (loading) return <StageSpinner label={t('extended.stage.loadingScore')} />;
  if (error || !bytes) return <StageMessage message={error ?? t('extended.stage.noScore')} />;

  return (
    <ScorePlayer
      src={bytes}
      identity={version.id}
      track={track}
      onTrackChange={setTrack}
      labels={{
        play: t('extended.playback.play'),
        pause: t('extended.playback.pause'),
        stop: t('extended.playback.stop'),
        position: t('extended.playback.position'),
        loop: t('extended.playback.loop'),
        speed: t('extended.playback.speed'),
        allTracks: t('extended.stage.allTracks'),
        failed: t('extended.stage.noScore'),
        loadingSounds: t('extended.playback.loadingSounds'),
      }}
    />
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
