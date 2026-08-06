import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronsUpDown, CornerDownLeft, EyeOff, FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import {
  hidePanel,
  requestAccessibility,
  type Binding,
  type TrackedFile,
  type Version,
} from '@/lib/ipc';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/utils';
import { PanelBody } from './PanelShell';
import { VersionLedger } from './VersionLedger';
import type { PanelSession } from './usePanelSession';

/**
 * How long the confirmation stays up before the panel dismisses itself.
 * Long enough to register, short enough that the user is back in Guitar Pro
 * without noticing the detour.
 */
const CONFIRM_MS = 450;

type Phase = 'idle' | 'saving' | 'saved';

/**
 * The product's main gesture: read what changed, name it, press Enter, gone.
 */
export function CommitView({
  session,
  active,
  focusToken,
  onOpenSwitcher,
}: {
  session: PanelSession;
  active: TrackedFile;
  /** Changes when the panel comes to the front — refocuses the input. */
  focusToken: number;
  onOpenSwitcher(): void;
}) {
  const { t, i18n } = useTranslation();
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [committed, setCommitted] = useState<Version | null>(null);
  const [rejected, setRejected] = useState(false);
  const [failures, setFailures] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dismissal = useRef<number>(undefined);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  // The field is disabled while saving, which evicts focus. After a failure the
  // retry should be one keystroke away, not one click and one keystroke.
  useEffect(() => {
    if (failures > 0) inputRef.current?.focus();
  }, [failures]);

  useEffect(() => () => window.clearTimeout(dismissal.current), []);

  // The host refuses this commit, and would be right to: naming a file that
  // already *is* its newest version is how a change made to one score ends up
  // filed under another.
  const nothingToName = session.pendingChange === false;
  const ready = message.trim().length > 0 && phase === 'idle' && !nothingToName;

  async function commit() {
    if (!ready) {
      // Nothing to name: nudge the field rather than failing silently.
      setRejected(true);
      window.setTimeout(() => setRejected(false), 220);
      return;
    }

    setPhase('saving');
    try {
      const version = await session.commit(active.id, message.trim());
      setCommitted(version);
      setPhase('saved');
      setMessage('');
      dismissal.current = window.setTimeout(() => {
        void hidePanel();
        setPhase('idle');
        setCommitted(null);
      }, CONFIRM_MS);
    } catch (cause) {
      setPhase('idle');
      setFailures((count) => count + 1);
      session.reportError(String(cause));
    }
  }

  return (
    <PanelBody>
      <div className="shrink-0 px-3 pt-2.5 pb-3" data-panel-stagger="">
        <button
          type="button"
          onClick={onOpenSwitcher}
          className="group flex w-full items-center gap-2 text-left outline-none"
          aria-label={t('panel.switchFile')}
        >
          <span className="h-4 w-[3px] shrink-0 bg-brand transition-all group-hover:h-5 group-focus-visible:h-5" />
          <span className="truncate text-md leading-tight font-bold tracking-tight" title={active.path}>
            {active.name}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
        </button>

        <p className="mt-0.5 pl-[15px] font-mono text-[10px] text-muted-foreground">
          {session.lastChangeAt
            ? t('panel.lastChange', {
                when: formatRelative(session.lastChangeAt, i18n.language),
              })
            : t('panel.noChangeYet')}
          {session.unnamedSaves > 0 && (
            <>
              {' · '}
              <span className="text-warning">
                {t('panel.unnamedSaves', { count: session.unnamedSaves })}
              </span>
            </>
          )}
          {nothingToName && (
            <>
              {' · '}
              <span className="text-warning">{t('panel.nothingToName')}</span>
            </>
          )}
        </p>

        <BindingNotice binding={session.binding} onAddFile={() => void session.addFile()} />

        <div className="mt-2.5">
          {phase === 'saved' && committed ? (
            <ConfirmationBar version={committed} />
          ) : (
            <div
              data-rejected={rejected || undefined}
              className={cn(
                'flex h-10 items-center gap-2.5 border border-input bg-background/40 px-2.5 transition-colors',
                'focus-within:border-brand-border focus-within:bg-background/80',
                'data-rejected:animate-[panel-reject_220ms_ease] data-rejected:border-destructive/70',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'h-4 w-[3px] shrink-0 transition-colors',
                  ready ? 'bg-brand-bright' : 'bg-brand/40',
                )}
              />
              <Input
                ref={inputRef}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void commit();
                  }
                }}
                disabled={phase === 'saving'}
                placeholder={t('panel.messagePlaceholder')}
                aria-label={t('panel.messageLabel')}
                spellCheck={false}
                autoComplete="off"
                // The row around it already shows focus; a second ring on the
                // control itself reads as a validation error.
                className="h-auto flex-1 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0"
              />
              {phase === 'saving' ? (
                <Spinner className="size-3.5 shrink-0 text-brand-bright" />
              ) : (
                <CornerDownLeft
                  aria-hidden
                  className={cn(
                    'size-3.5 shrink-0 transition-colors',
                    ready ? 'text-brand-bright' : 'text-muted-foreground/40',
                  )}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <VersionLedger versions={session.versions} />
    </PanelBody>
  );
}

/**
 * Why the panel might be pointed at the wrong score.
 *
 * Silent on the happy path — the file name above already says what Guitar Pro
 * has open. It speaks up only when the host couldn't make that guarantee.
 */
function BindingNotice({ binding, onAddFile }: { binding: Binding; onAddFile(): void }) {
  const { t } = useTranslation();

  switch (binding.kind) {
    case 'unmatched':
      return (
        <Notice
          icon={<FileQuestion />}
          label={t('panel.binding.unmatched', { name: binding.name })}
          action={t('panel.binding.track')}
          onAction={onAddFile}
        />
      );
    case 'blind':
      return (
        <Notice
          icon={<EyeOff />}
          label={t('panel.binding.blind')}
          action={t('panel.binding.allow')}
          onAction={() => void requestAccessibility()}
        />
      );
    // Bound to the open score, or Guitar Pro isn't running — nothing to add.
    default:
      return null;
  }
}

function Notice({
  icon,
  label,
  action,
  onAction,
}: {
  icon: ReactNode;
  label: string;
  action: string;
  onAction(): void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2 border-l-2 border-warning/60 bg-warning/10 py-1 pr-1 pl-2">
      <span aria-hidden className="shrink-0 text-warning [&_svg]:size-3">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground" title={label}>
        {label}
      </span>
      <Button variant="ghost" size="xs" onClick={onAction} className="shrink-0">
        {action}
      </Button>
    </div>
  );
}

/** Replaces the input for a beat so the commit is visibly acknowledged. */
function ConfirmationBar({ version }: { version: Version }) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className="flex h-10 animate-[panel-confirm_160ms_cubic-bezier(0.16,1,0.3,1)] items-center gap-2.5 border border-success/60 bg-success/15 px-2.5"
    >
      <Check className="size-3.5 shrink-0 text-success" />
      <span className="flex-1 truncate text-sm text-foreground">{version.message}</span>
      <Kbd className="h-4 bg-transparent px-0 font-mono text-[10px] tracking-widest text-success uppercase">
        {t('panel.saved')}
      </Kbd>
    </div>
  );
}
