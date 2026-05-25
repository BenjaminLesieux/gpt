import { useState } from 'react';
import { GitBranch, ChevronDown, Plus, Check } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useBranches, useCheckout, useCreateBranch } from '@/hooks/useGpt';
import { toast } from 'sonner';

interface BranchSwitcherProps {
  repoPath: string;
}

export function BranchSwitcher({ repoPath }: BranchSwitcherProps) {
  const { data } = useBranches(repoPath);
  const checkout = useCheckout(repoPath);
  const createBranch = useCreateBranch(repoPath);
  const [open, setOpen] = useState(false);
  const [newBranch, setNewBranch] = useState('');

  const current = data?.current ?? '…';
  const branches = data?.branches ?? [];

  const handleCheckout = async (ref: string) => {
    if (ref === data?.current) { setOpen(false); return; }
    try {
      await checkout.mutateAsync(ref);
      setOpen(false);
      toast.success(`Switched to ${ref}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Checkout failed');
    }
  };

  const handleCreate = async () => {
    const name = newBranch.trim();
    if (!name) return;
    try {
      await createBranch.mutateAsync(name);
      await checkout.mutateAsync(name);
      setNewBranch('');
      setOpen(false);
      toast.success(`Created and switched to ${name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create branch');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="mt-2 flex w-full items-center gap-1.5 rounded-sm border border-border bg-secondary px-2 py-1.5 text-[12px] text-foreground transition-colors duration-100 hover:bg-accent"
            aria-label={`Current branch: ${current}. Click to switch.`}
          />
        }
      >
        <GitBranch className="size-3 shrink-0" strokeWidth={1.5} />
        <span className="min-w-0 flex-1 truncate text-left font-sans">{current}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1" align="start" sideOffset={4}>
        <div className="mb-1 px-2 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/50">
          Branches
        </div>

        <div className="max-h-48 overflow-y-auto">
          {branches.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => handleCheckout(b)}
              disabled={checkout.isPending}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] transition-colors duration-100',
                b === current
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Check
                className={cn('size-3 shrink-0', b === current ? 'opacity-100 text-primary' : 'opacity-0')}
                strokeWidth={2}
              />
              <span className="truncate font-mono">{b}</span>
            </button>
          ))}
        </div>

        <div className="mt-1 border-t border-border pt-1">
          <div className="flex items-center gap-1 px-1">
            <Input
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="New branch…"
              className="h-7 flex-1 border-0 bg-transparent px-1 text-[12px] font-mono shadow-none focus-visible:ring-0"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleCreate}
              disabled={!newBranch.trim() || createBranch.isPending}
              aria-label="Create branch"
            >
              <Plus className="size-3" />
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
