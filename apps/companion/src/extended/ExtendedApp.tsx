import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, ChevronDown, FilePlus2, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { TrackedFile, Version } from '@/lib/ipc';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/utils';
import { DiffStage } from './DiffStage';
import { RestoreDialog } from './RestoreDialog';
import { ScoreStage, StageMessage, StageSpinner } from './ScoreStage';
import { Timeline } from './Timeline';
import { useHistory } from './useHistory';
import { useLibrary } from './useLibrary';

/**
 * Extended window — timeline, visual diff, restore, playback.
 *
 * One file at a time, chosen in the header. The left rail is the history; the
 * stage shows either the selected version on its own (playable) or that
 * version against a pinned base.
 */
export function ExtendedApp() {
  const { t } = useTranslation();
  const library = useLibrary();
  const history = useHistory(library.selected?.id ?? null);

  const [headId, setHeadId] = useState<string | null>(null);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<Version | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const fileId = library.selected?.id ?? null;

  // A different file has a different history: nothing about the old selection
  // survives the switch.
  useEffect(() => {
    setHeadId(null);
    setBaseId(null);
    setNotice(null);
  }, [fileId]);

  const entries = useMemo(
    () => [...history.versions, ...history.snapshots],
    [history.versions, history.snapshots],
  );
  const head =
    entries.find((entry) => entry.id === headId) ?? history.versions[0] ?? history.snapshots[0] ?? null;
  const base = entries.find((entry) => entry.id === baseId) ?? null;

  /** The version just before `head` within its own tier. */
  const previous = useMemo(() => {
    if (!head) return null;
    const tier = head.kind === 'named' ? history.versions : history.snapshots;
    return tier[tier.findIndex((entry) => entry.id === head.id) + 1] ?? null;
  }, [head, history.versions, history.snapshots]);

  function compare(version: Version) {
    if (version.id === baseId) {
      setBaseId(null);
      return;
    }
    setBaseId(version.id);
    // Diffing something against itself shows nothing — move the head to the
    // newest entry that isn't the new base.
    if (version.id === head?.id) {
      setHeadId(entries.find((entry) => entry.id !== version.id)?.id ?? null);
    }
  }

  if (!library.loading && library.files.length === 0) {
    return (
      <Shell>
        <NoTrackedFiles onAddFile={() => void library.addFile()} />
      </Shell>
    );
  }

  return (
    <Shell
      header={
        library.selected && (
          <FileSelector
            files={library.files}
            selected={library.selected}
            onSelect={library.select}
            onAddFile={() => void library.addFile()}
          />
        )
      }
    >
      {(failure ?? library.error ?? history.error) && (
        <Strip
          tone="error"
          message={(failure ?? library.error ?? history.error) as string}
          onDismiss={() => {
            setFailure(null);
            library.clearError();
            history.clearError();
          }}
        />
      )}
      {notice && <Strip tone="notice" message={notice} onDismiss={() => setNotice(null)} />}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-76 shrink-0 flex-col border-r border-border">
          <Timeline
            history={history}
            headId={head?.id ?? null}
            baseId={base?.id ?? null}
            onSelect={(version) => setHeadId(version.id)}
            onCompare={compare}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {head && library.selected ? (
            <>
              <StageHeader
                head={head}
                base={base}
                canCompare={previous !== null}
                onCompareWithPrevious={() => previous && setBaseId(previous.id)}
                onClearCompare={() => setBaseId(null)}
                onRestore={() => setRestoring(head)}
              />
              {base ? (
                <DiffStage fileId={library.selected.id} base={base} head={head} />
              ) : (
                <ScoreStage fileId={library.selected.id} version={head} />
              )}
            </>
          ) : history.loading ? (
            <StageSpinner label={t('extended.stage.loadingScore')} />
          ) : (
            <StageMessage message={t('extended.stage.noVersions')} />
          )}
        </main>
      </div>

      {library.selected && (
        <RestoreDialog
          file={library.selected}
          version={restoring}
          onClose={() => setRestoring(null)}
          onRestored={(safety) => {
            setNotice(
              safety
                ? t('extended.restore.doneWithSafety')
                : t('extended.restore.done'),
            );
            history.reload();
          }}
          onError={setFailure}
        />
      )}
    </Shell>
  );
}

