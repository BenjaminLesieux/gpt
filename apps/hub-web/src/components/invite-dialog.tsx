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
import { Input } from '@gpt/ui/input';
import { CopyButton } from '@/components/copy-button';
import { HubError, type ScoreInvite } from '@/lib/api';
import { inviteLink } from '@/lib/invite-link';
import { until } from '@/lib/relative-time';

interface InviteDialogProps {
  /** Null while closed. Carries the score so the copy can name it. */
  score: { id: string; name: string } | null;
  /** Also drops `invite`, so reopening cannot flash the previous link. */
  onOpenChange: (open: boolean) => void;
  /** Mints the invite. What it hands back arrives as `invite`. */
  onInvite: (id: string) => Promise<ScoreInvite>;
  invite: ScoreInvite | null;
  minting: boolean;
  error: unknown;
}

/**
 * Adding somebody to a score, as a link and nothing else.
 *
 * There is no email field because there is no mailer: a field that took an
 * address and then asked the user to send the link themselves would be a
 * promise the hub cannot keep. The link *is* the message, so the whole dialog
 * is one value and a way to copy it.
 *
 * Minted when the dialog opens rather than on a button, because a code that
 * is not on screen is a button whose only outcome is another button.
 */
export function InviteDialog({
  score,
  onOpenChange,
  onInvite,
  invite,
  minting,
  error,
}: InviteDialogProps) {
  // One invite per opening. Without the guard StrictMode's double effect
  // mints two, and the first is a live link nobody will ever hold.
  const mintedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!score) {
      mintedForRef.current = null;
      return;
    }
    if (mintedForRef.current === score.id) return;
    mintedForRef.current = score.id;

    // The failure is already on the mutation; this only stops an unhandled
    // rejection.
    void onInvite(score.id).catch(() => undefined);
  }, [score, onInvite]);

  const link = invite ? inviteLink(window.location.origin, invite.code) : '';

  return (
    <Dialog open={score !== null} onOpenChange={(next) => !next && onOpenChange(next)}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[520px] gap-5 rounded-lg border border-border bg-popover p-6 shadow-[0_8px_32px_rgba(0,0,0,.6)] ring-0"
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">Invite someone to “{score?.name}”</DialogTitle>
          <DialogDescription className="text-sm leading-normal text-muted-foreground">
            Send them this link. Whoever opens it and signs in joins the score and can save
            versions to it — so send it to the band and not to a public channel.
          </DialogDescription>
        </DialogHeader>

        {error != null && (
          <p
            role="alert"
            className="rounded-sm border border-brand-border bg-brand-dim px-3 py-2.5 text-sm leading-normal text-foreground"
          >
            {error instanceof HubError ? error.message : 'Could not make a link. Try again.'}
          </p>
        )}

        {error == null && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                aria-label="Invite link"
                value={minting ? 'Making a link…' : link}
                // It is read character by character and pasted, never typed
                // into — and selecting the whole of it is the only thing
                // anyone does here.
                onFocus={(event) => event.currentTarget.select()}
                className="h-8 rounded-sm border-border bg-card font-mono text-xs"
              />
              {/* Only once there is something to copy: a control that
                  silently puts an empty string on the clipboard is worse
                  than one that is not there yet. */}
              {invite && (
                <CopyButton
                  value={link}
                  label={`Copy the invite link for ${score?.name ?? 'this score'}`}
                  className="h-8"
                />
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {invite
                ? `It works once, and stops working ${until(new Date(invite.expiresAt))}.`
                : 'One person, once.'}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <DialogClose
            render={
              <Button type="button" variant="ghost" className="rounded-sm">
                Done
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
