import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { FSLayer } from "../runtime/FSLayer.js";
import { validateRepoData } from "./repo.js";

/**
 * Build an `FSLayer` whose `exists` answers from a provided set of paths.
 * `resolve` joins parts with `/` which is sufficient for these tests.
 */
function fsWithPaths(existingPaths: Set<string>): Layer.Layer<FSLayer> {
  const notImplemented = () => Effect.die("not implemented in test");
  return Layer.succeed(FSLayer, {
    readFile: notImplemented,
    writeFile: notImplemented,
    mkdir: notImplemented,
    exists: (p: string) => Effect.succeed(existingPaths.has(p)),
    resolve: (...parts: string[]) => parts.join("/"),
  } as FSLayer["Type"]);
}

const runValidate = (dir: string, paths: Set<string>) =>
  Effect.runPromise(validateRepoData(dir).pipe(Effect.provide(fsWithPaths(paths))));

describe("validateRepoData", () => {
  it("reports a non-existent directory", async () => {
    const result = await runValidate("/tmp/missing", new Set());
    expect(result).toEqual({
      dir: "/tmp/missing",
      exists: false,
      isGitRepo: false,
      isGptRepo: false,
    });
  });

  it("detects a plain (non-gpt) git repository", async () => {
    const result = await runValidate("/repo", new Set(["/repo", "/repo/.git"]));
    expect(result).toEqual({
      dir: "/repo",
      exists: true,
      isGitRepo: true,
      isGptRepo: false,
    });
  });

  it("detects a fully-initialized gpt repository", async () => {
    const result = await runValidate(
      "/repo",
      new Set(["/repo", "/repo/.git", "/repo/.gpt"]),
    );
    expect(result).toEqual({
      dir: "/repo",
      exists: true,
      isGitRepo: true,
      isGptRepo: true,
    });
  });

  it("treats a directory without .git as not a git repo", async () => {
    const result = await runValidate("/some/folder", new Set(["/some/folder"]));
    expect(result.isGitRepo).toBe(false);
    expect(result.isGptRepo).toBe(false);
  });

  it("treats .gpt-only (no .git) as not a gpt repo", async () => {
    // A `.gpt` folder without `.git` shouldn't count — we require both.
    const result = await runValidate("/odd", new Set(["/odd", "/odd/.gpt"]));
    expect(result.isGitRepo).toBe(false);
    expect(result.isGptRepo).toBe(false);
  });
});
