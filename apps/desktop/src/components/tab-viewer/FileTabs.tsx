import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface FileTabsProps {
  files: Array<{ file: string }>;
  selected: string | null;
  onSelect: (file: string) => void;
  /** Optional action buttons rendered to the right of the tab list. */
  actions?: ReactNode;
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export function FileTabs({ files, selected, onSelect, actions }: FileTabsProps) {
  if (files.length === 0) return null;

  const value = selected ?? files[0].file;

  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-1">
      <Tabs value={value} onValueChange={onSelect}>
        <TabsList variant="line" aria-label="Guitar Pro files">
          {files.map(({ file }) => (
            <TabsTrigger key={file} value={file}>
              {basename(file)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}
