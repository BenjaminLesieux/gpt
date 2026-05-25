import { Effect } from "effect";
import { join } from "node:path";
import * as fsNode from "node:fs";
import { mergeScores, applyMerge, CONFLICT_SIDECAR, isFullyResolved, unresolvedCount } from "@gpt/gpt-core";
import type { ConflictSidecar, FileConflictState } from "@gpt/gpt-core";
import { GitLayer } from "../runtime/GitLayer.js";
import { AlphaTabLayer } from "../runtime/AlphaTabLayer.js";
import { FSLayer } from "../runtime/FSLayer.js";
import { FSError, NoCommonAncestorError, NoMergeInProgressError, UnresolvedConflictsError } from "../errors.js";

const GP_EXT = /\.(gp|gp5|gp4|gpx|gp6|gp7)$/i;
const isGpFile = (f: string) => GP_EXT.test(f);

// ─── Public result types ──────────────────────────────────────────────────────
// These are returned by mergeData() and consumed by both the CLI command and
// the HTTP serve endpoint.

export type MergeOutcome =
  | { type: "already-up-to-date" }
  | { type: "fast-forward"; filesUpdated: string[] }
  | { type: "clean"; commitHash: string; filesUpdated: string[] }
  | { type: "conflicts"; files: FileConflictState[]; conflictCount: number; filesUpdated: string[] };

// ─── Core merge logic (pure Effect, layer-injected) ──────────────────────────

export interface MergeOptions {
  dir?: string;
  branch: string;
  /** If true, don't commit clean merges — leave them staged. Default: false. */
  noCommit?: boolean;
  /** Author for the auto-commit on clean merges. */
  author?: { name: string; email: string };
}

