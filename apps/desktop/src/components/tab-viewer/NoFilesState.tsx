import { Music } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function NoFilesState() {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Music aria-hidden />
        </EmptyMedia>
        <EmptyTitle>No tablature</EmptyTitle>
        <EmptyDescription>This commit contains no Guitar Pro files.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
