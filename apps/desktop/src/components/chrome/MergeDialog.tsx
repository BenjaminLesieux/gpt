import { useState } from 'react';
import { GitMerge } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MergeStartPanel } from '@/features/merge/MergeStartPanel';
import type { MergeOutcome } from '@/api/client';

// ─── MergeDialog ────────────────────────────────────────────────────────────
//
// Starting a merge is a branch-level action (think GitHub Desktop's
// "Merge into current branch"), so it lives in the toolbar rather than as a
// tab. A clean merge just toasts; a conflicting merge drops the user on the
// Changes tab, where ChangesView surfaces the conflict resolver.

export function MergeDialog({ repoPath }: { repoPath: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const handleMergeStarted = (outcome: MergeOutcome) => {
    setOpen(false);
    if (outcome.type === 'conflicts') {
      navigate({ to: '/repo/changes' });
    } else if (outcome.type === 'fast-forward') {
      toast.success('Fast-forward merge complete');
    } else if (outcome.type === 'clean') {
      toast.success(`Merge committed as ${outcome.commitHash.slice(0, 7)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-1.5">
            <GitMerge className="size-3.5" strokeWidth={1.5} />
            Merge
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Merge a branch</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-[360px] flex-col">
          <MergeStartPanel repoPath={repoPath} onMergeStarted={handleMergeStarted} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
