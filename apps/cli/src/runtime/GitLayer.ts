import { Context, Effect, Layer } from "effect";
import git from "isomorphic-git";
import * as fsNode from "node:fs";
import type { Commit } from "@gpt/gpt-core";
import { GitError } from "../errors.js";

const fs = fsNode;

const wrap =
  <A>(operation: string, fn: () => Promise<A>) =>
    Effect.tryPromise({ try: fn, catch: (e) => new GitError(operation, e) });

export class GitLayer extends Context.Tag("GitLayer")<
  GitLayer,
  {
    readonly init: (dir: string) => Effect.Effect<void, GitError>;
    readonly add: (dir: string, filepath: string) => Effect.Effect<void, GitError>;
    readonly commit: (dir: string, message: string, author: { name: string; email: string }) => Effect.Effect<string, GitError>;
    readonly log: (dir: string) => Effect.Effect<Commit[], GitError>;
    readonly resolveRef: (dir: string, ref: string) => Effect.Effect<string, GitError>;
    readonly readBlob: (dir: string, oid: string, filepath: string) => Effect.Effect<Uint8Array, GitError>;
    readonly listBranches: (dir: string) => Effect.Effect<string[], GitError>;
    readonly currentBranch: (dir: string) => Effect.Effect<string, GitError>;
    readonly checkout: (dir: string, ref: string) => Effect.Effect<void, GitError>;
    readonly branch: (dir: string, name: string) => Effect.Effect<void, GitError>;
    readonly listFiles: (dir: string, ref: string) => Effect.Effect<string[], GitError>;
    readonly statusMatrix: (dir: string, filter?: (f: string) => boolean) => Effect.Effect<Array<[string, number, number, number]>, GitError>;
    readonly readCommit: (dir: string, oid: string) => Effect.Effect<Commit, GitError>;
    /** Returns the set of common ancestor commit hashes for two commits (can be multiple in criss-cross merges). */
    readonly findMergeBase: (dir: string, oidA: string, oidB: string) => Effect.Effect<string[], GitError>;
    readonly writeRef: (dir: string, ref: string, value: string) => Effect.Effect<void, GitError>;
    readonly resetIndex: (dir: string, filepath: string) => Effect.Effect<void, GitError>;
  }
>() {
  static readonly Live = Layer.succeed(GitLayer, {
    init: (dir) =>
      wrap("init", () => git.init({ fs, dir })),

    add: (dir, filepath) =>
      wrap("add", () => git.add({ fs, dir, filepath })),

    commit: (dir, message, author) =>
      wrap("commit", () => git.commit({ fs, dir, message, author })),

    log: (dir) =>
      wrap("log", async () => {
        const entries = await git.log({ fs, dir });
        return entries.map((e) => ({
          hash: e.oid,
          shortHash: e.oid.slice(0, 7),
          message: e.commit.message.trim(),
          author: {
            name: e.commit.author.name,
            email: e.commit.author.email,
            timestamp: e.commit.author.timestamp,
          },
          parentHashes: e.commit.parent,
        }));
      }),

    resolveRef: (dir, ref) =>
      wrap("resolveRef", () => git.resolveRef({ fs, dir, ref })),

    readBlob: (dir, oid, filepath) =>
      wrap("readBlob", async () => {
        const { blob } = await git.readBlob({ fs, dir, oid, filepath });
        return blob;
      }),

    listBranches: (dir) =>
      wrap("listBranches", () => git.listBranches({ fs, dir })),

    currentBranch: (dir) =>
      wrap("currentBranch", async () => {
        const branch = await git.currentBranch({ fs, dir });
        return branch ?? "HEAD";
      }),

    checkout: (dir, ref) =>
      wrap("checkout", () => git.checkout({ fs, dir, ref })),

    branch: (dir, name) =>
      wrap("branch", () => git.branch({ fs, dir, ref: name })),

    listFiles: (dir, ref) =>
      wrap("listFiles", () => git.listFiles({ fs, dir, ref })),

    readCommit: (dir, oid) =>
      wrap("readCommit", async () => {
        const { commit } = await git.readCommit({ fs, dir, oid });
        return {
          hash: oid,
          shortHash: oid.slice(0, 7),
          message: commit.message.trim(),
          author: {
            name: commit.author.name,
            email: commit.author.email,
            timestamp: commit.author.timestamp,
          },
          parentHashes: commit.parent,
        };
      }),

    statusMatrix: (dir, filter) =>
      wrap("statusMatrix", async () => {
        const rows = await git.statusMatrix({ fs, dir, filter });
        return rows as Array<[string, number, number, number]>;
      }),

    findMergeBase: (dir, oidA, oidB) =>
      wrap("findMergeBase", () => git.findMergeBase({ fs, dir, oids: [oidA, oidB] })),

    writeRef: (dir, ref, value) =>
      wrap("writeRef", () => git.writeRef({ fs, dir, ref, value, force: true })),

    resetIndex: (dir, filepath) =>
      wrap("resetIndex", () => git.resetIndex({ fs, dir, filepath })),
  });
}
