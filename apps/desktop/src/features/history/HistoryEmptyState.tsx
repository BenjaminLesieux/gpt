import { GitCommitVertical } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function HistoryEmptyState() {
  return (
    <Empty className="border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitCommitVertical aria-hidden />
        </EmptyMedia>
        <EmptyTitle>No commits yet</EmptyTitle>
        <EmptyDescription>
          Add a <span className="font-mono">.gp</span> file to the working tree, then
          stage and commit it from the CLI or the commit panel.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent />
    </Empty>
  );
}
