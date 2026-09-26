import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';
import { Badge } from '@gpt/ui/badge';
import { Button } from '@gpt/ui/button';
import { Kbd } from '@gpt/ui/kbd';
import { dateLocale, since } from '@gpt/ui/lib/time';
import {
  HistoryList,
  HistorySkeleton,
  LoadMore,
  type HistoryLabels,
} from '@gpt/ui/score/history';
import { InviteDialog } from '@/components/invite-dialog';
import { MemberAvatars } from '@/components/member-avatars';
import { VersionInspector } from '@/components/version-inspector';
import { HubError, type Branch, type Version } from '@/lib/api';
import { historyQuery, scoreQuery, useCreateInvite } from '@/lib/queries';
import { authedRoute } from './authed';

/**
 * One score, and the thing that makes a history worth having: a way to look
 * at it.
 *
 * The history is the page's body, not a tab inside it. Everything above it —
 * the name, the band, the branches in flight — is context for the list, and
 * the list is what the page is for.
 */

function ScorePage() {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const labels: HistoryLabels = {
    unnamed: t('common.unnamedVersion'),
    current: t('history.current'),
    landed: t('history.landed'),
    reading: t('history.reading'),
    session: ({ part, ...rest }) => t(`history.session.${part}`, rest),
    scope: {
      bars: (count) => t('history.bars', { count }),
      tracks: (count) => t('history.tracks', { count }),
    },
  };
  const { scoreId } = scoreRoute.useParams();
  const score = useQuery(scoreQuery(scoreId));
  const history = useInfiniteQuery(historyQuery(scoreId));

  // Commit ids, newest first, exactly as the list holds them. One is a
  // version; more is a range and its two ends are the first and the last.
  const [selected, setSelected] = useState<string[]>([]);

  // The score being invited to, not a boolean: the dialog names it, and it is
  // what the invite is minted against.
  const [inviting, setInviting] = useState<{ id: string; name: string } | null>(null);
  const invite = useCreateInvite();

  const versions = useMemo(
    () => history.data?.pages.flatMap((page) => page.versions) ?? [],
    [history.data]
  );

  // The first page carries the counts and the refs; later pages only add
  // rows. Memoised off `latest` rather than off a `?? []` fallback, which
  // would be a new array on every render and re-derive the map with it.
  const latest = history.data?.pages[0];
  const head = latest?.head ?? null;
  const total = latest?.total ?? 0;

  const branches = useMemo(() => latest?.branches ?? [], [latest]);

  /** A branch's name, against the version at its tip — the chip in the row. */
  const tips = useMemo(
    () => new Map(branches.filter((branch) => branch.ahead > 0).map((b) => [b.tip, b.name])),
    [branches]
  );

  const chosen = versions.filter((version) => selected.includes(version.id));

  function select(commit: string, extend: boolean) {
    setSelected((current) => {
      if (current.includes(commit) && current.length === 1) return [];
      if (!extend || current.length === 0) return [commit];

      // Shift-click takes the span between the anchor and this row, in the
      // list's own order — which is topological, not chronological.
      const anchor = versions.findIndex((version) => version.id === current[0]);
      const to = versions.findIndex((version) => version.id === commit);
      if (anchor < 0 || to < 0) return [commit];

      const [from, until] = anchor < to ? [anchor, to] : [to, anchor];
      return versions.slice(from, until + 1).map((version) => version.id);
    });
  }

  return (
    <div className="flex min-h-0 flex-1">
      <main className="@container flex min-w-0 flex-1 flex-col">
        <nav className="flex h-10 flex-none items-center gap-3 px-4 text-sm wide:px-6">
          <Link
            to="/"
            className="rounded-sm text-muted-foreground transition-colors duration-100 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            {t('common.yourScores')}
          </Link>
          <span aria-hidden className="text-muted-foreground">
            /
          </span>
          <span className="truncate text-foreground">{score.data?.name ?? '…'}</span>
        </nav>

        <header className="flex flex-none flex-wrap items-start justify-between gap-6 px-4 pt-4 pb-4 wide:px-6">
          <div className="flex min-w-0 flex-col gap-2.5">
            <h1 className="truncate text-2xl leading-tight font-semibold tracking-tight">
              {score.data?.name ?? ' '}
            </h1>
            <p className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {/* The clone URL is monospace because it is read character by
                  character and pasted, not skimmed. Same treatment as the
                  scores list gives it. */}
              <span className="truncate font-mono">{score.data?.url}</span>
              <Rule />
              <span>{t('score.created', { date: created(score.data?.createdAt, locale) })}</span>
              <Rule />
              <span>{state(total, versions, branches, locale, t)}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <MemberAvatars members={score.data?.members ?? []} />
            <Button
              variant="outline"
              size="sm"
              disabled={!score.data}
              onClick={() => score.data && setInviting({ id: scoreId, name: score.data.name })}
              className="h-6.5 rounded-sm border-border bg-card px-2.5 text-sm"
            >
              {t('score.invite')}
              <span className="sr-only">{t('score.inviteFor', { name: score.data?.name })}</span>
            </Button>
          </div>
        </header>

        {branches.length > 0 && <Branches branches={branches} />}

        <div className="flex h-8 flex-none items-center justify-between border-b border-border pr-4 @min-[800px]:pr-6">
          <h2 className="flex items-center text-xs tracking-widest text-muted-foreground uppercase">
            <span aria-hidden className="w-6 flex-none @min-[800px]:w-20" />
            {t('score.history')}
          </h2>
          <p className="font-mono text-xs text-muted-foreground">
            {selected.length > 1
              ? t('score.selectedRange', { count: selected.length })
              : selected.length === 1
                ? t('score.selectedOne')
                : count(total, branches.length, t)}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {history.isPending && <HistorySkeleton labels={labels} />}

          {history.isError && (
            <p
              role="alert"
              className="m-4 border border-brand-border bg-brand-dim px-3 py-2.5 text-sm text-foreground wide:m-6"
            >
              {history.error instanceof HubError
                ? history.error.message
                : t('score.readFailed')}
            </p>
          )}

          {history.isSuccess && versions.length === 0 && <Empty />}

          {versions.length > 0 && (
            <>
              <HistoryList
                versions={versions}
                head={head}
                locale={locale}
                labels={labels}
                tips={tips}
                selected={selected}
                onSelect={select}
              />
              {history.hasNextPage && (
                <LoadMore
                  showing={t('history.showing', { loaded: versions.length, total })}
                  loading={history.isFetchingNextPage}
                  labels={{ loading: t('history.loading'), loadMore: t('history.loadMore') }}
                  onLoad={() => void history.fetchNextPage()}
                />
              )}
            </>
          )}
        </div>
      </main>

      <InviteDialog
        score={inviting}
        onOpenChange={() => {
          setInviting(null);
          // The link is spent as far as this dialog is concerned: reopening
          // mints a new one, and showing the old one meanwhile would be a
          // code the inviter may already have pasted somewhere.
          invite.reset();
        }}
        onInvite={invite.mutateAsync}
        invite={invite.data ?? null}
        minting={invite.isPending}
        error={invite.error}
      />

      {chosen.length > 0 && (
        <VersionInspector
          scoreId={scoreId}
          selected={chosen}
          branchOf={(commit) => tips.get(commit) ?? null}
          onClose={() => setSelected([])}
        />
      )}
    </div>
  );
}

