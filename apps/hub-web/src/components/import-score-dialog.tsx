import { useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useTranslation } from 'react-i18next';
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
import { Field, FieldError, FieldLabel } from '@gpt/ui/field';
import { Input } from '@gpt/ui/input';
import { HubError, type CreatedScore } from '@/lib/api';
import { ImportFailed } from '@/lib/queries';

/** Matches GP_EXTENSIONS in the companion's config.rs. */
const GP_EXTENSIONS = ['.gp', '.gpx', '.gp5', '.gp4', '.gp3'];

/** The hub's own cap. Refused here so an oversized file is a sentence, not a 413. */
const MAX_SCORE_BYTES = 32 * 1024 * 1024;

interface ImportScoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  error: unknown;
  onImport: (name: string, file: File) => Promise<unknown>;
  onRetry: (score: CreatedScore, file: File) => Promise<unknown>;
}

/** A song's name is its filename without the extension, nine times in ten. */
function nameFromFile(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').trim();
}

export function ImportScoreDialog({
  open,
  onOpenChange,
  submitting,
  error,
  onImport,
  onRetry,
}: ImportScoreDialogProps) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);

  // The score the create leg already made. Sending the file again has to go
  // to this one, or a musician who retries twice ends up with three scores.
  const stranded = error instanceof ImportFailed ? error.score : null;

  const form = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      if (!file) return;
      if (stranded) {
        await onRetry(stranded, file);
        return;
      }
      await onImport(value.name.trim(), file);
    },
  });

  function reset() {
    form.reset();
    setFile(null);
    setTooLarge(false);
    if (pickerRef.current) pickerRef.current.value = '';
  }

  function choose(chosen: File | null) {
    setTooLarge(chosen !== null && chosen.size > MAX_SCORE_BYTES);
    setFile(chosen);
    // Only as a starting point: a name already typed is the user's.
    if (chosen && form.state.values.name.trim().length === 0) {
      form.setFieldValue('name', nameFromFile(chosen.name));
    }
  }

  const blocked = submitting || !file || tooLarge;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-flight would strand a score with nowhere to show its
        // credentials, exactly as it would while creating one.
        if (submitting) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-w-[440px] gap-5 rounded-lg border border-border bg-popover p-6 shadow-[0_8px_32px_rgba(0,0,0,.6)] ring-0"
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">{t('import.title')}</DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <Field>
            <FieldLabel
              htmlFor="import-file"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t('import.file')}
            </FieldLabel>
            <Input
              id="import-file"
              ref={pickerRef}
              type="file"
              accept={GP_EXTENSIONS.join(',')}
              disabled={submitting}
              onChange={(event) => choose(event.target.files?.[0] ?? null)}
              className="h-10 rounded-sm bg-card py-2 shadow-none file:mr-3 file:border-0 file:bg-transparent file:text-sm file:text-muted-foreground"
            />
            <DialogDescription className="text-sm leading-normal text-muted-foreground">
              {t('import.description', { extensions: GP_EXTENSIONS.join(', ') })}
            </DialogDescription>
            {tooLarge && (
              <FieldError
                errors={[{ message: t('import.tooLarge') }]}
              />
            )}
          </Field>

          <form.Field
            name="name"
            validators={{
              onBlur: ({ value }) =>
                value.trim().length > 0 ? undefined : { message: t('common.nameRequired') },
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel
                  htmlFor={field.name}
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {t('common.name')}
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder={t('common.namePlaceholder')}
                  disabled={submitting || stranded !== null}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  className="h-10 rounded-sm bg-card shadow-none"
                />
                {field.state.meta.isTouched && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )}
          </form.Field>

          {submitting && (
            <div className="flex flex-col gap-2.5" aria-live="polite">
              <p className="text-base text-foreground">
                {stranded ? t('import.resending') : t('import.importing')}
              </p>
              <div className="relative h-0.5 overflow-hidden bg-accent">
                <div className="absolute inset-y-0 left-0 w-[30%] animate-[hub-indeterminate_1.4s_ease-in-out_infinite] bg-brand" />
              </div>
            </div>
          )}

          {stranded && !submitting && (
            <p
              role="alert"
              className="rounded-sm border border-brand-border bg-brand-dim px-3 py-2.5 text-sm leading-normal text-foreground"
            >
              {t('import.stranded', { name: stranded.name })}
            </p>
          )}

          {error != null && !stranded && (
            <p
              role="alert"
              className="rounded-sm border border-brand-border bg-brand-dim px-3 py-2.5 text-sm leading-normal text-foreground"
            >
              {error instanceof HubError ? error.message : t('common.genericError')}
            </p>
          )}

          <DialogFooter className="gap-2">
            <DialogClose
              render={
                <Button type="button" variant="ghost" disabled={submitting} className="rounded-sm">
                  {t('common.cancel')}
                </Button>
              }
            />
            <Button type="submit" disabled={blocked} className="rounded-sm">
              {stranded ? t('import.retry') : t('import.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
