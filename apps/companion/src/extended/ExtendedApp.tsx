import { useTranslation } from 'react-i18next';

/**
 * Extended window — timeline, visual diff, restore, playback.
 *
 * M1 ships the shell only; the real content lands in M4.
 */
export function ExtendedApp() {
  const { t } = useTranslation();

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header
        data-tauri-drag-region
        className="flex h-11 shrink-0 items-center border-b border-border px-4 pl-20"
      >
        <span className="text-xs font-bold tracking-widest uppercase" data-tauri-drag-region>
          {t('extended.title')}
        </span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">{t('extended.windowTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('extended.comingInM4')}</p>
      </main>
    </div>
  );
}
