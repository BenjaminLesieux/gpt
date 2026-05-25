import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpenRepoView } from "./OpenRepoView";
import { useAppStore } from "../store/index";
import { gptClient, type RepoValidation } from "../api/client";

// HTTP client is spied on at the module boundary — no real server needed.
// `window.gptNative.openRepoDialog` is stubbed to simulate user picks / cancels.

const mockDialog = vi.fn<() => Promise<string | null>>();

beforeEach(() => {
  // Reset store + window shim between tests.
  useAppStore.setState({ repoPath: null, selectedCommitHash: null, activeTrackIndex: 0 });
  mockDialog.mockReset();
  (window as unknown as { gptNative: unknown }).gptNative = {
    openRepoDialog: mockDialog,
    getServeBaseUrl: vi.fn().mockResolvedValue("http://127.0.0.1:7337"),
  };
});

afterEach(() => {
  // Prevent spies on the `gptClient` singleton from leaking between tests.
  vi.restoreAllMocks();
});

function stubValidate(result: RepoValidation) {
  return vi.spyOn(gptClient, "validateRepo").mockResolvedValue(result);
}

describe("OpenRepoView", () => {
  it("shows the idle prompt with an Open folder button", () => {
    render(<OpenRepoView />);
    expect(screen.getByRole("button", { name: /open folder/i })).toBeInTheDocument();
    expect(screen.getByText(/start versioning/i)).toBeInTheDocument();
  });

  it("commits the path to the store when user picks a ready gpt repo", async () => {
    const user = userEvent.setup();
    mockDialog.mockResolvedValueOnce("/ready/repo");
    stubValidate({ dir: "/ready/repo", exists: true, isGitRepo: true, isGptRepo: true });

    render(<OpenRepoView />);
    await user.click(screen.getByRole("button", { name: /open folder/i }));

    await waitFor(() => {
      expect(useAppStore.getState().repoPath).toBe("/ready/repo");
    });
  });

  it("does nothing when the user cancels the native dialog", async () => {
    const user = userEvent.setup();
    mockDialog.mockResolvedValueOnce(null);
    const validateSpy = stubValidate({
      dir: "",
      exists: false,
      isGitRepo: false,
      isGptRepo: false,
    });

    render(<OpenRepoView />);
    await user.click(screen.getByRole("button", { name: /open folder/i }));

    expect(useAppStore.getState().repoPath).toBeNull();
    expect(validateSpy).not.toHaveBeenCalled();
  });

  it("offers init for a plain (non-gpt) git folder, and commits after confirming", async () => {
    const user = userEvent.setup();
    mockDialog.mockResolvedValueOnce("/plain/git");
    stubValidate({ dir: "/plain/git", exists: true, isGitRepo: true, isGptRepo: false });
    const initSpy = vi
      .spyOn(gptClient, "init")
      .mockResolvedValue({ dir: "/plain/git", status: "already" });

    render(<OpenRepoView />);
    await user.click(screen.getByRole("button", { name: /open folder/i }));

    await screen.findByText(/hasn't been registered with gpt/i);
    await user.click(screen.getByRole("button", { name: /^initialize$/i }));

    await waitFor(() => {
      expect(initSpy).toHaveBeenCalledWith("/plain/git");
      expect(useAppStore.getState().repoPath).toBe("/plain/git");
    });
  });

  it("offers init for a non-repo folder and commits after confirming", async () => {
    const user = userEvent.setup();
    mockDialog.mockResolvedValueOnce("/fresh");
    stubValidate({ dir: "/fresh", exists: true, isGitRepo: false, isGptRepo: false });
    vi.spyOn(gptClient, "init").mockResolvedValue({ dir: "/fresh", status: "created" });

    render(<OpenRepoView />);
    await user.click(screen.getByRole("button", { name: /open folder/i }));

    await screen.findByText(/isn't a repository yet/i);
    await user.click(screen.getByRole("button", { name: /^initialize$/i }));

    await waitFor(() => expect(useAppStore.getState().repoPath).toBe("/fresh"));
  });

  it("returns to idle when the user cancels the init prompt", async () => {
    const user = userEvent.setup();
    mockDialog.mockResolvedValueOnce("/plain/git");
    stubValidate({ dir: "/plain/git", exists: true, isGitRepo: true, isGptRepo: false });

    render(<OpenRepoView />);
    await user.click(screen.getByRole("button", { name: /open folder/i }));

    await user.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(screen.getByRole("button", { name: /open folder/i })).toBeInTheDocument();
    expect(useAppStore.getState().repoPath).toBeNull();
  });

  it("surfaces validate errors and offers a retry", async () => {
    const user = userEvent.setup();
    mockDialog.mockResolvedValueOnce("/bad");
    vi.spyOn(gptClient, "validateRepo").mockRejectedValueOnce(new Error("disk read failed"));

    render(<OpenRepoView />);
    await user.click(screen.getByRole("button", { name: /open folder/i }));

    await screen.findByText(/disk read failed/i);
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.getByRole("button", { name: /open folder/i })).toBeInTheDocument();
    expect(useAppStore.getState().repoPath).toBeNull();
  });

  it("surfaces init errors without committing the path", async () => {
    const user = userEvent.setup();
    mockDialog.mockResolvedValueOnce("/fresh");
    stubValidate({ dir: "/fresh", exists: true, isGitRepo: false, isGptRepo: false });
    vi.spyOn(gptClient, "init").mockRejectedValueOnce(new Error("permission denied"));

    render(<OpenRepoView />);
    await user.click(screen.getByRole("button", { name: /open folder/i }));
    await user.click(await screen.findByRole("button", { name: /^initialize$/i }));

    await screen.findByText(/permission denied/i);
    expect(useAppStore.getState().repoPath).toBeNull();
  });

  it("reports an error when the native bridge is missing (non-Electron context)", async () => {
    const user = userEvent.setup();
    (window as unknown as { gptNative: undefined }).gptNative = undefined;

    render(<OpenRepoView />);
    await user.click(screen.getByRole("button", { name: /open folder/i }));

    expect(await screen.findByText(/native bridge unavailable/i)).toBeInTheDocument();
  });
});
