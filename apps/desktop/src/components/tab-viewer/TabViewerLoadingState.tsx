import { Skeleton } from "@/components/ui/skeleton";

const ROWS = [80, 95, 70, 88, 60] as const;

export function TabViewerLoadingState() {
  return (
    <div className="flex h-full flex-col gap-6 overflow-hidden p-8">
      {ROWS.map((w) => (
        <div key={w} className="flex flex-col gap-2">
          <Skeleton className="h-2 w-16" />
          <Skeleton className="h-10" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}
