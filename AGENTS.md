<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

---

# GPT — Guitar Pro Tracker: Workspace Root

## What this is

A monorepo for GPT (Guitar Pro Tracker), a Git-like version control system for `.gp` (Guitar Pro) music files. Think "Git + GitHub, but for musicians." Built with NX workspaces.

## Repo map

```
apps/
  cli/          — Core engine. All business logic lives here. Scriptable, runs standalone.
  desktop/      — Electron + React UI. Thin wrapper around the CLI. Zero business logic.
  desktop-e2e/  — Playwright end-to-end tests for the desktop app.
packages/
  gpt-core/     — Shared types, serializer, and diff/merge algorithm. Zero runtime deps.
  alphatab-react/ — React wrapper around the AlphaTab tablature renderer. Publishable to npm.
```

## Tech stack

| Concern | Tool |
|---|---|
| Monorepo orchestration | NX 22 |
| Package manager | pnpm (workspaces) |
| Language | TypeScript 5 (strict) |
| CLI runtime | Effect.ts v3 (typed errors, DI via layers) |
| Desktop shell | Electron + electron-vite |
| UI framework | React 19 + shadcn/ui + BaseUI |
| State | Zustand (desktop) |
| Data fetching | TanStack Query (desktop) |
| Tablature rendering | AlphaTab (@coderline/alphatab) |
| Git backend | isomorphic-git |
| Testing | Vitest + @testing-library/react |
| Linting | ESLint 10 flat config (typescript-eslint) |

## Key architectural decisions

1. **CLI is the engine, desktop is the UI.** The desktop app never calls business logic directly. It spawns the CLI or connects to `gpt serve` over HTTP. This keeps the two completely decoupled.
2. **Binary stored as-is, diffs computed at read time.** `.gp` files are stored verbatim in the git object store. Diffing means: parse both versions with AlphaTab → structural JSON → diff the JSON. Nothing intermediate is persisted.
3. **Diff happens at the measure level.** The natural unit of musical change is the measure, not the byte or the line. This makes diffs human-readable and merges optimistic.

## Running tasks

Always use NX to run tasks — never invoke compilers or test runners directly.

```bash
pnpm nx build @gpt/gpt-core          # build one project
pnpm nx test @gpt/gpt-core           # test one project
pnpm nx run-many -t build            # build everything
pnpm nx run-many -t test             # test everything
pnpm nx affected -t test             # test only what changed
pnpm nx graph                         # visualize project dependencies
pnpm lint                             # lint the whole workspace
pnpm lint:fix                         # auto-fix lint issues
```

## Adding a new project

Use NX generators — never create project files by hand:

```bash
pnpm nx g @nx/react:library packages/my-lib --bundler=vite --unitTestRunner=vitest
pnpm nx g @nx/node:app apps/my-service --bundler=esbuild
pnpm nx sync  # always run after scaffolding to sync tsconfig references
```

## Code conventions

- **Comments** — Add a comment only when the WHY is non-obvious: a hidden constraint, a subtle invariant, a workaround for a specific bug, or behaviour that would surprise a reader. Never describe WHAT the code does (the code already does that). Never reference PLAN.md, milestone numbers, or sprint context — those belong in commit messages and PRs, not source files. No AI-generated boilerplate comments.
- **Effect.ts in CLI/gpt-core.** Use `Effect.gen` + service layers. Never use try/catch.
- **Typed errors.** Tag all error types with `_tag` so Effect can match them structurally.
- **`--json` flag on every CLI command.** Machine-readable output is required for the desktop bridge.
- **Workspace imports.** Import internal packages as `@gpt/gpt-core`, never via relative paths that cross package boundaries.
- **No non-null assertions (`!`) in production code.** Use type narrowing (`if (!x) return`) or extend the null guard to cover all variables you need. The one accepted exception is TanStack Query's `queryFn` when `enabled: !!x` already guards the call — TypeScript can't see through `enabled`, so `x!` inside `queryFn` is intentional.
- **No `as` type assertions** unless casting to/from `unknown` at a system boundary (e.g. Electron IPC, JSON parse). Prefer type guards.
- **`cn()` for all className construction.** Never use `[...].join(" ")` or string concatenation for Tailwind classes — `cn()` handles conflict resolution correctly.
- **No dead code.** Remove placeholder components and unreferenced files immediately rather than leaving them in the tree with a TODO comment.
- **Module resolution — `.js` extensions:**
  - `apps/cli` and `packages/*` use `moduleResolution: nodenext` (Node.js ESM). Relative imports **must** include the `.js` extension.
  - `apps/desktop/src` uses `moduleResolution: bundler` (Vite). Relative imports **must not** include a file extension — Vite resolves `.ts`/`.tsx` without it, and the extensions are misleading noise.

