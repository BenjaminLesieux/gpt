import { Effect } from "effect";
import { intro, outro, spinner } from "@clack/prompts";
import { GitLayer } from "../runtime/GitLayer.js";
import { FSLayer } from "../runtime/FSLayer.js";

/**
 * Pure init effect. Ensures the directory is a git repo with a `.gpt` marker.
 *
 * @returns `"created"` if we initialized it, `"already"` if it was already a gpt repo.
 */
export const initData = (dir: string = process.cwd()) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    const fs = yield* FSLayer;

    const gptDir = fs.resolve(dir, ".gpt");
    const already = yield* fs.exists(gptDir);
    if (already) return "already" as const;

    yield* git.init(dir);
    yield* fs.mkdir(gptDir);
    return "created" as const;
  });

export const initCommand = (dir: string = process.cwd()) =>
  Effect.gen(function* () {
    intro("gpt init");
    const s = spinner();
    s.start("Initializing repository…");
    const result = yield* initData(dir);
    s.stop(result === "created" ? "Repository initialized." : "Already a gpt repository.");
    outro(
      result === "created"
        ? "Done! Run `gpt add <file.gp>` to start tracking your songs."
        : "No changes made.",
    );
  }).pipe(
    Effect.provide(GitLayer.Live),
    Effect.provide(FSLayer.Live),
  );
