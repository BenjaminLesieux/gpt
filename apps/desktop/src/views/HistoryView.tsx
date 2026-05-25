import { useMemo } from 'react';
import { useAppStore } from '@/store';
import { useCommitLog } from '@/hooks/useGpt';
import { HistoryBrowser } from '@/features/history/HistoryBrowser';
import { CommitDetail } from '@/features/history/CommitDetail';
import { DiffView } from '@/features/history/DiffView';

export function HistoryView() {
  const repoPath = useAppStore((s) => s.repoPath)!;
  const selectedCommitHash = useAppStore((s) => s.selectedCommitHash);
  const diffCommitHash = useAppStore((s) => s.diffCommitHash);
  const setDiffCommit = useAppStore((s) => s.setDiffCommit);

  const { data: commits } = useCommitLog(repoPath);

  // Resolve the two commits and determine which is older (base) vs newer (head)
  // by their position in the log (earlier index = newer).
  const diffPair = useMemo(() => {
    if (!selectedCommitHash || !diffCommitHash || !commits) return null;
    const a = commits.find((c) => c.hash === selectedCommitHash);
    const b = commits.find((c) => c.hash === diffCommitHash);
    if (!a || !b) return null;
    const iA = commits.indexOf(a);
    const iB = commits.indexOf(b);
    // Lower index = more recent commit → head; higher index = older → base
    return iA < iB ? { base: b, head: a } : { base: a, head: b };
  }, [commits, selectedCommitHash, diffCommitHash]);

  return (
    <>
      <div className="flex w-[280px] shrink-0 flex-col border-r border-border">
        <HistoryBrowser repoPath={repoPath} />
      </div>
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
    </>
  );
}