import { defineCommand, runMain } from "citty";
import { Effect } from "effect";
import { initCommand } from "./commands/init.js";
import { addCommand } from "./commands/add.js";
import { commitCommand } from "./commands/commit.js";
import { logCommand } from "./commands/log.js";
import { diffCommand } from "./commands/diff.js";
import { statusCommand } from "./commands/status.js";
import { showCommand } from "./commands/show.js";
import { serveCommand } from "./commands/serve.js";
import { branchListCommand, branchCreateCommand, checkoutCommand } from "./commands/branch.js";
import { mergeCommand } from "./commands/merge.js";

const run = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.runPromise(effect as Effect.Effect<unknown>).catch((e) => {
    console.error("\x1b[31mError:\x1b[0m", (e as Error).message ?? e);
    process.exit(1);
  });

const main = defineCommand({
  meta: { name: "gpt", description: "Git-like version control for Guitar Pro files" },
  subCommands: {
    init: defineCommand({
      meta: { description: "Initialize a new gpt repository" },
      args: { dir: { type: "positional", required: false, default: "." } },
      run: ({ args }) => run(initCommand(args.dir)),
    }),
    add: defineCommand({
      meta: { description: "Stage a Guitar Pro file" },
      args: { file: { type: "positional", required: true } },
      run: ({ args }) => run(addCommand(args.file)),
    }),
    commit: defineCommand({
      meta: { description: "Commit staged changes" },
      args: {
        message: { type: "string", alias: "m", description: "Commit message" },
        json: { type: "boolean", default: false },
      },
      run: ({ args }) => run(commitCommand({ message: args.message })),
    }),
    log: defineCommand({
      meta: { description: "Show commit history" },
      args: { json: { type: "boolean", default: false } },
      run: ({ args }) => run(logCommand({ json: args.json })),
    }),
    status: defineCommand({
      meta: { description: "Show staged and unstaged .gp file changes" },
      args: { json: { type: "boolean", default: false } },
      run: ({ args }) => run(statusCommand({ json: args.json })),
    }),
    show: defineCommand({
      meta: { description: "Show a commit's metadata and per-track change summary" },
      args: {
        hash: { type: "positional", required: true },
        export: { type: "string", description: "Write .gp file(s) at this commit to the given path" },
        json: { type: "boolean", default: false },
      },
      run: ({ args }) => run(showCommand({ hash: args.hash, export: args.export, json: args.json })),
    }),
    diff: defineCommand({
      meta: { description: "Show musical diff between commits or working tree vs HEAD" },
      args: {
        hash1: { type: "positional", required: false },
        hash2: { type: "positional", required: false },
        json: { type: "boolean", default: false },
      },
      run: ({ args }) => run(diffCommand({ hash1: args.hash1, hash2: args.hash2, json: args.json })),
    }),
    branch: defineCommand({
      meta: { description: "List or create branches" },
      args: {
        name: { type: "positional", required: false, description: "Branch name to create (omit to list)" },
        json: { type: "boolean", default: false },
      },
      run: ({ args }) =>
        args.name
          ? run(branchCreateCommand({ name: args.name }))
          : run(branchListCommand({ json: args.json })),
    }),
    checkout: defineCommand({
      meta: { description: "Switch to a branch or commit" },
      args: { ref: { type: "positional", required: true, description: "Branch name or commit hash" } },
      run: ({ args }) => run(checkoutCommand({ ref: args.ref })),
    }),
    merge: defineCommand({
      meta: { description: "Merge a branch into the current branch" },
      args: {
        branch: { type: "positional", required: true, description: "Branch to merge" },
        "no-commit": { type: "boolean", default: false, description: "Stage merged files but do not commit" },
        json: { type: "boolean", default: false, description: "Output result as JSON" },
      },
      run: ({ args }) => run(mergeCommand({ branch: args.branch, noCommit: args["no-commit"], json: args.json })),
    }),
    serve: defineCommand({
      meta: { description: "Start the gpt HTTP server on :7337" },
      args: {
        port: { type: "string", default: "7337", description: "Port to listen on" },
      },
      run: ({ args }) => run(serveCommand({ port: Number(args.port) })),
    }),
  },
});

runMain(main);
