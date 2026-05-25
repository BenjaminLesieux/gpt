import { Effect } from "effect";
import { join } from "node:path";
import { diffScores } from "@gpt/gpt-core";
import type { ScoreDiff, TrackDiff } from "@gpt/gpt-core";
import { GitLayer } from "../runtime/GitLayer.js";
import { AlphaTabLayer } from "../runtime/AlphaTabLayer.js";
import { FSLayer } from "../runtime/FSLayer.js";

interface DiffOptions {
  hash1?: string;
  hash2?: string;
  json?: boolean;
  dir?: string;
}

export interface FileDiff {
  file: string;
  diff: ScoreDiff;
}

export const diffData = ({ hash1, hash2, dir = process.cwd() }: Omit<DiffOptions, "json">) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    const at = yield* AlphaTabLayer;
    const fs = yield* FSLayer;

    return hash1 && hash2
      ? yield* diffTwoCommits(dir, hash1, hash2, git, at)
      : yield* diffWorkingTreeVsHead(dir, git, at, fs);
  });

export const diffCommand = ({ hash1, hash2, json = false, dir = process.cwd() }: DiffOptions) =>
  Effect.gen(function* () {
    const fileDiffs = yield* diffData({ hash1, hash2, dir });

    if (fileDiffs.length === 0) {
      process.stdout.write("No .gp files to diff.\n");
      return;
    }

    if (json) {
      const out = fileDiffs.map(({ file, diff }) => ({
        file,
        diff: { meta: diff.meta, tracks: diff.tracks, summary: diff.summary },
      }));
      process.stdout.write(JSON.stringify({ ok: true, data: out }, null, 2) + "\n");
      return;
    }

    for (const { file, diff } of fileDiffs) {
      const label = hash1 && hash2 ? `${hash1.slice(0, 7)}..${hash2.slice(0, 7)}` : "HEAD..working tree";
      process.stdout.write(`\x1b[1mdiff --gpt ${label} ${file}\x1b[0m\n`);

      if (diff.summary === "No changes") {
        process.stdout.write("  (no changes)\n");
        continue;
      }

      for (const track of diff.tracks) {
        const line = formatTrackDiff(track);
        if (line) process.stdout.write(`  ${line}\n`);
      }
    }
  }).pipe(
    Effect.provide(GitLayer.Live),
    Effect.provide(AlphaTabLayer.Live),
    Effect.provide(FSLayer.Live),
  );

// ─── Diff strategies ─────────────────────────────────────────────────────────

function diffWorkingTreeVsHead(
  dir: string,
  git: GitLayer["Type"],
  at: AlphaTabLayer["Type"],
  fs: FSLayer["Type"],
) {
  return Effect.gen(function* () {
    const headSha = yield* git.resolveRef(dir, "HEAD").pipe(
      Effect.catchAll(() => Effect.succeed(null as string | null)),
    );

    if (!headSha) {
      process.stdout.write("No commits yet — nothing to diff against.\n");
      return [] as FileDiff[];
    }

    const trackedFiles = yield* git.listFiles(dir, "HEAD");
    const gpFiles = trackedFiles.filter((f) => f.endsWith(".gp") || f.endsWith(".gp5") || f.endsWith(".gpx"));

    const results: FileDiff[] = [];
    for (const file of gpFiles) {
      const workingBytes = yield* fs.readFile(join(dir, file)).pipe(
        Effect.catchAll(() => Effect.succeed(null as Uint8Array | null)),
      );
      if (!workingBytes) continue;

      const headBytes = yield* git.readBlob(dir, headSha, file);
      const [baseScore, headScore] = yield* Effect.all([
        at.parse(headBytes),
        at.parse(workingBytes),
      ]);

      results.push({ file, diff: diffScores(baseScore, headScore) });
    }

    return results;
  });
}

function diffTwoCommits(
  dir: string,
  hash1: string,
  hash2: string,
  git: GitLayer["Type"],
  at: AlphaTabLayer["Type"],
) {
  return Effect.gen(function* () {
    const [files1, files2] = yield* Effect.all([
      git.listFiles(dir, hash1),
      git.listFiles(dir, hash2),
    ]);

    const gpFiles = [...new Set([...files1, ...files2])].filter(
      (f) => f.endsWith(".gp") || f.endsWith(".gp5") || f.endsWith(".gpx"),
    );

    const results: FileDiff[] = [];
    for (const file of gpFiles) {
      const inBase = files1.includes(file);
      const inHead = files2.includes(file);

      const baseBytes = inBase ? yield* git.readBlob(dir, hash1, file) : null;
      const headBytes = inHead ? yield* git.readBlob(dir, hash2, file) : null;

      if (!baseBytes || !headBytes) {
        // file added or removed — skip full diff for now; summary handled below
        continue;
      }

      const [baseScore, headScore] = yield* Effect.all([
        at.parse(baseBytes),
        at.parse(headBytes),
      ]);

      results.push({ file, diff: diffScores(baseScore, headScore) });
    }

    return results;
  });
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function formatTrackDiff(track: TrackDiff): string {
  const added = track.bars.filter((b) => b.type === "added").length;
  const removed = track.bars.filter((b) => b.type === "removed").length;
  const changed = track.bars.filter((b) => b.type === "changed").length;

  if (!added && !removed && !changed) return "";

  const parts = [
    changed ? `\x1b[33m~${changed}\x1b[0m` : "",
    added ? `\x1b[32m+${added}\x1b[0m` : "",
    removed ? `\x1b[31m-${removed}\x1b[0m` : "",
  ].filter(Boolean);

  return `${track.trackName}: ${parts.join(" ")}`;
}
