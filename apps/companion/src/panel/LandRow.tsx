import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { GitMerge, Users } from 'lucide-react';
import { Button } from '@gpt/ui/button';
import { Spinner } from '@gpt/ui/spinner';
import { Toggle } from '@gpt/ui/toggle';
import { cn } from '@gpt/ui/lib/utils';
import { askFirst, landBranch, setAskFirst, type LandOutcome, type TrackedFile } from '@/lib/ipc';

const MAIN = 'main';

/** A branch other than main, on a score the hub serves. */
export function canLand(file: TrackedFile): boolean {
  return (
    file.branch !== MAIN &&
    file.remote?.auth.kind === 'token' &&
    /\/git\/[^/]+\/[^/]+\.git$/.test(file.remote.url)
  );
}

/** One tap to land the current branch on main, and what came of it. */
export function LandRow({ file, onError }: { file: TrackedFile; onError(message: string): void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<LandOutcome | null>(null);
  const [asking, setAsking] = useState(false);

  // Off until the hub answers; offline it stays off rather than erroring.
  useEffect(() => {
    let live = true;
    askFirst(file.id).then(
      (held) => live && setAsking(held),
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [file.id, file.branch]);

  async function land() {
    setBusy(true);
    setOutcome(null);
    try {
      const landed = await landBranch(file.id);
      setOutcome(landed);
      if (landed.status === 'waiting') setAsking(true);
    } catch (cause) {
      onError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(pressed: boolean) {
    try {
      setAsking(await setAskFirst(file.id, pressed));
    } catch (cause) {
      onError(String(cause));
    }
  }

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="xs" onClick={() => void land()} disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : <GitMerge data-icon="inline-start" />}
          {t('panel.land.action')}
        </Button>
        <Toggle
          size="sm"
          pressed={asking}
          onPressedChange={(pressed) => void toggle(pressed)}
          className="h-6 min-w-0 px-1.5 text-[10px] text-muted-foreground aria-pressed:text-foreground [&_svg]:size-3"
        >
          <Users />
          {t('panel.land.askFirst')}
        </Toggle>
      </div>
      {outcome && (
        <p
          role="status"
          className={cn('mt-1 truncate font-mono text-[10px]', tone(outcome))}
          title={
            outcome.status === 'conflicts'
              ? outcome.conflicts.map((conflict) => conflict.description).join('\n')
              : undefined
          }
        >
          {describe(outcome, t)}
        </p>
      )}
    </div>
  );
}

function describe(outcome: LandOutcome, t: TFunction): string {
  switch (outcome.status) {
    case 'landed':
      return t('panel.land.landed');
    case 'clean':
      return t('panel.land.clean');
    case 'waiting':
      return t('panel.land.waiting');
    case 'conflicts':
      return t('panel.land.conflicts', {
        count: new Set(outcome.conflicts.map((conflict) => conflict.bar)).size,
      });
    case 'unreadable':
      return t('panel.land.unreadable');
    case 'up_to_date':
      return t('panel.land.upToDate');
    case 'main_moved':
      return t('panel.land.mainMoved');
  }
}

function tone(outcome: LandOutcome): string {
  switch (outcome.status) {
    case 'landed':
      return 'text-success';
    case 'clean':
    case 'up_to_date':
      return 'text-muted-foreground';
    default:
      return 'text-warning';
  }
}
