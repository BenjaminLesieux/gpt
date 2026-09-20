import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { Badge } from '@gpt/ui/badge';
import { Kbd } from '@gpt/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpt/ui/tooltip';
import { HistoryList, HistorySkeleton, LoadMore } from '@/components/history-list';
import { VersionInspector } from '@/components/version-inspector';
import { HubError, type Branch, type Member, type Version } from '@/lib/api';
import { initials, since } from '@/lib/history-format';
import { historyQuery, scoreQuery } from '@/lib/queries';
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
  const { scoreId } = scoreRoute.useParams();
  const score = useQuery(scoreQuery(scoreId));
  const history = useInfiniteQuery(historyQuery(scoreId));

  // Commit ids, newest first, exactly as the list holds them. One is a
  // version; more is a range and its two ends are the first and the last.
  const [selected, setSelected] = useState<string[]>([]);

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
      <main className="flex min-w-0 flex-1 flex-col">
        <nav className="flex h-10 flex-none items-center gap-3 px-4 text-sm wide:px-6">
          <Link
            to="/"
            className="rounded-sm text-muted-foreground transition-colors duration-100 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            Your scores
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
              <span>{state(total, versions, branches)}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Members members={score.data?.members ?? []} />
          </div>
        </header>

        {branches.length > 0 && <Branches branches={branches} />}

        <div className="flex h-8 flex-none items-center justify-between border-b border-border pr-4 wide:pr-6">
          <h2 className="flex items-center text-xs tracking-widest text-muted-foreground uppercase">
            <span aria-hidden className="w-6 flex-none wide:w-20" />
            History
          </h2>
          <p className="font-mono text-xs text-muted-foreground">
            {selected.length > 1
              ? `${selected.length} selected · click a row to reset`
              : selected.length === 1
                ? '1 selected · shift-click for a range'
                : count(total, branches.length)}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {history.isPending && <HistorySkeleton />}

          {history.isError && (
            <p
              role="alert"
              className="m-4 border border-brand-border bg-brand-dim px-3 py-2.5 text-sm text-foreground wide:m-6"
            >
              {history.error instanceof HubError
                ? history.error.message
                : 'Could not read this history.'}
            </p>
          )}

          {history.isSuccess && versions.length === 0 && <Empty />}

          {versions.length > 0 && (
            <>
              <HistoryList
                versions={versions}
                head={head}
                tips={tips}
                selected={selected}
                onSelect={select}
              />
              {history.hasNextPage && (
                <LoadMore
                  loaded={versions.length}
                  total={total}
                  loading={history.isFetchingNextPage}
                  onLoad={() => void history.fetchNextPage()}
                />
              )}
            </>
          )}
        </div>
      </main>

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

/** *Last version 20 minutes ago · No branches in flight* — the page's state. */
function state(total: number, versions: Version[], branches: Branch[]): string {
  if (total === 0) return 'Nothing pushed yet';

  const flight = branches.filter((branch) => branch.ahead > 0).length;
  const last = versions[0] ? `Last version ${since(versions[0].at)}` : '';
  const lines =
    flight === 0
      ? 'no branches in flight'
      : flight === 1
        ? 'one branch in flight'
        : `${flight} branches in flight`;

  return `${last} · ${lines}`;
}

function count(total: number, branches: number): string {
  const versions = `${total} ${total === 1 ? 'version' : 'versions'}`;
  if (branches === 0) return `${versions} · main`;
  return `${versions} · main + ${branches} ${branches === 1 ? 'branch' : 'branches'}`;
}

function Members({ members }: { members: Member[] }) {
  return (
    <ul className="flex gap-1">
      {members.map((member) => (
        <li key={member.accountId}>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="flex size-6 items-center justify-center rounded-sm border border-border bg-accent font-mono text-[10px] text-muted-foreground" />
              }
            >
              {initials(member.email)}
              <span className="sr-only">
                {member.email}
                {member.role === 'owner' ? ', owner' : ''}
              </span>
            </TooltipTrigger>
            <TooltipContent className="rounded-sm font-mono text-xs">{member.email}</TooltipContent>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

/**
 * The branches, said in words above the graph. *Ben is on Bass, Sam is on
 * Drums, these don't overlap* is the whole value of branching, and it has to
 * be readable without tracing two lines in a gutter.
 */
function Branches({ branches }: { branches: Branch[] }) {
  const flight = branches.filter((branch) => branch.ahead > 0);
  if (flight.length === 0) return null;

  return (
    <section aria-label="Branches" className="flex flex-none flex-col gap-2 px-4 pb-4 wide:px-6">
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
                In flight
              </Badge>
            </div>
            <p className="text-sm leading-normal text-muted-foreground">
              {branch.ahead} {branch.ahead === 1 ? 'version' : 'versions'} ahead of the main line.
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
  return (
    <div className="flex items-start pt-16">
      <span aria-hidden className="w-6 flex-none wide:w-20" />
      <div className="flex max-w-[520px] flex-col gap-4 pr-4">
        <p className="text-lg leading-snug text-foreground">No versions yet.</p>
        <p className="text-base leading-normal text-muted-foreground">
          Open the score in Guitar Pro, press <Kbd>⌥⌘G</Kbd>, type what you changed and hit Enter.
          It shows up here straight away.
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
