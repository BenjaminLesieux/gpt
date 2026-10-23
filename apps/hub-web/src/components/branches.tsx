import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Button } from '@gpt/ui/button';
import { Toggle } from '@gpt/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpt/ui/tooltip';
import { dateLocale, since } from '@gpt/ui/lib/time';
import { HubError, type BranchDetail, type Landing } from '@/lib/api';
import { conflictBars, conflictPlace, sharedTracks } from '@/lib/branches';
import { DOWNLOAD_URL, openLink } from '@/lib/clone-link';
import { branchesQuery, useLandBranch, useSetAskFirst } from '@/lib/queries';

/**
 * The branches, said in words above the graph. *Ben is on Bass, Sam is on
 * Drums, these don't overlap* is the whole value of branching, and it has to
 * be readable without tracing two lines in a gutter.
 *
 * A branch that needs a decision says where, and hands it to the app. There
 * is no picker here: choosing between two bars means hearing both.
 */
export function Branches({ scoreId }: { scoreId: string }) {
  const { t, i18n } = useTranslation();
  const branches = useQuery(branchesQuery(scoreId));

  if (branches.isError) {
    return (
      <p className="flex-none px-4 pb-4 text-sm text-muted-foreground wide:px-6">
        {t('branches.readFailed')}
      </p>
    );
  }
  if (!branches.data?.length) return null;

  const list = new Intl.ListFormat(i18n.language, { type: 'conjunction' });
  const flight = branches.data.filter((branch) => branch.ahead > 0);
  const shared = sharedTracks(branches.data);
  const allRead = flight.every((branch) => branch.scope);

  return (
    <section
      aria-label={t('score.branchesLabel')}
      className="flex flex-none flex-col gap-2 px-4 pb-4 wide:px-6"
    >
      <ul className="flex flex-col divide-y divide-border border border-border bg-card">
        {branches.data.map((branch) => (
          <Row key={branch.name} scoreId={scoreId} branch={branch} />
        ))}
      </ul>

      {shared.map(({ track, branches: names }) => (
        <p key={track ?? ''} className="text-sm text-foreground">
          {t(names.length === 2 ? 'branches.sharedTwo' : 'branches.sharedMany', {
            branches: list.format(names),
            track: track ?? t('branches.settings'),
          })}
        </p>
      ))}
      {shared.length === 0 && allRead && flight.length > 1 && (
        <p className="text-sm text-muted-foreground">{t('branches.disjoint')}</p>
      )}
    </section>
  );
}

function Row({ scoreId, branch }: { scoreId: string; branch: BranchDetail }) {
  const { t, i18n } = useTranslation();
  const askFirst = useSetAskFirst(scoreId);

  return (
    <li className="flex flex-col gap-3 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="truncate font-mono text-foreground">{branch.name}</span>
        {branch.pushedBy && <span className="truncate">{branch.pushedBy}</span>}
        {branch.ahead === 0 ? (
          <span>{t('branches.noVersions')}</span>
        ) : (
          <>
            <span>{t('score.versions', { count: branch.ahead })}</span>
            <span>{touches(branch, t)}</span>
          </>
        )}
        <span className="ml-auto">{since(new Date(branch.at), dateLocale(i18n.language))}</span>
        <Toggle
          variant="outline"
          size="sm"
          pressed={askFirst.isPending ? askFirst.variables.askFirst : branch.askFirst}
          disabled={askFirst.isPending}
          onPressedChange={(pressed) => askFirst.mutate({ branch: branch.name, askFirst: pressed })}
          className="h-6.5 rounded-sm border-border px-2.5 text-xs font-normal"
        >
          {t('branches.askFirst')}
        </Toggle>
      </div>

      {askFirst.isError && <Failure error={askFirst.error} />}
      {branch.landing && <Decision scoreId={scoreId} branch={branch} landing={branch.landing} />}
    </li>
  );
}

function touches(branch: BranchDetail, t: TFunction): string {
  if (!branch.scope) return t('branches.unreadable');
  const names = branch.scope.tracks.map((track) => track.name);
  if (branch.scope.meta) names.push(t('branches.settings'));
  if (names.length === 0) return t('branches.touchesNoBars');
  return t('branches.touches', { tracks: names.join(', ') });
}

function Decision({
  scoreId,
  branch,
  landing,
}: {
  scoreId: string;
  branch: BranchDetail;
  landing: Landing;
}) {
  const { t } = useTranslation();
  const land = useLandBranch(scoreId);
  // A gitarpro:// link with nothing behind it fails silently, so once it has
  // been pressed the way to get the app sits under it.
  const [opened, setOpened] = useState(false);

  const open = (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        className="rounded-sm"
        onClick={() => setOpened(true)}
        render={<a href={openLink(window.location.origin, scoreId, branch.name)} />}
      >
        {t('branches.open')}
      </Button>
      {opened && (
        <span className="text-sm text-muted-foreground">
          {t('clone.nothingHappened')}{' '}
          <a
            href={DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            {t('clone.download')}
          </a>
        </span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-2 border-l border-border pl-3 text-sm">
      {landing.tip !== branch.tip && <p className="text-muted-foreground">{t('branches.stale')}</p>}

      {landing.status === 'conflicts' && (
        <>
          {landing.cleanBars > 0 && (
            <p className="text-muted-foreground">
              {t('branches.cleanBars', { count: landing.cleanBars })}
            </p>
          )}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-foreground">
            <span>{t('branches.needsYou', { count: conflictBars(landing.conflicts) })}</span>
            {landing.conflicts.map((conflict) => (
              <Tooltip key={`${conflict.bar}:${conflict.track}`}>
                <TooltipTrigger
                  render={
                    <span
                      tabIndex={0}
                      className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    />
                  }
                >
                  {conflictPlace(conflict, {
                    bar: (bar) => t('branches.bar', { bar }),
                    everyTrack: t('branches.everyTrack'),
                  })}
                </TooltipTrigger>
                <TooltipContent className="rounded-sm text-xs">{conflict.description}</TooltipContent>
              </Tooltip>
            ))}
          </div>
          {open}
        </>
      )}

      {landing.status === 'unreadable' && (
        <>
          <p className="text-muted-foreground">{t('branches.unreadable')}</p>
          {open}
        </>
      )}

      {landing.status === 'waiting' && (
        <>
          <p className="text-foreground">{t('branches.waiting')}</p>
          <div>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-sm"
              disabled={land.isPending}
              onClick={() => land.mutate(branch.name)}
            >
              {land.isPending ? t('branches.landing') : t('branches.land')}
            </Button>
          </div>
          {land.data?.status === 'clean' && (
            <p className="text-muted-foreground">{t('branches.dryRun')}</p>
          )}
          {land.isError && <Failure error={land.error} />}
        </>
      )}
    </div>
  );
}

function Failure({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const message =
    error instanceof HubError
      ? error.code === 'main_moved'
        ? t('branches.mainMoved')
        : error.message
      : t('common.genericError');

  return (
    <p role="alert" className="text-sm text-foreground">
      {message}
    </p>
  );
}
