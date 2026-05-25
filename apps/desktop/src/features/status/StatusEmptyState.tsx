import { CheckCircle } from 'lucide-react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

export function StatusEmptyState() {
  return (
    <Empty className="border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CheckCircle aria-hidden />
        </EmptyMedia>
        <EmptyTitle>Working tree clean</EmptyTitle>
        <EmptyDescription>
          No staged or unstaged changes. Edit a{' '}
          <span className="font-mono">.gp</span> file to see it here.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent />
    </Empty>
  );
}
