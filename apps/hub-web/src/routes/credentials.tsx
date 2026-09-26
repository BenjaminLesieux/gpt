import { createRoute, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@gpt/ui/button';
import { CopyButton } from '@/components/copy-button';
import { clearHandoff, peekHandoff, usePendingHandoff } from '@/lib/credentials-handoff';
import { authedRoute } from './authed';

const ROW_LABEL =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground';

function ValueRow({
  label,
  value,
  copyLabel,
  last,
}: {
  label: string;
  value: string;
  copyLabel: string;
  last?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[110px_1fr_auto] items-start gap-4 px-4 py-3.5 ${
        last ? '' : 'border-b border-border-subtle'
      }`}
    >
      <div className={`${ROW_LABEL} pt-1`}>{label}</div>
      {/* Monospace because the user has to compare this character by
          character against a field in another app. */}
      <div className="break-all font-mono text-sm leading-normal text-foreground">{value}</div>
      <CopyButton value={value} label={copyLabel} />
    </div>
  );
}

function CredentialsPage() {
  const { t } = useTranslation();
  const score = usePendingHandoff();
  const navigate = credentialsRoute.useNavigate();

  if (!score) return null;

  const all = [
    `${t('credentials.url')}: ${score.url}`,
    `${t('credentials.username')}: ${score.username}`,
    `${t('credentials.token')}: ${score.token}`,
  ].join('\n');

  return (
    <main className="flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-12">
      <div className="flex w-full max-w-[720px] flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-sm uppercase tracking-wide text-muted-foreground">
            {t('credentials.eyebrow')}
          </p>
          <h1 className="text-2xl font-medium leading-tight tracking-tight">
            {t('credentials.title', { name: score.name })}
          </h1>
        </div>

        {/* The instruction outranks the warning: it is why they are here. */}
        <div className="flex flex-col gap-2 border border-border border-l-2 border-l-brand bg-card px-6 py-5">
          <p className="text-lg font-medium leading-snug text-foreground">
            {t('credentials.instruction')}
          </p>
          <p className="text-base leading-normal text-muted-foreground">
            {t('credentials.detail')}
          </p>
        </div>

        <div className="border border-border bg-card">
          <ValueRow
            label={t('credentials.url')}
            value={score.url}
            copyLabel={t('credentials.copyUrl')}
          />
          <ValueRow
            label={t('credentials.username')}
            value={score.username}
            copyLabel={t('credentials.copyUsername')}
          />
          <ValueRow
            label={t('credentials.token')}
            value={score.token}
            copyLabel={t('credentials.copyToken')}
            last
          />
        </div>

        <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
          <p className="flex flex-1 items-start gap-2.5 border border-brand-border bg-brand-dim px-3 py-2.5">
            <span className="whitespace-nowrap pt-px font-mono text-sm font-bold text-brand-bright">
              {t('credentials.shownOnce')}
            </span>
            <span className="text-sm leading-snug text-foreground">
              {t('credentials.shownOnceDetail')}
            </span>
          </p>
          <CopyButton
            value={all}
            label={t('credentials.copyAllLabel')}
            size="default"
            className="h-10 whitespace-nowrap rounded-sm border-border-strong px-5"
          >
            {t('credentials.copyAll')}
          </CopyButton>
        </div>

        <div className="flex justify-end border-t border-border-subtle pt-5">
          <Button
            className="rounded-sm"
            onClick={async () => {
              clearHandoff();
              await navigate({ to: '/' });
            }}
          >
            {t('credentials.done')}
          </Button>
        </div>
      </div>
    </main>
  );
}

export const credentialsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/credentials',
  // Reachable only straight after a create. A reload has already lost the
  // token, so landing here with nothing in hand means going back to the list
  // rather than showing an empty screen that implies it could be recovered.
  beforeLoad: () => {
    if (!peekHandoff()) throw redirect({ to: '/' });
  },
  component: CredentialsPage,
});
