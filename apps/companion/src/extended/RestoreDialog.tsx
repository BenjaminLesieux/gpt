import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Spinner } from '@/components/ui/spinner';
import { restoreVersion, type TrackedFile, type Version } from '@/lib/ipc';

interface RestoreDialogProps {
  file: TrackedFile;
  version: Version | null;
  onClose(): void;
  /** `safety` is the snapshot the host took of the file it overwrote. */
  onRestored(safety: Version | null): void;
  onError(message: string): void;
}

/**
 * Restore writes over the file Guitar Pro has open, so it asks first.
 *
 * The host snapshots the current bytes before overwriting them, which is what
 * makes this reversible — and the reason to say so in the dialog rather than
 * hedge with a scarier warning.
 */
export function RestoreDialog({
  file,
  version,
  onClose,
  onRestored,
  onError,
}: RestoreDialogProps) {
  const { t } = useTranslation();
  const [restoring, setRestoring] = useState(false);

  async function confirm() {
    if (!version) return;
    setRestoring(true);
    try {
      onRestored(await restoreVersion(file.id, version.id));
      onClose();
    } catch (cause) {
      onError(String(cause));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <AlertDialog open={version !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('extended.restore.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('extended.restore.description', {
              version:
                version?.kind === 'named' ? version.message : t('extended.timeline.autoSnapshot'),
              file: file.name,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={restoring}>{t('extended.restore.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={restoring}>
            {restoring && <Spinner data-icon="inline-start" />}
            {t('extended.restore.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
