import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface StatusHeaderProps {
  stagedCount: number;
  changedCount: number;
  isFetching: boolean;
  onRefresh: () => void;
}

export function StatusHeader({ stagedCount, changedCount, isFetching, onRefresh }: StatusHeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Working Tree
      </span>
      <div className="flex items-center gap-3">
        {(stagedCount > 0 || changedCount > 0) && (
          <div className="flex items-center gap-2 font-mono text-[11px]">
            {stagedCount > 0 && (
              <span className="text-diff-added">{stagedCount} staged</span>
            )}
            {stagedCount > 0 && changedCount > 0 && (
              <span className="text-muted-foreground/30">·</span>
            )}
            {changedCount > 0 && (
              <span className="text-diff-changed">{changedCount} changed</span>
            )}
          </div>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                onClick={onRefresh}
                className="h-5 w-5 p-0 text-muted-foreground/50 hover:text-muted-foreground"
              >
                <RefreshCw className={cn('size-3', isFetching && 'animate-spin')} aria-hidden />
              </Button>
            }
          />
          <TooltipContent side="bottom">Refresh</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
