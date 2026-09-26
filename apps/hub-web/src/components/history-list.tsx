import { useTranslation } from 'react-i18next';
import { Badge } from '@gpt/ui/badge';
import { Button } from '@gpt/ui/button';
import { Skeleton } from '@gpt/ui/skeleton';
import type { Version } from '@/lib/api';
import {
  ago,
  entries,
  initials,
  scopeText,
  shortId,
  shortScopeText,
  time,
} from '@/lib/history-format';
import type { Row } from '@/lib/lanes';
import { HistoryGutter } from './history-gutter';

/**
 * The history.
 *
 * The list is the content and the graph is a rail beside it: every version is
 * a row of text a screen reader reads in order, and the drawing in the gutter
 * is `aria-hidden`. Nothing is said by colour alone — a branch is named by a
 * chip, the current version by a badge.
 *
 * Rows are 40px and keyboard reachable top to bottom. Clicking one selects
 * it; shift-clicking a second takes the span between them, which is the
 * question *what changed between these two* asked directly.
 */

export interface HistoryListProps {
  versions: Version[];
  head: string | null;
  /** Which branch each version's tip belongs to, for the chip at the tip. */
  tips: Map<string, string>;
  selected: string[];
  onSelect(commit: string, extend: boolean): void;
}

export function HistoryList({ versions, head, tips, selected, onSelect }: HistoryListProps) {
  const chosen = new Set(selected);

  return (
    <ul className="flex flex-col">
      {entries(versions, head).map((entry) => {
        if (entry.kind === 'day') {
          return (
            <li key={entry.key}>
              <h3 className="flex h-8 items-center border-b border-border-subtle bg-background">
                <Rail height={32} gutter={{ main: 'full', l2: 'none', l3: 'none', node: 'none' }} />
                <span className="text-xs tracking-widest text-muted-foreground uppercase">
                  {entry.label}
                </span>
              </h3>
            </li>
          );
        }

        if (entry.kind === 'session') {
          return (
            <li key={entry.key}>
              <p className="flex h-7 items-center border-b border-border-subtle">
                <Rail height={28} gutter={{ main: 'full', l2: 'none', l3: 'none', node: 'none' }} />
                <span className="text-xs text-muted-foreground">{entry.label}</span>
              </p>
            </li>
          );
        }

        return (
          <HistoryRow
            key={entry.key}
            row={entry}
            branch={tips.get(entry.version.id) ?? null}
            head={head}
            selected={chosen.has(entry.version.id)}
            onSelect={onSelect}
          />
        );
      })}
    </ul>
  );
}

