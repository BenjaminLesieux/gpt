import { FilePlus2 } from 'lucide-react';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import type { FileStatus } from './StatusFileRow';

interface StatusNewFileStateProps {
  status: Extract<FileStatus, 'added' | 'untracked'>;
}

export function StatusNewFileState({ status }: StatusNewFileStateProps) {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FilePlus2 aria-hidden />
        </EmptyMedia>
        <EmptyTitle>New file</EmptyTitle>
        <EmptyDescription>
          {status === 'added'
            ? 'Staged for first commit — no previous snapshot exists.'
            : 'Not yet tracked — no previous snapshot exists.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
