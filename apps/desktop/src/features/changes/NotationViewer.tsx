import { useState } from 'react';
import { AlphaTab, darkTheme, useScore } from '@gpt/alphatab-react';
import { TrackSelector } from '@/components/tab-viewer/TrackSelector';
import { TabViewerErrorState } from '@/components/tab-viewer/TabViewerErrorState';
import PlayTimeline from '@/components/tab-viewer/PlayTimeline';

interface NotationViewerProps {
  fileBytes: Uint8Array | null;
}

// ─── NotationViewer ─────────────────────────────────────────────────────────
//
// Full alphaTab rendering of a single score version (with playback + track
// selection). The surrounding header — file name, version label, mode toggle —
// is owned by ChangeDetail; this component is just the rendered tab.

export function NotationViewer({ fileBytes }: NotationViewerProps) {
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number | null>(null);
  const [renderError, setRenderError] = useState<Error | null>(null);

  const trackIndices = selectedTrackIndex !== null ? [selectedTrackIndex] : undefined;

  return (
    <AlphaTab.Root
      src={fileBytes}
      tracks={trackIndices}
      settings={{
        ...darkTheme,
        core: { engine: 'svg' },
        player: {
          enablePlayer: true,
          enableElementHighlighting: true,
          soundFont: '/soundfont/sonivox.sf2',
        },
      }}
      onError={setRenderError}
    >
      <ScoreHeader
        selectedTrackIndex={selectedTrackIndex}
        onSelectTrack={setSelectedTrackIndex}
      />

      <PlayTimeline />

      <div className="relative min-h-0 flex-1 overflow-auto bg-background">
        {renderError && <TabViewerErrorState message={renderError.message} />}
        {fileBytes && !renderError && (
          <AlphaTab.Viewport
            cursorClassNames={{
              bar: 'bg-accent/18',
              beat: 'bg-primary/85',
              selection: 'bg-red/14',
              highlightColor: 'oklch(65% 0.14 60)',
            }}
          />
        )}
      </div>
    </AlphaTab.Root>
  );
}

function ScoreHeader({
  selectedTrackIndex,
  onSelectTrack,
}: {
  selectedTrackIndex: number | null;
  onSelectTrack: (i: number | null) => void;
}) {
  const { score } = useScore();
  if (!score) return null;
  return (
    <TrackSelector
      score={score}
      selectedIndex={selectedTrackIndex}
      onSelect={onSelectTrack}
    />
  );
}