function HistoryRow({
  row,
  branch,
  head,
  selected,
  onSelect,
}: {
  row: Row;
  branch: string | null;
  head: string | null;
  selected: boolean;
  onSelect(commit: string, extend: boolean): void;
}) {
  const { t } = useTranslation();
  const { version, gutter } = row;
  // Selection is a white left edge and a raised background, never the accent:
  // the accent belongs to the current version and is rationed to one meaning.
  const gut = selected ? { ...gutter, node: 'sel' as const } : gutter;

  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={(event) => onSelect(version.id, event.shiftKey)}
        className={`flex h-10 w-full items-center gap-3 border-b border-l-2 border-b-border-subtle pr-4 text-left transition-colors duration-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring wide:pr-6 ${
          selected
            ? 'border-l-foreground bg-popover'
            : 'border-l-transparent hover:bg-card'
        }`}
      >
        <Rail gutter={gut} />

        {branch && (
          <Badge
            variant="outline"
            className="shrink-0 rounded-sm border-border-strong font-mono text-xs font-normal text-foreground"
          >
            {branch}
          </Badge>
        )}

        <span
          className={`min-w-0 flex-1 truncate text-base ${
            version.message ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          {/* Never rewritten, never truncated mid-word by us, never given an
              invented title when it is empty. */}
          {version.message || t('common.unnamedVersion')}
        </span>

        {version.id === head && (
          <Badge
            variant="outline"
            className="shrink-0 rounded-sm border-brand-border text-xs font-normal text-brand-bright"
          >
            {t('history.current')}
          </Badge>
        )}
        {version.parents.length > 1 && (
          <Badge
            variant="outline"
            className="shrink-0 rounded-sm border-border text-xs font-normal text-muted-foreground"
          >
            {t('history.landed')}
          </Badge>
        )}

        <span className="hidden w-[150px] shrink-0 truncate text-right font-mono text-xs text-muted-foreground wide:block">
          {scopeText(version.scope)}
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground wide:hidden">
          {shortScopeText(version.scope)}
        </span>

        <Author email={version.authorEmail} />

        <span className="hidden w-[72px] shrink-0 text-right text-xs text-muted-foreground wide:block">
          {time(version.at)}
        </span>
        <span className="w-11 shrink-0 text-right text-xs text-muted-foreground wide:hidden">
          {ago(version.at)}
        </span>

        {/* Present but subordinate: metadata, never the title of a row. First
            thing to go when the width runs out. */}
        <span className="hidden w-[60px] shrink-0 text-right font-mono text-xs text-muted-foreground wide:block">
          {shortId(version.id)}
        </span>
      </button>
    </li>
  );
}

/**
 * Both gutters, one hidden. The narrow one is a CSS decision and the lane
 * count is a JS one, and a media-query hook would make the first depend on
 * the second for two SVGs that cost nothing.
 */
function Rail({ gutter, height = 40 }: { gutter: Row['gutter']; height?: number }) {
  return (
    <>
      <span className="wide:hidden">
        <HistoryGutter {...gutter} height={height} narrow />
      </span>
      <span className="hidden wide:block">
        <HistoryGutter {...gutter} height={height} />
      </span>
    </>
  );
}

/**
 * Initials, because accounts have no display name yet. Squares, 2px radius,
 * never a photograph — there is no upload and the page makes no third-party
 * requests.
 *
 * `title` rather than the Tooltip primitive: the whole row is a button, and
 * a tooltip trigger inside it would be a button inside a button. The address
 * is in the row's own text for a screen reader either way.
 */
function Author({ email }: { email: string }) {
  return (
    <span
      title={email}
      className="flex size-5 shrink-0 items-center justify-center rounded-sm border border-border bg-accent font-mono text-[10px] text-muted-foreground"
    >
      {initials(email)}
      <span className="sr-only">{email}</span>
    </span>
  );
}

/**
 * The loaded edge, stated in words. The alternative is scrolling into a
 * spinner and never knowing whether the history ended or the page did.
 */
export function LoadMore({
  loaded,
  total,
  loading,
  onLoad,
}: {
  loaded: number;
  total: number;
  loading: boolean;
  onLoad(): void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border bg-card py-3 pr-4 wide:pr-6">
      <p className="flex items-center text-sm text-muted-foreground">
        <span aria-hidden className="w-6 flex-none wide:w-20" />
        {t('history.showing', { loaded, total })}
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="h-7 shrink-0 rounded-sm"
        disabled={loading}
        onClick={onLoad}
      >
        {loading ? t('history.loading') : t('history.loadMore')}
      </Button>
    </div>
  );
}

/**
 * Skeleton, not spinner, and a static one: hover and active states are the
 * whole motion budget. The rail is drawn straight with no nodes, because the
 * shape of the history is not known until the round-trip lands.
 */
export function HistorySkeleton() {
  const { t } = useTranslation();

  return (
    <>
      <p role="status" className="sr-only">
        {t('history.reading')}
      </p>
      <div aria-hidden>
        {[180, 132, 216, 96, 160, 124].map((width, index) => (
          <div
            key={width}
            className="flex h-10 items-center gap-3 border-b border-border-subtle pr-4 wide:pr-6"
          >
            <Rail
              gutter={{
                main: index === 0 ? 'bottom' : 'full',
                l2: 'none',
                l3: 'none',
                node: 'none',
              }}
            />
            <Skeleton className="h-2.5 rounded-sm bg-popover" style={{ width }} />
            <span className="flex-1" />
            <Skeleton className="size-5 rounded-sm bg-popover" />
            <Skeleton className="h-2.5 w-10 rounded-sm bg-popover" />
          </div>
        ))}
      </div>
    </>
  );
}
