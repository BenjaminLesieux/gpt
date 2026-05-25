import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import {
  History,
  FileText,
  GitCompare,
  GitMerge,
  Settings,
  Folder,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/store';
import { BranchSwitcher } from '@/components/chrome/BranchSwitcher';
import { useMergeStatus, keys } from '@/hooks/useGpt';
import { useFileWatcher } from '@/hooks/useFileWatcher';
import { gptClient, type StatusResult } from '@/api/client';
import { QuickCommitSheet } from '@/components/QuickCommitSheet';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  useSidebar,
} from '@/components/ui/sidebar';

// ─── Branch section ───────────────────────────────────────────────────────────
// Needs useSidebar so must live inside SidebarProvider

function RepoBranchSection({ repoPath }: { repoPath: string }) {
  const { state } = useSidebar();
  if (state === 'collapsed') return null;
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/40">
        Repository
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <Folder className="size-3 shrink-0 text-muted-foreground/60" strokeWidth={1.5} />
        <span
          className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
          title={repoPath}
        >
          {repoPath}
        </span>
      </div>
      <BranchSwitcher repoPath={repoPath} />
    </div>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export function RepoShell() {
  const repoPath = useAppStore((s) => s.repoPath)!;

  useFileWatcher(repoPath);

  const { data: mergeStatus } = useMergeStatus(repoPath);
  const mergeUnresolved = mergeStatus?.active ? mergeStatus.unresolved : 0;

  // Subscribe only to the derived dirty count — avoids re-renders when other
  // status fields change (rerender-derived-state rule).
  const { data: dirtyCount = 0 } = useQuery({
    queryKey: keys.status(repoPath),
    queryFn: () => gptClient.status(repoPath),
    enabled: !!repoPath,
    select: (s: StatusResult) => s.staged.length + s.unstaged.length + s.untracked.length,
  });

  const { location } = useRouterState();
  const path = location.pathname;

  return (
    <SidebarProvider
      className="h-full min-h-0"
      style={
        {
          '--sidebar-width': '220px',
          '--sidebar-width-icon': '3rem',
          '--sidebar-top': '2rem',
        } as React.CSSProperties
      }
    >
      <Sidebar collapsible="icon" variant="sidebar">
        {/* ── Header ── */}
        <SidebarHeader className="gap-0 p-0">
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-3">
            <span className="font-mono text-[18px] font-bold tracking-[-0.04em] text-foreground group-data-[collapsible=icon]:hidden">
              gp<span className="text-primary">t</span>
            </span>
            <SidebarTrigger className="text-muted-foreground/50 hover:text-muted-foreground" />
          </div>

          <RepoBranchSection repoPath={repoPath} />
        </SidebarHeader>

        {/* ── Nav ── */}
        <SidebarContent className="pt-2">
          <SidebarGroup className="gap-0 p-0">
            <SidebarGroupLabel className="px-4 pb-1 pt-3 font-sans text-[10px] uppercase tracking-[0.1em] text-muted-foreground/40">
              Views
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0 px-2">

                {/* History */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="History"
                    isActive={path === '/repo/history'}
                    render={<Link to="/repo/history" />}
                    className="relative rounded-sm py-2.5"
                  >
                    {path === '/repo/history' && (
                      <span className="absolute bottom-0 left-0 top-0 w-0.5 rounded-sm bg-primary" />
                    )}
                    <History strokeWidth={1.5} />
                    <span>History</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* Status */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={dirtyCount > 0 ? `Status — ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}` : 'Status'}
                    isActive={path === '/repo/status'}
                    render={<Link to="/repo/status" />}
                    className="relative rounded-sm py-2.5"
                  >
                    {path === '/repo/status' && (
                      <span className="absolute bottom-0 left-0 top-0 w-0.5 rounded-sm bg-primary" />
                    )}
                    {/* Icon — carries a dot overlay when sidebar is collapsed */}
                    <span className="relative">
                      <FileText strokeWidth={1.5} />
                      {dirtyCount > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 hidden size-1.5 rounded-full bg-primary group-data-[collapsible=icon]:block" />
                      )}
                    </span>
                    <span className="flex-1">Status</span>
                    {dirtyCount > 0 && (
                      <span className="rounded-sm border border-primary/40 bg-brand-dim px-1 font-mono text-[9px] font-bold text-primary group-data-[collapsible=icon]:hidden">
                        {dirtyCount}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* Diff */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Diff"
                    isActive={path === '/repo/diff'}
                    render={<Link to="/repo/diff" />}
                    className="relative rounded-sm py-2.5"
                  >
                    {path === '/repo/diff' && (
                      <span className="absolute bottom-0 left-0 top-0 w-0.5 rounded-sm bg-primary" />
                    )}
                    <GitCompare strokeWidth={1.5} />
                    <span>Diff</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* Merge */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={
                      mergeUnresolved > 0
                        ? `Merge — ${mergeUnresolved} conflict${mergeUnresolved === 1 ? '' : 's'}`
                        : 'Merge'
                    }
                    isActive={path === '/repo/merge'}
                    render={<Link to="/repo/merge" />}
                    className="relative rounded-sm py-2.5"
                  >
                    {path === '/repo/merge' && (
                      <span className="absolute bottom-0 left-0 top-0 w-0.5 rounded-sm bg-primary" />
                    )}
                    <GitMerge strokeWidth={1.5} />
                    <span className="flex-1">Merge</span>
                    {mergeUnresolved > 0 && (
                      <span className="rounded-sm border border-diff-changed/40 bg-diff-changed-bg px-1 font-mono text-[9px] font-bold text-diff-changed group-data-[collapsible=icon]:hidden">
                        {mergeUnresolved}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>

              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* ── Footer ── */}
        <SidebarFooter className="p-0">
          <div className="flex items-center justify-between border-t border-border px-3 py-3">
            <span className="font-mono text-[11px] text-muted-foreground/40 group-data-[collapsible=icon]:hidden">
              v0.1.0
            </span>
            <button
              type="button"
              aria-label="Settings"
              className="rounded-sm p-1 text-muted-foreground/40 transition-colors duration-100 hover:text-muted-foreground"
            >
              <Settings className="size-4" strokeWidth={1.5} />
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>

      {/* ── Main ── */}
      <SidebarInset className="min-w-0 p-0">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </SidebarInset>

      <QuickCommitSheet repoPath={repoPath} />
    </SidebarProvider>
  );
}
