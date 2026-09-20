import { Suspense, lazy } from 'react';
import { Button } from '@gpt/ui/button';
import { Separator } from '@gpt/ui/separator';
import type { Version } from '@/lib/api';
import { initials, shortId, time, when } from '@/lib/history-format';

/**
 * alphaTab is most of a megabyte gzipped and nothing needs it until someone
 * asks to look at a version. Loading it with the route would put it on the
 * critical path of the score list too, which is the page people open to
 * glance and leave.
 */
const VersionPlayer = lazy(() =>
  import('./version-player').then((module) => ({ default: module.VersionPlayer }))
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
  const range = selected.length > 1;

  return (
    <aside
      aria-label={range ? 'The selected range' : 'The selected version'}
      className="flex w-[520px] flex-none flex-col border-l border-border bg-card"
    >
      <div className="flex h-8 flex-none items-center justify-between border-b border-border px-4">
        <h2 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          {range ? `Range · ${selected.length} versions` : 'Version'}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="-mr-2 h-6 rounded-sm px-2 text-sm"
          onClick={onClose}
        >
          Close
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
          <VersionPlayer scoreId={scoreId} commit={selected[0].id} />
        </Suspense>
      </div>
    </aside>
  );
}

function OneVersion({ version, branch }: { version: Version; branch: string | null }) {
  return (
    <>
      <p
        className={`text-lg leading-snug text-pretty ${
          version.message ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        {/* An empty message is the user's own two-second entry and is never
            given an invented title. */}
        {version.message || 'Unnamed version'}
      </p>

      <dl className="flex flex-col gap-2.5">
        <Fact label="Who" mono>
          {version.authorEmail}
        </Fact>
        <Fact label="When">{when(version.at)}</Fact>
        <Fact label="Branch" mono>
          {branch ?? 'main'}
        </Fact>
        <Separator className="my-0.5 bg-border" />
        <Fact label="Tracks touched" mono>
          {version.scope?.tracks.length
            ? version.scope.tracks.map((track) => track.name).join(', ')
            : '—'}
        </Fact>
        <Fact label="Bars changed" mono>
          {version.scope ? String(version.scope.bars) : '—'}
        </Fact>
        <Fact label="Id" mono muted>
          {shortId(version.id)}
        </Fact>
      </dl>
    </>
  );
}

function RangeFacts({ selected }: { selected: Version[] }) {
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
        Between these two: {bars} {bars === 1 ? 'bar' : 'bars'}
        {names.length > 0 && <> across {list(names)}</>}, {selected.length} versions.
      </p>

      <dl className="flex flex-col gap-2.5">
        <Fact label="Newer end">{newest.message || 'Unnamed version'}</Fact>
        <Fact label="Older end">{oldest.message || 'Unnamed version'}</Fact>
        <Separator className="my-0.5 bg-border" />
        {names.map((name) => (
          <Fact key={name} label={name} labelMono mono muted>
            {`${tracks.get(name)} ${tracks.get(name) === 1 ? 'bar' : 'bars'}`}
          </Fact>
        ))}
        {names.length > 0 && <Separator className="my-0.5 bg-border" />}
        <Fact label="Who worked in it" mono>
          {people.join(', ')}
        </Fact>
        <Fact label="Span">{`${when(oldest.at)} → ${time(newest.at)}`}</Fact>
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

/** *Guitar 1 and Bass*, *Guitar 1, Bass and Drums* — prose, not a join. */
function list(names: string[]): string {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The first selection of a session waits on alphaTab's chunk. Say so. */
function PlayerLoading() {
  return (
    <p role="status" className="border border-border-subtle bg-card px-3 py-2.5 text-sm text-muted-foreground">
      Loading the score.
    </p>
  );
}
