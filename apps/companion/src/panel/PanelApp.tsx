import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { hidePanel, openExtendedWindow } from '@/lib/ipc';

/**
 * Hotkey panel — the product's main gesture.
 *
 * M1 ships the shell only: the window plumbing, dismissal and the affordance
 * to open the extended window. The commit flow (active file, message input,
 * recent versions) lands in M3.
 */
export function PanelApp() {
  const { t } = useTranslation();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        void hidePanel();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-lg border border-border bg-popover text-foreground shadow-[var(--shadow-overlay)]">
      <header
        data-tauri-drag-region
        className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2"
      >
        <span className="text-xs font-bold tracking-widest uppercase" data-tauri-drag-region>
          {t('panel.title')}
        </span>
        <span className="text-xs text-muted-foreground" data-tauri-drag-region>
          {t('panel.noTrackedFile')}
        </span>
      </header>

      <main className="flex flex-1 flex-col items-start justify-center gap-1 px-4">
        <p className="text-sm text-muted-foreground">{t('panel.quickPanel')}</p>
        <p className="text-xs text-muted-foreground">{t('panel.commitFlowComingInM3')}</p>
      </main>

      <footer className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Kbd>Esc</Kbd> {t('panel.close')}
        </span>
        <Button variant="ghost" size="sm" onClick={() => void openExtendedWindow()}>
          {t('panel.extendedWindow')}
        </Button>
      </footer>
    </div>
  );
}
