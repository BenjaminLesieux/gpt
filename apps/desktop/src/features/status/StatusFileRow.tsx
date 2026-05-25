import { Plus, Minus, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Spinner } from '@/components/ui/spinner';

export type FileStatus = 'added' | 'modified' | 'deleted' | 'untracked';

export interface StatusFile {
  file: string;
  status: FileStatus;
  summary?: string;
}

interface StatusFileRowProps extends StatusFile {
  selected: boolean;
  onSelect: () => void;
  onOpen?: () => void;
  onStage?: () => void;
  isStaging?: boolean;
  onUnstage?: () => void;
  isUnstaging?: boolean;
}

const STATUS_CONFIG: Record<FileStatus, { letter: string; textCls: string; bgCls: string }> = {
  added:     { letter: 'A', textCls: 'text-diff-added',   bgCls: 'bg-diff-added-bg'   },
  modified:  { letter: 'M', textCls: 'text-diff-changed', bgCls: 'bg-diff-changed-bg' },
  deleted:   { letter: 'D', textCls: 'text-destructive',  bgCls: 'bg-diff-removed-bg' },
  untracked: { letter: '?', textCls: 'text-info',         bgCls: 'bg-info/10'         },
};

function splitPath(filePath: string): [string, string] {
  const idx = filePath.lastIndexOf('/');
  if (idx === -1) return ['', filePath];
  return [filePath.slice(0, idx + 1), filePath.slice(idx + 1)];
}

export function StatusFileRow({
  file,
  status,
  summary,
  selected,
  onSelect,
  onOpen,
  onStage,
  isStaging,
  onUnstage,
  isUnstaging,
}: StatusFileRowProps) {
  const { letter, textCls, bgCls } = STATUS_CONFIG[status];
  const [dir, basename] = splitPath(file);

  return (
    <div
      className={cn(
        'group relative flex items-stretch border-l-2 transition-colors duration-100',
        selected
          ? 'border-l-primary bg-accent hover:bg-accent'
          : 'border-l-transparent hover:bg-accent/50',
      )}
    >
      {/* Selection area */}
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className="flex flex-1 items-center gap-3 px-4 py-2 text-left"
      >
        <div className={cn('flex size-[18px] shrink-0 items-center justify-center', bgCls)}>
          <span className={cn('font-mono text-[10px] font-bold leading-none', textCls)}>
            {letter}
          </span>
        </div>

        <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
          {dir && (
            <span className="font-mono text-[11px] text-muted-foreground/40">{dir}</span>
          )}
          <span className="font-mono text-[11px] text-foreground/85">{basename}</span>
        </div>

        {summary && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
            {summary}
          </span>
        )}
      </button>

      {/* Hover-reveal actions: Open + Stage/Unstage */}
      {(onOpen || onStage || onUnstage) && (
        <div
          className={cn(
            'flex shrink-0 items-center gap-0.5 pr-2 transition-opacity duration-100',
            (isStaging || isUnstaging) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {onOpen && (
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Open ${basename} in Guitar Pro`}
                  onClick={(e) => { e.stopPropagation(); onOpen(); }}
                >
                  <ExternalLink strokeWidth={1.5} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open in Guitar Pro</TooltipContent>
            </Tooltip>
          )}
          {onUnstage && (
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => { e.stopPropagation(); onUnstage(); }}
                  disabled={isUnstaging}
                  aria-label={`Unstage ${basename}`}
                  className="hover:text-destructive"
                >
                  {isUnstaging ? <Spinner className="size-3" /> : <Minus strokeWidth={2} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Unstage</TooltipContent>
            </Tooltip>
          )}
          {onStage && (
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => { e.stopPropagation(); onStage(); }}
                  disabled={isStaging}
                  aria-label={`Stage ${basename}`}
                  className="hover:text-primary"
                >
                  {isStaging ? <Spinner className="size-3" /> : <Plus strokeWidth={2} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stage</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
