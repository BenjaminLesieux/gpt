import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, GitCompareArrows, History as HistoryIcon } from 'lucide-react';
import { Button } from '@gpt/ui/button';
import { ScrollArea } from '@gpt/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpt/ui/tooltip';
import type { Version } from '@/lib/ipc';
import { dateLocale } from '@gpt/ui/lib/time';
import { cn } from '@gpt/ui/lib/utils';
import { HistoryList, HistorySkeleton, type HistoryLabels } from '@gpt/ui/score/history';
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
  const { t, i18n } = useTranslation();
  const [showSnapshots, setShowSnapshots] = useState(false);

  const labels = (unnamed: string): HistoryLabels => ({
    unnamed,
    current: t('extended.timeline.latest'),
    landed: t('extended.timeline.landed'),
    reading: t('extended.timeline.reading'),
    session: ({ part, ...rest }) => t(`extended.timeline.session.${part}`, rest),
  });

  if (history.loading) return <HistorySkeleton labels={labels('')} />;

  const tier = (versions: Version[], unnamed: string) => (
    <HistoryList
      versions={linked(versions)}
      head={versions[0]?.id ?? null}
      locale={dateLocale(i18n.language)}
      labels={labels(unnamed)}
      selected={headId ? [headId] : []}
      base={baseId}
      onSelect={(id) => {
        const version = versions.find((entry) => entry.id === id);
        if (version) onSelect(version);
      }}
      trailing={(version) => (
        <ComparePin isBase={version.id === baseId} onCompare={() => onCompare(version)} />
      )}
    />
  );

  return (
    <ScrollArea className="min-h-0 flex-1">
      <section>
        <SectionHeading label={t('extended.timeline.versions')} count={history.versions.length} />

        {history.versions.length === 0 ? (
          <p className="px-4 pb-3 text-xs text-muted-foreground/70">
            {t('extended.timeline.noVersions')}
          </p>
        ) : (
          // Named versions always carry their message, so there is no unnamed one to label.
          tier(history.versions, '')
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
            tier(history.snapshots, t('extended.timeline.autoSnapshot'))
          ))}
      </section>
    </ScrollArea>
  );
}

/** Each tier is one straight line, newest first: a version's parent is the row below it. */
function linked(versions: Version[]) {
  return versions.map((version, index) => ({
    ...version,
    parents: index + 1 < versions.length ? [versions[index + 1].id] : [],
  }));
}

function ComparePin({ isBase, onCompare }: { isBase: boolean; onCompare(): void }) {
  const { t } = useTranslation();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onCompare}
            aria-label={t('extended.timeline.compareFrom')}
            aria-pressed={isBase}
            className={cn(
              'opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100',
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
