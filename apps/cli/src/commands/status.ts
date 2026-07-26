import { Effect } from "effect";
import { join } from "node:path";
import { diffScores } from "@gpt/gpt-core";
import { GitLayer } from "../runtime/GitLayer";
import { AlphaTabLayer } from "../runtime/AlphaTabLayer";
import { FSLayer } from "../runtime/FSLayer";

const GP_EXTENSIONS = [".gp", ".gp5", ".gpx"];
const isGpFile = (f: string) => GP_EXTENSIONS.some((ext) => f.endsWith(ext));

export interface StagedFile {
  file: string;
  status: "added" | "modified" | "deleted";
  summary?: string;
}

export interface UnstagedFile {
  file: string;
  status: "modified" | "deleted";
}

export interface StatusResult {
  branch: string;
  staged: StagedFile[];
  unstaged: UnstagedFile[];
  untracked: string[];
}

interface StatusOptions {
  json?: boolean;
  dir?: string;
}

export const statusData = (dir: string = process.cwd()) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    const at = yield* AlphaTabLayer;
    const fs = yield* FSLayer;

    const branch = yield* git.currentBranch(dir);

    const matrix = yield* git.statusMatrix(dir, isGpFile).pipe(
      Effect.catchAll(() => Effect.succeed([] as Array<[string, number, number, number]>)),
    );

    const headSha = yield* git.resolveRef(dir, "HEAD").pipe(
      Effect.catchAll(() => Effect.succeed(null as string | null)),
    );

    const staged: StagedFile[] = [];
    const unstaged: UnstagedFile[] = [];
    const untracked: string[] = [];

    for (const [file, head, _workdir, stage] of matrix) {
      // Stage status meanings:
      //   0 = absent from index
      //   1 = same as HEAD
      //   2 = same as workdir (staged)
      //   3 = different from both HEAD and workdir (staged, but workdir has more changes)

      const stagedAdded = head === 0 && (stage === 2 || stage === 3);
      const stagedModified = head === 1 && (stage === 2 || stage === 3);
      const stagedDeleted = head === 1 && stage === 0;
      const isStaged = stagedAdded || stagedModified || stagedDeleted;

      if (stagedAdded) {
        staged.push({ file, status: "added" });
      } else if (stagedModified) {
        const summary = headSha
          ? yield* computeStagedSummary(dir, file, headSha, git, at, fs)
          : undefined;
        staged.push({ file, status: "modified", ...(summary ? { summary } : {}) });
      } else if (stagedDeleted) {
        staged.push({ file, status: "deleted" });
      }

      // If staged but workdir has additional changes (stage === 3), also show in unstaged
      if (isStaged && stage === 3) {
        unstaged.push({ file, status: "modified" });
      } else if (!isStaged) {
        const workdir = _workdir;
        if (head === 1 && workdir === 2 && stage === 1) {
          unstaged.push({ file, status: "modified" });
        } else if (head === 1 && workdir === 0 && stage === 1) {
          unstaged.push({ file, status: "deleted" });
        } else if (head === 0 && workdir === 2 && stage === 0) {
          untracked.push(file);
        }
      }
    }

    return { branch, staged, unstaged, untracked } as StatusResult;
  });

export const statusEffect = ({ json = false, dir = process.cwd() }: StatusOptions) =>
  statusData(dir).pipe(
    Effect.flatMap((result) =>
      Effect.sync(() => {
        if (json) {
          process.stdout.write(JSON.stringify({ ok: true, data: result }, null, 2) + "\n");
        } else {
          printStatus(result);
        }
      }),
    ),
  );

export const statusCommand = (options: StatusOptions) =>
  statusEffect(options).pipe(
    Effect.provide(GitLayer.Live),
    Effect.provide(AlphaTabLayer.Live),
    Effect.provide(FSLayer.Live),
  );

function computeStagedSummary(
  dir: string,
  file: string,
  headSha: string,
  git: GitLayer["Type"],
  at: AlphaTabLayer["Type"],
  fs: FSLayer["Type"],
) {
  return Effect.gen(function* () {
    const headBytes = yield* git.readBlob(dir, headSha, file).pipe(
      Effect.catchAll(() => Effect.succeed(null as Uint8Array | null)),
    );
    if (!headBytes) return undefined;

    const workdirBytes = yield* fs.readFile(join(dir, file)).pipe(
      Effect.catchAll(() => Effect.succeed(null as Uint8Array | null)),
    );
    if (!workdirBytes) return undefined;

    const [baseScore, headScore] = yield* Effect.all([
      at.parse(headBytes),
      at.parse(workdirBytes),
    ]);

    const diff = diffScores(baseScore, headScore);
    return diff.summary !== "No changes" ? diff.summary : undefined;
  });
}

function printStatus(result: StatusResult) {
  process.stdout.write(`On branch \x1b[1m${result.branch}\x1b[0m\n\n`);

  if (result.staged.length > 0) {
    process.stdout.write("Changes staged for commit:\n");
    for (const { file, status, summary } of result.staged) {
      const label = status.padEnd(12);
      const summaryStr = summary ? `  \x1b[2m(${summary})\x1b[0m` : "";
      process.stdout.write(`  \x1b[32m${label}${file}${summaryStr}\x1b[0m\n`);
    }
    process.stdout.write("\n");
  }

  if (result.unstaged.length > 0) {
    process.stdout.write("Changes not staged for commit:\n");
    for (const { file, status } of result.unstaged) {
      const label = status.padEnd(12);
      process.stdout.write(`  \x1b[31m${label}${file}\x1b[0m\n`);
    }
    process.stdout.write("\n");
  }

  if (result.untracked.length > 0) {
    process.stdout.write("Untracked files:\n");
    for (const file of result.untracked) {
      process.stdout.write(`  \x1b[90m${file}\x1b[0m\n`);
    }
    process.stdout.write("\n");
  }

  if (
    result.staged.length === 0 &&
    result.unstaged.length === 0 &&
    result.untracked.length === 0
  ) {
    process.stdout.write("Nothing to commit, working tree clean\n");
  }
}
