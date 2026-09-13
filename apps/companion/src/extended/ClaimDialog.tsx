import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@gpt/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gpt/ui/dialog';
import { Spinner } from '@gpt/ui/spinner';
import {
  adoptClaim,
  peekClaim,
  type ClaimArrivedEvent,
  type ClaimPeek,
  type TrackedFile,
} from '@/lib/ipc';

interface ClaimDialogProps {
  /** Null when no link has arrived. */
  claim: ClaimArrivedEvent | null;
  onClose(): void;
  onAdopted(file: TrackedFile): void;
}

/**
 * The same outcome as `AdoptDialog` reached from the other end: there the user
 * pastes a repository they already have credentials for, here the hub hands
 * one over and the credentials are minted on the way in.
 *
 * Nothing is decided from the link. The score's name is read back from the
 * hub, because a link is a thing anyone can write and one saying *Blackbird*
 * must not be able to deliver something else; the origin is shown as it
 * arrived, because that is what is about to be trusted and the confirmation
 * is the place to catch a lie about it.
 */
export function ClaimDialog({ claim, onClose, onAdopted }: ClaimDialogProps) {
  const { t } = useTranslation();
  const [peek, setPeek] = useState<ClaimPeek | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);

  useEffect(() => {
    if (!claim) return;

    setPeek(null);
    setFailure(null);
    setAdopting(false);

    // The peek consumes nothing, so a dialog the user cancels — or one a
    // second link replaces — costs the claim nothing.
    let current = true;
    void peekClaim(claim.hub, claim.claim).then(
      (read) => current && setPeek(read),
      (cause) => current && setFailure(String(cause)),
    );
    return () => {
      current = false;
    };
  }, [claim]);

  async function adopt() {
    if (!claim) return;
    setAdopting(true);
    setFailure(null);
    try {
      const adopted = await adoptClaim(claim.hub, claim.claim);
      // The save dialog was cancelled. Nothing was spent, so the dialog stays
      // up and the same link still works.
      if (!adopted) return;

      onAdopted(adopted);
      onClose();
    } catch (cause) {
      setFailure(String(cause));
    } finally {
      setAdopting(false);
    }
  }

  return (
    <Dialog open={claim !== null} onOpenChange={(next) => !next && !adopting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {peek ? t('extended.claim.title', { score: peek.scoreName }) : t('extended.claim.reading')}
          </DialogTitle>
          <DialogDescription>
            {t('extended.claim.description', { hub: peek?.hubName ?? claim?.hub })}
          </DialogDescription>
        </DialogHeader>

        {/* The origin as it arrived in the link, not as the hub described
            itself. It is the value being trusted, so it is the one to show. */}
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">{t('extended.claim.from')}</span>
          <span className="font-mono text-xs break-all text-foreground">{claim?.hub}</span>
        </div>

        {failure && (
          <p
            role="alert"
            className="border-l-2 border-destructive/60 bg-destructive/10 py-1.5 pr-2 pl-2 text-xs text-destructive"
          >
            {failure}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={adopting}>
            {t('extended.claim.cancel')}
          </Button>
          <Button onClick={() => void adopt()} disabled={adopting || peek === null}>
            {adopting && <Spinner data-icon="inline-start" />}
            {t('extended.claim.action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
