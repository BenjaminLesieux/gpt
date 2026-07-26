import { Effect } from "effect";
import { FSLayer } from "../runtime/FSLayer";

/**
 * Shape returned by `GET /repo/validate`.
 *
 * `isGitRepo` — directory contains a `.git/` folder.
 * `isGptRepo` — directory contains both `.git/` and `.gpt/` markers.
 *
 * Used by the desktop open-repo flow to decide whether to prompt for init.
 */
export interface RepoValidation {
  dir: string;
  exists: boolean;
  isGitRepo: boolean;
  isGptRepo: boolean;
}

export const validateRepoData = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FSLayer;
    const exists = yield* fs.exists(dir);
    const isGitRepo = exists && (yield* fs.exists(fs.resolve(dir, ".git")));
    const isGptRepo = isGitRepo && (yield* fs.exists(fs.resolve(dir, ".gpt")));
    return { dir, exists, isGitRepo, isGptRepo } satisfies RepoValidation;
  });
