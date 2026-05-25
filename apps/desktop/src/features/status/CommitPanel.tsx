import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { useRepoStatus, useCommit } from '@/hooks/useGpt';

interface CommitPanelProps {
  repoPath: string;
  onCommitSuccess?: () => void;
}

export function CommitPanel({ repoPath, onCommitSuccess }: CommitPanelProps) {
  const { data: status } = useRepoStatus(repoPath);
  const commit = useCommit(repoPath);
  const [message, setMessage] = useState('');

  const stagedCount = status?.staged.length ?? 0;
  const canCommit = stagedCount > 0 && message.trim().length > 0 && !commit.isPending;

  const handleCommit = async () => {
    if (!canCommit) return;
    try {
      await commit.mutateAsync(message.trim());
      setMessage('');
      toast.success('Snapshot saved');
      onCommitSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Commit failed');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleCommit();
    }
  };

  return (
    <div className="shrink-0 border-t border-border px-4 py-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/50">
          Snapshot
        </span>
        {stagedCount > 0 && (
          <span className="font-mono text-[10px] text-diff-added">{stagedCount} staged</span>
        )}
      </div>

      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe this version…"
        disabled={commit.isPending}
        className="mb-3 min-h-[68px] max-h-[120px] resize-none overflow-y-auto text-[12px]"
        rows={3}
      />

      <Button
        onClick={() => void handleCommit()}
        disabled={!canCommit}
        className="w-full justify-between"
      >
        <span className="flex items-center gap-1.5">
          {commit.isPending && <Loader2 className="size-3 animate-spin" />}
          Save snapshot
        </span>
        {!commit.isPending && (
          <KbdGroup className="opacity-50">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </KbdGroup>
        )}
      </Button>
    </div>
  );
}
