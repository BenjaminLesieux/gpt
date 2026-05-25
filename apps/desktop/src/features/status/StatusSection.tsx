import { cn } from '@/lib/utils';
import { StatusFileRow, type StatusFile, type FileStatus } from './StatusFileRow';

interface StatusSectionProps {
  title: string;
  files: StatusFile[];
  indicatorCls?: string;
  selectedFile: string | null;
  onSelectFile: (file: string, status: FileStatus) => void;
  onOpenFile?: (file: string) => void;
  onStageFile?: (file: string) => void;
  stagingFiles?: ReadonlySet<string>;
  onUnstageFile?: (file: string) => void;
  unstagingFiles?: ReadonlySet<string>;
}

export function StatusSection({
  title,
  files,
  indicatorCls,
  selectedFile,
  onSelectFile,
  onOpenFile,
  onStageFile,
  stagingFiles,
  onUnstageFile,
  unstagingFiles,
}: StatusSectionProps) {
  if (files.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/50">
          {title}
        </span>
        <span className={cn('font-mono text-[10px]', indicatorCls ?? 'text-muted-foreground/40')}>
          {files.length}
        </span>
      </div>
      <ul className="flex flex-col">
        {files.map(({ file, status, summary }) => (
          <li key={`${status}:${file}`}>
            <StatusFileRow
              file={file}
              status={status}
              summary={summary}
              selected={selectedFile === file}
              onSelect={() => onSelectFile(file, status)}
              onOpen={onOpenFile ? () => onOpenFile(file) : undefined}
              onStage={onStageFile ? () => onStageFile(file) : undefined}
              isStaging={stagingFiles?.has(file) ?? false}
              onUnstage={onUnstageFile ? () => onUnstageFile(file) : undefined}
              isUnstaging={unstagingFiles?.has(file) ?? false}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
