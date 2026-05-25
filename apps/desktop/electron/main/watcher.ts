import { watch, type FSWatcher } from "chokidar";
import { basename } from "node:path";

const GP_FILE_RE = /\.gp[34567x]?$/i;

/**
 * Watches a repo directory for Guitar Pro file changes and fires a callback
 * with the changed filename. Debounced via chokidar's awaitWriteFinish to
 * handle GP's atomic-write pattern (temp-write → rename) on all platforms.
 */
export class RepoWatcher {
  private watcher: FSWatcher | null = null;

  start(repoPath: string, onChanged: (file: string) => void): void {
    this.stop();
    this.watcher = watch(repoPath, {
      ignored: [
        /(^|[/\\])\.git([/\\]|$)/,
        /(^|[/\\])\.gpt-conflict([/\\]|$)/,
        /(^|[/\\])node_modules([/\\]|$)/,
      ],
      persistent: true,
      ignoreInitial: true,
      depth: 1,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    const emit = (filePath: string) => {
      if (GP_FILE_RE.test(filePath)) onChanged(basename(filePath));
    };

    this.watcher.on("add", emit).on("change", emit);
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
