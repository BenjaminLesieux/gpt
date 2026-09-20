import { Link, createRoute, redirect } from '@tanstack/react-router';
import { AuthForm } from '@/components/auth-form';
import { Wordmark } from '@/components/wordmark';
import { accountQuery, useLogin, useSignup } from '@/lib/queries';
import { rootRoute, type RouterContext } from './root';

/** Someone already signed in has no business on these two screens. */
async function redirectIfSignedIn({
  context,
  search,
}: {
  context: RouterContext;
  search: { invite?: string };
}) {
  try {
    await context.queryClient.ensureQueryData(accountQuery);
  } catch {
    return;
  }
  // Still holding an invite: it is the reason they are here, and the score
  // list has nothing to say about it.
  throw redirect(
    search.invite ? { to: '/join/$code', params: { code: search.invite } } : { to: '/' }
  );
}

/**
 * The centred card these two screens are. Exported because the accept screen
 * is the third of them: it is the page somebody lands on holding a link, with
 * one thing to read and one thing to press, and it sends them here.
 */
export function AuthLayout({
  title,
  blurb,
  children,
  footer,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-[360px] flex-col gap-8">
        <Wordmark className="text-xl" />
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-medium leading-tight tracking-tight">{title}</h1>
          {blurb && <p className="text-base leading-normal text-muted-foreground">{blurb}</p>}
        </div>
        {children}
        <p className="border-t border-border-subtle pt-4 text-sm text-muted-foreground">
          {footer}
        </p>
      </div>
    </main>
  );
}

const linkClass =
  'border-b border-border-strong text-foreground transition-colors hover:text-brand-bright';

/**
 * The invite somebody was holding when they were sent here to sign in.
 *
 * A code and not a return URL: it is fed straight back into a typed route, so
 * there is no string from the address bar that can be navigated to and no
 * open redirect to get wrong.
 */
function inviteSearch(search: Record<string, unknown>): { invite?: string } {
  return typeof search.invite === 'string' ? { invite: search.invite } : {};
}

function LoginPage() {
  const login = useLogin();
  const navigate = loginRoute.useNavigate();
  const { invite } = loginRoute.useSearch();

  return (
    <AuthLayout
      title="Log in"
      footer={
        <>
          No account yet?{' '}
          <Link to="/signup" search={{ invite }} className={linkClass}>
            Sign up
          </Link>
        </>
      }
    >
      <AuthForm
        mode="login"
        submitting={login.isPending}
        error={login.error}
        onSubmit={async (values) => {
          await login.mutateAsync(values);
          // Back to the link they were holding. Landing on the score list
          // instead leaves them signed in and none the wiser about the
          // invite, which is where an invite quietly dies.
          await (invite
            ? navigate({ to: '/join/$code', params: { code: invite } })
            : navigate({ to: '/' }));
        }}
      />
    </AuthLayout>
  );
}

function SignupPage() {
  const signup = useSignup();
  const navigate = signupRoute.useNavigate();
  const { invite } = signupRoute.useSearch();

  return (
    <AuthLayout
      title="Create your account"
      blurb="Somewhere for your versions to live, so the work you did tonight is still there tomorrow."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" search={{ invite }} className={linkClass}>
            Log in
          </Link>
        </>
      }
    >
      <AuthForm
        mode="signup"
        submitting={signup.isPending}
        error={signup.error}
        onSubmit={async (values) => {
          await signup.mutateAsync(values);
          await (invite
            ? navigate({ to: '/join/$code', params: { code: invite } })
            : navigate({ to: '/' }));
        }}
      />
    </AuthLayout>
  );
}

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: inviteSearch,
  beforeLoad: redirectIfSignedIn,
  component: LoginPage,
});

export const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  validateSearch: inviteSearch,
  beforeLoad: redirectIfSignedIn,
  component: SignupPage,
});
