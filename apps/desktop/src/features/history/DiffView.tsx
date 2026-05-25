import { useState, useMemo, Suspense, lazy } from 'react';
import { ArrowLeftRight, X, GitCommitHorizontal, ChevronDown } from 'lucide-react';
import type { Commit } from '@gpt/gpt-core';
import { darkTheme } from '@gpt/alphatab-react';
import { useShow } from '@/hooks/useGpt';
import { useDiffScores } from '@/hooks/useDiffScores';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const TabDiffLazy = lazy(() =>
  import('@gpt/alphatab-react').then((m) => ({ default: m.TabDiff })),
);

// ─── DiffView ─────────────────────────────────────────────────────────────────

interface DiffViewProps {
  repoPath: string;
  baseCommit: Commit;
  headCommit: Commit;
  onClose: () => void;
}

export function DiffView({ repoPath, baseCommit, headCommit, onClose }: DiffViewProps) {
  const { data: baseShow } = useShow(repoPath, baseCommit.hash);
  const { data: headShow } = useShow(repoPath, headCommit.hash);

  const commonFiles = useMemo(() => {
    if (!baseShow || !headShow) return [];
    const baseSet = new Set(baseShow.files.map((f) => f.file));
    return headShow.files.filter((f) => baseSet.has(f.file)).map((f) => f.file);
  }, [baseShow, headShow]);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const activeFile = selectedFile ?? commonFiles[0] ?? null;

  const { diff, baseBytes, headBytes, isLoading } = useDiffScores(
    repoPath,
    baseCommit.hash,
    headCommit.hash,
    activeFile,
  );

  const [trackIndex, setTrackIndex] = useState(0);

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
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col border-b border-border">
        {/* Top strip: labels + close */}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div aria-hidden className="h-4 w-0.5 shrink-0 bg-diff-changed" />
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
            Diff
          </span>

          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <CommitPill commit={baseCommit} role="base" />
            <ArrowLeftRight className="size-3 shrink-0 text-muted-foreground/40" strokeWidth={1.5} />
            <CommitPill commit={headCommit} role="head" />
          </div>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close diff view"
          >
            <X className="size-3.5" />
          </Button>
        </div>

        {/* File + track selectors */}
        {(commonFiles.length > 1 || (diff && diff.tracks.length > 1)) && (
          <div className="flex items-center gap-2 border-t border-border/40 px-4 py-1.5">
            {commonFiles.length > 1 && (
              <FileSelector
                files={commonFiles}
                active={activeFile}
                onSelect={(f) => { setSelectedFile(f); setTrackIndex(0); }}
              />
            )}
            {diff && diff.tracks.length > 1 && (
              <TrackSelector
                tracks={diff.tracks.map((t) => t.trackName)}
                active={trackIndex}
                onSelect={setTrackIndex}
              />
            )}
          </div>
        )}
      </header>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      {isLoading && <DiffLoadingState />}

      {!isLoading && !activeFile && (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-[12px] text-muted-foreground/40">No common files</span>
        </div>
      )}

      {!isLoading && activeFile && !diff && (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-[12px] text-muted-foreground/40">Could not compute diff</span>
        </div>
      )}

      {!isLoading && diff && baseBytes && headBytes && (
        <Suspense fallback={<DiffLoadingState />}>
          <TabDiffLazy
            base={baseBytes}
            head={headBytes}
            diff={diff}
            trackIndex={trackIndex}
            settings={paneSettings}
            baseLabel={`${baseCommit.shortHash}`}
            headLabel={`${headCommit.shortHash}`}
            style={{ flex: 1, minHeight: 0 }}
          />
        </Suspense>
      )}
    </article>
  );
}

// ─── CommitPill ───────────────────────────────────────────────────────────────

function CommitPill({ commit, role }: { commit: Commit; role: 'base' | 'head' }) {
  const accentColor =
    role === 'base'
      ? 'text-diff-removed'
      : 'text-diff-added';

  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      <GitCommitHorizontal
        className={cn('size-3 shrink-0', accentColor)}
        strokeWidth={1.5}
      />
      <span className={cn('font-mono text-[11px] shrink-0 tabular-nums', accentColor)}>
        {commit.shortHash}
      </span>
      <span className="min-w-0 truncate text-[12px] text-muted-foreground/70">
        {commit.message.split('\n')[0] || '(no message)'}
      </span>
    </div>
  );
}

// ─── FileSelector ─────────────────────────────────────────────────────────────

function FileSelector({
  files,
  active,
  onSelect,
}: {
  files: string[];
  active: string | null;
  onSelect: (f: string) => void;
}) {
  const label = active?.split('/').pop() ?? 'Select file';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] font-mono text-muted-foreground/70 hover:bg-accent hover:text-foreground transition-colors duration-100"
          />
        }
      >
        {label}
        <ChevronDown className="size-3 opacity-60" strokeWidth={1.5} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {files.map((f) => (
          <DropdownMenuItem
            key={f}
            onClick={() => onSelect(f)}
            className={cn('font-mono text-[11px]', active === f && 'text-primary')}
          >
            {f}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── TrackSelector ────────────────────────────────────────────────────────────

function TrackSelector({
  tracks,
  active,
  onSelect,
}: {
  tracks: string[];
  active: number;
  onSelect: (i: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] font-mono text-muted-foreground/70 hover:bg-accent hover:text-foreground transition-colors duration-100"
          />
        }
      >
        {tracks[active] ?? 'Track'}
        <ChevronDown className="size-3 opacity-60" strokeWidth={1.5} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {tracks.map((name, i) => (
          <DropdownMenuItem
            key={i}
            onClick={() => onSelect(i)}
            className={cn('font-mono text-[11px]', active === i && 'text-primary')}
          >
            {name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Loading state ────────────────────────────────────────────────────────────

function DiffLoadingState() {
  return (
    <div className="flex flex-1 gap-px overflow-hidden">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-1 flex-col gap-4 p-8">
          {[80, 95, 70, 88].map((w) => (
            <div key={w} className="flex flex-col gap-2">
              <Skeleton className="h-1.5 w-12" />
              <Skeleton className="h-10" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
