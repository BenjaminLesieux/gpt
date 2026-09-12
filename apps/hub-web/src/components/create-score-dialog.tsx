import { useForm } from '@tanstack/react-form';
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
import { HubError } from '@/lib/api';

interface CreateScoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  error: unknown;
  onCreate: (name: string) => Promise<unknown>;
}

export function CreateScoreDialog({
  open,
  onOpenChange,
  submitting,
  error,
  onCreate,
}: CreateScoreDialogProps) {
  const form = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      await onCreate(value.name.trim());
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // The dialog stays put while the server is working: closing it would
        // strand a half-made score with nowhere to show its credentials.
        if (submitting) return;
        if (!next) form.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-w-[440px] gap-5 rounded-lg border border-border bg-popover p-6 shadow-[0_8px_32px_rgba(0,0,0,.6)] ring-0"
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">Create score</DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="name"
            validators={{
              onBlur: ({ value }) =>
                value.trim().length > 0 ? undefined : { message: 'Give the score a name.' },
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel
                  htmlFor={field.name}
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Name
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  autoFocus
                  placeholder="Untitled riff"
                  disabled={submitting}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  className="h-10 rounded-sm bg-card shadow-none"
                />
                <DialogDescription className="text-sm leading-normal text-muted-foreground">
                  Give it the song's name. This takes a few seconds — we're setting up
                  storage for it on the server.
                </DialogDescription>
                {field.state.meta.isTouched && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )}
          </form.Field>

          {submitting && (
            <div className="flex flex-col gap-2.5" aria-live="polite">
              <p className="text-base text-foreground">
                Setting up “{form.state.values.name.trim()}”…
              </p>
              {/* Honest indeterminate bar: the wait is real and its length
                  is not known, so a skeleton would be a guess. */}
              <div className="relative h-0.5 overflow-hidden bg-accent">
                <div className="absolute inset-y-0 left-0 w-[30%] animate-[hub-indeterminate_1.4s_ease-in-out_infinite] bg-brand" />
              </div>
            </div>
          )}

          {error != null && (
            <p
              role="alert"
              className="rounded-sm border border-brand-border bg-brand-dim px-3 py-2.5 text-sm leading-normal text-foreground"
            >
              {error instanceof HubError
                ? error.message
                : 'Something went wrong. Try again.'}
            </p>
          )}

          <DialogFooter className="gap-2">
            <DialogClose
              render={
                <Button type="button" variant="ghost" disabled={submitting} className="rounded-sm">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={submitting} className="rounded-sm">
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
