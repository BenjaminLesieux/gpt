import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { authedRoute } from './routes/authed';
import { loginRoute, signupRoute } from './routes/auth';
import { connectRoute } from './routes/connect';
import { credentialsRoute } from './routes/credentials';
import { joinRoute } from './routes/join';
import { rootRoute } from './routes/root';
import { scoreRoute } from './routes/score';
import { scoresRoute } from './routes/scores';

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  // Outside the signed-in shell on purpose: somebody holding an invite may
  // not have an account yet, and the screen has to name the score before it
  // asks them for one.
  joinRoute,
  // Outside it too: signed out, it sends people to sign in carrying its query.
  connectRoute,
  authedRoute.addChildren([scoresRoute, scoreRoute, credentialsRoute]),
]);

export function createHubRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPreload: 'intent',
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createHubRouter>;
  }
}
