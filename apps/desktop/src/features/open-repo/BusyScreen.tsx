import { Spinner } from "@/components/ui/spinner";

interface BusyScreenProps {
  label: string;
  path: string;
}

export function BusyScreen({ label, path }: BusyScreenProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Spinner aria-hidden />
        <span className="text-xs uppercase tracking-[0.18em]">{label}…</span>
      </div>
      <p className="max-w-full truncate font-mono text-xs text-muted-foreground">
        {path}
      </p>
    </div>
  );
}
