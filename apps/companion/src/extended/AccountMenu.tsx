import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, LogOut } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@gpt/ui/alert-dialog';
import { Button } from '@gpt/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@gpt/ui/dropdown-menu';
import { Spinner } from '@gpt/ui/spinner';

interface AccountMenuProps {
  email: string;
  onSignOut(): Promise<void>;
  onError(message: string): void;
}

/** Who is signed in, and the way out — asked first, because saves stop being recorded. */
export function AccountMenu({ email, onSignOut, onError }: AccountMenuProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function confirm() {
    setSigningOut(true);
    try {
      await onSignOut();
    } catch (cause) {
      onError(String(cause));
      setConfirming(false);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="xs" />}>
          {email}
          <ChevronDown data-icon="inline-end" className="opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setConfirming(true)} className="text-xs">
            <LogOut />
            {t('extended.account.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('extended.account.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('extended.account.description', { email })}</AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={signingOut}>{t('extended.account.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirm} disabled={signingOut}>
              {signingOut && <Spinner data-icon="inline-start" />}
              {t('extended.account.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
