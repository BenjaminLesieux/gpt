import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface HistoryHeaderProps {
  count: number;
  isFetching: boolean;
  onRefresh: () => void;
}

export function HistoryHeader({ count, isFetching, onRefresh }: HistoryHeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        History
      </span>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-muted-foreground/50">
          {count} {count === 1 ? 'commit' : 'commits'}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                onClick={onRefresh}
                className="h-5 w-5 p-0 text-muted-foreground/50 hover:text-muted-foreground"
              >
                <RefreshCw
                  className={cn('size-3', isFetching && 'animate-spin')}
                  aria-hidden
                />
              </Button>
            }
          />
          <TooltipContent side="bottom">Refresh</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
