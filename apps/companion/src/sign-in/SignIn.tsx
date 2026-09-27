import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LogIn } from 'lucide-react';
import { Button } from '@gpt/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@gpt/ui/empty';
import { Field, FieldError, FieldLabel } from '@gpt/ui/field';
import { Input } from '@gpt/ui/input';
import { Spinner } from '@gpt/ui/spinner';
import { cn } from '@gpt/ui/lib/utils';
import type { Auth } from './useAuth';

/** `Hub::new`'s rule, so a typo is caught before the host is asked. */
function isHub(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value);
    return (
      protocol === 'https:' ||
      (protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname))
    );
  } catch {
    return false;
  }
}

/**
 * What both windows show while signed out: the hub's address, one button, why,
 * and — once the browser is open — that it is waiting, with a way to start
 * again. `compact` is the panel's 420×320 cut.
 */
export function SignIn({ auth, compact = false }: { auth: Auth; compact?: boolean }) {
  const { t } = useTranslation();
  const signedOut = auth.state?.kind === 'signedOut' ? auth.state : null;
  const failure = auth.error ?? signedOut?.failure ?? null;
  // Follows the host's last hub until something is typed, so a sign-in the
  // other window started is restarted here with the same address.
  const [typed, setTyped] = useState<string | null>(null);
  const hub = typed ?? signedOut?.hub ?? '';
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const address = hub.trim();
    if (!isHub(address)) {
      setInvalid(true);
      return;
    }
    auth.signIn(address);
  }

  return (
    <Empty className={cn(compact && 'justify-center gap-3 p-6')}>
      <EmptyHeader className={cn(compact && 'gap-1.5')}>
        <EmptyMedia
          variant="icon"
          className={cn(compact && 'mb-1 size-9 rounded-none bg-brand-dim text-brand-bright')}
        >
          <LogIn className={cn(compact && 'size-5')} />
        </EmptyMedia>
        <EmptyTitle className={cn(compact && 'text-md font-bold tracking-tight')}>
          {t('signIn.title')}
        </EmptyTitle>
        <EmptyDescription className={cn(compact && 'text-xs')}>{t('signIn.why')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="gap-2">
        <form onSubmit={submit} noValidate className="w-full">
          <Field data-invalid={invalid} className="gap-2">
            <FieldLabel htmlFor="sign-in-hub" className={cn(compact && 'sr-only')}>
              {t('signIn.hub')}
            </FieldLabel>
            {/* In the panel the button sits beside the field: there is no height to spare. */}
            <div className={cn('flex gap-2', !compact && 'flex-col')}>
              <Input
                id="sign-in-hub"
                type="url"
                value={hub}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setInvalid(false);
                }}
                placeholder="https://hub.example.com"
                aria-invalid={invalid}
                spellCheck={false}
                autoComplete="url"
                className={cn(compact && 'h-8 text-xs')}
              />
              <Button type="submit" size="sm" variant={signedOut?.waiting ? 'ghost' : 'default'}>
                {t(signedOut?.waiting ? 'signIn.again' : 'signIn.action')}
              </Button>
            </div>
            {invalid && <FieldError className="text-xs">{t('signIn.invalidHub')}</FieldError>}
          </Field>
        </form>
        {signedOut?.waiting && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3" />
            {t('signIn.waiting')}
          </span>
        )}
        {failure && (
          <p role="alert" className="text-xs text-destructive">
            {failure}
          </p>
        )}
      </EmptyContent>
    </Empty>
  );
}
