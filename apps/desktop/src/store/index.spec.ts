import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./index";

/**
 * The store is tiny — these tests just make sure each slice's action cleanly
 * updates state without cross-slice leakage. Using `getState()` / `setState()`
 * here keeps tests free of React rendering overhead.
 */

describe("useAppStore", () => {
  beforeEach(() => {
    // Reset to a known-clean state between tests.
    useAppStore.setState({ repoPath: null, selectedCommitHash: null, activeTrackIndex: 0 });
  });

  it("starts with no repo open", () => {
    const state = useAppStore.getState();
    expect(state.repoPath).toBeNull();
    expect(state.selectedCommitHash).toBeNull();
    expect(state.activeTrackIndex).toBe(0);
  });

  it("setRepoPath updates the repo path", () => {
    useAppStore.getState().setRepoPath("/Users/me/songs");
    expect(useAppStore.getState().repoPath).toBe("/Users/me/songs");
  });

  it("setRepoPath(null) clears the repo (close repo)", () => {
    useAppStore.getState().setRepoPath("/repo");
    useAppStore.getState().setRepoPath(null);
    expect(useAppStore.getState().repoPath).toBeNull();
  });

  it("changing one slice does not clobber another", () => {
    const { setRepoPath, selectCommit, setActiveTrack } = useAppStore.getState();
    setRepoPath("/r");
    selectCommit("abc123");
    setActiveTrack(2);

    const after = useAppStore.getState();
    expect(after.repoPath).toBe("/r");
    expect(after.selectedCommitHash).toBe("abc123");
    expect(after.activeTrackIndex).toBe(2);
  });
});
