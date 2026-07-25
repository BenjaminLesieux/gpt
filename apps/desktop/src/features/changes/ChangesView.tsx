import { useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/store';
import { useMergeStatus } from '@/hooks/useGpt';
import { MasterDetail } from '@/components/layout/MasterDetail';
import { StatusPanel } from '@/features/status/StatusPanel';
import { CommitPanel } from '@/features/status/CommitPanel';
import { StatusSelectFileState } from '@/features/status/StatusSelectFileState';
import { MergeConflictView, MergeConflictSkeleton } from '@/features/merge/MergeConflictView';
import type { MergeStatus } from '@/api/client';
import type { FileStatus } from '@/features/status/StatusFileRow';
import { ChangeDetail } from './ChangeDetail';

interface Selection {
  file: string;
  status: FileStatus;
}

// ─── ChangesView ────────────────────────────────────────────────────────────
//
// The "Changes" tab. In its normal state it's a master-detail: changed files +
// commit box on the left, the selected file's diff/notation on the right.
//
// A merge-in-progress isn't a separate destination — it's a *state* of this
// tab, exactly like GitHub Desktop. When a merge is active we hand the whole
// area to the conflict resolver; once it's committed or aborted, mergeStatus
// refreshes and we fall back to the normal changes layout.

export function ChangesView() {
  const repoPath = useAppStore((s) => s.repoPath)!;
  const { data: mergeStatus } = useMergeStatus(repoPath);

  if (mergeStatus?.active) {
    return <MergeConflictArea repoPath={repoPath} mergeStatus={mergeStatus} />;
  }

  return <ChangesMasterDetail repoPath={repoPath} />;
}

function ChangesMasterDetail({ repoPath }: { repoPath: string }) {
  const [selection, setSelection] = useState<Selection | null>(null);

  return (
    <MasterDetail>
      <MasterDetail.List>
        <div className="min-h-0 flex-1">
          <StatusPanel
            repoPath={repoPath}
            selectedFile={selection?.file ?? null}
            onSelectFile={(file, status) => setSelection({ file, status })}
          />
        </div>
        <CommitPanel repoPath={repoPath} onCommitSuccess={() => setSelection(null)} />
      </MasterDetail.List>

      <MasterDetail.Detail>
        {selection ? (
          <ChangeDetail
            key={selection.file}
            repoPath={repoPath}
            file={selection.file}
            status={selection.status}
          />
        ) : (
          <StatusSelectFileState />
        )}
      </MasterDetail.Detail>
    </MasterDetail>
  );
}

function MergeConflictArea({
  repoPath,
  mergeStatus,
}: {
  repoPath: string;
  mergeStatus: Extract<MergeStatus, { active: true }>;
}) {
  if (!mergeStatus.sidecar) return <MergeConflictSkeleton />;
  return (
    <MergeConflictView
      repoPath={repoPath}
      sidecar={mergeStatus.sidecar}
      unresolved={mergeStatus.unresolved}
      onAborted={() => toast.info('Merge aborted')}
      onFinalized={() => toast.success('Merge committed — history updated')}
    />
  );
}
