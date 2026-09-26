import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@gpt/ui/button';
import { Separator } from '@gpt/ui/separator';
import { Wordmark } from './wordmark';

/**
 * The signed-in shell. Content starts below it, so a left nav can be added
 * later by splitting the region underneath rather than redrawing this.
 */
export function Header({ email, onLogOut }: { email: string; onLogOut: () => void }) {
  const { t } = useTranslation();

  return (
    <header className="flex h-14 flex-none items-center justify-between border-b border-border-subtle px-6">
      {/* The way back. /credentials is otherwise a dead end — its only exit is
          the button that says the token has been pasted, which is a lie if it
          hasn't been. */}
      <Link
        to="/"
        aria-label={t('common.yourScores')}
        className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <Wordmark className="text-md" />
      </Link>
      <div className="flex items-center gap-4">
        <span className="hidden font-mono text-sm text-muted-foreground sm:inline">{email}</span>
        <Separator orientation="vertical" className="hidden h-5 bg-border-subtle sm:block" />
        <Button variant="ghost" size="sm" onClick={onLogOut}>
          {t('auth.logOut')}
        </Button>
      </div>
    </header>
  );
}
