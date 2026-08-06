import { useTranslation } from 'react-i18next';
import { Cloud, CloudOff, Download, GitBranch, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { SyncState, TrackedFile } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import type { Sync } from './useSync';

interface SyncBarProps {
  file: TrackedFile;
  sync: Sync;
  onOpenSettings(): void;
  onPull(): void;
}

/**
 * Where this score stands against its remote, and the two things the user can
 * do about it.
 *
 * Sending is not one of them: named versions leave on their own, so an ahead
 * count is a progress report rather than a button. What needs a person is
 * bringing versions in — and being told when nothing can.
 */
export function SyncBar({ file, sync, onOpenSettings, onPull }: SyncBarProps) {
  const { t } = useTranslation();

  if (!file.remote) {
    return (
      <Button variant="ghost" size="xs" onClick={onOpenSettings} className="ml-auto">
        <CloudOff data-icon="inline-start" className="opacity-60" />
        {t('extended.remote.setUp')}
      </Button>
    );
  }

  return (
    <div className="ml-auto flex items-center gap-1.5">
      <Standing state={sync.state} busy={sync.busy} />

      {sync.state.kind === 'behind' && (
        <Button variant="outline" size="xs" onClick={onPull} disabled={sync.busy}>
          <Download data-icon="inline-start" />
          {t('extended.sync.bringIn')}
        </Button>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void sync.check()}
              disabled={sync.busy}
              aria-label={t('extended.sync.check')}
            />
          }
        >
          <RefreshCw className={cn('size-3.5', sync.busy && 'animate-spin')} />
        </TooltipTrigger>
        <TooltipContent>{t('extended.sync.check')}</TooltipContent>
      </Tooltip>

      <Button variant="ghost" size="xs" onClick={onOpenSettings}>
        <Cloud data-icon="inline-start" className="opacity-60" />
        {t('extended.remote.configured')}
      </Button>
    </div>
  );
}

function Standing({ state, busy }: { state: SyncState; busy: boolean }) {
  const { t } = useTranslation();

  if (busy && state.kind === 'unconfigured') {
    return <Spinner className="size-3.5 text-muted-foreground" />;
  }

  switch (state.kind) {
    case 'upToDate':
      return <Label>{t('extended.sync.upToDate')}</Label>;
    case 'ahead':
      return <Label>{t('extended.sync.ahead', { count: state.versions })}</Label>;
    case 'behind':
      return <Label>{t('extended.sync.behind', { count: state.versions })}</Label>;
    case 'diverged':
      return (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex items-center gap-1.5 text-warning" tabIndex={0}>
                <GitBranch aria-hidden className="size-3.5 shrink-0" />
                <span className="font-mono text-[10px] whitespace-nowrap">
                  {t('extended.sync.diverged')}
                </span>
              </span>
            }
          />
          <TooltipContent className="max-w-72">
            {t('extended.sync.divergedHelp', { ahead: state.ahead, behind: state.behind })}
          </TooltipContent>
        </Tooltip>
      );
    default:
      return null;
  }
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] whitespace-nowrap text-muted-foreground">{children}</span>
  );
}
