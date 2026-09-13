import { useEffect, useRef } from 'react';
import { Button } from '@gpt/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gpt/ui/dialog';
import { HubError, type Score } from '@/lib/api';
import { cloneLink, DOWNLOAD_URL, openCloneLink } from '@/lib/clone-link';

interface CloneScoreDialogProps {
  /** Null while closed. Carries the score so the copy can name it. */
  score: Score | null;
  onOpenChange: (open: boolean) => void;
  /** Mints the claim and hands back the code that goes in the link. */
  onClaim: (id: string) => Promise<{ code: string }>;
  claiming: boolean;
  error: unknown;
  /** The fallback: the three values on screen, as before Clone existed. */
  onShowValues: (id: string) => void;
  showingValues: boolean;
}

/**
 * Clone is a dialog and not a bare link because a `gitarpro://` link with no
 * app behind it fails silently in every browser — there is no event to catch
 * and nothing on screen would change. So the scheme is fired *under* a dialog
 * that stays up, and the two ways out sit beneath it: get the app, or fall
 * back to the copy-paste flow that existed before this did.
 */
export function CloneScoreDialog({
  score,
  onOpenChange,
  onClaim,
  claiming,
  error,
  onShowValues,
  showingValues,
}: CloneScoreDialogProps) {
  // One claim per opening. Without the guard, StrictMode's double effect
  // would mint two and leave the first unspendable for five minutes.
  const claimedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!score) {
      claimedForRef.current = null;
      return;
    }
    if (claimedForRef.current === score.id) return;
    claimedForRef.current = score.id;

    void onClaim(score.id).then(
      ({ code }) => openCloneLink(cloneLink(window.location.origin, code)),
      // The mutation already carries the failure; this only stops an
      // unhandled rejection.
      () => undefined
    );
  }, [score, onClaim]);

  const busy = claiming || showingValues;

  return (
    <Dialog open={score !== null} onOpenChange={(next) => !next && !busy && onOpenChange(next)}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[460px] gap-5 rounded-lg border border-border bg-popover p-6 shadow-[0_8px_32px_rgba(0,0,0,.6)] ring-0"
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">
            Add “{score?.name}” to this computer
          </DialogTitle>
          <DialogDescription className="text-sm leading-normal text-muted-foreground">
            Gitarpro should be asking you where to save it. It gets its own sign-in details
            for this machine — nothing is shared with the computer you set the score up on.
          </DialogDescription>
        </DialogHeader>

        {error != null && (
          <p
            role="alert"
            className="rounded-sm border border-brand-border bg-brand-dim px-3 py-2.5 text-sm leading-normal text-foreground"
          >
            {error instanceof HubError ? error.message : 'Something went wrong. Try again.'}
          </p>
        )}

        <div className="flex flex-col gap-3 border-t border-border-subtle pt-5">
          <p className="text-sm text-muted-foreground">Nothing happened?</p>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="secondary"
              className="rounded-sm"
              render={
                <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
                  Download Gitarpro
                </a>
              }
            />
            <Button
              variant="ghost"
              className="rounded-sm"
              disabled={busy || !score}
              onClick={() => score && onShowValues(score.id)}
            >
              {showingValues ? 'Getting them…' : 'Show the values instead'}
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <DialogClose
            render={
              <Button type="button" variant="ghost" disabled={busy} className="rounded-sm">
                Done
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