export const mergeData = ({
  dir = process.cwd(),
  branch,
  noCommit = false,
  author = {
    name:  process.env["GIT_AUTHOR_NAME"]  ?? "Musician",
    email: process.env["GIT_AUTHOR_EMAIL"] ?? "musician@local",
  },
}: MergeOptions) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    const at  = yield* AlphaTabLayer;
    const fs  = yield* FSLayer;

    // ── 1. Resolve hashes ─────────────────────────────────────────────────
    const [oursHash, theirsHash, oursRef] = yield* Effect.all([
      git.resolveRef(dir, "HEAD"),
      git.resolveRef(dir, branch),
      git.currentBranch(dir),
    ]);

    // ── 2. Find common ancestor ───────────────────────────────────────────
    const bases = yield* git.findMergeBase(dir, oursHash, theirsHash);
    if (bases.length === 0) {
      return yield* Effect.fail(new NoCommonAncestorError(branch));
    }
    const baseHash = bases[0]!;

    // ── 3. Fast-path checks ───────────────────────────────────────────────
    if (theirsHash === oursHash) {
      return { type: "already-up-to-date" } satisfies MergeOutcome;
    }
    if (baseHash === theirsHash) {
      // Theirs is an ancestor of ours — we're ahead, nothing to do.
      return { type: "already-up-to-date" } satisfies MergeOutcome;
    }

    const isFastForward = baseHash === oursHash;

    // ── 4. Collect .gp files present in any two of the three commits ──────
    const [baseFiles, oursFiles, theirsFiles] = yield* Effect.all([
      git.listFiles(dir, baseHash).pipe(Effect.catchAll(() => Effect.succeed([] as string[]))),
      git.listFiles(dir, oursHash),
      git.listFiles(dir, theirsHash),
    ]);

    const allGpFiles = [...new Set([
      ...baseFiles.filter(isGpFile),
      ...oursFiles.filter(isGpFile),
      ...theirsFiles.filter(isGpFile),
    ])].sort();

    // ── 5. Merge each file ────────────────────────────────────────────────
    const conflictFiles: FileConflictState[] = [];
    const updatedFiles:  string[]            = [];

    for (const file of allGpFiles) {
      const inBase   = baseFiles.includes(file);
      const inOurs   = oursFiles.includes(file);
      const inTheirs = theirsFiles.includes(file);

      // ── File only in theirs (added by them) → copy to working tree ─────
      if (!inBase && !inOurs && inTheirs) {
        const bytes = yield* git.readBlob(dir, theirsHash, file);
        yield* fs.writeFile(join(dir, file), bytes);
        yield* git.add(dir, file);
        updatedFiles.push(file);
        stdout(`A  ${file}  (added from ${branch})`);
        continue;
      }

      // ── File only in ours (we added it) → nothing to do ────────────────
      if (!inBase && inOurs && !inTheirs) continue;

      // ── File removed in theirs → leave as-is in working tree ───────────
      // (Deletions would require more complex handling; skip for now.)
      if (inBase && inOurs && !inTheirs) continue;

      // ── File present in all three (or at least ours + theirs) → merge ──
      if (!inOurs || !inTheirs) continue; // only in one side + base → skip

      const [baseBytes, oursBytes, theirsBytes] = yield* Effect.all([
        inBase
          ? git.readBlob(dir, baseHash, file).pipe(Effect.map((b) => b as Uint8Array | null))
          : Effect.succeed(null as Uint8Array | null),
        git.readBlob(dir, oursHash, file),
        git.readBlob(dir, theirsHash, file),
      ]);

      const [oursScore, theirsScore] = yield* Effect.all([
        at.parse(oursBytes),
        at.parse(theirsBytes),
      ]);

      const baseScore = baseBytes ? yield* at.parse(baseBytes) : null;

      // If no base (file added on both sides independently), treat ours as base.
      const effectiveBase = baseScore ?? oursScore;

      const result  = mergeScores(effectiveBase, oursScore, theirsScore);
      applyMerge(oursScore, theirsScore, result);

      const mergedBytes = yield* at.exportToBytes(oursScore);
      yield* fs.writeFile(join(dir, file), mergedBytes);
      updatedFiles.push(file);

      if (result.hasConflicts) {
        conflictFiles.push({
          path:          file,
          conflictCount: result.conflictCount,
          conflicts:     result.conflicts,
          resolutions:   {},
        });
        stdout(`CONFLICT  ${file}  (${result.conflictCount} conflict${result.conflictCount === 1 ? "" : "s"})`);
        for (const loc of result.conflicts.slice(0, 5)) {
          stdout(`  · ${loc.description}`);
        }
        if (result.conflicts.length > 5) {
          stdout(`  · … and ${result.conflicts.length - 5} more`);
        }
      } else {
        yield* git.add(dir, file);
        stdout(`M  ${file}  (auto-merged)`);
      }
    }

    // ── 6. Outcome ────────────────────────────────────────────────────────
    if (conflictFiles.length > 0) {
      const sidecar: ConflictSidecar = {
        schemaVersion: 1,
        baseHash,
        oursRef,
        theirsRef: branch,
        theirsHash,
        mergedAt: new Date().toISOString(),
        files: conflictFiles,
      };
      yield* fs.writeFile(
        join(dir, CONFLICT_SIDECAR),
        Buffer.from(JSON.stringify(sidecar, null, 2)),
      );
      const total = conflictFiles.reduce((n, f) => n + f.conflictCount, 0);
      return { type: "conflicts", files: conflictFiles, conflictCount: total, filesUpdated: updatedFiles } satisfies MergeOutcome;
    }

    // ── 7. Clean merge: auto-commit (unless --no-commit) ─────────────────
    if (isFastForward) {
      // Stage all updated files first.
      for (const file of updatedFiles) {
        yield* git.add(dir, file);
      }
      const message = `Fast-forward merge branch '${branch}'`;
      const commitHash = yield* git.commit(dir, message, author);
      stdout(`Fast-forward merge → ${commitHash.slice(0, 7)}`);
      return { type: "fast-forward", filesUpdated: updatedFiles } satisfies MergeOutcome;
    }

    if (noCommit) {
      return { type: "clean", commitHash: "", filesUpdated: updatedFiles } satisfies MergeOutcome;
    }

    const message = `Merge branch '${branch}'`;
    const commitHash = yield* git.commit(dir, message, author);
    return { type: "clean", commitHash, filesUpdated: updatedFiles } satisfies MergeOutcome;
  });

// ─── Finalize (post-conflict resolution commit) ───────────────────────────────

export interface FinalizeOptions {
  dir?: string;
  message?: string;
  author?: { name: string; email: string };
}

