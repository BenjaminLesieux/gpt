import { useState, useCallback, useEffect } from 'react';
import { ExternalLink, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { AlphaTab, darkTheme, useScore } from '@gpt/alphatab-react';
import { useShow, useShowFile, useRestoreWorkdir } from '@/hooks/useGpt';
import { useOpenFile } from '@/hooks/useOpenFile';
import { gptClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Spinner } from '@/components/ui/spinner';
import { FileTabs } from '@/components/tab-viewer/FileTabs';
import { TrackSelector } from '@/components/tab-viewer/TrackSelector';
import { NoFilesState } from '@/components/tab-viewer/NoFilesState';
import { TabViewerLoadingState } from '@/components/tab-viewer/TabViewerLoadingState';
import { TabViewerErrorState } from '@/components/tab-viewer/TabViewerErrorState';
import PlayTimeline from '@/components/tab-viewer/PlayTimeline';

interface TabViewerProps {
  repoPath: string;
  hash: string;
}

export function TabViewer({ repoPath, hash }: TabViewerProps) {
  const {
    data: showData,
    isLoading: showLoading,
    error: showError,
  } = useShow(repoPath, hash);
  const gpFiles = showData?.files ?? [];
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number | null>(null);
  const [renderError, setRenderError] = useState<Error | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  const openFile = useOpenFile();
  const restoreWorkdir = useRestoreWorkdir(repoPath);

  const activeFile = selectedFile ?? gpFiles[0]?.file ?? null;
  const {
    data: fileBytes,
    isLoading: fileLoading,
    error: fileError,
  } = useShowFile(repoPath, hash, activeFile);

  // Reset tab state whenever the viewed commit changes.
  useEffect(() => {
    setSelectedFile(null);
    setSelectedTrackIndex(null);
    setRenderError(null);
  }, [hash]);

  const handleFileSelect = useCallback((file: string) => {
    setSelectedFile(file);
    setSelectedTrackIndex(null);
    setRenderError(null);
  }, []);

  const handleOpenInGP = useCallback(async () => {
    if (!activeFile) return;
    setIsOpening(true);
    try {
      const { path } = await gptClient.restoreTmp(repoPath, hash, activeFile);
      await openFile(path);
    } catch (err) {
      toast.error('Could not open file', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsOpening(false);
    }
  }, [repoPath, hash, activeFile, openFile]);

  const handleRestoreWorkdir = useCallback(async () => {
    if (!activeFile) return;
    try {
      await restoreWorkdir.mutateAsync({ hash, file: activeFile });
      toast.success(`Restored ${activeFile.split('/').pop()} to working tree`);
    } catch (err) {
      toast.error('Could not restore file', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [hash, activeFile, restoreWorkdir]);

  if (showLoading) return <TabViewerLoadingState />;
  if (showError) {
    return (
      <TabViewerErrorState
        message={
          showError instanceof Error ? showError.message : String(showError)
        }
      />
    );
  }
  if (gpFiles.length === 0) return <NoFilesState />;

  const trackIndices =
    selectedTrackIndex !== null ? [selectedTrackIndex] : undefined;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <FileTabs
        files={gpFiles}
        selected={activeFile}
        onSelect={handleFileSelect}
        actions={
          activeFile ? (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={handleOpenInGP}
                      disabled={isOpening}
                      aria-label="Open in Guitar Pro"
                    />
                  }
                >
                  {isOpening ? <Spinner className="size-3" /> : <ExternalLink strokeWidth={1.5} />}
                  Open
                </TooltipTrigger>
                <TooltipContent>Open this version in Guitar Pro</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={handleRestoreWorkdir}
                      disabled={restoreWorkdir.isPending}
                      aria-label="Restore to working tree"
                    />
                  }
                >
                  {restoreWorkdir.isPending ? <Spinner className="size-3" /> : <RotateCcw strokeWidth={1.5} />}
                  Restore
                </TooltipTrigger>
                <TooltipContent>Overwrite working tree with this version</TooltipContent>
              </Tooltip>
            </>
          ) : null
        }
      />

      <AlphaTab.Root
        src={fileBytes ?? null}
        tracks={trackIndices}
        settings={{
          ...darkTheme,
          core: {
            engine: 'svg',
            logLevel: 'error',
          },
          player: {
            enablePlayer: true,
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
          {fileLoading && <TabViewerLoadingState />}
          {fileError && !fileLoading && (
            <TabViewerErrorState
              message={
                fileError instanceof Error
                  ? fileError.message
                  : String(fileError)
              }
            />
          )}
          {renderError && !fileLoading && !fileError && (
            <TabViewerErrorState message={renderError.message} />
          )}
          {fileBytes && !fileError && (
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
    </section>
  );
}

// Reads score from context — must be inside <AlphaTab.Root>.
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
