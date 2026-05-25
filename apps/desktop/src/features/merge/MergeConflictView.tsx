import { useState, useCallback } from 'react';
import {
  GitMerge,
  Check,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useResolveConflict,
  useFinalizeMerge,
  useAbortMerge,
} from '@/hooks/useGpt';
import { humanPath } from './conflictPath';
import type { ConflictSidecar, FileConflictState } from '@/api/client';
import type { SidecarConflict } from '@gpt/gpt-core';

// ─── Props ────────────────────────────────────────────────────────────────────

interface MergeConflictViewProps {
  repoPath: string;
  sidecar: ConflictSidecar;
  unresolved: number;
  onAborted: () => void;
  onFinalized: (commitHash: string) => void;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function MergeConflictView({
  repoPath,
  sidecar,
  unresolved,
  onAborted,
  onFinalized,
}: MergeConflictViewProps) {
  const [selectedFile, setSelectedFile] = useState<string>(sidecar.files[0]?.path ?? '');
  const [commitMsg, setCommitMsg] = useState('');

  const resolve = useResolveConflict(repoPath);
  const finalize = useFinalizeMerge(repoPath);
  const abort = useAbortMerge(repoPath);

  const total = sidecar.files.reduce((n, f) => n + f.conflictCount, 0);
  const resolved = total - unresolved;
  const allDone = unresolved === 0;
  const pct = total > 0 ? Math.round((resolved / total) * 100) : 0;

  const handleResolve = useCallback(
    async (file: string, path: string, resolution: 'ours' | 'theirs') => {
      try {
        await resolve.mutateAsync({ file, path, resolution });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save resolution');
      }
    },
    [resolve],
  );

  const handleAcceptAll = useCallback(
    async (side: 'ours' | 'theirs') => {
      const activeFile = sidecar.files.find((f) => f.path === selectedFile);
      if (!activeFile) return;
      const pending = activeFile.conflicts.filter((c) => !activeFile.resolutions[c.path]);
      await Promise.all(pending.map((c) => handleResolve(activeFile.path, c.path, side)));
    },
    [sidecar.files, selectedFile, handleResolve],
  );

  const handleFinalize = async () => {
    try {
      const result = await finalize.mutateAsync(
        commitMsg.trim() || `Merge branch '${sidecar.theirsRef}'`,
      );
      toast.success(`Merged → ${result.shortHash}`);
      onFinalized(result.commitHash);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Finalize failed');
    }
  };

  const handleAbort = async () => {
    try {
      await abort.mutateAsync();
      toast.info('Merge aborted');
      onAborted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Abort failed');
    }
  };

  const activeFile = sidecar.files.find((f) => f.path === selectedFile) ?? null;

  return (
    <article className="flex h-full min-h-0 flex-col">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col border-b border-border">
        {/* Branch strip */}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div aria-hidden className="h-4 w-0.5 shrink-0 bg-diff-changed" />
          <GitMerge className="size-3.5 shrink-0 text-muted-foreground/50" strokeWidth={1.5} />
          <div className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[11px]">
            <span className="text-info">{sidecar.oursRef}</span>
            <span className="text-muted-foreground/30">←</span>
            <span className="text-diff-added">{sidecar.theirsRef}</span>
          </div>

          {/* Progress pill */}
          <div className="flex items-center gap-2">
            <div className="h-1 w-20 overflow-hidden rounded-full bg-border">
              <div
                className={cn(
                  'h-full transition-all duration-300',
                  allDone ? 'bg-diff-added' : 'bg-diff-changed',
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span
              className={cn(
                'font-mono text-[11px] tabular-nums',
                allDone ? 'text-diff-added' : 'text-diff-changed',
              )}
            >
              {resolved}/{total}
            </span>
          </div>

          <div aria-hidden className="h-4 w-px bg-border" />

          <button
            type="button"
            onClick={handleAbort}
            disabled={abort.isPending}
            className="flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1 font-sans text-[11px] text-muted-foreground/60 transition-colors duration-100 hover:border-destructive/40 hover:text-destructive disabled:opacity-40"
          >
            <X className="size-3" strokeWidth={1.5} />
            Abort
          </button>

          <Button
            size="sm"
            disabled={!allDone || finalize.isPending}
            onClick={handleFinalize}
            className="h-7 text-[11px]"
          >
            {finalize.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Check className="size-3" strokeWidth={2} />
            )}
            Commit merge
          </Button>
        </div>

        {/* Commit message (only when all done) */}
        {allDone && (
          <div className="border-t border-border/40 px-4 py-2">
            <input
              type="text"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder={`Merge branch '${sidecar.theirsRef}'`}
              className="w-full rounded-sm border border-border bg-transparent px-3 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/30 focus:border-primary/50 focus:outline-none"
            />
          </div>
        )}
      </header>

      {/* ── Body: file rail + conflict list ─────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* File rail */}
        <FileRail
          files={sidecar.files}
          selectedFile={selectedFile}
          onSelect={setSelectedFile}
        />

        {/* Conflict list */}
        <div className="flex min-w-0 flex-1 flex-col">
          {activeFile ? (
            <ConflictList
              file={activeFile}
              oursRef={sidecar.oursRef}
              theirsRef={sidecar.theirsRef}
              onResolve={handleResolve}
              onAcceptAll={handleAcceptAll}
              isPending={resolve.isPending}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <span className="font-mono text-[11px] text-muted-foreground/30">
                Select a file
              </span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

// ─── File rail ────────────────────────────────────────────────────────────────

function FileRail({
  files,
  selectedFile,
  onSelect,
}: {
  files: FileConflictState[];
  selectedFile: string;
  onSelect: (path: string) => void;
}) {
  return (
    <aside className="flex w-[200px] shrink-0 flex-col border-r border-border">
      <div className="border-b border-border/40 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/30">
        Files
      </div>
      <ScrollArea className="flex-1">
        {files.map((f) => {
          const pending = f.conflictCount - Object.keys(f.resolutions).length;
          const done = pending === 0;
          const isActive = f.path === selectedFile;
          return (
            <button
              key={f.path}
              type="button"
              onClick={() => onSelect(f.path)}
              className={cn(
                'relative flex w-full items-start gap-2.5 border-b border-border/20 px-3 py-2.5 text-left transition-colors duration-100',
                isActive ? 'bg-accent' : 'hover:bg-accent/50',
              )}
            >
              {isActive && (
                <div className="absolute bottom-0 left-0 top-0 w-0.5 bg-primary" />
              )}
              <div
                className={cn(
                  'mt-0.5 size-1.5 shrink-0 rounded-full',
                  done ? 'bg-diff-added' : 'bg-diff-changed',
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[11px] text-foreground/80">
                  {f.path.split('/').pop()}
                </div>
                <div
                  className={cn(
                    'font-mono text-[10px]',
                    done ? 'text-diff-added' : 'text-diff-changed',
                  )}
                >
                  {done ? '✓ resolved' : `${pending} remaining`}
                </div>
              </div>
            </button>
          );
        })}
      </ScrollArea>
    </aside>
  );
}

// ─── Conflict list ────────────────────────────────────────────────────────────

function ConflictList({
  file,
  oursRef,
  theirsRef,
  onResolve,
  onAcceptAll,
  isPending,
}: {
  file: FileConflictState;
  oursRef: string;
  theirsRef: string;
  onResolve: (filePath: string, conflictPath: string, res: 'ours' | 'theirs') => void;
  onAcceptAll: (side: 'ours' | 'theirs') => void;
  isPending: boolean;
}) {
  const pendingCount = file.conflicts.filter((c) => !file.resolutions[c.path]).length;
  const allDone = pendingCount === 0;

  return (
    <div className="flex min-h-0 flex-col">
      {/* File header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <span className="font-mono text-[11px] text-foreground/70">{file.path}</span>
        <span
          className={cn(
            'font-mono text-[10px]',
            allDone ? 'text-diff-added' : 'text-muted-foreground/40',
          )}
        >
          {file.conflictCount - pendingCount}/{file.conflictCount}
        </span>

        {!allDone && (
          <>
            <div aria-hidden className="ml-auto h-3.5 w-px bg-border" />
            <button
              type="button"
              onClick={() => onAcceptAll('ours')}
              disabled={isPending}
              className="flex items-center gap-1 rounded-sm border border-info/30 bg-info/10 px-2 py-0.5 font-mono text-[10px] text-info transition-colors duration-100 hover:bg-info/20 disabled:opacity-40"
            >
              ‹‹ All ours
            </button>
            <button
              type="button"
              onClick={() => onAcceptAll('theirs')}
              disabled={isPending}
              className="flex items-center gap-1 rounded-sm border border-diff-added/30 bg-diff-added-bg px-2 py-0.5 font-mono text-[10px] text-diff-added transition-colors duration-100 hover:bg-diff-added/20 disabled:opacity-40"
            >
              All theirs ››
            </button>
          </>
        )}
      </div>

      {/* Rows */}
      <ScrollArea className="flex-1">
        {file.conflicts.map((conflict) => (
          <ConflictRow
            key={conflict.path}
            conflict={conflict}
            resolution={file.resolutions[conflict.path] ?? null}
            filePath={file.path}
            oursRef={oursRef}
            theirsRef={theirsRef}
            onResolve={onResolve}
            isPending={isPending}
          />
        ))}
      </ScrollArea>
    </div>
  );
}

// ─── Single conflict row ──────────────────────────────────────────────────────

function ConflictRow({
  conflict,
  resolution,
  filePath,
  oursRef,
  theirsRef,
  onResolve,
  isPending,
}: {
  conflict: SidecarConflict;
  resolution: 'ours' | 'theirs' | null;
  filePath: string;
  oursRef: string;
  theirsRef: string;
  onResolve: (filePath: string, conflictPath: string, res: 'ours' | 'theirs') => void;
  isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(!resolution);
  const label = humanPath(conflict.path);
  const isResolved = !!resolution;

  return (
    <div
      className={cn(
        'border-b border-border/30 transition-colors duration-150',
        !isResolved && 'border-l-2 border-l-diff-changed',
        resolution === 'ours' && 'border-l-2 border-l-info',
        resolution === 'theirs' && 'border-l-2 border-l-diff-added',
      )}
    >
      {/* Row header — always visible */}
      <div
        className={cn(
          'flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors duration-100',
          expanded ? 'bg-card' : 'hover:bg-accent/30',
        )}
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
      >
        {/* Kind badge */}
        <KindBadge kind={conflict.kind} />

        {/* Path label + description */}
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] text-foreground/80">{label}</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground/40">
            {conflict.description}
          </div>
        </div>

        {/* Resolution status */}
        <div className="flex shrink-0 items-center gap-2">
          {isResolved ? (
            <span
              className={cn(
                'flex items-center gap-1 font-mono text-[10px]',
                resolution === 'ours' ? 'text-info' : 'text-diff-added',
              )}
            >
              <Check className="size-3" strokeWidth={2} />
              {resolution === 'ours' ? oursRef : theirsRef}
            </span>
          ) : (
            <span className="font-mono text-[10px] text-diff-changed">unresolved</span>
          )}
          {expanded ? (
            <ChevronDown className="size-3 text-muted-foreground/40" strokeWidth={1.5} />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground/40" strokeWidth={1.5} />
          )}
        </div>
      </div>

      {/* Expanded resolution panel */}
      {expanded && (
        <div className="border-t border-border/30 bg-card/50 px-4 py-3">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/30">
            Choose a version
          </div>

          {/* Raw conflict path */}
          <div className="mb-4 rounded-sm border border-border/30 bg-background px-2.5 py-1.5">
            <span className="font-mono text-[10px] text-muted-foreground/40">
              {conflict.path}
            </span>
          </div>

          <div className="flex gap-3">
            {/* Accept ours */}
            <VersionButton
              side="ours"
              label={oursRef}
              isSelected={resolution === 'ours'}
              isPending={isPending}
              onClick={() => onResolve(filePath, conflict.path, 'ours')}
            />

            <div className="flex items-center">
              <span className="font-mono text-[11px] text-muted-foreground/30">vs</span>
            </div>

            {/* Accept theirs */}
            <VersionButton
              side="theirs"
              label={theirsRef}
              isSelected={resolution === 'theirs'}
              isPending={isPending}
              onClick={() => onResolve(filePath, conflict.path, 'theirs')}
            />
          </div>

          {isResolved && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mt-3 font-mono text-[10px] text-muted-foreground/40 underline-offset-2 hover:text-muted-foreground/70 hover:underline"
            >
              Collapse
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KindBadge({ kind }: { kind: 'field' | 'structural-note' | 'structural-beat' }) {
  const map = {
    field: { label: 'FIELD', class: 'text-info border-info/30 bg-info/10' },
    'structural-note': {
      label: 'NOTE',
      class: 'text-diff-changed border-diff-changed/30 bg-diff-changed-bg',
    },
    'structural-beat': {
      label: 'BEAT',
      class: 'text-diff-changed border-diff-changed/30 bg-diff-changed-bg',
    },
  } as const;

  const style = map[kind] ?? map.field;
  return (
    <span
      className={cn(
        'mt-px shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.08em]',
        style.class,
      )}
    >
      {style.label}
    </span>
  );
}

function VersionButton({
  side,
  label,
  isSelected,
  isPending,
  onClick,
}: {
  side: 'ours' | 'theirs';
  label: string;
  isSelected: boolean;
  isPending: boolean;
  onClick: () => void;
}) {
  const isOurs = side === 'ours';
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={onClick}
      className={cn(
        'flex flex-1 flex-col gap-2 rounded-sm border p-3 text-left transition-all duration-150',
        isSelected && isOurs && 'border-info/50 bg-info/10',
        isSelected && !isOurs && 'border-diff-added/50 bg-diff-added-bg',
        !isSelected && 'border-border bg-card hover:border-border/80 hover:bg-accent/30',
        'disabled:opacity-50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'font-mono text-[10px] uppercase tracking-[0.08em]',
            isSelected && isOurs && 'text-info',
            isSelected && !isOurs && 'text-diff-added',
            !isSelected && 'text-muted-foreground/50',
          )}
        >
          {isOurs ? '← Ours' : 'Theirs →'}
        </span>
        {isSelected && (
          <Check
            className={cn('size-3', isOurs ? 'text-info' : 'text-diff-added')}
            strokeWidth={2}
          />
        )}
      </div>
      <span
        className={cn(
          'font-mono text-[11px]',
          isSelected && isOurs && 'text-info',
          isSelected && !isOurs && 'text-diff-added',
          !isSelected && 'text-foreground/70',
        )}
      >
        {label}
      </span>
    </button>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

export function MergeConflictSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
        <div className="flex-1" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-[200px] border-r border-border p-3">
          {[1, 2].map((i) => (
            <div key={i} className="mb-3 flex gap-2">
              <Skeleton className="mt-1 size-1.5 rounded-full" />
              <div className="flex-1">
                <Skeleton className="mb-1 h-3 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex-1 p-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="mb-3 flex items-start gap-3 border-b border-border/20 pb-3">
              <Skeleton className="mt-0.5 h-4 w-12 rounded-sm" />
              <div className="flex-1">
                <Skeleton className="mb-1.5 h-3 w-48" />
                <Skeleton className="h-2.5 w-32" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
