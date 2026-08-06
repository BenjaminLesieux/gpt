import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { setRemote, type RemoteAuth, type TrackedFile } from '@/lib/ipc';

interface RemoteDialogProps {
  file: TrackedFile;
  open: boolean;
  onClose(): void;
  onSaved(): void;
  onError(message: string): void;
}

/**
 * Where a score is pushed, and what it authenticates with.
 *
 * The token is write-only from here on. It goes to the keychain and the host
 * never hands it back, so an existing one shows as an empty field that means
 * "unchanged" rather than as a row of dots pretending to be the secret.
 */
export function RemoteDialog({ file, open, onClose, onSaved, onError }: RemoteDialogProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);

  // Reopening shows what is stored, not what was typed and abandoned last time.
  useEffect(() => {
    if (!open) return;
    setUrl(file.remote?.url ?? '');
    setUsername(file.remote?.auth.kind === 'token' ? file.remote.auth.username : '');
    setToken('');
  }, [open, file.remote]);

  const trimmedUrl = url.trim();
  const hasStoredToken = file.remote?.auth.kind === 'token';
  /** A token sent over plain http travels in the clear. */
  const insecure =
    /^http:\/\//i.test(trimmedUrl) && (token.length > 0 || username.length > 0 || hasStoredToken);

  async function save() {
    if (trimmedUrl.length === 0) return;
    setSaving(true);
    try {
      // Nothing to authenticate with means nothing to authenticate — a bare
      // repo on a disk or a server that asks for nothing.
      const auth: RemoteAuth =
        token.length > 0 || username.length > 0 || hasStoredToken
          ? { kind: 'token', username: username.trim() }
          : { kind: 'none' };

      await setRemote(file.id, trimmedUrl, auth, token.length > 0 ? token : undefined);
      onSaved();
      onClose();
    } catch (cause) {
      onError(String(cause));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await setRemote(file.id, null);
      onSaved();
      onClose();
    } catch (cause) {
      onError(String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('extended.remote.title')}</DialogTitle>
          <DialogDescription>
            {t('extended.remote.description', { file: file.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="remote-url">{t('extended.remote.url')}</Label>
            <Input
              id="remote-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://git.example.com/you/song.git"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="remote-username">{t('extended.remote.username')}</Label>
            <Input
              id="remote-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t('extended.remote.usernamePlaceholder')}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="remote-token">{t('extended.remote.token')}</Label>
            <Input
              id="remote-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={
                hasStoredToken
                  ? t('extended.remote.tokenStored')
                  : t('extended.remote.tokenPlaceholder')
              }
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
          {file.remote && (
            <Button variant="ghost" onClick={remove} disabled={saving} className="mr-auto">
              {t('extended.remote.remove')}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('extended.remote.cancel')}
          </Button>
          <Button onClick={save} disabled={saving || trimmedUrl.length === 0}>
            {saving && <Spinner data-icon="inline-start" />}
            {t('extended.remote.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
