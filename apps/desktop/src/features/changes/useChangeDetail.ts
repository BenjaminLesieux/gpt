import { useMemo } from 'react';
import { diffScores } from '@gpt/gpt-core';
import type { ScoreDiff } from '@gpt/gpt-core';
import { useCommitLog, useShowFile, useWorkdirFile } from '@/hooks/useGpt';
import { parseScore } from '@/hooks/parseScore';
import type { FileStatus } from '@/features/status/StatusFileRow';

export type ChangeViewMode = 'diff' | 'notation';

export interface ChangeDetailData {
  /** Committed (HEAD) version. `null` for added/untracked files. */
  headBytes: Uint8Array | null;
  /** Working-tree version. `null` for deleted files. */
  workBytes: Uint8Array | null;
  /** Semantic HEAD→working-tree diff. Only computed for modified files. */
  diff: ScoreDiff | null;
  /** Which detail modes make sense for this file's status. First = default. */
  availableModes: ChangeViewMode[];
  isLoading: boolean;
  error: Error | null;
}

// ─── useChangeDetail ────────────────────────────────────────────────────────
//
// Resolves the bytes the Changes detail pane needs and, for modified files,
// the semantic diff between HEAD and the working tree. Centralising the
// fetching here keeps ChangeDetail purely presentational — it only decides how
// to render the modes this hook says are available.
//
// Which versions exist depends on status:
//   modified         → HEAD + working tree   → diff + notation
//   added / untracked→ working tree only      → notation
//   deleted          → HEAD only              → notation (rendered as deleted)

export function useChangeDetail(
  repoPath: string,
  file: string | null,
  status: FileStatus | null,
): ChangeDetailData {
  const { data: commits } = useCommitLog(repoPath);
  const headHash = commits?.[0]?.hash ?? null;

  const hasHead = status === 'modified' || status === 'deleted';
  const hasWork = status === 'modified' || status === 'added' || status === 'untracked';

  const headQuery = useShowFile(repoPath, hasHead ? headHash : null, hasHead ? file : null);
  const workQuery = useWorkdirFile(repoPath, hasWork ? file : null);

  const diff = useMemo<ScoreDiff | null>(() => {
    if (status !== 'modified' || !headQuery.data || !workQuery.data) return null;
    try {
      return diffScores(parseScore(headQuery.data), parseScore(workQuery.data));
    } catch (e) {
      console.error('[useChangeDetail] failed to compute diff:', e);
      return null;
    }
  }, [status, headQuery.data, workQuery.data]);

  const availableModes: ChangeViewMode[] =
    status === 'modified' ? ['diff', 'notation'] : ['notation'];

  return {
    headBytes: headQuery.data ?? null,
    workBytes: workQuery.data ?? null,
    diff,
    availableModes,
    isLoading: (hasHead && headQuery.isLoading) || (hasWork && workQuery.isLoading),
    error: (headQuery.error ?? workQuery.error) as Error | null,
  };
}
