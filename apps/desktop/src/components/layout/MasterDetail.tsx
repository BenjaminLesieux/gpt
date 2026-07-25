import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// ─── MasterDetail ───────────────────────────────────────────────────────────
//
// The two-column shape shared by every repo tab: a fixed-width list on the
// left, a flexible detail pane on the right. Composed via children rather than
// render props so each tab decides exactly what goes in each slot.
//
//   <MasterDetail>
//     <MasterDetail.List>…</MasterDetail.List>
//     <MasterDetail.Detail>…</MasterDetail.Detail>
//   </MasterDetail>

export function MasterDetail({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>;
}

function List({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex w-[300px] shrink-0 flex-col border-r border-border', className)}>
      {children}
    </div>
  );
}

function Detail({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 overflow-hidden', className)}>
      {children}
    </div>
  );
}

MasterDetail.List = List;
MasterDetail.Detail = Detail;
