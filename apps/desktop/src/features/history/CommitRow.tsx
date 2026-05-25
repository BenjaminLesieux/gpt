import { GitCompare, GitBranch, X } from "lucide-react";
import type { Commit } from "@gpt/gpt-core";
import { cn } from "../../lib/utils";

interface CommitRowProps {
  commit: Commit;
  selected: boolean;
  isDiffTarget: boolean;
  onSelect: () => void;
  onCompare: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  branchName?: string;
}

function GraphColumn({
  isFirst,
  isLast,
}: {
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div className="relative ml-3 w-4 shrink-0 self-stretch">
      {!isFirst && (
        <div
          className="absolute left-[7px] top-0 w-px bg-border"
          style={{ height: "calc(50% - 5px)" }}
        />
      )}
      {!isLast && (
        <div
          className="absolute left-[7px] w-px bg-border"
          style={{ top: "calc(50% + 5px)", bottom: 0 }}
        />
      )}
      {isFirst ? (
        <div className="absolute left-[3px] top-1/2 size-[10px] -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_2px_hsl(var(--background))]" />
      ) : (
        <div className="absolute left-[3px] top-1/2 size-2 -translate-y-1/2 rounded-full border border-primary/50 bg-background" />
      )}
    </div>
  );
}

export function CommitRow({
  commit,
  selected,
  isDiffTarget,
  onSelect,
  onCompare,
  isFirst,
  isLast,
  branchName,
}: CommitRowProps) {
  const showGraph = isFirst !== undefined && isLast !== undefined;

  return (
    <div
      className={cn(
        "group relative flex items-stretch border-l-2 transition-colors duration-100",
        "hover:bg-accent/50",
        selected ? "border-l-primary bg-accent" : "border-l-transparent",
        isDiffTarget && !selected && "border-l-warning/70 bg-warning/5",
      )}
    >
      {showGraph && <GraphColumn isFirst={isFirst!} isLast={isLast!} />}

      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="flex-1 px-4 py-3 text-left"
      >
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-info tabular-nums">
            {commit.shortHash}
          </span>
          {branchName && (
            <span className="inline-flex items-center gap-0.5 rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-px font-mono text-[9px] leading-tight text-primary/80">
              <GitBranch className="size-2.5" strokeWidth={1.5} />
              {branchName}
            </span>
          )}
          {isDiffTarget && (
            <span className="font-mono text-[9px] uppercase tracking-widest text-warning/80">
              compare
            </span>
          )}
        </div>
        <div
          className={cn(
            "mb-1.5 truncate text-[13px] leading-tight",
            selected ? "text-foreground" : "text-foreground/80",
          )}
        >
          {commit.message.split("\n")[0] || "(no message)"}
        </div>
        <div className="font-mono text-[11px] text-muted-foreground/60">
          {commit.author.name} · {formatShortDate(commit.author.timestamp)}
        </div>
      </button>

      <div
        className={cn(
          "flex shrink-0 items-center pr-2 transition-opacity duration-100",
          isDiffTarget ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCompare(); }}
          title={isDiffTarget ? "Remove from compare" : "Compare with selected"}
          className={cn(
            "rounded-sm p-1.5 transition-colors duration-100",
            isDiffTarget
              ? "text-warning/80 hover:bg-warning/15"
              : "text-muted-foreground/50 hover:bg-accent hover:text-muted-foreground",
          )}
        >
          {isDiffTarget
            ? <X className="size-3" strokeWidth={2} />
            : <GitCompare className="size-3" strokeWidth={1.5} />}
        </button>
      </div>
    </div>
  );
}

function formatShortDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return date.toLocaleDateString([], { month: "short", day: "2-digit" });
}
