import { Outlet, createRoute, redirect } from '@tanstack/react-router';
import { TooltipProvider } from '@gpt/ui/tooltip';
import { Header } from '@/components/header';
import { accountQuery, useLogout } from '@/lib/queries';
import { rootRoute, type RouterContext } from './root';

function AuthedLayout() {
  const { account } = authedRoute.useRouteContext();
  const logout = useLogout();
  const navigate = authedRoute.useNavigate();

  return (
    // One provider for the whole signed-in shell, as the companion does in
    // ExtendedApp — nothing below should nest another.
    <TooltipProvider>
      <div className="flex h-dvh flex-col">
        <Header
          email={account.email}
          onLogOut={async () => {
            await logout.mutateAsync();
            await navigate({ to: '/login' });
          }}
        />
        <Outlet />
      </div>
    </TooltipProvider>
  );
}

/**
 * A pathless layout: everything signed-in hangs off it, so the session check
 * and the header are written once. The content region is its Outlet, which
 * is where a left nav would be added without redrawing the header.
 */
export const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: async ({ context }: { context: RouterContext }) => {
    try {
      return { account: await context.queryClient.ensureQueryData(accountQuery) };
    } catch {
      throw redirect({ to: '/login' });
    }
  },
  component: AuthedLayout,
});
