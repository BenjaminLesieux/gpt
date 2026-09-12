import { Button } from '@gpt/ui/button';
import { Separator } from '@gpt/ui/separator';
import { Wordmark } from './wordmark';

/**
 * The signed-in shell. Content starts below it, so a left nav can be added
 * later by splitting the region underneath rather than redrawing this.
 */
export function Header({ email, onLogOut }: { email: string; onLogOut: () => void }) {
  return (
    <header className="flex h-14 flex-none items-center justify-between border-b border-border-subtle px-6">
      <Wordmark className="text-md" />
      <div className="flex items-center gap-4">
        <span className="hidden font-mono text-sm text-muted-foreground sm:inline">{email}</span>
        <Separator orientation="vertical" className="hidden h-5 bg-border-subtle sm:block" />
        <Button variant="ghost" size="sm" onClick={onLogOut}>
          Log out
        </Button>
      </div>
    </header>
  );
}
