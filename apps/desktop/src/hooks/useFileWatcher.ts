import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { keys } from "./useGpt";
import { useAppStore } from "@/store/index";

/**
 * Registers a chokidar-backed file watcher for the given repo via Electron IPC.
 * Invalidates status/workdir caches on .gp file change and shows a toast with a
 * "Stage & Commit" shortcut that opens the QuickCommitSheet.
 */
export function useFileWatcher(repoPath: string | null): void {
  const qc = useQueryClient();
  const setQuickCommitFile = useAppStore((s) => s.setQuickCommitFile);

  useEffect(() => {
    if (!repoPath || !window.gptNative) return;

    window.gptNative.watchRepo(repoPath);

    const off = window.gptNative.onFileChanged((file) => {
      qc.invalidateQueries({ queryKey: keys.status(repoPath) });
      qc.invalidateQueries({ queryKey: keys.workdirFile(repoPath, file) });

      const basename = file.split("/").pop() ?? file;
      toast(`${basename} modified`, {
        duration: 8000,
        action: {
          label: "Stage & Commit",
          onClick: () => setQuickCommitFile(file),
        },
      });
    });

    return () => {
      off();
      window.gptNative?.watchRepo(null);
    };
  }, [repoPath, qc, setQuickCommitFile]);
}
