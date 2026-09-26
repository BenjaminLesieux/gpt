import { useForm } from '@tanstack/react-form';
import { useTranslation } from 'react-i18next';
import { Button } from '@gpt/ui/button';
import { Field, FieldError, FieldLabel } from '@gpt/ui/field';
import { Input } from '@gpt/ui/input';
import { HubError } from '@/lib/api';

/**
 * The server's floor is ten characters and it ships no password reset, so the
 * field says ten. Promising eight here would only fail on submit.
 */
const MIN_PASSWORD = 10;

const LABEL = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';
const CONTROL = 'h-10 rounded-sm bg-card shadow-none';

interface AuthFormProps {
  mode: 'signup' | 'login';
  submitting: boolean;
  error: unknown;
  onSubmit: (values: { email: string; password: string }) => Promise<unknown>;
}

export function AuthForm({ mode, submitting, error, onSubmit }: AuthFormProps) {
  const { t } = useTranslation();
  const signup = mode === 'signup';

  const form = useForm({
    defaultValues: { email: '', password: '' },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {error != null && (
        // One sentence above the fields rather than red on each input: the
        // server will not say which of the two was wrong, so neither field
        // is the one to point at.
        <p
          role="alert"
          className="rounded-sm border border-brand-border bg-brand-dim px-3 py-2.5 text-sm leading-normal text-foreground"
        >
          {error instanceof HubError ? error.message : t('common.genericError')}
        </p>
      )}

      <form.Field
        name="email"
        validators={{
          onBlur: ({ value }) =>
            value.includes('@') ? undefined : { message: t('auth.emailInvalid') },
        }}
      >
        {(field) => (
          <Field data-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={field.name} className={LABEL}>
              {t('auth.email')}
            </FieldLabel>
            <Input
              id={field.name}
              name={field.name}
              type="email"
              autoComplete="email"
              placeholder={t('auth.emailPlaceholder')}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
              className={CONTROL}
            />
            {field.state.meta.isTouched && <FieldError errors={field.state.meta.errors} />}
          </Field>
        )}
      </form.Field>

      <form.Field
        name="password"
        validators={{
          onBlur: ({ value }) =>
            !signup || value.length >= MIN_PASSWORD
              ? undefined
              : { message: t('auth.passwordTooShort', { min: MIN_PASSWORD }) },
        }}
      >
        {(field) => (
          <Field data-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={field.name} className={LABEL}>
              {t('auth.password')}
            </FieldLabel>
            <Input
              id={field.name}
              name={field.name}
              type="password"
              autoComplete={signup ? 'new-password' : 'current-password'}
              placeholder={
                signup ? t('auth.passwordPlaceholder', { min: MIN_PASSWORD }) : undefined
              }
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
              className={CONTROL}
            />
            {field.state.meta.isTouched && <FieldError errors={field.state.meta.errors} />}
          </Field>
        )}
      </form.Field>

      <Button type="submit" disabled={submitting} className="h-10 w-full rounded-sm">
        {signup ? t('auth.createAccount') : t('auth.logIn')}
      </Button>
    </form>
  );
}
