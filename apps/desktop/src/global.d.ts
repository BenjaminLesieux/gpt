/**
 * Native capabilities injected by Electron's preload bridge into the renderer
 * window. Undefined in non-Electron contexts (plain vite preview, tests).
 *
 * The source of truth for this contract is `electron/preload/index.ts`.
 */
interface GptNative {
  /** Opens the native folder picker; returns an absolute path or `null` on cancel. */
  openRepoDialog: () => Promise<string | null>;
  /** Resolves the base URL of the running `gpt serve` instance. */
  getServeBaseUrl: () => Promise<string>;
  /** Tell the main process which repo to watch. Pass `null` to stop watching. */
  watchRepo: (repoPath: string | null) => Promise<void>;
  /**
   * Subscribe to file-change events from the repo watcher.
   * Returns a cleanup function — call it to unsubscribe.
   */
  onFileChanged: (cb: (file: string) => void) => () => void;
  /** Open a path with the OS default application (cross-platform). */
  openPath: (filePath: string) => Promise<string>;
  /** Returns the last N opened repo paths (most recent first). */
  getRecentRepos: () => Promise<string[]>;
  /** Prepends the given path to the recent-repos list and returns the updated list. */
  addRecentRepo: (repoPath: string) => Promise<string[]>;
}

declare global {
  interface Window {
    gptNative?: GptNative;
  }

  // Electron-only CSS prop that marks a region as the OS title bar drag handle.
  namespace React {
    interface CSSProperties {
      WebkitAppRegion?: "drag" | "no-drag";
    }
  }
}

export {};
