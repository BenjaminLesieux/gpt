import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@gpt/ui/button';
import { Skeleton } from '@gpt/ui/skeleton';
import { HubError } from '@/lib/api';
import { accountQuery, inviteQuery, useAcceptInvite } from '@/lib/queries';
import { AuthLayout } from './auth';
import { rootRoute } from './root';

/**
 * Where an invite link lands.
 *
 * The score is named before anything is agreed to, and the name comes from
 * the hub rather than from the link — a crafted URL can say *Blackbird* and
 * put somebody on something else, and the peek endpoint is what stops it.
 * Peeking consumes nothing, so reloading this page, or closing it, leaves the
 * invite exactly where it was.
 *
 * Accepting needs a session, because it puts an *account* on a score. Someone
 * who has not got one yet is sent to sign up carrying the code, and comes
 * back here — the alternative is the screen that thanks them for signing up
 * and never mentions the invite again.
 */
function JoinPage() {
  const { t } = useTranslation();
  const { code } = joinRoute.useParams();
  const invite = useQuery(inviteQuery(code));
  const account = useQuery(accountQuery);
  const accept = useAcceptInvite();
  const navigate = joinRoute.useNavigate();

  // The session matters as much as the invite here: resolving one before the
  // other would show *create an account* to somebody who has one.
  if (invite.isPending || account.isPending) {
    return (
      <AuthLayout title={t('join.checking')} footer={<span>{t('join.oneMoment')}</span>}>
        <Skeleton className="h-9 rounded-sm" />
      </AuthLayout>
    );
  }

  if (invite.isError) {
    // The hub already writes these for a musician to read — *that invite has
    // expired, ask for a new link* — so they are shown rather than re-worded.
    return (
      <AuthLayout
        title={t('join.broken.title')}
        blurb={
          invite.error instanceof HubError
            ? invite.error.message
            : t('join.broken.unknown')
        }
        footer={t('join.broken.footer')}
      >
        <Button variant="secondary" className="h-9 rounded-sm" render={<Link to="/" />}>
          {t('join.broken.goToScores')}
        </Button>
      </AuthLayout>
    );
  }

  const signedIn = account.isSuccess;

  return (
    <AuthLayout
      title={t('join.title', { score: invite.data.scoreName })}
      blurb={t('join.blurb', { invitedBy: invite.data.invitedBy })}
      footer={
        signedIn ? (
          <>
            {t('join.signedInAs', { email: account.data.email })}{' '}
            <Link to="/" className={LINK}>
              {t('common.yourScores')}
            </Link>
          </>
        ) : (
          <>
            {t('join.haveAccount')}{' '}
            <Link to="/login" search={{ invite: code }} className={LINK}>
              {t('join.logIn')}
            </Link>
          </>
        )
      }
    >
      {accept.error != null && (
        <p
          role="alert"
          className="rounded-sm border border-brand-border bg-brand-dim px-3 py-2.5 text-sm leading-normal text-foreground"
        >
          {accept.error instanceof HubError
            ? accept.error.message
            : t('join.failed')}
        </p>
      )}

      {signedIn ? (
        <Button
          className="h-9 rounded-sm"
          disabled={accept.isPending}
          onClick={async () => {
            const score = await accept.mutateAsync(code);
            await navigate({ to: '/scores/$scoreId', params: { scoreId: score.id } });
          }}
        >
          {accept.isPending ? t('join.joining') : t('join.join')}
        </Button>
      ) : (
        // Not a bare link to /signup: the code travels with them, because an
        // invite they have to find again after signing up is one they won't.
        <Button
          className="h-9 rounded-sm"
          render={<Link to="/signup" search={{ invite: code }} />}
        >
          {t('join.createAccount')}
        </Button>
      )}
    </AuthLayout>
  );
}

const LINK = 'border-b border-border text-foreground transition-colors hover:text-brand-bright';

export const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  // Not `/invites/:code`: the hub answers that prefix with JSON. See
  // `lib/invite-link.ts`.
  path: '/join/$code',
  component: JoinPage,
});
