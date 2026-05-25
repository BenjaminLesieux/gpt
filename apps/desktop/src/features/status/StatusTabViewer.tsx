import { useState } from 'react';
import { AlphaTab, darkTheme, useScore } from '@gpt/alphatab-react';
import { useCommitLog, useShowFile, useWorkdirFile } from '@/hooks/useGpt';
import { TrackSelector } from '@/components/tab-viewer/TrackSelector';
import { TabViewerLoadingState } from '@/components/tab-viewer/TabViewerLoadingState';
import { TabViewerErrorState } from '@/components/tab-viewer/TabViewerErrorState';
import PlayTimeline from '@/components/tab-viewer/PlayTimeline';
import { StatusSelectFileState } from './StatusSelectFileState';
import type { FileStatus } from './StatusFileRow';

interface StatusTabViewerProps {
  repoPath: string;
  file: string | null;
  status: FileStatus | null;
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

export function StatusTabViewer({ repoPath, file, status }: StatusTabViewerProps) {
  if (!file || !status) {
    return <StatusSelectFileState />;
  }
  if (status === 'added' || status === 'untracked') {
    return <WorkdirContent key={file} repoPath={repoPath} file={file} />;
  }
  return (
    <HeadContent
      key={file}
      repoPath={repoPath}
      file={file}
      isDeleted={status === 'deleted'}
    />
  );
}

// ── Working-tree viewer (added / untracked) ────────────────────────────────

function WorkdirContent({ repoPath, file }: { repoPath: string; file: string }) {
  const { data: fileBytes, isLoading, error } = useWorkdirFile(repoPath, file);

  if (isLoading) return <TabViewerLoadingState />;
  if (error) {
    return <TabViewerErrorState message={error instanceof Error ? error.message : String(error)} />;
  }

  return (
    <ScoreViewer
      fileBytes={fileBytes ?? null}
      label={basename(file)}
      rightLabel="Working tree"
    />
  );
}

// ── HEAD viewer (modified / deleted) ──────────────────────────────────────

function HeadContent({
  repoPath,
  file,
  isDeleted,
}: {
  repoPath: string;
  file: string;
  isDeleted: boolean;
}) {
  const { data: commits, isLoading: commitsLoading } = useCommitLog(repoPath);
  const headHash = commits?.[0]?.hash ?? null;

  const { data: fileBytes, isLoading: fileLoading, error: fileError } = useShowFile(
    repoPath,
    headHash,
    file,
  );

  if (commitsLoading || fileLoading) return <TabViewerLoadingState />;
  if (!headHash) {
    return <TabViewerErrorState message="No committed version found." />;
  }
  if (fileError) {
    return (
      <TabViewerErrorState
        message={fileError instanceof Error ? fileError.message : String(fileError)}
      />
    );
  }

  return (
    <ScoreViewer
      fileBytes={fileBytes ?? null}
      label={basename(file)}
      rightLabel="HEAD"
      isDeleted={isDeleted}
    />
  );
}

// ── Shared AlphaTab renderer ───────────────────────────────────────────────

interface ScoreViewerProps {
  fileBytes: Uint8Array | null;
  label: string;
  rightLabel: string;
  isDeleted?: boolean;
}

function ScoreViewer({ fileBytes, label, rightLabel, isDeleted }: ScoreViewerProps) {
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number | null>(null);
  const [renderError, setRenderError] = useState<Error | null>(null);

  const trackIndices = selectedTrackIndex !== null ? [selectedTrackIndex] : undefined;

  return (
    <article className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <div aria-hidden className="h-4 w-0.5 shrink-0 bg-primary" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {label}
        </span>
        {isDeleted && (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-destructive">
            deleted
          </span>
        )}
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/60">
          {rightLabel}
        </span>
      </header>

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
    </article>
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
