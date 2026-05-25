import { useState } from 'react';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRepoStatus, useStageFile, useUnstageFile } from '@/hooks/useGpt';
import { useOpenFile } from '@/hooks/useOpenFile';
import { StatusHeader } from '@/features/status/StatusHeader';
import { StatusSection } from '@/features/status/StatusSection';
import { StatusSkeleton } from '@/features/status/StatusSkeleton';
import { StatusEmptyState } from '@/features/status/StatusEmptyState';
import { StatusErrorState } from '@/features/status/StatusErrorState';
import type { FileStatus, StatusFile } from '@/features/status/StatusFileRow';

interface StatusPanelProps {
  repoPath: string;
  selectedFile: string | null;
  onSelectFile: (file: string, status: FileStatus) => void;
}

export function StatusPanel({ repoPath, selectedFile, onSelectFile }: StatusPanelProps) {
  const {
    data: status,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useRepoStatus(repoPath);

  const stageFile = useStageFile(repoPath);
  const unstageFile = useUnstageFile(repoPath);
  const openFile = useOpenFile();
  const [stagingFiles, setStagingFiles] = useState<Set<string>>(new Set());
  const [unstagingFiles, setUnstagingFiles] = useState<Set<string>>(new Set());

  const handleUnstageFile = async (file: string) => {
    setUnstagingFiles((prev) => new Set([...prev, file]));
    try {
      await unstageFile.mutateAsync(file);
      toast.success(`${file.split('/').pop()} unstaged`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unstage file');
    } finally {
      setUnstagingFiles((prev) => {
        const next = new Set(prev);
        next.delete(file);
        return next;
      });
    }
  };

  // Build the absolute path for opening in an external application.
  // repoPath uses the OS separator; file uses forward slashes from git — both
  // work with shell.openPath on all three platforms.
  const handleOpenFile = (file: string) =>
    openFile(`${repoPath}/${file}`);

  const handleStageFile = async (file: string) => {
    setStagingFiles((prev) => new Set([...prev, file]));
    try {
      await stageFile.mutateAsync(file);
      toast.success(`${file.split('/').pop()} staged`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to stage file');
    } finally {
      setStagingFiles((prev) => {
        const next = new Set(prev);
        next.delete(file);
        return next;
      });
    }
  };

  const stagedCount  = status?.staged.length ?? 0;
  const changedCount = (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0);
  const isEmpty      = !isLoading && !isError && !!status && stagedCount === 0 && changedCount === 0;

  const stagedFiles: StatusFile[] = status?.staged.map((f) => ({
    file:    f.file,
    status:  f.status as FileStatus,
    summary: f.summary,
  })) ?? [];

  const unstagedFiles: StatusFile[] = [
    ...(status?.unstaged.map((f) => ({ file: f.file, status: f.status as FileStatus })) ?? []),
    ...(status?.untracked.map((f) => ({ file: f, status: 'untracked' as const })) ?? []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <StatusHeader
        stagedCount={stagedCount}
        changedCount={changedCount}
        isFetching={isFetching}
        onRefresh={() => refetch()}
      />

      <ScrollArea className="min-h-0 flex-1">
        {isLoading && <StatusSkeleton />}

        {isError && (
          <StatusErrorState
            message={error instanceof Error ? error.message : 'Failed to load status'}
            onRetry={() => refetch()}
          />
        )}

        {isEmpty && <StatusEmptyState />}

        {!isLoading && !isError && status && (stagedCount > 0 || changedCount > 0) && (
          <>
            <StatusSection
              title="Staged"
              indicatorCls="text-diff-added"
              files={stagedFiles}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              onOpenFile={handleOpenFile}
              onUnstageFile={handleUnstageFile}
              unstagingFiles={unstagingFiles}
            />
            <StatusSection
              title="Unstaged"
              indicatorCls="text-diff-changed"
              files={unstagedFiles}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              onOpenFile={handleOpenFile}
              onStageFile={handleStageFile}
              stagingFiles={stagingFiles}
            />
          </>
        )}
      </ScrollArea>
    </div>
  );
}
