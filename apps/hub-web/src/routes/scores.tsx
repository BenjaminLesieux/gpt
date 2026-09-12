import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { Badge } from '@gpt/ui/badge';
import { Button } from '@gpt/ui/button';
import { Empty, EmptyContent, EmptyDescription } from '@gpt/ui/empty';
import { Skeleton } from '@gpt/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gpt/ui/table';
import { CreateScoreDialog } from '@/components/create-score-dialog';
import { ImportScoreDialog } from '@/components/import-score-dialog';
import { HubError, type Score } from '@/lib/api';
import { handOff } from '@/lib/credentials-handoff';
import {
  scoresQuery,
  useCreateScore,
  useFinishSetup,
  useImportScore,
  useRetryImport,
} from '@/lib/queries';
import { authedRoute } from './authed';

const CELL_META = 'truncate text-sm text-muted-foreground';

/** Dates the way someone reads them, not the way they serialise. */
function formatCreated(iso: string): string {
  const created = new Date(iso);
  const sameDay = new Date().toDateString() === created.toDateString();
  return sameDay
    ? `Today, ${created.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : created.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function ScoreRow({
  score,
  onFinishSetup,
  finishing,
}: {
  score: Score;
  onFinishSetup: (id: string) => void;
  finishing: boolean;
}) {
  const unfinished = score.token === null;

  // A row and, when setup was abandoned, the row explaining it. They are
  // separate <tr>s rather than one tall cell so the explanation is reachable
  // in the reading order right after the score it is about.
  const explanationId = `${score.id}-unfinished`;

  return (
    <>
      <TableRow
        className={unfinished ? 'border-border-subtle bg-card' : 'border-border-subtle'}
        aria-describedby={unfinished ? explanationId : undefined}
      >
        <TableCell className="h-10 py-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="truncate text-base text-foreground">{score.name}</span>
            {unfinished && (
              <Badge
                variant="outline"
                className="shrink-0 rounded-sm border-border-strong bg-popover text-xs font-normal text-warning-bright"
              >
                Setup unfinished
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className={`${CELL_META} h-10 max-w-[1px] py-0 font-mono`}>
          {score.url}
        </TableCell>
        <TableCell className={`${CELL_META} h-10 py-0 whitespace-nowrap`}>
          {formatCreated(score.createdAt)}
        </TableCell>
        <TableCell className="h-10 py-0">
          {unfinished ? (
            <Button
              variant="outline"
              size="sm"
              disabled={finishing}
              onClick={() => onFinishSetup(score.id)}
              className="h-6.5 rounded-sm border-border-strong bg-popover px-2.5 text-sm"
            >
              {/* Naming the score keeps every one of these buttons distinct
                  to anyone listing the page's controls out of context. */}
              {finishing ? 'Finishing…' : 'Finish setup'}
              <span className="sr-only"> for {score.name}</span>
            </Button>
          ) : (
            // The value is gone; only the name it was given survives. A row
            // that showed anything else would imply it could be recovered.
            <span className={`${CELL_META} font-mono`}>{score.token?.name}</span>
          )}
        </TableCell>
      </TableRow>
      {unfinished && (
        <TableRow className="border-border-subtle hover:bg-transparent">
          <TableCell
            id={explanationId}
            colSpan={4}
            className="bg-card py-3 text-sm leading-normal text-muted-foreground"
          >
            This score has storage but no sign-in details yet. Finish setup to get its URL,
            username and token — nothing you've saved is lost.
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ScoresPage() {
  const scores = useQuery(scoresQuery);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const navigate = scoresRoute.useNavigate();

  async function showCredentials(created: Parameters<typeof handOff>[0]) {
    handOff(created);
    setDialogOpen(false);
    await navigate({ to: '/credentials' });
  }

  async function showImportedCredentials(created: Parameters<typeof handOff>[0]) {
    handOff(created);
    setImportOpen(false);
    await navigate({ to: '/credentials' });
  }

  const create = useCreateScore(showCredentials);
  const finish = useFinishSetup(showCredentials);
  const importScore = useImportScore(showImportedCredentials);
  const retryImport = useRetryImport(showImportedCredentials);

  // The one thing that needs the git side to answer. Everything already
  // stored still reads fine, so the page degrades rather than failing.
  const upstreamDown =
    (create.error instanceof HubError && create.error.isUpstreamDown) ||
    (finish.error instanceof HubError && finish.error.isUpstreamDown) ||
    (importScore.error instanceof HubError && importScore.error.isUpstreamDown);

  const rows = scores.data ?? [];
  const empty = scores.isSuccess && rows.length === 0;

  return (
    <>
      {upstreamDown && (
        <div className="flex flex-none flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-6 py-3.5">
          <p className="flex items-center gap-3 text-base leading-snug text-foreground">
            <span aria-hidden className="size-1.5 shrink-0 bg-warning-bright" />
            Can't reach the sync server right now. Your scores and everything you've saved
            are safe — you just can't add a new score until it's back.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="rounded-sm"
            onClick={() => {
              create.reset();
              finish.reset();
              importScore.reset();
              void scores.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      )}

      <main className="flex flex-1 flex-col gap-5 px-6 py-8">
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-medium tracking-tight">Scores</h1>
            {rows.length > 0 && (
              <span className="font-mono text-sm text-muted-foreground">{rows.length}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {upstreamDown && (
              <span className="text-sm text-muted-foreground">
                Unavailable while the server is down
              </span>
            )}
            <Button
              variant="secondary"
              className="rounded-sm"
              disabled={upstreamDown}
              onClick={() => setImportOpen(true)}
            >
              Import a score
            </Button>
            <Button
              className="rounded-sm"
              disabled={upstreamDown}
              onClick={() => setDialogOpen(true)}
            >
              Create score
            </Button>
          </div>
        </div>

        {scores.isPending && (
          <>
            {/* The skeleton is shape, not information. Without this the page
                is silent until the rows land. */}
            <p role="status" className="sr-only">
              Loading your scores.
            </p>
            <div className="border border-border-subtle" aria-hidden>
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="flex h-10 items-center gap-4 border-b border-border-subtle px-4 last:border-b-0"
                >
                  <Skeleton className="h-2.5 w-[140px] rounded-none bg-popover" />
                  <Skeleton className="h-2.5 flex-1 rounded-none bg-card" />
                  <Skeleton className="h-2.5 w-20 rounded-none bg-card" />
                </div>
              ))}
            </div>
          </>
        )}

        {scores.isError && !upstreamDown && (
          <p role="alert" className="border border-brand-border bg-brand-dim px-3 py-2.5 text-sm text-foreground">
            {scores.error instanceof HubError
              ? scores.error.message
              : 'Could not load your scores.'}
          </p>
        )}

        {empty && (
          <Empty className="flex-1 border border-border-subtle">
            <EmptyContent className="max-w-[420px] gap-5">
              <EmptyDescription className="text-base leading-normal text-muted-foreground">
                A score is one song, versioned. Create one and every save in Guitar Pro
                lands here.
              </EmptyDescription>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <Button
                  variant="secondary"
                  className="rounded-sm border-border"
                  disabled={upstreamDown}
                  onClick={() => setDialogOpen(true)}
                >
                  Create score
                </Button>
                <Button
                  variant="ghost"
                  className="rounded-sm"
                  disabled={upstreamDown}
                  onClick={() => setImportOpen(true)}
                >
                  Import a file you already have
                </Button>
              </div>
            </EmptyContent>
          </Empty>
        )}

        {rows.length > 0 && (
          <div className="border border-border-subtle">
            <Table className="table-fixed">
              <TableCaption className="mt-0 border-t border-border-subtle px-4 py-3 text-left">
                Token values are never shown again after a score is created.
              </TableCaption>
              <TableHeader>
                <TableRow className="border-border-subtle hover:bg-transparent">
                  <TableHead className="h-8 w-[260px] bg-card text-xs font-medium uppercase tracking-wide">
                    Name
                  </TableHead>
                  <TableHead className="h-8 bg-card text-xs font-medium uppercase tracking-wide">
                    Clone URL
                  </TableHead>
                  <TableHead className="h-8 w-[150px] bg-card text-xs font-medium uppercase tracking-wide">
                    Created
                  </TableHead>
                  <TableHead className="h-8 w-[190px] bg-card text-xs font-medium uppercase tracking-wide">
                    Token
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((score) => (
                  <ScoreRow
                    key={score.id}
                    score={score}
                    finishing={finish.isPending && finish.variables === score.id}
                    onFinishSetup={(id) => finish.mutate(id)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      <CreateScoreDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          if (!next) create.reset();
          setDialogOpen(next);
        }}
        submitting={create.isPending}
        error={create.error}
        onCreate={(name) => create.mutateAsync(name)}
      />

      <ImportScoreDialog
        open={importOpen}
        onOpenChange={(next) => {
          if (!next) {
            importScore.reset();
            retryImport.reset();
          }
          setImportOpen(next);
        }}
        submitting={importScore.isPending || retryImport.isPending}
        error={retryImport.error ?? importScore.error}
        onImport={(name, file) => importScore.mutateAsync({ name, file })}
        onRetry={(score, file) => retryImport.mutateAsync({ score, file })}
      />
    </>
  );
}

export const scoresRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  loader: ({ context }) => context.queryClient.ensureQueryData(scoresQuery),
  component: ScoresPage,
});
