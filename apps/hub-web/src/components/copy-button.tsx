import { useEffect, useRef, useState } from 'react';
import { Button } from '@gpt/ui/button';
import { cn } from '@gpt/ui/lib/utils';

interface CopyButtonProps {
  value: string;
  /** Spoken name — "Copy token", never a bare "Copy". */
  label: string;
  children?: React.ReactNode;
  className?: string;
  size?: 'sm' | 'default';
}

/**
 * Copy with a confirmed state. The label swap is the confirmation, so it is
 * announced rather than only coloured — a green border alone says nothing to
 * a screen reader, and nothing at all to anyone who cannot separate the two
 * reds and greens on this palette.
 */
export function CopyButton({
  value,
  label,
  children = 'Copy',
  className,
  size = 'sm',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can be refused outright. The value is on screen and
      // selectable, so saying nothing is better than an alert that steals
      // focus from what the user was about to copy by hand.
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      aria-label={label}
      onClick={copy}
      className={cn(
        'min-w-[76px] rounded-sm border-border',
        copied && 'border-success-border text-success-bright',
        className
      )}
    >
      <span aria-live="polite">{copied ? 'Copied' : children}</span>
    </Button>
  );
}