/** A hairline between two facts, not a bullet: the design has no pills. */
function Rule() {
  return <span aria-hidden className="h-3 w-px bg-border" />;
}

/**
 * When the score was made. Absolute rather than relative — this one never
 * changes, and *created 3 months ago* is a worse answer than the date.
 */
function created(iso: string | undefined, locale: string): string {
  if (!iso) return '…';
  const at = new Date(iso);
  const month = at.toLocaleDateString(locale, { month: 'long' });
  return `${at.getDate()} ${month} ${at.getFullYear()}`;
}

/** *Last version 20 minutes ago · No branches in flight* — the page's state. */
function state(
  total: number,
  versions: Version[],
  branches: Branch[],
  locale: string,
  t: TFunction
): string {
  if (total === 0) return t('score.nothingPushed');

  const flight = branches.filter((branch) => branch.ahead > 0).length;
  const last = versions[0]
    ? t('score.lastVersion', { when: since(new Date(versions[0].at), locale) })
    : '';
  const lines =
    flight === 0 ? t('score.noBranchesInFlight') : t('score.branchesInFlight', { count: flight });

  return `${last} · ${lines}`;
}

function count(total: number, branches: number, t: TFunction): string {
  const versions = t('score.versions', { count: total });
  if (branches === 0) return `${versions} · main`;
  return `${versions} · main + ${t('score.branches', { count: branches })}`;
}

/**
 * The branches, said in words above the graph. *Ben is on Bass, Sam is on
 * Drums, these don't overlap* is the whole value of branching, and it has to
 * be readable without tracing two lines in a gutter.
 */
function Branches({ branches }: { branches: Branch[] }) {
  const { t } = useTranslation();
  const flight = branches.filter((branch) => branch.ahead > 0);
  if (flight.length === 0) return null;

  return (
    <section
      aria-label={t('score.branchesLabel')}
      className="flex flex-none flex-col gap-2 px-4 pb-4 wide:px-6"
    >
      <ul className="grid gap-3 wide:grid-cols-2">
        {flight.map((branch) => (
          <li
            key={branch.name}
            className="flex flex-col gap-2 border border-border bg-card px-3.5 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-mono text-sm text-foreground">{branch.name}</span>
              <Badge
                variant="outline"
                className="shrink-0 rounded-sm border-border text-xs font-normal text-muted-foreground"
              >
                {t('score.inFlight')}
              </Badge>
            </div>
            <p className="text-sm leading-normal text-muted-foreground">
              {t('score.ahead', { count: branch.ahead })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The state right after a score is created, where the musician is quietly
 * unsure whether they set the app up correctly. One line, then the one thing
 * they could check. It resolves itself the moment they hit the hotkey.
 */
function Empty() {
  const { t } = useTranslation();

  return (
    <div className="flex items-start pt-16">
      <span aria-hidden className="w-6 flex-none @min-[800px]:w-20" />
      <div className="flex max-w-[520px] flex-col gap-4 pr-4">
        <p className="text-lg leading-snug text-foreground">{t('score.empty.title')}</p>
        <p className="text-base leading-normal text-muted-foreground">
          <Trans i18nKey="score.empty.body" components={{ kbd: <Kbd /> }} />
        </p>
      </div>
    </div>
  );
}

export const scoreRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/scores/$scoreId',
  loader: ({ context, params }) =>
    // The score's own row, not the history: the name and the band render
    // immediately, and only the rows wait on the round-trip over git.
    context.queryClient.ensureQueryData(scoreQuery(params.scoreId)),
  component: ScorePage,
});
