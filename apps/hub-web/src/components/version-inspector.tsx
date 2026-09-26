import { Suspense, lazy } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Button } from '@gpt/ui/button';
import { Separator } from '@gpt/ui/separator';
import { versionScoreUrl, type Version } from '@/lib/api';
import { clock, dateLocale, dayLabel } from '@gpt/ui/lib/time';
import { initials, shortId } from '@gpt/ui/score/history';

/**
 * alphaTab is most of a megabyte gzipped and nothing needs it until someone
 * asks to look at a version. Loading it with the route would put it on the
 * critical path of the score list too, which is the page people open to
 * glance and leave.
 */
const ScorePlayer = lazy(() =>
  import('@gpt/ui/score/player').then((module) => ({ default: module.ScorePlayer }))
);

/**
 * The inspector: one version's facts, or a range's, and the score itself.
 *
 * A rail rather than an expanding row, so the list keeps its 40px rhythm and
 * the graph never re-lays out under the pointer. It is wider than the 320px
 * the design drew, because it now holds notation — that is the honest
 * consequence of the hub being able to play a version rather than apologise
 * for not being able to.
 */

export interface VersionInspectorProps {
  scoreId: string;
  /** Newest first, exactly as the list holds them. One, or a range's ends. */
  selected: Version[];
  branchOf(commit: string): string | null;
  onClose(): void;
}

export function VersionInspector({
  scoreId,
  selected,
  branchOf,
  onClose,
}: VersionInspectorProps) {
  const { t } = useTranslation();
  const range = selected.length > 1;

  return (
    <aside
      aria-label={range ? t('inspector.rangeLabel') : t('inspector.versionLabel')}
      className="flex w-[520px] flex-none flex-col border-l border-border bg-card"
    >
      <div className="flex h-8 flex-none items-center justify-between border-b border-border px-4">
        <h2 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          {range ? t('inspector.range', { count: selected.length }) : t('inspector.version')}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="-mr-2 h-6 rounded-sm px-2 text-sm"
          onClick={onClose}
        >
          {t('inspector.close')}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {range ? (
          <RangeFacts selected={selected} />
        ) : (
          <OneVersion version={selected[0]} branch={branchOf(selected[0].id)} />
        )}

        <Separator className="bg-border" />

        {/* The newer end of a range, so the transport and the facts agree
            about which version is on screen. */}
        <Suspense fallback={<PlayerLoading />}>
          <ScorePlayer
            // A URL, not bytes. alphaTab streams it itself, and the response is
            // immutable — a sha names one tree forever — so stepping back through a
            // history re-reads nothing it has already seen.
            src={versionScoreUrl(scoreId, selected[0].id)}
            identity={selected[0].id}
            className="border border-border-subtle bg-card"
            labels={{
              play: t('player.play'),
              pause: t('player.pause'),
              stop: t('player.stop'),
              position: t('player.position'),
              loop: t('player.loop'),
              speed: t('player.speed'),
              allTracks: t('player.allTracks'),
              failed: t('player.unreadable'),
              loadingSounds: t('player.loadingSounds'),
            }}
          />
        </Suspense>
      </div>
    </aside>
  );
}

function OneVersion({ version, branch }: { version: Version; branch: string | null }) {
  const { t, i18n } = useTranslation();

  return (
    <>
      <p
        className={`text-lg leading-snug text-pretty ${
          version.message ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        {/* An empty message is the user's own two-second entry and is never
            given an invented title. */}
        {version.message || t('common.unnamedVersion')}
      </p>

      <dl className="flex flex-col gap-2.5">
        <Fact label={t('inspector.who')} mono>
          {version.authorEmail}
        </Fact>
        <Fact label={t('inspector.when')}>
          {when(version.at, dateLocale(i18n.language), t)}
        </Fact>
        <Fact label={t('inspector.branch')} mono>
          {branch ?? 'main'}
        </Fact>
        <Separator className="my-0.5 bg-border" />
        <Fact label={t('inspector.tracksTouched')} mono>
          {version.scope?.tracks.length
            ? version.scope.tracks.map((track) => track.name).join(', ')
            : '—'}
        </Fact>
        <Fact label={t('inspector.barsChanged')} mono>
          {version.scope ? String(version.scope.bars) : '—'}
        </Fact>
        <Fact label={t('inspector.id')} mono muted>
          {shortId(version.id)}
        </Fact>
      </dl>
    </>
  );
}

function RangeFacts({ selected }: { selected: Version[] }) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const newest = selected[0];
  const oldest = selected[selected.length - 1];

  // Summed from what each version touched. A track worked on twice in the
  // range counts both times, which is what "bars changed between these two"
  // means — it is a total of edits, not a count of distinct bars.
  const tracks = new Map<string, number>();
  for (const version of selected) {
    for (const track of version.scope?.tracks ?? []) {
      tracks.set(track.name, (tracks.get(track.name) ?? 0) + track.bars);
    }
  }

  const bars = [...tracks.values()].reduce((sum, count) => sum + count, 0);
  const names = [...tracks.keys()];
  const people = [...new Set(selected.map((version) => initials(version.authorEmail)))];

  return (
    <>
      <p className="text-md leading-normal text-pretty text-foreground">
        {t(names.length > 0 ? 'inspector.betweenAcross' : 'inspector.between', {
          bars: t('history.bars', { count: bars }),
          tracks: list(names, locale),
          versions: t('score.versions', { count: selected.length }),
        })}
      </p>

      <dl className="flex flex-col gap-2.5">
        <Fact label={t('inspector.newerEnd')}>{newest.message || t('common.unnamedVersion')}</Fact>
        <Fact label={t('inspector.olderEnd')}>{oldest.message || t('common.unnamedVersion')}</Fact>
        <Separator className="my-0.5 bg-border" />
        {names.map((name) => (
          <Fact key={name} label={name} labelMono mono muted>
            {t('history.bars', { count: tracks.get(name) })}
          </Fact>
        ))}
        {names.length > 0 && <Separator className="my-0.5 bg-border" />}
        <Fact label={t('inspector.whoWorked')} mono>
          {people.join(', ')}
        </Fact>
        <Fact label={t('inspector.span')}>
          {`${when(oldest.at, locale, t)} → ${clock(new Date(newest.at), locale)}`}
        </Fact>
      </dl>
    </>
  );
}

function Fact({
  label,
  children,
  mono = false,
  labelMono = false,
  muted = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  labelMono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt
        className={`shrink-0 text-sm ${
          labelMono ? 'font-mono text-foreground' : 'text-muted-foreground'
        }`}
      >
        {label}
      </dt>
      <dd
        className={`min-w-0 text-right text-sm break-words ${mono ? 'font-mono' : ''} ${
          muted ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {children}
      </dd>
    </div>
  );
}

/** *Yesterday at 9:31 pm* — the inspector's one long-form date. */
function when(iso: string, locale: string, t: TFunction): string {
  const at = new Date(iso);
  return t('time.dayAtTime', { day: dayLabel(at, locale), time: clock(at, locale) });
}

/** *Guitar 1 and Bass*, *Guitar 1, Bass and Drums* — prose, not a join. */
function list(names: string[], locale: string): string {
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(names);
}

/** The first selection of a session waits on alphaTab's chunk. Say so. */
function PlayerLoading() {
  const { t } = useTranslation();

  return (
    <p role="status" className="border border-border-subtle bg-card px-3 py-2.5 text-sm text-muted-foreground">
      {t('inspector.loadingScore')}
    </p>
  );
}
