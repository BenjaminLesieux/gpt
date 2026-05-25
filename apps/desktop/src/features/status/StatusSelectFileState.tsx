import { FileSearch } from 'lucide-react';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

export function StatusSelectFileState() {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileSearch aria-hidden />
        </EmptyMedia>
        <EmptyTitle>Nothing selected</EmptyTitle>
        <EmptyDescription>
          Pick a file from the list to preview its last snapshot.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
