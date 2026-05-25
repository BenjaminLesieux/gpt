import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { History, X } from "lucide-react";
import { useAppStore } from "@/store";
import { useCommitLog } from "@/hooks/useGpt";
import { HistoryBrowser } from "./HistoryBrowser";
import { CommitDetail } from "./CommitDetail";
import { DiffView } from "./DiffView";
import { cn } from "@/lib/utils";

const MIN_HEIGHT = 160;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 300;

interface HistoryPanelProps {
  onClose: () => void;
}

export function HistoryPanel({ onClose }: HistoryPanelProps) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startY.current = e.clientY;
      startH.current = height;
    },
    [height],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startY.current - e.clientY;
      setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startH.current + delta)));
    };
    const onUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    const onDown = () => {
      if (isDragging.current) {
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const repoPath = useAppStore((s) => s.repoPath)!;
  const selectedCommitHash = useAppStore((s) => s.selectedCommitHash);
  const diffCommitHash = useAppStore((s) => s.diffCommitHash);
  const setDiffCommit = useAppStore((s) => s.setDiffCommit);
  const { data: commits } = useCommitLog(repoPath);

  const diffPair = useMemo(() => {
    if (!selectedCommitHash || !diffCommitHash || !commits) return null;
    const a = commits.find((c) => c.hash === selectedCommitHash);
    const b = commits.find((c) => c.hash === diffCommitHash);
    if (!a || !b) return null;
    const iA = commits.indexOf(a);
    const iB = commits.indexOf(b);
    return iA < iB ? { base: b, head: a } : { base: a, head: b };
  }, [commits, selectedCommitHash, diffCommitHash]);

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border bg-background"
      style={{ height }}
    >
      {/* Drag handle */}
      <div
        className={cn(
          "group flex h-1 w-full shrink-0 cursor-ns-resize items-center justify-center",
          "transition-colors duration-150 hover:bg-primary/20",
        )}
        onMouseDown={handleMouseDown}
      >
        <div className="h-px w-8 rounded-full bg-border opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
      </div>

      {/* Tab bar */}
      <div className="flex h-8 shrink-0 items-center gap-px border-b border-border bg-sidebar">
        <div className="flex h-full items-center gap-1.5 border-r border-border bg-background px-3 text-[11px] font-medium text-foreground">
          <History className="size-3 shrink-0" strokeWidth={1.5} />
          <span>History</span>
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={onClose}
          aria-label="Close history panel"
          className="mr-1 rounded-sm p-1 text-muted-foreground/40 transition-colors duration-100 hover:bg-accent hover:text-muted-foreground"
        >
          <X className="size-3" strokeWidth={1.5} />
        </button>
      </div>

      {/* Content: commit list + detail */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Commit list with graph */}
        <div className="flex w-[300px] shrink-0 flex-col border-r border-border">
          <HistoryBrowser repoPath={repoPath} showGraph />
        </div>

        {/* Detail / diff pane */}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {diffPair ? (
            <DiffView
              repoPath={repoPath}
              baseCommit={diffPair.base}
              headCommit={diffPair.head}
              onClose={() => setDiffCommit(null)}
            />
          ) : (
            <CommitDetail repoPath={repoPath} commitHash={selectedCommitHash} />
          )}
        </div>
      </div>
    </div>
  );
}
