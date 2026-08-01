import { Effect } from "effect";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import * as fsNode from "node:fs";
import * as os from "node:os";
import * as pathNode from "node:path";
import { GitLayer } from "../runtime/GitLayer";
import { AlphaTabLayer } from "../runtime/AlphaTabLayer";
import { FSLayer } from "../runtime/FSLayer";
import { logData } from "./log";
import { statusData } from "./status";
import { diffData, tracksWithBars } from "./diff";
import { showData, showFileBytesData } from "./show";
import { initData } from "./init";
import { validateRepoData } from "./repo";
import { branchListData } from "./branch";
import { mergeData, finalizeData } from "./merge";
import { CONFLICT_SIDECAR, unresolvedCount } from "@gpt/gpt-core";
import type { ConflictSidecar } from "@gpt/gpt-core";

const DEFAULT_PORT = 7337;

function provideAll<A, E>(
  effect: Effect.Effect<A, E, GitLayer | AlphaTabLayer | FSLayer>,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(GitLayer.Live),
      Effect.provide(AlphaTabLayer.Live),
      Effect.provide(FSLayer.Live),
    ),
  );
}

function dir(searchParams: URLSearchParams): string {
  return searchParams.get("dir") ?? process.cwd();
}

export const serveCommand = ({ port = DEFAULT_PORT }: { port?: number } = {}) =>
  Effect.sync(() => {
    const app = new Hono();

    app.use("*", cors());

    app.get("/log", async (c) => {
      const commits = await provideAll(logData(dir(new URL(c.req.url).searchParams)));
      return c.json({ ok: true, data: commits });
    });

    app.get("/status", async (c) => {
      const status = await provideAll(statusData(dir(new URL(c.req.url).searchParams)));
      return c.json({ ok: true, data: status });
    });

    app.get("/diff", async (c) => {
      const params = new URL(c.req.url).searchParams;
      const fileDiffs = await provideAll(
        diffData({
          dir: dir(params),
          hash1: params.get("hash1") ?? undefined,
          hash2: params.get("hash2") ?? undefined,
        }),
      );
      const out = fileDiffs.map(({ file, diff }) => ({
        file,
        diff: { meta: diff.meta, tracks: tracksWithBars(diff), summary: diff.summary },
      }));
      return c.json({ ok: true, data: out });
    });

    app.get("/show/:hash", async (c) => {
      const params = new URL(c.req.url).searchParams;
      const result = await provideAll(showData({ hash: c.req.param("hash"), dir: dir(params) }));
      return c.json({ ok: true, data: result });
    });

    app.get("/show/:hash/file/:filename{.+}", async (c) => {
      const params = new URL(c.req.url).searchParams;
      const bytes = await provideAll(
        showFileBytesData({ hash: c.req.param("hash"), file: c.req.param("filename"), dir: dir(params) }),
      );
      return c.body(Buffer.from(bytes) as unknown as ArrayBuffer, 200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${c.req.param("filename").split("/").pop()}"`,
      });
    });

    app.get("/workdir/file/:filename{.+}", async (c) => {
      const params = new URL(c.req.url).searchParams;
      const filename = c.req.param("filename");
      const repoDir = dir(params);
      const bytes = await provideAll(
        Effect.gen(function* () {
          const fsl = yield* FSLayer;
          return yield* fsl.readFile(fsl.resolve(repoDir, filename));
        }),
      );
      return c.body(Buffer.from(bytes) as unknown as ArrayBuffer, 200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename.split("/").pop()}"`,
      });
    });

    app.get("/branch", async (c) => {
      const { branches, current } = await provideAll(branchListData(dir(new URL(c.req.url).searchParams)));
      return c.json({ ok: true, data: { branches, current } });
    });

    app.post("/branch", async (c) => {
      const body = await c.req.json<{ name?: string }>();
      if (!body.name) return c.json({ ok: false, error: "Missing required field: name" }, 400);
      await Effect.runPromise(
        Effect.gen(function* () {
          const git = yield* GitLayer;
          yield* git.branch(dir(new URL(c.req.url).searchParams), body.name!);
        }).pipe(Effect.provide(GitLayer.Live)),
      );
      return c.json({ ok: true, data: { name: body.name } });
    });

    app.post("/checkout", async (c) => {
      const body = await c.req.json<{ ref?: string }>();
      if (!body.ref) return c.json({ ok: false, error: "Missing required field: ref" }, 400);
      await Effect.runPromise(
        Effect.gen(function* () {
          const git = yield* GitLayer;
          yield* git.checkout(dir(new URL(c.req.url).searchParams), body.ref!);
        }).pipe(Effect.provide(GitLayer.Live)),
      );
      return c.json({ ok: true, data: { ref: body.ref } });
    });

    app.get("/repo/validate", async (c) => {
      const target = dir(new URL(c.req.url).searchParams);
      const result = await provideAll(validateRepoData(target));
      return c.json({ ok: true, data: result });
    });

    app.post("/init", async (c) => {
      const body = await c.req.json<{ dir?: string }>();
      const target = body.dir?.trim();
      if (!target) return c.json({ ok: false, error: "Missing required field: dir" }, 400);
      const result = await provideAll(initData(target));
      return c.json({ ok: true, data: { dir: target, status: result } });
    });

    app.post("/reset", async (c) => {
      const body = await c.req.json<{ file?: string }>();
      if (!body.file) return c.json({ ok: false, error: "Missing required field: file" }, 400);
      await Effect.runPromise(
        Effect.gen(function* () {
          const git = yield* GitLayer;
          yield* git.resetIndex(dir(new URL(c.req.url).searchParams), body.file!);
        }).pipe(Effect.provide(GitLayer.Live)),
      );
      return c.json({ ok: true, data: { file: body.file } });
    });

    app.post("/add", async (c) => {
      const body = await c.req.json<{ file?: string }>();
      if (!body.file) return c.json({ ok: false, error: "Missing required field: file" }, 400);
      await Effect.runPromise(
        Effect.gen(function* () {
          const git = yield* GitLayer;
          yield* git.add(dir(new URL(c.req.url).searchParams), body.file!);
        }).pipe(Effect.provide(GitLayer.Live)),
      );
      return c.json({ ok: true, data: { file: body.file } });
    });

    app.post("/commit", async (c) => {
      const body = await c.req.json<{ message?: string }>();
      const message = body.message?.trim();
      if (!message) return c.json({ ok: false, error: "Missing required field: message" }, 400);
      const hash = await Effect.runPromise(
        Effect.gen(function* () {
          const git = yield* GitLayer;
          return yield* git.commit(dir(new URL(c.req.url).searchParams), message, {
            name: process.env["GIT_AUTHOR_NAME"] ?? "Musician",
            email: process.env["GIT_AUTHOR_EMAIL"] ?? "musician@local",
          });
        }).pipe(Effect.provide(GitLayer.Live)),
      );
      return c.json({ ok: true, data: { hash, shortHash: hash.slice(0, 7), message } });
    });

    // ── Merge ─────────────────────────────────────────────────────────────────

    /** Read the conflict sidecar if present, null otherwise. */
    async function readSidecar(repoDir: string): Promise<ConflictSidecar | null> {
      try {
        const bytes = await provideAll(
          Effect.gen(function* () {
            const fsl = yield* FSLayer;
            return yield* fsl.readFile(fsl.resolve(repoDir, CONFLICT_SIDECAR));
          }),
        );
        return JSON.parse(Buffer.from(bytes).toString("utf8")) as ConflictSidecar;
      } catch {
        return null;
      }
    }

    async function writeSidecar(repoDir: string, sidecar: ConflictSidecar): Promise<void> {
      await provideAll(
        Effect.gen(function* () {
          const fsl = yield* FSLayer;
          yield* fsl.writeFile(
            fsl.resolve(repoDir, CONFLICT_SIDECAR),
            Buffer.from(JSON.stringify(sidecar, null, 2)),
          );
        }),
      );
    }

    /** GET /merge — check whether a merge is in progress. */
    app.get("/merge", async (c) => {
      const repoDir = dir(new URL(c.req.url).searchParams);
      const sidecar = await readSidecar(repoDir);
      if (!sidecar) return c.json({ ok: true, data: { active: false } });
      return c.json({ ok: true, data: { active: true, sidecar, unresolved: unresolvedCount(sidecar) } });
    });

    /**
     * POST /merge — start a merge.
     * Body: { branch: string, noCommit?: boolean }
     * Returns 200 on clean/fast-forward, 409 on conflicts.
     */
    app.post("/merge", async (c) => {
      const params = new URL(c.req.url).searchParams;
      const body = await c.req.json<{ branch?: string; noCommit?: boolean }>();
      if (!body.branch) return c.json({ ok: false, error: "Missing required field: branch" }, 400);
      const outcome = await provideAll(mergeData({ dir: dir(params), branch: body.branch, noCommit: body.noCommit }));
      return c.json({ ok: true, data: outcome });
    });

    /**
     * PUT /merge/resolve — record a resolution for one conflict path in the sidecar.
     * Body: { file: string, path: string, resolution: "ours" | "theirs" }
     * Returns remaining unresolved count.
     */
    app.put("/merge/resolve", async (c) => {
      const params = new URL(c.req.url).searchParams;
      const repoDir = dir(params);
      const body = await c.req.json<{ file?: string; path?: string; resolution?: "ours" | "theirs" }>();
      if (!body.file || !body.path || !body.resolution) {
        return c.json({ ok: false, error: "Missing required fields: file, path, resolution" }, 400);
      }

      const sidecar = await readSidecar(repoDir);
      if (!sidecar) return c.json({ ok: false, error: "No merge in progress" }, 404);

      const fileState = sidecar.files.find((f) => f.path === body.file);
      if (!fileState) return c.json({ ok: false, error: `File not in conflict: ${body.file}` }, 404);

      fileState.resolutions[body.path] = body.resolution;
      await writeSidecar(repoDir, sidecar);

      const unresolved = unresolvedCount(sidecar);
      return c.json({ ok: true, data: { unresolved, fullyResolved: unresolved === 0 } });
    });

    /**
     * POST /merge/finalize — apply all resolutions, re-export affected files, and commit.
     * Body (optional): { message?: string }
     * Requires all conflicts to be resolved; returns 409 otherwise.
     */
    app.post("/merge/finalize", async (c) => {
      const params = new URL(c.req.url).searchParams;
      const repoDir = dir(params);
      const body = await c.req.json<{ message?: string }>().catch(() => ({} as { message?: string }));
      const result = await provideAll(finalizeData({ dir: repoDir, message: body.message }));
      return c.json({ ok: true, data: { commitHash: result.commitHash, shortHash: result.commitHash.slice(0, 7) } });
    });

    /**
     * DELETE /merge — abort the current merge (removes the conflict sidecar).
     * Does NOT restore file contents — the caller is responsible for restoring if needed.
     */
    app.delete("/merge", async (c) => {
      const repoDir = dir(new URL(c.req.url).searchParams);
      try {
        await fsNode.promises.unlink(pathNode.join(repoDir, CONFLICT_SIDECAR));
      } catch {
        // Already gone — treat as success
      }
      return c.json({ ok: true, data: { aborted: true } });
    });

    /**
     * POST /restore — copy a committed file to the OS temp directory and return the path.
     * Lets the desktop open a historical version in Guitar Pro without touching the working tree.
     * Body: { hash: string, file: string }   Query: ?dir=<repo>
     */
    app.post("/restore", async (c) => {
      const repoDir = dir(new URL(c.req.url).searchParams);
      const body = await c.req.json<{ hash?: string; file?: string }>();
      if (!body.hash || !body.file) {
        return c.json({ ok: false, error: "Missing required fields: hash, file" }, 400);
      }
      const bytes = await provideAll(showFileBytesData({ hash: body.hash, file: body.file, dir: repoDir }));
      const tmpPath = pathNode.join(os.tmpdir(), `gpt-${body.hash.slice(0, 7)}-${pathNode.basename(body.file)}`);
      await fsNode.promises.writeFile(tmpPath, Buffer.from(bytes));
      return c.json({ ok: true, data: { path: tmpPath } });
    });

    /**
     * POST /restore-workdir — overwrite the working-tree file with a committed version.
     * Equivalent to `git checkout <hash> -- <file>` but without changing the git index.
     * Body: { hash: string, file: string }   Query: ?dir=<repo>
     */
    app.post("/restore-workdir", async (c) => {
      const repoDir = dir(new URL(c.req.url).searchParams);
      const body = await c.req.json<{ hash?: string; file?: string }>();
      if (!body.hash || !body.file) {
        return c.json({ ok: false, error: "Missing required fields: hash, file" }, 400);
      }
      const bytes = await provideAll(showFileBytesData({ hash: body.hash, file: body.file, dir: repoDir }));
      await fsNode.promises.writeFile(pathNode.join(repoDir, body.file), Buffer.from(bytes));
      return c.json({ ok: true, data: { file: body.file } });
    });

    app.onError((err, c) => {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: message }, 500);
    });

    app.notFound((c) => c.json({ ok: false, error: `No route: ${c.req.method} ${c.req.path}` }, 404));

    return new Promise<void>((_, reject) => {
      serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
        process.stdout.write(`gpt serve  listening on http://127.0.0.1:${port}\n`);
      }).on("error", reject);
    });
  }).pipe(Effect.flatMap((p) => Effect.promise(() => p)));
