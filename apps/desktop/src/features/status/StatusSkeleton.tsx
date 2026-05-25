import { Skeleton } from '@/components/ui/skeleton';

const STAGED_WIDTHS  = [68, 45] as const;
const CHANGED_WIDTHS = [83, 55, 61, 38] as const;

export function StatusSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2">
        <Skeleton className="h-2 w-10" />
      </div>
      <ul className="flex flex-col">
        {STAGED_WIDTHS.map((w) => (
          <li key={`s-${w}`} className="flex items-center gap-3 px-4 py-2">
            <Skeleton className="size-[18px] shrink-0" />
            <Skeleton className="h-2" style={{ width: `${w}%` }} />
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2 pt-4">
        <Skeleton className="h-2 w-14" />
      </div>
      <ul className="flex flex-col">
        {CHANGED_WIDTHS.map((w) => (
          <li key={`u-${w}`} className="flex items-center gap-3 px-4 py-2">
            <Skeleton className="size-[18px] shrink-0" />
            <Skeleton className="h-2" style={{ width: `${w}%` }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
