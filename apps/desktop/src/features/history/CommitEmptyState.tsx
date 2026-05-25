import { GitCommitHorizontal } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function CommitEmptyState() {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitCommitHorizontal aria-hidden />
        </EmptyMedia>
        <EmptyTitle>Nothing selected</EmptyTitle>
        <EmptyDescription>
          Pick a commit from the list to see its message, author, and the
          tablature at that point in time.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
