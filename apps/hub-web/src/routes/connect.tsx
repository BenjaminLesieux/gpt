import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@gpt/ui/button';
import { HubError } from '@/lib/api';
import { connectSearch, isConnectable, openCloneLink, signedInLink } from '@/lib/clone-link';
import { accountQuery, useCompanionCode } from '@/lib/queries';
import { AuthLayout } from './auth';
import { rootRoute } from './root';

/**
 * Where the companion sends the browser to sign in. See
 * `docs/companion-sign-in.md`: the code minted here is useless without the
 * verifier the companion kept, and `state` goes back exactly as it came.
 */
function ConnectPage() {
  const { t } = useTranslation();
  const search = connectRoute.useSearch();
  const account = useQuery(accountQuery);
  const code = useCompanionCode();
  const [sent, setSent] = useState(false);

  if (!isConnectable(search)) {
    return (
      <AuthLayout
        title={t('connect.broken.title')}
        blurb={t('connect.broken.blurb')}
        footer={t('connect.broken.footer')}
      >
        <Button
          variant="secondary"
          className="h-9 rounded-sm"
          nativeButton={false}
          render={<Link to="/" />}
        >
          {t('join.broken.goToScores')}
        </Button>
      </AuthLayout>
    );
  }

  if (sent) {
    return (
      <AuthLayout
        title={t('connect.sent.title')}
        blurb={t('connect.sent.blurb')}
        footer={t('join.signedInAs', { email: account.data?.email })}
      />
    );
  }

  const device = search.device?.trim() || t('connect.thisComputer');

  return (
    <AuthLayout
      title={t('connect.title', { device })}
      blurb={t('connect.blurb')}
      footer={t('join.signedInAs', { email: account.data?.email })}
    >
      {code.error != null && (
        <p
          role="alert"
          className="rounded-sm border border-destructive bg-card px-3 py-2.5 text-sm leading-normal text-foreground"
        >
          {code.error instanceof HubError ? code.error.message : t('connect.failed')}
        </p>
      )}
      <Button
        className="h-9 rounded-sm"
        disabled={code.isPending}
        onClick={() =>
          code.mutate(search.challenge, {
            onSuccess: (issued) => {
              openCloneLink(signedInLink(window.location.origin, issued.code, search.state));
              setSent(true);
            },
          })
        }
      >
        {code.isPending ? t('connect.connecting') : t('connect.connect')}
      </Button>
    </AuthLayout>
  );
}

export const connectRoute = createRoute({
  getParentRoute: () => rootRoute,
  // Not under `/companion/`: that prefix is the API, and this is a page.
  path: '/connect',
  validateSearch: connectSearch,
  beforeLoad: async ({ context, search }) => {
    // A broken link is said so without making anyone sign in first.
    if (!isConnectable(search)) return;
    try {
      await context.queryClient.ensureQueryData(accountQuery);
    } catch {
      throw redirect({ to: '/login', search: { connect: search } });
    }
  },
  component: ConnectPage,
});
