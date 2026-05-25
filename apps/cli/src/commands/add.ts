import { Effect } from "effect";
import { outro } from "@clack/prompts";
import { GitLayer } from "../runtime/GitLayer.js";

export const addCommand = (filepath: string, dir: string = process.cwd()) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    yield* git.add(dir, filepath);
    outro(`Staged: ${filepath}`);
  }).pipe(Effect.provide(GitLayer.Live));
