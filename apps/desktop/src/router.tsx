import {
  createRouter,
  createRoute,
  createRootRoute,
  createMemoryHistory,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { TitleBar } from '@/components/chrome/TitleBar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { OpenRepoView } from '@/views/OpenRepoView';
import { RepoShell } from '@/views/RepoShell';
import { HistoryView } from '@/views/HistoryView';
import { StatusView } from '@/views/StatusView';
import { MergeView } from '@/views/MergeView';
import { useAppStore } from '@/store';

function ViewPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/40">
        {label}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground/30">coming soon</span>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: () => (
    <TooltipProvider delay={150}>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <TitleBar />
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
        <Toaster />
      </div>
    </TooltipProvider>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: OpenRepoView,
});

const repoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/repo',
  beforeLoad: () => {
    if (!useAppStore.getState().repoPath) {
      throw redirect({ to: '/' });
    }
  },
  component: RepoShell,
});

const repoIndexRoute = createRoute({
  getParentRoute: () => repoRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/repo/status' });
  },
});

const historyRoute = createRoute({
  getParentRoute: () => repoRoute,
  path: '/history',
  component: HistoryView,
});

const statusRoute = createRoute({
  getParentRoute: () => repoRoute,
  path: '/status',
  component: StatusView,
});

const diffRoute = createRoute({
  getParentRoute: () => repoRoute,
  path: '/diff',
  component: () => <ViewPlaceholder label="Diff" />,
});

const mergeRoute = createRoute({
  getParentRoute: () => repoRoute,
  path: '/merge',
  component: MergeView,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  repoRoute.addChildren([repoIndexRoute, historyRoute, statusRoute, diffRoute, mergeRoute]),
]);

const memoryHistory = createMemoryHistory({ initialEntries: ['/'] });

export const router = createRouter({ routeTree, history: memoryHistory });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
