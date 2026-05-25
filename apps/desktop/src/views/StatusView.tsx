import { useState, lazy, Suspense } from 'react';
import { useAppStore } from '@/store';
import { StatusPanel } from '@/features/status/StatusPanel';
import { CommitPanel } from '@/features/status/CommitPanel';
import { TabViewerLoadingState } from '@/components/tab-viewer/TabViewerLoadingState';
import type { FileStatus } from '@/features/status/StatusFileRow';

const StatusTabViewer = lazy(() =>
  import('@/features/status/StatusTabViewer').then((m) => ({ default: m.StatusTabViewer })),
);

interface Selection {
  file: string;
  status: FileStatus;
}

export function StatusView() {
  const repoPath = useAppStore((s) => s.repoPath)!;
  const [selection, setSelection] = useState<Selection | null>(null);

  return (
    <>
      <div className="flex w-[280px] shrink-0 flex-col border-r border-border">
        <div className="min-h-0 flex-1">
          <StatusPanel
            repoPath={repoPath}
            selectedFile={selection?.file ?? null}
            onSelectFile={(file, status) => setSelection({ file, status })}
          />
        </div>
        <CommitPanel
          repoPath={repoPath}
          onCommitSuccess={() => setSelection(null)}
        />
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Suspense fallback={<TabViewerLoadingState />}>
          <StatusTabViewer
            repoPath={repoPath}
            file={selection?.file ?? null}
            status={selection?.status ?? null}
          />
        </Suspense>
      </div>
    </>
  );
}
