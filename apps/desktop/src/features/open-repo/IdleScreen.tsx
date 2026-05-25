import { FolderOpen, Clock, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface IdleScreenProps {
  onOpen: () => void;
  recentRepos?: string[];
  onOpenRecent?: (path: string) => void;
}

export function IdleScreen({ onOpen, recentRepos = [], onOpenRecent }: IdleScreenProps) {
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[42ch] text-base leading-snug text-muted-foreground">
        Open a folder to start versioning your Guitar&nbsp;Pro files. Diffs are computed
        at the measure — not the byte.
      </p>
      <div className="flex items-center gap-3">
        <Button size="lg" onClick={onOpen} aria-label="Open folder">
          <FolderOpen aria-hidden />
          Open folder
        </Button>
      </div>

      {recentRepos.length > 0 && onOpenRecent && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Clock className="size-3 text-muted-foreground/40" strokeWidth={1.5} />
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/40">
              Recent
            </span>
          </div>
          <ul className="flex flex-col gap-0.5">
            {recentRepos.map((repo) => {
              const name = repo.split('/').pop() ?? repo;
              const dir = repo.slice(0, repo.length - name.length - 1);
              return (
                <li key={repo}>
                  <button
                    type="button"
                    onClick={() => onOpenRecent(repo)}
                    className="group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors duration-100 hover:bg-accent"
                  >
                    <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                      {dir && (
                        <span className="font-mono text-[10px] text-muted-foreground/40">
                          {dir}/
                        </span>
                      )}
                      <span className="font-mono text-[11px] text-foreground/80">{name}</span>
                    </span>
                    <ChevronRight
                      className="size-3 shrink-0 text-muted-foreground/30 transition-transform duration-100 group-hover:translate-x-0.5 group-hover:text-muted-foreground/60"
                      strokeWidth={1.5}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
