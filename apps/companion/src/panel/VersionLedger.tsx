import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Version } from '@/lib/ipc';
import { formatRelative } from '@/lib/time';

/**
 * The active file's recent named versions, newest first.
 *
 * A ledger, not a list: fixed-width index, rule, message, time. Snapshots
 * never appear here — they are recovery material and belong to the extended
 * window.
 */
export function VersionLedger({ versions }: { versions: Version[] }) {
  const { t, i18n } = useTranslation();

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-border" data-panel-stagger="">
      <h2 className="flex shrink-0 items-baseline gap-2 px-3 pt-2 pb-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
        {t('panel.recentVersions')}
        {versions.length > 0 && (
          <span className="font-mono text-[10px] font-normal tracking-normal text-muted-foreground/60">
            {versions.length}
          </span>
        )}
      </h2>

      {versions.length === 0 ? (
        <p className="px-3 pb-2 text-xs text-muted-foreground/70">{t('panel.noVersionsYet')}</p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ol className="pb-1">
            {versions.map((version, index) => (
              <li key={version.id}>
                <div className="group grid grid-cols-[1rem_1fr_auto] items-baseline gap-2 px-3 py-[3px] transition-colors hover:bg-accent">
                  <span className="font-mono text-[10px] text-muted-foreground/50 tabular-nums group-hover:text-brand-bright">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="truncate text-xs text-foreground/90" title={version.message}>
                    {version.message}
                  </span>
                  <time
                    className="font-mono text-[10px] whitespace-nowrap text-muted-foreground"
                    dateTime={new Date(version.timestamp * 1000).toISOString()}
                  >
                    {formatRelative(version.timestamp, i18n.language)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        </ScrollArea>
      )}
    </section>
  );
}
