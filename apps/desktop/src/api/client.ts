/**
 * Typed HTTP client for the `gpt serve` bridge (default: http://127.0.0.1:7337).
 *
 * All JSON endpoints follow a single envelope:
 *   - Success: `{ ok: true,  data: T }`
 *   - Error:   `{ ok: false, error: string }`
 *
 * The client unwraps the envelope and throws {@link GptApiError} on failure.
 * Callers (TanStack Query hooks, imperative code) can therefore `await` the
 * raw data type and rely on normal error propagation.
 */

import type { Commit, ConflictSidecar, FileConflictState } from "@gpt/gpt-core";

// ─── Types mirrored from the CLI package (structural, not imported) ──────────
// Kept intentionally minimal — we only surface what the desktop consumes.

export interface StatusResult {
  branch: string;
  staged: Array<{ file: string; status: "added" | "modified" | "deleted"; summary?: string }>;
  unstaged: Array<{ file: string; status: "modified" | "deleted" }>;
  untracked: string[];
}

export interface FileDiff {
  file: string;
  diff: { meta: unknown; tracks: unknown; summary: string };
}

export interface ShowResult {
  commit: Commit;
  files: Array<{ file: string; summary?: string }>;
}

export interface RepoValidation {
  dir: string;
  exists: boolean;
  isGitRepo: boolean;
  isGptRepo: boolean;
}

export interface InitResult {
  dir: string;
  status: "created" | "already";
}

export interface CommitResult {
  hash: string;
  shortHash: string;
  message: string;
}

export interface BranchResult {
  branches: string[];
  current: string;
}

// ─── Merge types ───────────────────────────────────────────────────────────────

export type MergeStatus =
  | { active: false }
  | { active: true; sidecar: ConflictSidecar; unresolved: number };

export type MergeOutcome =
  | { type: "already-up-to-date" }
  | { type: "fast-forward"; filesUpdated: string[] }
  | { type: "clean"; commitHash: string; filesUpdated: string[] }
  | { type: "conflicts"; files: FileConflictState[]; conflictCount: number; filesUpdated: string[] };

export interface MergeResolveResult {
  unresolved: number;
  fullyResolved: boolean;
}

export interface MergeFinalizeResult {
  commitHash: string;
  shortHash: string;
}

export type { ConflictSidecar, FileConflictState };

// ─── Envelope ─────────────────────────────────────────────────────────────────

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export class GptApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GptApiError";
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

