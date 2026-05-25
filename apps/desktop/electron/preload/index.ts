import { contextBridge, ipcRenderer } from "electron";

const gptNative = {
  openRepoDialog: (): Promise<string | null> => ipcRenderer.invoke("dialog:openRepo"),
  getServeBaseUrl: (): Promise<string> => ipcRenderer.invoke("serve:baseUrl"),

  /** Tell the main process which repo to watch (pass null to stop watching). */
  watchRepo: (repoPath: string | null): Promise<void> =>
    ipcRenderer.invoke("repo:watch", repoPath),

  /**
   * Subscribe to file-change events from the repo watcher.
   * Returns a cleanup function — call it to unsubscribe.
   */
  onFileChanged: (cb: (file: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, file: string) => cb(file);
    ipcRenderer.on("repo:file-changed", handler);
    return () => ipcRenderer.off("repo:file-changed", handler);
  },

  /** Open a file path with the OS default application (cross-platform). */
  openPath: (filePath: string): Promise<string> =>
    ipcRenderer.invoke("shell:open-path", filePath),

  /** Returns the last N opened repo paths (most recent first). */
  getRecentRepos: (): Promise<string[]> =>
    ipcRenderer.invoke("repos:getRecent"),

  /** Prepends the given path to the recent-repos list and returns the updated list. */
  addRecentRepo: (repoPath: string): Promise<string[]> =>
    ipcRenderer.invoke("repos:addRecent", repoPath),
};

contextBridge.exposeInMainWorld("gptNative", gptNative);

export type GptNative = typeof gptNative;
