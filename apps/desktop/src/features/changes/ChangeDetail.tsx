import { Suspense, lazy, useMemo, useState } from 'react';
import { GitCompare, Music } from 'lucide-react';
import { darkTheme } from '@gpt/alphatab-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TabViewerLoadingState } from '@/components/tab-viewer/TabViewerLoadingState';
import { TabViewerErrorState } from '@/components/tab-viewer/TabViewerErrorState';
import type { FileStatus } from '@/features/status/StatusFileRow';
import { NotationViewer } from './NotationViewer';
import { useChangeDetail, type ChangeViewMode } from './useChangeDetail';

const TabDiffLazy = lazy(() =>
  import('@gpt/alphatab-react').then((m) => ({ default: m.TabDiff })),
);

interface ChangeDetailProps {
  repoPath: string;
  file: string;
  status: FileStatus;
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

// ─── ChangeDetail ───────────────────────────────────────────────────────────
//
// The right-hand detail pane for a selected uncommitted change. Owns the
// header (file name, version label, mode toggle) and renders one of two
// explicit variants:
//   • diff      — semantic HEAD→working-tree diff (modified files only)
//   • notation  — full alphaTab rendering of the relevant version
//
// Mode availability comes from useChangeDetail; the toggle only appears when
// more than one mode is possible. Callers should key this component by `file`
// so mode state resets when the selection changes.

export function ChangeDetail({ repoPath, file, status }: ChangeDetailProps) {
  const { headBytes, workBytes, diff, availableModes, isLoading, error } = useChangeDetail(
    repoPath,
    file,
    status,
  );

  const [mode, setMode] = useState<ChangeViewMode>(availableModes[0]);
  const activeMode = availableModes.includes(mode) ? mode : availableModes[0];

  const versionLabel =
    status === 'deleted' ? 'HEAD' : status === 'modified' ? 'Working tree' : 'New file';

  const paneSettings = useMemo(
    () => ({
      ...darkTheme,
      core: { engine: 'svg' as const, logLevel: 'error' as const },
      player: { enablePlayer: false },
    }),
    [],
  );

  return (
    <article className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <div aria-hidden className="h-4 w-0.5 shrink-0 bg-primary" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {basename(file)}
        </span>

        {status === 'deleted' && (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-destructive">
            deleted
          </span>
        )}

        {availableModes.length > 1 && (
          <ToggleGroup
            value={[activeMode]}
            onValueChange={(vals) => {
              const next = vals[0] as ChangeViewMode | undefined;
              if (next) setMode(next);
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="diff" aria-label="Show semantic diff" className="gap-1.5">
              <GitCompare className="size-3.5" strokeWidth={1.5} />
              Diff
            </ToggleGroupItem>
            <ToggleGroupItem value="notation" aria-label="Show notation" className="gap-1.5">
              <Music className="size-3.5" strokeWidth={1.5} />
              Notation
            </ToggleGroupItem>
          </ToggleGroup>
        )}

        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/60">
          {versionLabel}
        </span>
      </header>

      {isLoading ? (
        <TabViewerLoadingState />
      ) : error ? (
        <TabViewerErrorState message={error.message} />
      ) : activeMode === 'diff' && diff && headBytes && workBytes ? (
        <Suspense fallback={<TabViewerLoadingState />}>
          <TabDiffLazy
            base={headBytes}
            head={workBytes}
            diff={diff}
            settings={paneSettings}
            baseLabel="HEAD"
            headLabel="Working tree"
            style={{ flex: 1, minHeight: 0 }}
          />
        </Suspense>
      ) : (
        <NotationViewer
          key={`${file}:${status === 'deleted' ? 'head' : 'work'}`}
          fileBytes={status === 'deleted' ? headBytes : workBytes}
        />
      )}
    </article>
  );
}
