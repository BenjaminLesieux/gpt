import { useMemo, lazy, Suspense } from "react";
import type { Commit } from "@gpt/gpt-core";
import { useCommitLog } from "@/hooks/useGpt";
import { CommitEmptyState } from "./CommitEmptyState";
import { TabViewerLoadingState } from "@/components/tab-viewer/TabViewerLoadingState";

const TabViewer = lazy(() =>
  import("./TabViewer").then((m) => ({ default: m.TabViewer })),
);

interface CommitDetailProps {
  repoPath: string;
  commitHash: string | null;
}

export function CommitDetail({ repoPath, commitHash }: CommitDetailProps) {
  const { data: commits } = useCommitLog(repoPath);
  const commit = useMemo<Commit | null>(() => {
    if (!commitHash || !commits) return null;
    return commits.find((c) => c.hash === commitHash) ?? null;
  }, [commits, commitHash]);

  if (!commit || !commitHash) {
    return <CommitEmptyState />;
  }

  const title = commit.message.split("\n")[0];

  return (
    <article className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <div aria-hidden className="h-4 w-0.5 shrink-0 bg-primary" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {title || "(no message)"}
        </span>
        <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-muted-foreground/60">
          <span>{commit.author.name}</span>
          <span className="text-muted-foreground/30">·</span>
          <span>{commit.hash.slice(0, 7)}</span>
        </div>
      </header>

      <Suspense fallback={<TabViewerLoadingState />}>
        <TabViewer repoPath={repoPath} hash={commitHash} />
      </Suspense>
    </article>
  );
}
