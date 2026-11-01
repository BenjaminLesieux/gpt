import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { Badge } from '@gpt/ui/badge';
import { Button } from '@gpt/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gpt/ui/dialog';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@gpt/ui/empty';
import { Input } from '@gpt/ui/input';
import { Label } from '@gpt/ui/label';
import { ScrollArea } from '@gpt/ui/scroll-area';
import { Skeleton } from '@gpt/ui/skeleton';
import { Spinner } from '@gpt/ui/spinner';
import {
  adoptScore,
  listScores,
  pickAndAdoptRemote,
  type RemoteAuth,
  type Score,
  type TrackedFile,
} from '@/lib/ipc';

interface AdoptDialogProps {
  open: boolean;
  /** What is tracked already, to mark the scores that are on this machine. */
  files: TrackedFile[];
  onClose(): void;
  onAdopted(file: TrackedFile): void;
  onError(message: string): void;
}

/**
 * A score that exists on a server and nowhere on this machine.
 *
 * Picked from the signed-in account's scores, or — behind *different hub* —
 * pasted as the same triple `RemoteDialog` takes, for a hub this companion is
 * not signed in to. Both end in the same host adoption: a picked score is only
 * a triple the hub minted instead of one the user pasted. The path is not a
 * field: the host puts up a save dialog, so the file lands where the user
 * points and the name comes back from the OS rather than from typing.
 */
export function AdoptDialog({ open, files, onClose, onAdopted, onError }: AdoptDialogProps) {
  const { t } = useTranslation();
  const [elsewhere, setElsewhere] = useState(false);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [adopting, setAdopting] = useState(false);

  // Reopening starts clean: this dialog adopts a different score every time.
  useEffect(() => {
    if (!open) return;
    setElsewhere(false);
    setUrl('');
    setUsername('');
    setToken('');
  }, [open]);

  const trimmedUrl = url.trim();
  /** A token sent over plain http travels in the clear. */
  const insecure =
    /^http:\/\//i.test(trimmedUrl) && (token.length > 0 || username.length > 0);

  async function run(adoption: () => Promise<TrackedFile | null>) {
    setAdopting(true);
    try {
      const adopted = await adoption();
      // Cancelling the save dialog leaves the dialog as it was.
      if (!adopted) return;

      onAdopted(adopted);
      onClose();
    } catch (cause) {
      onError(String(cause));
    } finally {
      setAdopting(false);
    }
  }

  function adoptPasted() {
    if (trimmedUrl.length === 0) return;
    const auth: RemoteAuth =
      token.length > 0 || username.length > 0
        ? { kind: 'token', username: username.trim() }
        : { kind: 'none' };

    void run(() =>
      pickAndAdoptRemote(trimmedUrl, auth, token.length > 0 ? token : undefined),
    );
  }

  function adoptPicked(score: Score) {
    void run(() => adoptScore(score.id, score.name));
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('extended.adopt.title')}</DialogTitle>
          <DialogDescription>
            {t(elsewhere ? 'extended.adopt.description' : 'extended.adopt.pick')}
          </DialogDescription>
        </DialogHeader>

        {elsewhere ? (
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
        ) : (
          <ScoreList files={files} disabled={adopting} onPick={adoptPicked} />
        )}

        <DialogFooter>
          <Button
            variant="link"
            className="mr-auto px-0"
            onClick={() => setElsewhere(!elsewhere)}
            disabled={adopting}
          >
            {t(elsewhere ? 'extended.adopt.yourScores' : 'extended.adopt.differentHub')}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={adopting}>
            {t('extended.remote.cancel')}
          </Button>
          {elsewhere && (
            <Button onClick={adoptPasted} disabled={adopting || trimmedUrl.length === 0}>
              {adopting && <Spinner data-icon="inline-start" />}
              {t('extended.adopt.action')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The account's scores, fetched each time the list is shown. */
function ScoreList({
  files,
  disabled,
  onPick,
}: {
  files: TrackedFile[];
  disabled: boolean;
  onPick(score: Score): void;
}) {
  const { t } = useTranslation();
  const [scores, setScores] = useState<Score[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setScores(null);
    setError(null);
    listScores().then(
      (answer) => !cancelled && setScores(answer),
      (cause) => !cancelled && setError(String(cause)),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (error !== null) {
    return (
      <Empty className="p-6">
        <EmptyHeader>
          <EmptyTitle>{t('extended.adopt.loadFailed')}</EmptyTitle>
          <EmptyDescription role="alert" className="text-destructive">
            {error}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={() => setAttempt(attempt + 1)}>
            {t('extended.adopt.retry')}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (scores === null) {
    return (
      <div className="grid gap-2" aria-busy="true">
        <Skeleton className="h-9 rounded-sm" />
        <Skeleton className="h-9 rounded-sm" />
        <Skeleton className="h-9 rounded-sm" />
      </div>
    );
  }

  if (scores.length === 0) {
    return (
      <Empty className="p-6">
        <EmptyHeader>
          <EmptyTitle>{t('extended.adopt.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('extended.adopt.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const tracked = new Set(files.map((file) => file.remote?.url));
  return (
    <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-72">
      <ul className="grid gap-px">
        {scores.map((score) => {
          const here = tracked.has(score.url);
          return (
            <li key={score.id}>
              {/* A second copy of a tracked score would push to the same remote and diverge. */}
              <Button
                variant="ghost"
                className="w-full justify-between"
                disabled={disabled || here}
                onClick={() => onPick(score)}
              >
                <span className="truncate">{score.name}</span>
                {here && (
                  <Badge variant="outline" className="rounded-sm">
                    {t('extended.adopt.tracked')}
                  </Badge>
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}
