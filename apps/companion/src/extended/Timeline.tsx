import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, GitCompareArrows, History as HistoryIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Version } from '@/lib/ipc';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { History } from './useHistory';

interface TimelineProps {
  history: History;
  headId: string | null;
  baseId: string | null;
  onSelect(version: Version): void;
  onCompare(version: Version): void;
}

/**
 * The left rail: named versions above, auto-snapshots below.
 *
 * The two tiers stay visually separate — named versions are the history, the
 * snapshots underneath exist so a save that was never named is still
 * recoverable. Selecting a row shows it; the compare button pins it as the
 * base of a diff.
 */
export function Timeline({ history, headId, baseId, onSelect, onCompare }: TimelineProps) {
  const { t } = useTranslation();
  const [showSnapshots, setShowSnapshots] = useState(false);

  if (history.loading) return <TimelineSkeleton />;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <section>
        <SectionHeading label={t('extended.timeline.versions')} count={history.versions.length} />

        {history.versions.length === 0 ? (
          <p className="px-4 pb-3 text-xs text-muted-foreground/70">
            {t('extended.timeline.noVersions')}
          </p>
        ) : (
          <ol>
            {history.versions.map((version, index) => (
              <VersionRow
                key={version.id}
                version={version}
                index={history.versions.length - index}
                isHead={version.id === headId}
                isBase={version.id === baseId}
                onSelect={onSelect}
                onCompare={onCompare}
              />
            ))}
          </ol>
        )}
      </section>

      <section className="border-t border-border">
        <button
          type="button"
          onClick={() => setShowSnapshots((open) => !open)}
          aria-expanded={showSnapshots}
          className="flex w-full items-center gap-1.5 px-4 py-2 text-[10px] font-bold tracking-widest text-muted-foreground uppercase transition-colors hover:text-foreground"
        >
          <ChevronRight
            aria-hidden
            className={cn('size-3 transition-transform', showSnapshots && 'rotate-90')}
          />
          {t('extended.timeline.recovery')}
          <span className="font-mono text-[10px] font-normal tracking-normal text-muted-foreground/60">
            {history.snapshots.length}
          </span>
        </button>

        {showSnapshots &&
          (history.snapshots.length === 0 ? (
            <p className="px-4 pb-3 text-xs text-muted-foreground/70">
              {t('extended.timeline.noSnapshots')}
            </p>
          ) : (
            <ol className="pb-2">
              {history.snapshots.map((snapshot) => (
                <VersionRow
                  key={snapshot.id}
                  version={snapshot}
                  isHead={snapshot.id === headId}
                  isBase={snapshot.id === baseId}
                  onSelect={onSelect}
                  onCompare={onCompare}
                />
              ))}
            </ol>
          ))}
      </section>
    </ScrollArea>
  );
}

interface VersionRowProps {
  version: Version;
  /** Ordinal shown for named versions; snapshots are unnumbered. */
  index?: number;
  isHead: boolean;
  isBase: boolean;
  onSelect(version: Version): void;
  onCompare(version: Version): void;
}

function VersionRow({ version, index, isHead, isBase, onSelect, onCompare }: VersionRowProps) {
  const { t, i18n } = useTranslation();
  const label =
    version.kind === 'named' ? version.message : t('extended.timeline.autoSnapshot');

  return (
    <li className="group/row relative">
      <button
        type="button"
        onClick={() => onSelect(version)}
        aria-current={isHead}
        className={cn(
          'grid w-full grid-cols-[1.25rem_1fr_auto] items-baseline gap-2 py-1.5 pr-9 pl-4 text-left transition-colors',
          'border-l-2 border-transparent hover:bg-accent',
          isHead && 'border-brand bg-accent/60',
          isBase && !isHead && 'border-diff-removed',
        )}
      >
        <span
          className={cn(
            'font-mono text-[10px] tabular-nums',
            isHead ? 'text-brand-bright' : 'text-muted-foreground/50',
          )}
        >
          {index !== undefined ? String(index).padStart(2, '0') : '··'}
        </span>
        <span
          className={cn(
            'truncate text-xs',
            version.kind === 'named' ? 'text-foreground/90' : 'text-muted-foreground italic',
          )}
          title={label}
        >
          {label}
        </span>
        <time
          className="font-mono text-[10px] whitespace-nowrap text-muted-foreground"
          dateTime={new Date(version.timestamp * 1000).toISOString()}
        >
          {formatRelative(version.timestamp, i18n.language)}
        </time>
      </button>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onCompare(version)}
              aria-label={t('extended.timeline.compareFrom')}
              aria-pressed={isBase}
              className={cn(
                'absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity',
                'group-hover/row:opacity-100 focus-visible:opacity-100',
                isBase && 'text-diff-removed opacity-100',
              )}
            />
          }
        >
          <GitCompareArrows />
        </TooltipTrigger>
        <TooltipContent>
          {isBase ? t('extended.timeline.clearCompare') : t('extended.timeline.compareFrom')}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <h2 className="flex items-baseline gap-2 px-4 pt-3 pb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
      <HistoryIcon aria-hidden className="size-3" />
      {label}
      <span className="font-mono text-[10px] font-normal tracking-normal text-muted-foreground/60">
        {count}
      </span>
    </h2>
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {[90, 70, 80, 60, 75].map((width, index) => (
        <Skeleton key={index} className="h-4" style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}
