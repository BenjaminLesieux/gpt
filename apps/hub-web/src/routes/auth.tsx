import { Link, createRoute, redirect } from '@tanstack/react-router';
import { AuthForm } from '@/components/auth-form';
import { Wordmark } from '@/components/wordmark';
import { accountQuery, useLogin, useSignup } from '@/lib/queries';
import { rootRoute, type RouterContext } from './root';

/** Someone already signed in has no business on these two screens. */
async function redirectIfSignedIn({ context }: { context: RouterContext }) {
  try {
    await context.queryClient.ensureQueryData(accountQuery);
  } catch {
    return;
  }
  throw redirect({ to: '/' });
}

function AuthLayout({
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

function LoginPage() {
  const login = useLogin();
  const navigate = loginRoute.useNavigate();

  return (
    <AuthLayout
      title="Log in"
      footer={
        <>
          No account yet?{' '}
          <Link to="/signup" className={linkClass}>
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
          await navigate({ to: '/' });
        }}
      />
    </AuthLayout>
  );
}

function SignupPage() {
  const signup = useSignup();
  const navigate = signupRoute.useNavigate();

  return (
    <AuthLayout
      title="Create your account"
      blurb="Somewhere for your versions to live, so the work you did tonight is still there tomorrow."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className={linkClass}>
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
          await navigate({ to: '/' });
        }}
      />
    </AuthLayout>
  );
}

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: redirectIfSignedIn,
  component: LoginPage,
});

export const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  beforeLoad: redirectIfSignedIn,
  component: SignupPage,
});
