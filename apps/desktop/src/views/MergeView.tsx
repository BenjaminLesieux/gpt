import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useAppStore } from '@/store';
import { useMergeStatus } from '@/hooks/useGpt';
import { Skeleton } from '@/components/ui/skeleton';
import { MergeStartPanel } from '@/features/merge/MergeStartPanel';
import { MergeConflictView, MergeConflictSkeleton } from '@/features/merge/MergeConflictView';
import type { MergeOutcome } from '@/api/client';

export function MergeView() {
  const repoPath = useAppStore((s) => s.repoPath)!;
  const { data: mergeStatus, isLoading } = useMergeStatus(repoPath);
  const navigate = useNavigate();

  const handleMergeStarted = (outcome: MergeOutcome) => {
    if (outcome.type === 'clean' || outcome.type === 'fast-forward') {
      toast.success(
        outcome.type === 'fast-forward'
          ? 'Fast-forward merge complete'
          : `Merge committed as ${(outcome as { commitHash: string }).commitHash?.slice(0, 7) ?? ''}`,
      );
      navigate({ to: '/repo/status' });
    }
    // already-up-to-date and conflicts: MergeStartPanel handles toasts;
    // conflicts cause mergeStatus to refresh and show MergeConflictView.
  };

  const handleFinalized = (_commitHash: string) => {
    toast.success('Merge committed — history updated');
    navigate({ to: '/repo/status' });
  };

  const handleAborted = () => {
    // status query auto-refreshes; stay on page
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-8">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }

  if (mergeStatus?.active) {
    if (!mergeStatus.sidecar) return <MergeConflictSkeleton />;
    return (
      <MergeConflictView
        repoPath={repoPath}
        sidecar={mergeStatus.sidecar}
        unresolved={mergeStatus.unresolved}
        onAborted={handleAborted}
        onFinalized={handleFinalized}
      />
    );
  }

  return (
    <MergeStartPanel repoPath={repoPath} onMergeStarted={handleMergeStarted} />
  );
}
