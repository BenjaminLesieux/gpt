import { cn } from '@gpt/ui/lib/utils';

/** The logotype: `gpt` in mono, the `t` carrying the accent. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-mono font-bold tracking-tight text-foreground', className)}>
      gp<span className="text-brand-bright">t</span>
    </span>
  );
}
