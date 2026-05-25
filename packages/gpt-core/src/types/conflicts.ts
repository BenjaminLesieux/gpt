// ── Serializable conflict sidecar ─────────────────────────────────────────────
//
// Written to .gpt-conflicts.json when `gpt merge` produces unresolved conflicts.
// Contains no AlphaTab objects — fully JSON-serializable so the desktop UI
// can read it without spawning the CLI.

/** The filename of the merge conflict sidecar (at repo root). */
export const CONFLICT_SIDECAR = ".gpt-conflicts.json" as const;

/** A single conflict location — mirrors ConflictLocation from merge.ts. */
export interface SidecarConflict {
  /** Dot-notation path: "track[0].bar[4].voice[0].beat[0].note[s=1].fret" */
  readonly path: string;
  readonly kind: "field" | "structural-note" | "structural-beat";
  readonly description: string;
}

/** Per-file conflict state, updated as the user resolves conflicts in the UI. */
export interface FileConflictState {
  /** Repo-relative path, e.g. "song.gp" */
  readonly path: string;
  /** Total number of conflict locations in this file. */
  readonly conflictCount: number;
  /** Full list of conflict locations. */
  readonly conflicts: SidecarConflict[];
  /**
   * Resolutions accumulated as the user works through conflicts.
   * Key = SidecarConflict.path, value = which side to keep.
   * Starts empty; grows as the user resolves.
   */
  resolutions: Record<string, "ours" | "theirs">;
}

/** The complete sidecar written to disk after a conflicted merge. */
export interface ConflictSidecar {
  readonly schemaVersion: 1;
  /** Common ancestor commit hash. */
  readonly baseHash: string;
  /** The branch we're merging INTO (current branch name). */
  readonly oursRef: string;
  /** The branch we're merging FROM. */
  readonly theirsRef: string;
  /** Head commit hash of theirsRef at merge time. */
  readonly theirsHash: string;
  /** ISO 8601 timestamp when the merge was initiated. */
  readonly mergedAt: string;
  readonly files: FileConflictState[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function unresolvedCount(sidecar: ConflictSidecar): number {
  return sidecar.files.reduce((sum, f) => {
    const resolved = Object.keys(f.resolutions).length;
    return sum + (f.conflictCount - resolved);
  }, 0);
}

export function isFullyResolved(sidecar: ConflictSidecar): boolean {
  return unresolvedCount(sidecar) === 0;
}
