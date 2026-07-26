import { Effect } from "effect";
import { join } from "node:path";
import { diffScores } from "@gpt/gpt-core";
import type { Commit } from "@gpt/gpt-core";
import { GitLayer } from "../runtime/GitLayer";
import { AlphaTabLayer } from "../runtime/AlphaTabLayer";
import { FSLayer } from "../runtime/FSLayer";
import { CommitNotFoundError } from "../errors";

const GP_EXTENSIONS = [".gp", ".gp5", ".gpx"];
const isGpFile = (f: string) => GP_EXTENSIONS.some((ext) => f.endsWith(ext));

export interface FileShow {
  file: string;
  summary?: string;
}

export interface ShowResult {
  commit: Commit;
  files: FileShow[];
}

interface ShowOptions {
  hash: string;
  export?: string;
  json?: boolean;
  dir?: string;
}

export const showData = ({ hash, dir = process.cwd() }: { hash: string; dir?: string }) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    const at = yield* AlphaTabLayer;

    const fullHash = yield* expandHash(dir, hash, git);
    const commit = yield* git.readCommit(dir, fullHash);

    const gpFiles = (yield* git.listFiles(dir, fullHash)).filter(isGpFile);
    const files: FileShow[] = [];
    const parentHash = commit.parentHashes[0] ?? null;

    for (const file of gpFiles) {
      const headBytes = yield* git.readBlob(dir, fullHash, file);

      if (parentHash) {
        const parentFiles = yield* git.listFiles(dir, parentHash);
        if (parentFiles.includes(file)) {
          const parentBytes = yield* git.readBlob(dir, parentHash, file);
          const [baseScore, headScore] = yield* Effect.all([
            at.parse(parentBytes),
            at.parse(headBytes),
          ]);
          const diff = diffScores(baseScore, headScore);
          files.push({ file, summary: diff.summary !== "No changes" ? diff.summary : undefined });
        } else {
          files.push({ file, summary: "new file" });
        }
      } else {
        files.push({ file, summary: "new file" });
      }
    }

    if (parentHash) {
      const parentFiles = (yield* git.listFiles(dir, parentHash)).filter(isGpFile);
      for (const file of parentFiles) {
        if (!gpFiles.includes(file)) {
          files.push({ file, summary: "deleted" });
        }
      }
    }

    return { commit, files } as ShowResult;
  });

export const showFileBytesData = ({ hash, file, dir = process.cwd() }: { hash: string; file: string; dir?: string }) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    const fullHash = yield* expandHash(dir, hash, git);
    return yield* git.readBlob(dir, fullHash, file);
  });

export const showEffect = ({ hash, export: exportPath, json = false, dir = process.cwd() }: ShowOptions) =>
  Effect.gen(function* () {
    const fs = yield* FSLayer;
    const result = yield* showData({ hash, dir });

    if (exportPath) {
      const git = yield* GitLayer;
      const fullHash = yield* expandHash(dir, hash, git);
      const gpFiles = (yield* git.listFiles(dir, fullHash)).filter(isGpFile);
      for (const file of gpFiles) {
        const bytes = yield* git.readBlob(dir, fullHash, file);
        yield* exportBlob(dir, file, bytes, exportPath, gpFiles.length, fs);
      }
    }

    if (json) {
      process.stdout.write(JSON.stringify({ ok: true, data: result }, null, 2) + "\n");
      return;
    }

    printShow(result);
  });

export const showCommand = (options: ShowOptions) =>
  showEffect(options).pipe(
    Effect.provide(GitLayer.Live),
    Effect.provide(AlphaTabLayer.Live),
    Effect.provide(FSLayer.Live),
  );

// ─── Hash resolution ─────────────────────────────────────────────────────────

function expandHash(dir: string, hash: string, git: GitLayer["Type"]) {
  return Effect.gen(function* () {
    if (hash.length === 40) return hash;

    const commits = yield* git.log(dir);
    const found = commits.find((c) => c.hash.startsWith(hash));
    if (!found) {
      return yield* Effect.fail(new CommitNotFoundError(hash));
    }
    return found.hash;
  });
}

// ─── Export ──────────────────────────────────────────────────────────────────

function exportBlob(
  _dir: string,
  filename: string,
  bytes: Uint8Array,
  exportPath: string,
  totalFiles: number,
  fs: FSLayer["Type"],
) {
  return Effect.gen(function* () {
    // Single file: write directly to exportPath; multiple files: write to exportPath/<filename>
    const dest = totalFiles === 1 ? exportPath : join(exportPath, filename);
    const destDir = totalFiles === 1 ? exportPath.replace(/[^/\\]*$/, "") : exportPath;

    if (destDir) {
      yield* fs.mkdir(destDir).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }

    yield* fs.writeFile(dest, bytes);
    process.stdout.write(`Exported ${filename} → ${dest}\n`);
  });
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function printShow(result: ShowResult) {
  const { commit, files } = result;
  const date = new Date(commit.author.timestamp * 1000).toUTCString();

  process.stdout.write(`\x1b[33mcommit ${commit.hash}\x1b[0m\n`);
  process.stdout.write(`Author: ${commit.author.name} <${commit.author.email}>\n`);
  process.stdout.write(`Date:   ${date}\n\n`);
  process.stdout.write(`    ${commit.message}\n\n`);

  if (files.length === 0) return;

  const parentHash = commit.parentHashes[0];
  const label = parentHash ? `vs parent (${parentHash.slice(0, 7)})` : "initial commit";
  process.stdout.write(`Changes (${label}):\n`);

  for (const { file, summary } of files) {
    if (summary) {
      process.stdout.write(`  ${file}\n    ${summary}\n`);
    } else {
      process.stdout.write(`  ${file}  (no changes)\n`);
    }
  }
}
