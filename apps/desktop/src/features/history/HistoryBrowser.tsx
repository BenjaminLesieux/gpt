import { useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCommitLog, useBranches } from "@/hooks/useGpt";
import { useAppStore } from "@/store";
import { CommitRow } from "./CommitRow";
import { HistoryHeader } from "./HistoryHeader";
import { HistorySkeleton } from "./HistorySkeleton";
import { HistoryEmptyState } from "./HistoryEmptyState";
import { HistoryErrorState } from "./HistoryErrorState";

interface HistoryBrowserProps {
  repoPath: string;
  showGraph?: boolean;
}

export function HistoryBrowser({ repoPath, showGraph }: HistoryBrowserProps) {
  const { data: commits, isLoading, isError, error, refetch, isFetching } = useCommitLog(repoPath);
  const { data: branchData } = useBranches(repoPath);
  const selected = useAppStore((s) => s.selectedCommitHash);
  const selectCommit = useAppStore((s) => s.selectCommit);
  const diffTarget = useAppStore((s) => s.diffCommitHash);
  const setDiffCommit = useAppStore((s) => s.setDiffCommit);

  useEffect(() => {
    if (!selected && commits && commits.length > 0) {
      selectCommit(commits[0].hash);
    }
  }, [commits, selected, selectCommit]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HistoryHeader
        count={commits?.length ?? 0}
        isFetching={isFetching}
        onRefresh={() => refetch()}
      />

      <ScrollArea className="min-h-0 flex-1">
        {isLoading && <HistorySkeleton />}

        {isError && (
          <HistoryErrorState
            message={error instanceof Error ? error.message : "Failed to load history"}
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && !isError && commits && commits.length === 0 && <HistoryEmptyState />}

        {!isLoading && !isError && commits && commits.length > 0 && (
          <ul className="flex flex-col divide-y divide-border/40">
            {commits.map((commit, index) => (
              <li key={commit.hash}>
                <CommitRow
                  commit={commit}
                  selected={selected === commit.hash}
                  isDiffTarget={diffTarget === commit.hash}
                  onSelect={() => selectCommit(commit.hash)}
                  onCompare={() =>
                    setDiffCommit(diffTarget === commit.hash ? null : commit.hash)
                  }
                  isFirst={showGraph ? index === 0 : undefined}
                  isLast={showGraph ? index === commits.length - 1 : undefined}
                  branchName={showGraph && index === 0 ? branchData?.current : undefined}
                />
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
