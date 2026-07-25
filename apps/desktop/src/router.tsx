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
import { ChangesView } from '@/features/changes/ChangesView';
import { useAppStore } from '@/store';

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
    throw redirect({ to: '/repo/changes' });
  },
});

const changesRoute = createRoute({
  getParentRoute: () => repoRoute,
  path: '/changes',
  component: ChangesView,
});

const historyRoute = createRoute({
  getParentRoute: () => repoRoute,
  path: '/history',
  component: HistoryView,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  repoRoute.addChildren([repoIndexRoute, changesRoute, historyRoute]),
]);

const memoryHistory = createMemoryHistory({ initialEntries: ['/'] });

export const router = createRouter({ routeTree, history: memoryHistory });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
