import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@gpt/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gpt/ui/dialog';
import { Input } from '@gpt/ui/input';
import { Label } from '@gpt/ui/label';
import { Spinner } from '@gpt/ui/spinner';
import { pickAndAdoptRemote, type RemoteAuth, type TrackedFile } from '@/lib/ipc';

interface AdoptDialogProps {
  open: boolean;
  onClose(): void;
  onAdopted(file: TrackedFile): void;
  onError(message: string): void;
}

/**
 * A score that exists on a server and nowhere on this machine.
 *
 * The same triple as `RemoteDialog`, pasted the same way — there is no
 * list of an account's scores to pick from, and asking companion for one would
 * mean a credential that outranks a single score. The path is not a field: the
 * host puts up a save dialog, so the file lands where the user points and the
 * name comes back from the OS rather than from typing.
 */
export function AdoptDialog({ open, onClose, onAdopted, onError }: AdoptDialogProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [adopting, setAdopting] = useState(false);

  // Reopening starts clean: this dialog adopts a different score every time.
  useEffect(() => {
    if (!open) return;
    setUrl('');
    setUsername('');
    setToken('');
  }, [open]);

  const trimmedUrl = url.trim();
  /** A token sent over plain http travels in the clear. */
  const insecure =
    /^http:\/\//i.test(trimmedUrl) && (token.length > 0 || username.length > 0);

  async function adopt() {
    if (trimmedUrl.length === 0) return;
    setAdopting(true);
    try {
      const auth: RemoteAuth =
        token.length > 0 || username.length > 0
          ? { kind: 'token', username: username.trim() }
          : { kind: 'none' };

      const adopted = await pickAndAdoptRemote(
        trimmedUrl,
        auth,
        token.length > 0 ? token : undefined,
      );
      // Cancelling the save dialog leaves the triple where it was typed.
      if (!adopted) return;

      onAdopted(adopted);
      onClose();
    } catch (cause) {
      onError(String(cause));
    } finally {
      setAdopting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('extended.adopt.title')}</DialogTitle>
          <DialogDescription>{t('extended.adopt.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="adopt-url">{t('extended.remote.url')}</Label>
            <Input
              id="adopt-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://git.example.com/you/song.git"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="adopt-username">{t('extended.remote.username')}</Label>
            <Input
              id="adopt-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t('extended.remote.usernamePlaceholder')}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="adopt-token">{t('extended.remote.token')}</Label>
            <Input
              id="adopt-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={t('extended.remote.tokenPlaceholder')}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t('extended.remote.tokenHint')}</p>
          </div>

          {insecure && (
            <p className="flex items-start gap-2 border-l-2 border-warning/60 bg-warning/10 py-1.5 pr-2 pl-2 text-xs text-muted-foreground">
              <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
              {t('extended.remote.insecure')}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={adopting}>
            {t('extended.remote.cancel')}
          </Button>
          <Button onClick={() => void adopt()} disabled={adopting || trimmedUrl.length === 0}>
            {adopting && <Spinner data-icon="inline-start" />}
            {t('extended.adopt.action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
