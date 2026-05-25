# @gpt/cli

## Purpose

The core engine of GPT. Every piece of business logic — versioning, diffing, merging, file storage — lives here. The desktop app is just a UI skin over this CLI.

The CLI is designed to be used in two modes:
1. **Interactive terminal** — pretty prompts via `@clack/prompts`, colored output
2. **Machine mode** — `--json` flag on every command, structured `{ ok, data }` / `{ ok, error }` output for the desktop bridge

## Usage

```bash
gpt init                          # initialize repo in current dir
gpt add song.gp                   # stage a file
gpt status                        # show staged/unstaged changes
gpt commit -m "Add chorus"        # commit with message
gpt log                           # human-readable history
gpt log --json                    # machine-readable (used by desktop)
gpt diff                          # diff working tree vs last commit
gpt diff <hash1> <hash2>         # diff two commits
gpt branch feature/bridge         # create branch
gpt checkout feature/bridge       # switch branch
gpt merge feature/bridge          # 3-way merge
gpt serve                         # start HTTP server on :7337 (desktop bridge mode)
```

## Architecture

All business logic is structured with **Effect.ts**. No try/catch, no raw async/await in services.

```
src/
  main.ts              — CLI entrypoint (citty router)
  commands/            — One file per command, one exported Effect per file
    init.ts
    add.ts
    commit.ts
    log.ts
    diff.ts            — TODO: Milestone 1
    branch.ts          — TODO: Milestone 3
    merge.ts           — TODO: Milestone 3
    serve.ts           — TODO: Milestone 2
  runtime/             — Effect service layers
    FSLayer.ts         — filesystem operations (mockable in tests)
    GitLayer.ts        — isomorphic-git wrapper (mockable in tests)
    AlphaTabLayer.ts   — AlphaTab in Node.js headless mode (TODO)
  services/
    diff-engine.ts     — parse .gp → CanonicalScore → ScoreDiff (TODO)
    merge-engine.ts    — 3-way merge (TODO)
    serializer.ts      — delegates to @gpt/gpt-core
```

## Effect.ts patterns

Every command returns an `Effect` — never a raw Promise. Commands are run at the edge in `main.ts`:

```typescript
// Good
export const commitCommand = (opts) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    const hash = yield* git.commit(dir, message, author);
    return hash;
  }).pipe(Effect.provide(GitLayer.Live));

// Bad — don't do this
export async function commitCommand(opts) {
  try {
    return await git.commit(...);
  } catch (e) { ... }
}
```

Tag all errors so they can be caught structurally:
```typescript
class NoStagedFilesError extends Data.TaggedError("NoStagedFilesError") {}
```

## JSON output protocol

Every command that the desktop bridge can call **must** support `--json`. The output shape:
```typescript
// Success
{ "ok": true, "data": <payload> }

// Failure
{ "ok": false, "error": { "code": "TAGGED_ERROR_NAME", "message": "human string" } }
```

Never mix JSON and non-JSON output in the same run. When `--json` is set, suppress all `@clack/prompts` UI.

## Testing

```bash
pnpm nx test @gpt/cli
pnpm nx test @gpt/cli --testNamePattern="integration"
```

Unit tests: mock `FSLayer` and `GitLayer` via `Effect.provide(Layer.succeed(...))`.
Integration tests (`*.integration.spec.ts`): use a real temp directory created with `fs.mkdtemp`. Clean up in `afterEach`.

Test naming: **`should <action> when <condition>`**
Structure: Given / When / Then inside each test.