## Testing conventions

- Use Vitest for all tests.
- Test file names: `<subject>.spec.ts` or `<subject>.spec.tsx`.
- Test names: **`should <action> when <condition>`**
- Structure each test with **Given / When / Then** comments.
- Mock external I/O (filesystem, git, AlphaTab API) — never hit real files in unit tests.
- Integration tests (CLI commands end-to-end) live in `apps/cli/src/**/*.integration.spec.ts` and use a real temp directory.
- Do NOT write tests for placeholder/skeleton components. Only test components and functions with real logic.

## Frontend code style

- **`function` keyword** — React components and top-level named functions must use `function` declarations, not arrow-function assignments. `function Foo()` not `const Foo = () =>`. Enforced via `react/function-component-definition`.
- **No CSS modules** — `.module.css` / `.module.scss` imports are banned. Use **Tailwind CSS** or **styled-components** only. Enforced via `no-restricted-imports`.
- **UI library — shadcn/ui first, every time.** This is non-negotiable. Before writing any markup:
  1. Check `apps/desktop/src/components/ui/` for an existing primitive.
  2. If missing, search the registry with the **shadcn MCP** (`mcp__shadcn__search_items_in_registries`, `mcp__shadcn__view_items_in_registries`).
  3. Install with `pnpm dlx shadcn@latest add @shadcn/<name>` from `apps/desktop/`. The shadcn config is at `apps/desktop/components.json`; aliases use `@/...`.
  4. Theme via the existing `apps/desktop/src/styles/app.css` (Tailwind v4 `@theme inline` maps Gitarpro tokens onto shadcn's slots). Never override component internals — adjust the theme variables instead.
  5. Use **shadcn variant names verbatim** (`default | destructive | outline | secondary | ghost | link`). Do not invent `primary`/`subtle`/`danger`.
  6. Use **shadcn slot classes** (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-card`, `bg-accent`, `border-border`, `text-destructive`). Never `text-fg-meta`, `border-border-subtle`, `text-fg-muted`, etc. — those are dead.
  7. Never re-implement Button, Card, Tabs, ScrollArea, Tooltip, Empty, Alert, Skeleton, Separator, Badge, ToggleGroup, Sonner, Spinner, Dialog, etc. from scratch.
- **BaseUI** — use only for headless primitives that shadcn doesn't ship.
- **Title bar** — Electron uses `titleBarStyle: "hiddenInset"` on macOS. The `<TitleBar>` in `apps/desktop/src/components/chrome/TitleBar.tsx` reserves the OS drag region; every top-level view renders below it via the layout in `app/app.tsx`. Do not use `h-screen` inside views — use `h-full min-h-0` so they fit under the title bar.
- **Design system** — follow the Gitarpro design system at all times: tokens from `colors_and_type.css`, Bauhaus font for UI text, Space Mono for hashes/paths/CLI output, 2px sharp radii, accent color sparingly.
- **Skill** — invoke the `frontend-design` skill when implementing UI components or pages.

## Linting

The root `eslint.config.mjs` applies automatically to all packages. Key rules:
- `@typescript-eslint/no-explicit-any` — error
- `react-hooks/rules-of-hooks` — error
- `react-hooks/exhaustive-deps` — warn
- `@typescript-eslint/consistent-type-imports` — enforced (use `import type`)
- `no-restricted-syntax` (React files) — error (named PascalCase components must use `function` declaration, not arrow functions)
- `no-restricted-imports` (React files) — error (CSS module imports banned)
- `@eslint-react/no-nested-component-definitions` — error
- `@eslint-react/no-array-index-key` — warn
- Test files get relaxed rules (no-explicit-any off, no-non-null-assertion off)

> Note: React rules use `@eslint-react/eslint-plugin` (ESLint 10 compatible) instead of the legacy `eslint-plugin-react@7.x`, which is broken on ESLint 10.

---

## AlphaTab rules

- **`loadScoreFromBytes` always needs a true `Uint8Array`.** Wrap with `new Uint8Array(bytes)` — AlphaTab calls `.subarray()` internally, which does not exist on `ArrayBuffer`. A bare `bytes.buffer` or `bytes.buffer.slice()` will throw `TypeError: this._buffer.subarray is not a function`.

- **Bar bounds lookup.** After `postRenderFinished`, use `api.boundsLookup.findMasterBarByIndex(i)` (not `api.renderer.boundsLookup`). Returns `MasterBarBounds { visualBounds: { x, y, w, h } }`.

- **Overlay injection.** Inject overlay divs imperatively into `viewportEl` (same as AlphaTab's own cursor elements). Use `position:absolute;inset:0;pointer-events:none;overflow:visible` on the container. Clean up with `viewportEl.removeChild(container)` on effect teardown.

- **`optimizeDeps.exclude`.** Every Vite config that imports AlphaTab must have `optimizeDeps: { exclude: ["@coderline/alphatab"] }`. Without it, esbuild strips `import.meta.url` worklet references and rendering silently breaks.

- **`isReadyForPlayback` resets on load.** Set it back to `false` whenever a new score starts loading — stale `true` causes premature `play()` calls.

- **`stop()` can throw.** Wrap in try/catch (AlphaTab 1.8.x bug). After catching, dispatch a `stopped` event manually to reset UI state.

- **`Score.tempo` is getter-only.** `Score.tempo` is computed from `masterBars[0].tempoAutomations[0].value` — there is no setter. To change tempo, mutate the existing `Automation` at `ratioPosition === 0` in `masterBars[0].tempoAutomations`, or create one via `new model.Automation()` if none exists. Never write `score.tempo = value` — it throws at runtime.

- **`gpt-core` bundle must be rebuilt after source changes.** The CLI resolves `@gpt/gpt-core` to `packages/gpt-core/dist/index.js` (a Vite/rollup bundle via the pnpm workspace symlink). Editing source files under `packages/gpt-core/src/` has no effect on the running `gpt serve` process until you run `pnpm nx build @gpt/gpt-core` and restart the server.

- **`ScoreDiff` computation in the desktop.** Never try to deserialize `ScoreDiff` from HTTP — it contains live `alphaTab.model.Score` objects that don't survive JSON. Fetch both `.gp` blobs from `GET /show/:hash/:file`, then call `diffScores()` client-side inside `useDiffScores`.

---

## Base UI (`@base-ui-components/react`) rules

- **`asChild` does not exist in BaseUI.** `asChild` is a Radix UI / shadcn pattern. BaseUI uses a `render` prop instead — e.g. `<Tooltip.Trigger render={<button />}>`. Never pass `asChild` to a BaseUI component; it will be silently ignored and the component won't render as expected.

- **`data-orientation` ≠ `data-horizontal:`.** Base UI sets `data-orientation="horizontal"` (string attribute). Tailwind's `data-horizontal:` expands to `[data-horizontal]:` (boolean attribute selector) — they do **not** match; the utility is silently ignored. Use hardcoded height/dimension classes instead of orientation-conditional ones in Base UI-backed components. (`data-disabled:` works because Base UI sets `data-disabled=""`, a boolean-style empty attribute.)

---

## Synchronized scroll pattern

When mirroring scroll between two containers, use an `isSyncing` ref to prevent mutual listener loops. Reset via `requestAnimationFrame`, not `setTimeout`, so the flag clears in the same paint cycle:

```ts
const isSyncing = useRef(false);
const syncFrom = (source: HTMLDivElement, target: HTMLDivElement) => () => {
  if (isSyncing.current) return;
  isSyncing.current = true;
  target.scrollTop  = source.scrollTop;
  target.scrollLeft = source.scrollLeft;
  requestAnimationFrame(() => { isSyncing.current = false; });
};
```

When imperatively setting `scrollTop` from a click handler, also set `isSyncing.current = true` before touching both elements.

---

## `@gpt/alphatab-react` package rules

- Always update `packages/alphatab-react/src/index.ts` when adding a new export. Forgetting breaks consumers silently — tree-shaking hides missing exports until runtime.
- The `@gpt/source` export condition in `package.json` lets Vite resolve TypeScript source directly. Do not add a build step just to test desktop ↔ package integration in dev.

---

## Merge HTTP API conventions

- `GET /merge` — returns `{ active: false }` or `{ active: true, sidecar, unresolved }`. Always safe to call.
- `POST /merge` — body `{ branch, noCommit? }`. Returns 200 for clean/fast-forward, **409 for conflicts** (not 500). `data` is the `MergeOutcome` discriminated union.
- `PUT /merge/resolve` — body `{ file, path, resolution: "ours"|"theirs" }`. `path` is a `ConflictLocation.path` string from the sidecar. Updates sidecar on disk, returns `{ unresolved, fullyResolved }`.
- `POST /merge/finalize` — body `{ message? }`. Requires all conflicts resolved (409 otherwise). Applies bar-level resolutions: finds `track[T].bar[B]` in the path, copies theirs' bar into ours, re-exports, stages, commits, deletes sidecar. Returns `{ commitHash, shortHash }`.
- `DELETE /merge` — removes the sidecar only. Does **not** restore working-tree file contents.
- Resolution granularity is **bar-level in v1**: `parseBarRef("track[0].bar[4].voice[...]...")` extracts `{trackIndex, barIndex}`. Paths that don't match (e.g. `score.tempo`) are skipped for now.

## Merge UI conventions (5.3)

- `MergeView` reads `useMergeStatus` on mount; branches on `active` vs idle.
- `useResolveConflict` uses **optimistic updates** (`onMutate` sets cache immediately, `onError` rolls back). Resolution feels instant even on slow drives.
- `POST /merge` always returns `{ ok: true, data: MergeOutcome }` with **status 200** — caller checks `outcome.type`. The 409 convention was reverted because `unwrap()` throws on `!ok`.
- `humanPath(path)` in `features/merge/conflictPath.ts` converts raw `ConflictLocation.path` strings to readable labels. Update it when adding new path segment types.
- The sidebar Merge nav item shows an unresolved-count badge by reading `useMergeStatus` in `RepoShell` — keep the query lightweight (staleTime: 0, no polling interval).
- Kind badge mapping: `field` → blue/info, `structural-note` / `structural-beat` → amber/changed.
- Color convention in merge UI: **ours = info (blue)**, **theirs = diff-added (green)**, **unresolved = diff-changed (amber)**. Match this in any future AlphaTab-based conflict previews.

## Merge algorithm rules

- **`MergeCell<T>` is the core abstraction.** Every mergeable scalar at every level — meta, masterBar, beat, note — is one `MergeCell<T>`. Adding a new field is one line: `field: cell(base.field, ours.field, theirs.field)`.

- **Boolean fields cannot produce 3-way conflicts.** Two states (true/false) can never all differ. Only numeric and string fields can conflict.

- **"Both-added" notes use `newField(ours, theirs)` not `cell()`.** When both sides add a note at the same string but the string didn't exist in base, using `cell(ours, ours, theirs)` accidentally auto-resolves to theirs (it looks like "base==ours, take theirs"). Use the dedicated `newField` helper instead.

- **`diff.ts` stays bar-level; `merge.ts` goes to note-level.** The diff is for visualization (highlighting whole bars). The merge needs note precision to minimize what users must manually resolve. Don't conflate the two.

- **`fingerprint.ts` is the shared source of truth.** Both `diff.ts` and `merge.ts` import from `fingerprint.ts`. Never duplicate `barFingerprint`, `noteSnapshot`, or `beatSnapshot`.

- **`BarDiff.changed` always carries `changedFields: BarChangedField[]`.** Categories: `"notes"`, `"beats"`, `"articulation"`, `"dynamics"`. Used by the CLI summary and the `<TabDiff>` chip breakdown. Populate it via `categorizeBarChanges()`, not by adding fields to the fingerprint.

- **`ConflictLocation.path` format:** `meta.tempo`, `masterBar[2].timeSignatureNumerator`, `track[0].bar[4].voice[0].beat[2].note[s=3].fret`, `track[0].bar[4].voice[0].structuralBeats`.

---

## Commit log ordering

`/log` returns commits newest-first (index 0 = most recent). When determining base vs head for a diff, the commit at the **higher index** is the older one (base); the commit at the **lower index** is the newer one (head).

---

## Current milestone status (as of 2026-05-01)

| Milestone | Status |
|---|---|
| M1 — CLI: load & version `.gp` files | ✅ Done |
| M2 — Desktop: open repo & browse history | ✅ Done |
| M3 — Desktop: commit workflow | ✅ Done |
| M4 — Diff view & branching | ✅ Done |
| M5 — Merge | ✅ Done |
| M6 — Daily driver polish | 🔲 Not started |
| M7 — Git power features | 🔲 Not started |
| M8 — Remote backup & sharing | 🔲 Not started |
| M9 — Commit graph & visual history | 🔲 Not started |

---

## Missing CLI commands (to add in M6–M7)

| Command | HTTP equivalent | Notes |
|---|---|---|
| `gpt reset HEAD <file>` | `DELETE /staged` | Unstage; deferred from M3 |
| `gpt tag [--list\|--delete] <name> [<hash>]` | `GET/POST/DELETE /tags` | Version milestones |
| `gpt stash` / `gpt stash pop` / `gpt stash list` | `GET/POST/DELETE /stash` | isomorphic-git has no native stash; use `refs/gpt-stash/<n>` ref shim |
| `gpt commit --amend` | `POST /commit { amend: true }` | Amend last commit |
| `gpt log --file <path>` | `GET /log?file=<path>` | isomorphic-git `filepath` option in `git.log()` |
| `gpt restore <hash> <file>` | `POST /restore` | Overwrite working-tree file with version at commit |
| `gpt remote add/remove/list` | `GET/POST/DELETE /remotes` | Standard git remotes |
| `gpt push` / `gpt pull` / `gpt clone` | `POST /push`, `POST /pull`, `POST /clone` | isomorphic-git HTTPS transport |

---

## UX conventions established in M1–M5 (do not break)

- **`+` button on unstaged rows** → stage. The `-` counterpart (unstage, M6.1) goes on staged rows at the same position.
- **JetBrains-style action buttons** appear on row hover (right side). Spinner replaces the button during mutation.
- **Sonner toasts for all mutation outcomes** — success and error. Never use `alert()` or inline error text persisting beyond 3 s.
- **TanStack Query invalidation pattern** — after any mutation, invalidate the specific keys: `["status", repoPath]`, `["log", repoPath]`, `["branches", repoPath]`. Do not call `queryClient.invalidateQueries()` with no filter.
- **Zustand store is navigation-only** — never put server state here. If a value can be a query key, it should be.
- **`staleTime` policy** — `0` for `/status` and `/merge` (must be fresh); `2000` for `/log` and `/branch` (eliminates focus-refetch flicker). This is fixed in M6.6.

---

## Known TODOs carried over from M5

- `/repo/history` redirects to `/repo/status` — the History nav item toggles `historyPanelOpen` in Zustand instead of navigating. Temporary workaround; M6 should give History its own view.
- `ViewPlaceholder` at `/repo/diff` is still a stub. The diff flow goes through the History view (selecting two commits). Remove or wire it to cross-branch diff (M7.6).
- Unstage (`gpt reset HEAD <file>`) was explicitly deferred in M3.2 with the note "not in API yet." This is M6.1.
- `staleTime: 0` on all queries causes refetch flicker on window focus. Fixed in M6.6.

---

## `gpt-core` rebuild requirement

`packages/gpt-core/src/` changes have **no effect** on a running `gpt serve` until you rebuild:

```bash
pnpm nx build @gpt/gpt-core   # one-off rebuild
pnpm nx watch @gpt/gpt-core   # auto-rebuild on change (run in a separate terminal during dev)
```

The CLI resolves `@gpt/gpt-core` to `packages/gpt-core/dist/index.js` via the pnpm workspace symlink. Source edits are invisible until the dist is regenerated.
