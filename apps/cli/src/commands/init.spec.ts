import { describe, it, expect, vi } from "vitest";
import { Effect, Layer } from "effect";
import { FSLayer } from "../runtime/FSLayer";
import { GitLayer } from "../runtime/GitLayer";
import { initData } from "./init";

const notImplemented = () => Effect.die("not implemented in test");

function fsLayerWith(overrides: Partial<FSLayer["Type"]>): Layer.Layer<FSLayer> {
  return Layer.succeed(FSLayer, {
    readFile: notImplemented,
    writeFile: notImplemented,
    mkdir: () => Effect.succeed(undefined),
    exists: () => Effect.succeed(false),
    resolve: (...parts: string[]) => parts.join("/"),
    ...overrides,
  } as FSLayer["Type"]);
}

function gitLayerWith(overrides: Partial<GitLayer["Type"]>): Layer.Layer<GitLayer> {
  return Layer.succeed(GitLayer, {
    init: () => Effect.succeed(undefined),
    add: notImplemented,
    commit: notImplemented,
    log: notImplemented,
    resolveRef: notImplemented,
    readBlob: notImplemented,
    listBranches: notImplemented,
    currentBranch: notImplemented,
    checkout: notImplemented,
    branch: notImplemented,
    listFiles: notImplemented,
    statusMatrix: notImplemented,
    readCommit: notImplemented,
    ...overrides,
  } as GitLayer["Type"]);
}

const runInit = (dir: string, git: Layer.Layer<GitLayer>, fs: Layer.Layer<FSLayer>) =>
  Effect.runPromise(initData(dir).pipe(Effect.provide(git), Effect.provide(fs)));

describe("initData", () => {
  it("returns 'already' and does nothing when .gpt/ exists", async () => {
    const gitInit = vi.fn(() => Effect.succeed(undefined));
    const mkdir = vi.fn(() => Effect.succeed(undefined));

    const result = await runInit(
      "/repo",
      gitLayerWith({ init: gitInit }),
      fsLayerWith({
        exists: (p: string) => Effect.succeed(p === "/repo/.gpt"),
        mkdir,
      }),
    );

    expect(result).toBe("already");
    expect(gitInit).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("returns 'created' and calls git.init + mkdir when .gpt/ is absent", async () => {
    const gitInit = vi.fn(() => Effect.succeed(undefined));
    const mkdir = vi.fn(() => Effect.succeed(undefined));

    const result = await runInit(
      "/repo",
      gitLayerWith({ init: gitInit }),
      fsLayerWith({
        exists: () => Effect.succeed(false),
        mkdir,
      }),
    );

    expect(result).toBe("created");
    expect(gitInit).toHaveBeenCalledWith("/repo");
    expect(mkdir).toHaveBeenCalledWith("/repo/.gpt");
  });

  it("propagates a git init failure", async () => {
    const err = new Error("permission denied");
    await expect(
      runInit(
        "/repo",
        gitLayerWith({ init: () => Effect.fail(err) }),
        fsLayerWith({ exists: () => Effect.succeed(false) }),
      ),
    ).rejects.toThrow("permission denied");
  });
});
