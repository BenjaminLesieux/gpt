import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw } from 'lucide-react';
import { Button } from '@gpt/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpt/ui/tooltip';
import { onUpdateReady, restartToUpdate, updateReady } from '@/lib/ipc';

/** Shown only once a new version is downloaded. Never restarts on its own. */
export function UpdateButton({ onError }: { onError(message: string): void }) {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void updateReady().then(setVersion);
    const unlisten = onUpdateReady(setVersion);
    return () => void unlisten.then((stop) => stop());
  }, []);

  if (!version) return null;

  async function restart() {
    try {
      if (!(await restartToUpdate())) onError(t('extended.update.waitForSync'));
    } catch (error) {
      onError(String(error));
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" size="xs" onClick={() => void restart()} />}>
        <RotateCw data-icon="inline-start" />
        {t('extended.update.restart')}
      </TooltipTrigger>
      <TooltipContent>{t('extended.update.ready', { version })}</TooltipContent>
    </Tooltip>
  );
}
