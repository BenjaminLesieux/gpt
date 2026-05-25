import { useState } from 'react';
import { GitMerge, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useBranches, useStartMerge } from '@/hooks/useGpt';
import type { MergeOutcome } from '@/api/client';

interface MergeStartPanelProps {
  repoPath: string;
  onMergeStarted: (outcome: MergeOutcome) => void;
}

export function MergeStartPanel({ repoPath, onMergeStarted }: MergeStartPanelProps) {
  const { data: branchData } = useBranches(repoPath);
  const startMerge = useStartMerge(repoPath);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  const currentBranch = branchData?.current ?? '…';
  const otherBranches = (branchData?.branches ?? []).filter(
    (b) => b !== branchData?.current,
  );

  const handleMerge = async () => {
    if (!selectedBranch) return;
    try {
      const outcome = await startMerge.mutateAsync({ branch: selectedBranch });
      if (outcome.type === 'conflicts') {
        toast.warning(
          `Merge has ${outcome.conflictCount} conflict${outcome.conflictCount === 1 ? '' : 's'} — resolve them before committing`,
        );
      } else if (outcome.type === 'already-up-to-date') {
        toast.info('Already up to date');
      } else {
        toast.success(`Merged ${selectedBranch} successfully`);
      }
      onMergeStarted(outcome);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Merge failed');
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-8">
      {/* Icon */}
      <div className="flex size-16 items-center justify-center rounded-sm border border-border bg-card">
        <GitMerge className="size-7 text-muted-foreground/30" strokeWidth={1.5} />
      </div>

      {/* Heading */}
      <div className="text-center">
        <h2 className="mb-1.5 font-sans text-[15px] font-medium text-foreground">
          Merge a branch
        </h2>
        <p className="font-mono text-[11px] text-muted-foreground/50">
          into <span className="text-primary">{currentBranch}</span>
        </p>
      </div>

      {/* Branch picker + button */}
      <div className="flex w-full max-w-xs flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/40">
            Branch to merge from
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between rounded-sm border border-border bg-card px-3 py-2.5 text-left transition-colors duration-100 hover:bg-accent',
                    !selectedBranch && 'text-muted-foreground/50',
                  )}
                />
              }
            >
              <span className="font-mono text-[12px]">
                {selectedBranch ?? 'Select branch…'}
              </span>
              <ChevronDown className="size-3.5 text-muted-foreground/40" strokeWidth={1.5} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
              {otherBranches.length === 0 ? (
                <div className="px-3 py-4 text-center font-mono text-[11px] text-muted-foreground/40">
                  No other branches
                </div>
              ) : (
                otherBranches.map((b) => (
                  <DropdownMenuItem
                    key={b}
                    onClick={() => setSelectedBranch(b)}
                    className={cn(
                      'font-mono text-[12px]',
                      selectedBranch === b && 'text-primary',
                    )}
                  >
                    {b}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Button
          className="w-full"
          disabled={!selectedBranch || startMerge.isPending}
          onClick={handleMerge}
        >
          {startMerge.isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Merging…
            </>
          ) : (
            <>
              <GitMerge className="size-3.5" strokeWidth={1.5} />
              Start merge
            </>
          )}
        </Button>
      </div>

      {/* Explanation */}
      <p className="max-w-xs text-center font-mono text-[10px] leading-relaxed text-muted-foreground/30">
        GPT will perform a 3-way merge of all .gp files. Clean merges commit
        automatically. Conflicts are listed here for manual resolution.
      </p>
    </div>
  );
}
