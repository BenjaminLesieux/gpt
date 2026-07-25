import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Folder, FileDiff, History } from 'lucide-react';
import { useAppStore } from '@/store';
import { BranchSwitcher } from '@/components/chrome/BranchSwitcher';
import { MergeDialog } from '@/components/chrome/MergeDialog';
import { QuickCommitSheet } from '@/components/QuickCommitSheet';
import { useFileWatcher } from '@/hooks/useFileWatcher';
import { useMergeStatus, keys } from '@/hooks/useGpt';
import { gptClient, type StatusResult } from '@/api/client';
import { cn } from '@/lib/utils';

// ─── RepoShell ──────────────────────────────────────────────────────────────
//
// GitHub Desktop–style shell: a top toolbar (repository + branch + merge) and
// two tabs — Changes and History. Each tab is a master-detail surface; the
// shell itself only owns the toolbar and tab navigation.

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

export function RepoShell() {
  const repoPath = useAppStore((s) => s.repoPath)!;

  useFileWatcher(repoPath);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <RepoToolbar repoPath={repoPath} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
      <QuickCommitSheet repoPath={repoPath} />
    </div>
  );
}

// ─── Toolbar ────────────────────────────────────────────────────────────────

function RepoToolbar({ repoPath }: { repoPath: string }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-3 py-2">
      <div className="flex min-w-0 items-center gap-1.5" title={repoPath}>
        <Folder className="size-3.5 shrink-0 text-muted-foreground/60" strokeWidth={1.5} />
        <span className="max-w-[160px] truncate font-mono text-[12px] text-foreground">
          {basename(repoPath)}
        </span>
      </div>

      <div className="h-4 w-px shrink-0 bg-border" aria-hidden />

      <BranchSwitcher
        repoPath={repoPath}
        triggerClassName="flex max-w-[200px] items-center gap-1.5 rounded-sm border border-border bg-secondary px-2 py-1.5 text-[12px] text-foreground transition-colors duration-100 hover:bg-accent"
      />

      <MergeDialog repoPath={repoPath} />

      <div className="ml-auto">
        <RepoTabs repoPath={repoPath} />
      </div>
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

function RepoTabs({ repoPath }: { repoPath: string }) {
  const { location } = useRouterState();
  const path = location.pathname;

  const { data: mergeStatus } = useMergeStatus(repoPath);
  const mergeUnresolved = mergeStatus?.active ? mergeStatus.unresolved : 0;

  // Subscribe only to the derived dirty count — avoids re-renders when other
  // status fields change.
  const { data: dirtyCount = 0 } = useQuery({
    queryKey: keys.status(repoPath),
    queryFn: () => gptClient.status(repoPath),
    enabled: !!repoPath,
    select: (s: StatusResult) => s.staged.length + s.unstaged.length + s.untracked.length,
  });

  return (
    <nav className="flex items-center gap-1 rounded-md border border-border bg-secondary p-0.5">
      <TabLink
        to="/repo/changes"
        active={path === '/repo/changes'}
        icon={<FileDiff className="size-3.5" strokeWidth={1.5} />}
        label="Changes"
        badge={mergeUnresolved > 0 ? '!' : dirtyCount > 0 ? String(dirtyCount) : null}
        badgeTone={mergeUnresolved > 0 ? 'alert' : 'default'}
      />
      <TabLink
        to="/repo/history"
        active={path === '/repo/history'}
        icon={<History className="size-3.5" strokeWidth={1.5} />}
        label="History"
      />
    </nav>
  );
}

function TabLink({
  to,
  active,
  icon,
  label,
  badge,
  badgeTone = 'default',
}: {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: string | null;
  badgeTone?: 'default' | 'alert';
}) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-1.5 rounded-sm px-3 py-1 text-[12px] font-medium transition-colors duration-100',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
      {badge && (
        <span
          className={cn(
            'rounded-sm px-1 font-mono text-[9px] font-bold',
            badgeTone === 'alert'
              ? 'border border-diff-changed/40 bg-diff-changed-bg text-diff-changed'
              : 'border border-primary/40 bg-brand-dim text-primary',
          )}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