function Shell({ header, children }: { header?: React.ReactNode; children: React.ReactNode }) {
  const { t } = useTranslation();

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header
          data-tauri-drag-region
          className="flex h-11 shrink-0 items-center gap-4 border-b border-border px-4 pl-20"
        >
          <span className="text-xs font-bold tracking-widest uppercase" data-tauri-drag-region>
            {t('extended.title')}
          </span>
          {header}
        </header>
        {children}
      </div>
    </TooltipProvider>
  );
}

interface StageHeaderProps {
  head: Version;
  base: Version | null;
  canCompare: boolean;
  onCompareWithPrevious(): void;
  onClearCompare(): void;
  onRestore(): void;
}

function StageHeader({
  head,
  base,
  canCompare,
  onCompareWithPrevious,
  onClearCompare,
  onRestore,
}: StageHeaderProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {base && (
          <>
            <VersionPill version={base} tone="base" />
            <ArrowLeftRight aria-hidden className="size-3 shrink-0 text-muted-foreground/40" />
          </>
        )}
        <VersionPill version={head} tone="head" />
        <time
          className="shrink-0 font-mono text-[10px] text-muted-foreground"
          dateTime={new Date(head.timestamp * 1000).toISOString()}
        >
          {formatRelative(head.timestamp, i18n.language)}
        </time>
      </div>

      {base ? (
        <Button variant="ghost" size="xs" onClick={onClearCompare}>
          <X data-icon="inline-start" />
          {t('extended.stage.exitCompare')}
        </Button>
      ) : (
        canCompare && (
          <Button variant="ghost" size="xs" onClick={onCompareWithPrevious}>
            <ArrowLeftRight data-icon="inline-start" />
            {t('extended.stage.compareWithPrevious')}
          </Button>
        )
      )}

      <Button variant="outline" size="xs" onClick={onRestore}>
        <RotateCcw data-icon="inline-start" />
        {t('extended.stage.restore')}
      </Button>
    </div>
  );
}

function VersionPill({ version, tone }: { version: Version; tone: 'base' | 'head' }) {
  const { t } = useTranslation();
  const label = version.kind === 'named' ? version.message : t('extended.timeline.autoSnapshot');

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className={cn('h-3 w-0.5 shrink-0', tone === 'base' ? 'bg-diff-removed' : 'bg-brand')}
      />
      <span
        className={cn(
          'truncate text-xs',
          version.kind === 'named' ? 'text-foreground' : 'text-muted-foreground italic',
        )}
        title={label}
      >
        {label}
      </span>
    </span>
  );
}

interface FileSelectorProps {
  files: TrackedFile[];
  selected: TrackedFile;
  onSelect(id: string): void;
  onAddFile(): void;
}

function FileSelector({ files, selected, onSelect, onAddFile }: FileSelectorProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="xs" />}>
        {selected.name}
        <ChevronDown data-icon="inline-end" className="opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-100">
        {files.map((file) => (
          <DropdownMenuItem
            key={file.id}
            onClick={() => onSelect(file.id)}
            className={cn('text-xs', file.id === selected.id && 'text-brand-bright')}
          >
            <span className="truncate" title={file.path}>
              {file.name}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onAddFile} className="text-xs text-muted-foreground">
          <FilePlus2 />
          {t('extended.trackAnotherFile')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NoTrackedFiles({ onAddFile }: { onAddFile(): void }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 items-center justify-center">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FilePlus2 />
          </EmptyMedia>
          <EmptyTitle>{t('panel.empty.title')}</EmptyTitle>
          <EmptyDescription>{t('panel.empty.description')}</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" size="sm" onClick={onAddFile}>
          {t('panel.empty.action')}
        </Button>
      </Empty>
    </div>
  );
}

function Strip({
  tone,
  message,
  onDismiss,
}: {
  tone: 'error' | 'notice';
  message: string;
  onDismiss(): void;
}) {
  const { t } = useTranslation();

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex shrink-0 items-center gap-2 border-b py-1 pr-1 pl-4',
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-border bg-accent/40 text-foreground/80',
      )}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[10px]" title={message}>
        {message}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDismiss}
        aria-label={t('panel.dismissError')}
        className={cn(tone === 'error' && 'text-destructive hover:bg-destructive/20')}
      >
        <X />
      </Button>
    </div>
  );
}