export const finalizeData = ({
  dir = process.cwd(),
  message,
  author = {
    name:  process.env["GIT_AUTHOR_NAME"]  ?? "Musician",
    email: process.env["GIT_AUTHOR_EMAIL"] ?? "musician@local",
  },
}: FinalizeOptions) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    const at  = yield* AlphaTabLayer;
    const fsl = yield* FSLayer;

    // ── 1. Load sidecar ───────────────────────────────────────────────────
    const sidecarPath = fsl.resolve(dir, CONFLICT_SIDECAR);
    const sidecarExists = yield* fsl.exists(sidecarPath);
    if (!sidecarExists) {
      return yield* Effect.fail(new NoMergeInProgressError());
    }
    const sidecarBytes = yield* fsl.readFile(sidecarPath);
    const sidecar: ConflictSidecar = JSON.parse(Buffer.from(sidecarBytes).toString("utf8"));

    if (!isFullyResolved(sidecar)) {
      const n = unresolvedCount(sidecar);
      return yield* Effect.fail(new UnresolvedConflictsError(n));
    }

    // ── 2. Apply resolutions per file ─────────────────────────────────────
    for (const fileState of sidecar.files) {
      const oursBytes   = yield* fsl.readFile(fsl.resolve(dir, fileState.path));
      const oursScore   = yield* at.parse(oursBytes);
      const theirsBytes = yield* git.readBlob(dir, sidecar.theirsHash, fileState.path);
      const theirsScore = yield* at.parse(theirsBytes);

      let modified = false;

      for (const conflict of fileState.conflicts) {
        const resolution = fileState.resolutions[conflict.path];
        if (!resolution || resolution === "ours") continue; // ours already in place

        // resolution === "theirs": copy theirs' bar into ours
        const ref = parseBarRef(conflict.path);
        if (!ref) continue;

        const oursTrack   = oursScore.tracks[ref.trackIndex];
        const theirsTrack = theirsScore.tracks[ref.trackIndex];
        if (!oursTrack?.staves[0] || !theirsTrack?.staves[0]) continue;

        const theirsBar = theirsTrack.staves[0].bars[ref.barIndex];
        if (theirsBar) {
          oursTrack.staves[0].bars[ref.barIndex] = theirsBar;
          modified = true;
        }
      }

      if (modified) {
        const bytes = yield* at.exportToBytes(oursScore);
        yield* fsl.writeFile(fsl.resolve(dir, fileState.path), bytes);
      }

      yield* git.add(dir, fileState.path);
    }

    // ── 3. Commit ─────────────────────────────────────────────────────────
    const commitMessage = message ?? `Merge branch '${sidecar.theirsRef}'`;
    const commitHash = yield* git.commit(dir, commitMessage, author);

    // ── 4. Remove sidecar ─────────────────────────────────────────────────
    yield* Effect.tryPromise({
      try: () => fsNode.promises.unlink(sidecarPath),
      catch: (e) => new FSError("unlink", sidecarPath, e),
    });

    stdout(`Merge finalized → ${commitHash.slice(0, 7)}`);
    return { commitHash };
  });

// ─── CLI command ─────────────────────────────────────────────────────────────

interface MergeCommandOptions {
  dir?: string;
  branch: string;
  noCommit?: boolean;
  json?: boolean;
}

export const mergeCommand = ({ dir = process.cwd(), branch, noCommit = false, json = false }: MergeCommandOptions) =>
  Effect.gen(function* () {
    const outcome = yield* mergeData({ dir, branch, noCommit });

    if (json) {
      process.stdout.write(JSON.stringify({ ok: true, data: outcome }, null, 2) + "\n");
      if (outcome.type === "conflicts") process.exit(1);
      return;
    }

    switch (outcome.type) {
      case "already-up-to-date":
        process.stdout.write("Already up to date.\n");
        break;

      case "fast-forward":
        process.stdout.write(`Fast-forward\n`);
        break;

      case "clean":
        process.stdout.write(
          `\nMerge branch '${branch}' complete.\n` +
          `  ${outcome.filesUpdated.length} file${outcome.filesUpdated.length === 1 ? "" : "s"} merged\n` +
          (outcome.commitHash ? `  commit: ${outcome.commitHash.slice(0, 7)}\n` : ""),
        );
        break;

      case "conflicts": {
        const unresolved = outcome.conflictCount;
        process.stdout.write(
          `\nAutomatic merge failed — ${unresolved} conflict${unresolved === 1 ? "" : "s"} need manual resolution.\n` +
          `Conflict details written to ${CONFLICT_SIDECAR}.\n` +
          `\nResolve conflicts in the GPT desktop app, then:\n` +
          `  gpt add <file>   # stage resolved files\n` +
          `  gpt commit -m "Merge branch '${branch}'"\n`,
        );
        process.exit(1);
      }
    }
  }).pipe(
    Effect.provide(GitLayer.Live),
    Effect.provide(AlphaTabLayer.Live),
    Effect.provide(FSLayer.Live),
  );

// ─── Internal ─────────────────────────────────────────────────────────────────

function stdout(msg: string): void {
  process.stdout.write(msg + "\n");
}

/** Parses a ConflictLocation path like "track[0].bar[4].voice[...]..." → track/bar indices. */
export function parseBarRef(path: string): { trackIndex: number; barIndex: number } | null {
  const m = /^track\[(\d+)\]\.bar\[(\d+)\]/.exec(path);
  if (!m) return null;
  return { trackIndex: Number(m[1]), barIndex: Number(m[2]) };
}
