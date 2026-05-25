import { create } from "zustand";

/**
 * App-wide Zustand store.
 *
 * We only persist **navigation/selection state** here — everything that can
 * be derived from the `gpt serve` API (commit log, status, diffs, etc.) lives
 * in the TanStack Query cache. This avoids double-sourcing and keeps
 * invalidation simple.
 */

interface RepoSlice {
  /** Absolute path to the currently-open repository. `null` before any repo is opened. */
  repoPath: string | null;
  setRepoPath: (path: string | null) => void;
}

interface HistorySlice {
  /** Hash of the commit selected in the history browser. */
  selectedCommitHash: string | null;
  selectCommit: (hash: string | null) => void;
  /** Hash of a second commit pinned for comparison. When set, diff view is shown. */
  diffCommitHash: string | null;
  setDiffCommit: (hash: string | null) => void;
}

interface ViewerSlice {
  /** Active track index in the tab viewer (score may have multiple tracks). */
  activeTrackIndex: number;
  setActiveTrack: (index: number) => void;
}

interface QuickCommitSlice {
  /** File path queued for the quick-commit sheet (null = sheet closed). */
  quickCommitFile: string | null;
  setQuickCommitFile: (file: string | null) => void;
}

export type AppStore = RepoSlice & HistorySlice & ViewerSlice & QuickCommitSlice;


export const useAppStore = create<AppStore>((set) => ({
  // ── Repo ────────────────────────────────────────────────────────────────────
  repoPath: null,
  setRepoPath: (repoPath) => set({ repoPath }),

  // ── History ─────────────────────────────────────────────────────────────────
  selectedCommitHash: null,
  selectCommit: (selectedCommitHash) => set({ selectedCommitHash }),
  diffCommitHash: null,
  setDiffCommit: (diffCommitHash) => set({ diffCommitHash }),

  // ── Viewer ──────────────────────────────────────────────────────────────────
  activeTrackIndex: 0,
  setActiveTrack: (activeTrackIndex) => set({ activeTrackIndex }),

  // ── Quick commit ─────────────────────────────────────────────────────────────
  quickCommitFile: null,
  setQuickCommitFile: (quickCommitFile) => set({ quickCommitFile }),
}));