export interface GptClientOptions {
  /** Base URL of the `gpt serve` process. Defaults to http://127.0.0.1:7337. */
  baseUrl?: string;
  /** Injected `fetch` implementation for testing. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

export class GptClient {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(options: GptClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:7337").replace(/\/$/, "");
    this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  validateRepo(dir: string): Promise<RepoValidation> {
    return this.getJson<RepoValidation>("/repo/validate", { dir });
  }

  log(dir: string): Promise<Commit[]> {
    return this.getJson<Commit[]>("/log", { dir });
  }

  status(dir: string): Promise<StatusResult> {
    return this.getJson<StatusResult>("/status", { dir });
  }

  diff(dir: string, hash1?: string, hash2?: string): Promise<FileDiff[]> {
    return this.getJson<FileDiff[]>("/diff", {
      dir,
      ...(hash1 ? { hash1 } : {}),
      ...(hash2 ? { hash2 } : {}),
    });
  }

  show(dir: string, hash: string): Promise<ShowResult> {
    return this.getJson<ShowResult>(`/show/${encodeURIComponent(hash)}`, { dir });
  }

  /** Fetches the raw `.gp` bytes of `file` at `hash`. */
  async showFile(dir: string, hash: string, file: string): Promise<Uint8Array> {
    const url = this.buildUrl(
      `/show/${encodeURIComponent(hash)}/file/${file.split("/").map(encodeURIComponent).join("/")}`,
      { dir },
    );
    const res = await this.doFetch(url);
    if (!res.ok) throw new GptApiError(await safeText(res), res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Fetches the raw `.gp` bytes of `file` from the working tree (not from git). */
  async workdirFile(dir: string, file: string): Promise<Uint8Array> {
    const url = this.buildUrl(
      `/workdir/file/${file.split("/").map(encodeURIComponent).join("/")}`,
      { dir },
    );
    const res = await this.doFetch(url);
    if (!res.ok) throw new GptApiError(await safeText(res), res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  init(dir: string): Promise<InitResult> {
    return this.postJson<InitResult>("/init", {}, { dir });
  }

  addFile(dir: string, file: string): Promise<{ file: string }> {
    return this.postJson<{ file: string }>("/add", { file }, { dir });
  }

  unstageFile(dir: string, file: string): Promise<{ file: string }> {
    return this.postJson<{ file: string }>("/reset", { file }, { dir });
  }

  commit(dir: string, message: string): Promise<CommitResult> {
    return this.postJson<CommitResult>("/commit", { message }, { dir });
  }

  branches(dir: string): Promise<BranchResult> {
    return this.getJson<BranchResult>("/branch", { dir });
  }

  createBranch(dir: string, name: string): Promise<{ name: string }> {
    return this.postJson<{ name: string }>("/branch", { name }, { dir });
  }

  checkout(dir: string, ref: string): Promise<{ ref: string }> {
    return this.postJson<{ ref: string }>("/checkout", { ref }, { dir });
  }

  mergeStatus(dir: string): Promise<MergeStatus> {
    return this.getJson<MergeStatus>("/merge", { dir });
  }

  startMerge(dir: string, branch: string, noCommit?: boolean): Promise<MergeOutcome> {
    return this.postJson<MergeOutcome>("/merge", { branch, noCommit: noCommit ?? false }, { dir });
  }

  resolveConflict(
    dir: string,
    file: string,
    path: string,
    resolution: "ours" | "theirs",
  ): Promise<MergeResolveResult> {
    return this.putJson<MergeResolveResult>("/merge/resolve", { file, path, resolution }, { dir });
  }

  finalizeMerge(dir: string, message?: string): Promise<MergeFinalizeResult> {
    return this.postJson<MergeFinalizeResult>("/merge/finalize", { message }, { dir });
  }

  abortMerge(dir: string): Promise<{ aborted: true }> {
    return this.deleteJson<{ aborted: true }>("/merge", { dir });
  }

  /** Writes a committed file to the OS temp dir; returns the absolute temp path. */
  restoreTmp(dir: string, hash: string, file: string): Promise<{ path: string }> {
    return this.postJson<{ path: string }>("/restore", { hash, file }, { dir });
  }

  /** Overwrites the working-tree file with the committed version (like git checkout hash -- file). */
  restoreWorkdir(dir: string, hash: string, file: string): Promise<{ file: string }> {
    return this.postJson<{ file: string }>("/restore-workdir", { hash, file }, { dir });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private buildUrl(path: string, query: Record<string, string> = {}): string {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return url.toString();
  }

  private async getJson<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const res = await this.doFetch(this.buildUrl(path, query));
    return unwrap<T>(res);
  }

  private async postJson<T>(
    path: string,
    body: Record<string, unknown>,
    query: Record<string, string> = {},
  ): Promise<T> {
    const res = await this.doFetch(this.buildUrl(path, query), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return unwrap<T>(res);
  }

  private async putJson<T>(
    path: string,
    body: Record<string, unknown>,
    query: Record<string, string> = {},
  ): Promise<T> {
    const res = await this.doFetch(this.buildUrl(path, query), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return unwrap<T>(res);
  }

  private async deleteJson<T>(
    path: string,
    query: Record<string, string> = {},
  ): Promise<T> {
    const res = await this.doFetch(this.buildUrl(path, query), { method: "DELETE" });
    return unwrap<T>(res);
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  let payload: Envelope<T>;
  try {
    payload = (await res.json()) as Envelope<T>;
  } catch {
    throw new GptApiError(`Invalid response from gpt serve (${res.status})`, res.status);
  }
  if (!payload.ok) throw new GptApiError(payload.error, res.status);
  return payload.data;
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()) || `HTTP ${res.status}`; }
  catch { return `HTTP ${res.status}`; }
}

/** Default singleton for app use. Tests should construct their own instance. */
export const gptClient = new GptClient();
