import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { hidePanel, openExtendedWindow } from '@/lib/ipc';
import { CommitView } from './CommitView';
import { FileSwitcher } from './FileSwitcher';
import { PanelFooter, PanelHeader, PanelHint, PanelMark, PanelShell } from './PanelShell';
import { TrackFirstFile } from './TrackFirstFile';
import { useEnterAnimation } from './useEnterAnimation';
import { usePanelSession } from './usePanelSession';
import { usePanelShown } from './usePanelShown';

type Mode = 'commit' | 'switcher';

/**
 * Hotkey panel — the product's main gesture.
 *
 * Three mutually exclusive views, never mixed: nothing tracked yet, the commit
 * flow, or the file switcher. Escape always steps back one level and then out.
 */
export function PanelApp() {
  const { t } = useTranslation();
  const shownAt = usePanelShown();
  const session = usePanelSession(shownAt);
  const [mode, setMode] = useState<Mode>('commit');
  const card = useRef<HTMLDivElement>(null);

  useEnterAnimation(card, shownAt);

  // Reopening the panel always lands on the commit flow, whatever was left
  // open last time. `clearError` is stable, so `shownAt` is the real trigger.
  const { clearError } = session;
  useEffect(() => {
    setMode('commit');
    clearError();
  }, [shownAt, clearError]);

  const canSwitch = session.files.length > 0;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (mode === 'switcher') setMode('commit');
        else void hidePanel();
        return;
      }
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (canSwitch) setMode((current) => (current === 'switcher' ? 'commit' : 'switcher'));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, canSwitch]);

  return (
    <PanelShell ref={card}>
      <PanelHeader>
        <span className="flex items-center gap-2" data-tauri-drag-region>
          <PanelMark />
          <span className="text-xs font-bold tracking-widest uppercase" data-tauri-drag-region>
            {t('panel.title')}
          </span>
        </span>
        <WatchIndicator count={session.files.length} />
      </PanelHeader>

      {session.error && <ErrorStrip message={session.error} onDismiss={session.clearError} />}

      {session.active === null ? (
        <TrackFirstFile onAddFile={() => void session.addFile()} />
      ) : mode === 'switcher' ? (
        <FileSwitcher
          files={session.files}
          activeId={session.active.id}
          onSelect={(id) => {
            void session.select(id);
            setMode('commit');
          }}
          onAddFile={() => void session.addFile()}
        />
      ) : (
        <CommitView
          session={session}
          active={session.active}
          focusToken={shownAt}
          onOpenSwitcher={() => setMode('switcher')}
        />
      )}

      <PanelFooter>
        <span className="flex items-center gap-3">
          {session.active !== null &&
            (mode === 'switcher' ? (
              <>
                <PanelHint keys="⏎">{t('panel.hint.select')}</PanelHint>
                <PanelHint keys="esc">{t('panel.hint.back')}</PanelHint>
              </>
            ) : (
              <>
                <PanelHint keys="⏎">{t('panel.hint.commit')}</PanelHint>
                {canSwitch && <PanelHint keys="⌘K">{t('panel.hint.switch')}</PanelHint>}
              </>
            ))}
          {mode !== 'switcher' && <PanelHint keys="esc">{t('panel.hint.close')}</PanelHint>}
        </span>

        <Button
          variant="ghost"
          size="xs"
          onClick={() => void openExtendedWindow()}
          className="text-muted-foreground hover:text-foreground"
        >
          <Maximize2 data-icon="inline-start" />
          {t('panel.extendedWindow')}
        </Button>
      </PanelFooter>
    </PanelShell>
  );
}

/** How many files the watcher is holding — the panel's only ambient status. */
function WatchIndicator({ count }: { count: number }) {
  const { t } = useTranslation();

  return (
    <span
      className="relative flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground"
      title={t('panel.watching', { count })}
      data-tauri-drag-region
    >
      <span
        aria-hidden
        className={count > 0 ? 'size-[5px] bg-success' : 'size-[5px] bg-muted-foreground/40'}
      />
      {count}
    </span>
  );
}

function ErrorStrip({ message, onDismiss }: { message: string; onDismiss(): void }) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 py-1 pr-1 pl-3"
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-destructive" title={message}>
        {message}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDismiss}
        aria-label={t('panel.dismissError')}
        className="text-destructive hover:bg-destructive/20 hover:text-destructive"
      >
        <X />
      </Button>
    </div>
  );
}
