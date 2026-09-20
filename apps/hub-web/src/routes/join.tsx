import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
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
  const { code } = joinRoute.useParams();
  const invite = useQuery(inviteQuery(code));
  const account = useQuery(accountQuery);
  const accept = useAcceptInvite();
  const navigate = joinRoute.useNavigate();

  // The session matters as much as the invite here: resolving one before the
  // other would show *create an account* to somebody who has one.
  if (invite.isPending || account.isPending) {
    return (
      <AuthLayout title="Checking this link" footer={<span>One moment.</span>}>
        <Skeleton className="h-9 rounded-sm" />
      </AuthLayout>
    );
  }

  if (invite.isError) {
    // The hub already writes these for a musician to read — *that invite has
    // expired, ask for a new link* — so they are shown rather than re-worded.
    return (
      <AuthLayout
        title="This link doesn’t work"
        blurb={
          invite.error instanceof HubError
            ? invite.error.message
            : 'That link does not name anything. Ask for a new one.'
        }
        footer="Ask whoever shared the score to send you a new one."
      >
        <Button variant="secondary" className="h-9 rounded-sm" render={<Link to="/" />}>
          Go to your scores
        </Button>
      </AuthLayout>
    );
  }

  const signedIn = account.isSuccess;

  return (
    <AuthLayout
      title={`Join “${invite.data.scoreName}”`}
      blurb={`${invite.data.invitedBy} invited you. You’ll be able to open the score, read every version of it and save your own.`}
      footer={
        signedIn ? (
          <>
            Signed in as {account.data.email}.{' '}
            <Link to="/" className={LINK}>
              Your scores
            </Link>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <Link to="/login" search={{ invite: code }} className={LINK}>
              Log in
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
            : 'Could not join this score. Try again.'}
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
          {accept.isPending ? 'Joining…' : 'Join this score'}
        </Button>
      ) : (
        // Not a bare link to /signup: the code travels with them, because an
        // invite they have to find again after signing up is one they won't.
        <Button
          className="h-9 rounded-sm"
          render={<Link to="/signup" search={{ invite: code }} />}
        >
          Create an account to join
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
