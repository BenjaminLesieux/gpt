import type { ComponentProps, ReactNode } from 'react';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

/**
 * The panel's chrome: a floating card in a transparent, frameless window.
 *
 * Header, body and footer are separate exports rather than props so each view
 * composes the parts it needs — the commit flow, the switcher and the empty
 * state all want a different footer.
 */
export function PanelShell({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-panel-enter=""
      className={cn(
        'relative flex h-screen flex-col overflow-hidden rounded-lg',
        'border border-border bg-popover text-foreground shadow-[var(--shadow-overlay)]',
        // Hairline catch-light along the top edge — reads as a physical plate
        // rather than a flat rectangle.
        'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px',
        'before:bg-gradient-to-r before:from-transparent before:via-white/12 before:to-transparent',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PanelHeader({ children }: { children: ReactNode }) {
  return (
    <header
      data-tauri-drag-region
      className="relative flex h-9 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-border pr-2 pl-3"
    >
      {/* Five hairlines fading in from the left: a staff, as texture. */}
      <span
        aria-hidden
        className="panel-staff pointer-events-none absolute inset-y-[7px] right-14 w-20"
        data-tauri-drag-region
      />
      {children}
    </header>
  );
}

/** The Bauhaus mark: three bars stepping down, the accent in the middle. */
export function PanelMark() {
  return (
    <span aria-hidden className="flex w-3 shrink-0 flex-col gap-[2px]" data-tauri-drag-region>
      <span className="h-[2px] w-full bg-foreground" />
      <span className="h-[2px] w-[60%] bg-brand" />
      <span className="h-[2px] w-[30%] bg-foreground" />
    </span>
  );
}

export function PanelBody({ className, children, ...props }: ComponentProps<'main'>) {
  return (
    <main className={cn('flex min-h-0 flex-1 flex-col', className)} {...props}>
      {children}
    </main>
  );
}

export function PanelFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-2 border-t border-border pr-1.5 pl-3">
      {children}
    </footer>
  );
}

/** `⏎ commit` — a key and what it does, at the size the footer allows. */
export function PanelHint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Kbd className="h-4 min-w-4 bg-transparent px-0 font-mono text-foreground/70">{keys}</Kbd>
      {children}
    </span>
  );
}
