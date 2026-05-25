import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { GitCommit, FileText } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { useAppStore } from '@/store/index';
import { useStageFile, useCommit } from '@/hooks/useGpt';

interface QuickCommitSheetProps {
  repoPath: string;
}

export function QuickCommitSheet({ repoPath }: QuickCommitSheetProps) {
  const quickCommitFile = useAppStore((s) => s.quickCommitFile);
  const setQuickCommitFile = useAppStore((s) => s.setQuickCommitFile);

  const [message, setMessage] = useState('');
  const [isStaging, setIsStaging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const stageFile = useStageFile(repoPath);
  const commit = useCommit(repoPath);

  const isOpen = quickCommitFile !== null;
  const basename = quickCommitFile?.split('/').pop() ?? '';

  // Auto-stage the file and focus the textarea when the sheet opens.
  useEffect(() => {
    if (!isOpen || !quickCommitFile) return;

    setMessage('');
    setIsStaging(true);
    stageFile.mutateAsync(quickCommitFile)
      .catch((err) => {
        toast.error('Could not stage file', {
          description: err instanceof Error ? err.message : String(err),
        });
        setQuickCommitFile(null);
      })
      .finally(() => {
        setIsStaging(false);
        // Defer focus until after the sheet animation settles.
        setTimeout(() => textareaRef.current?.focus(), 80);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, quickCommitFile]);

  const handleCommit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || commit.isPending) return;
    try {
      const result = await commit.mutateAsync(trimmed);
      toast.success(`Committed ${result.shortHash}`, {
        description: result.message,
      });
      setQuickCommitFile(null);
    } catch (err) {
      toast.error('Commit failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [message, commit, setQuickCommitFile]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setQuickCommitFile(null);
    },
    [setQuickCommitFile],
  );

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-lg pb-6">
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center gap-2 text-sm font-medium">
            <GitCommit className="size-4 text-primary" strokeWidth={1.5} />
            Quick commit
          </SheetTitle>
        </SheetHeader>

        {/* File badge */}
        <div className="px-4">
          <div className="flex items-center gap-2 rounded-sm border border-border bg-muted/40 px-2.5 py-1.5">
            <FileText className="size-3.5 shrink-0 text-muted-foreground/60" strokeWidth={1.5} />
            <span className="font-mono text-[11px] text-foreground/80">{basename}</span>
            {isStaging && <Spinner className="ml-auto size-3" />}
          </div>
        </div>

        {/* Commit message */}
        <div className="px-4 pt-3">
          <Textarea
            ref={textareaRef}
            placeholder="Commit message…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStaging || commit.isPending}
            rows={3}
            className="resize-none"
          />
          <p className="mt-1.5 text-right font-mono text-[10px] text-muted-foreground/40">
            ⌘ Enter to commit
          </p>
        </div>

        <SheetFooter className="flex-row justify-end gap-2 px-4 pb-0 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setQuickCommitFile(null)}
            disabled={commit.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCommit}
            disabled={!message.trim() || isStaging || commit.isPending}
          >
            {commit.isPending ? <Spinner className="size-3" /> : <GitCommit strokeWidth={1.5} />}
            Commit
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
