import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_WIDTHS = [60, 78, 45, 84, 52, 70, 40, 66] as const;

export function HistorySkeleton() {
  return (
    <ul className="flex flex-col">
      {SKELETON_WIDTHS.map((width) => (
        <li
          key={`skeleton-${width}`}
          className="grid grid-cols-[64px_1fr_auto] items-center gap-3 border-l-2 border-transparent px-3 py-2.5"
        >
          <Skeleton className="h-2.5 w-14" />
          <Skeleton className="h-2.5" style={{ width: `${width}%` }} />
          <Skeleton className="h-2.5 w-8" />
        </li>
      ))}
    </ul>
  );
}
