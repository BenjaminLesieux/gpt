import type { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { authedRoute } from './routes/authed';
import { loginRoute, signupRoute } from './routes/auth';
import { credentialsRoute } from './routes/credentials';
import { rootRoute } from './routes/root';
import { scoresRoute } from './routes/scores';

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  authedRoute.addChildren([scoresRoute, credentialsRoute]),
]);

export function createHubRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createHubRouter>;
  }
}
