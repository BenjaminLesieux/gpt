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

# Gitarpro: Workspace Root

## What this is

Version control for Guitar Pro `.gp` files, built as a resident macOS menu-bar
app. Guitar Pro is not extensible, so this stands beside it: every save of a
tracked file becomes a silent snapshot, and a global hotkey names the versions
that count. Git stores the bytes and the user never sees a git concept.

## Repo map

```
apps/
  companion/    — The app. Tauri v2: Rust host (src-tauri/) + React webview (src/).
packages/
  gpt-core/     — Diff and merge over AlphaTab's model. Knows what a score is.
  alphatab-react/ — React bindings for AlphaTab: rendering, playback, diff overlays.
```

## Tech stack

| Concern                | Tool                                       |
| ---------------------- | ------------------------------------------ |
| Monorepo orchestration | Nx 22                                      |
| Package manager        | pnpm (workspaces)                          |
| App shell              | Tauri v2 (Rust host, WKWebView)            |
| Host language          | Rust 2021 (edition), rust-version 1.82     |
| UI language            | TypeScript 5 (strict)                      |
| UI framework           | React 19 + shadcn/ui + Base UI             |
| Styling                | Tailwind v4 (`@theme inline`)              |
| Tablature rendering    | AlphaTab (`@coderline/alphatab`)           |
| Git backend            | libgit2 via the `git2` crate               |
| File watching          | `notify`                                   |
| Secrets                | `keyring` (macOS login keychain)           |
| Testing                | Vitest + @testing-library/react; `cargo test` |
| Linting                | ESLint 10 flat config; clippy `-D warnings`   |

## Key architectural decisions

1. **The Rust host stores; TypeScript understands.** `src-tauri/` reads and
   writes bytes, watches files, talks to remotes and owns the windows. Anything
   that knows what a *note* is lives in `gpt-core`. Keep the Rust layer thin —
   this is the constraint most easily broken by adding a feature in the nearest
   place.
2. **One `.gp` file is one project.** No multi-file repos. One bare git repo per
   tracked file, under the app data dir. Named versions are commits on `main`;
   silent auto-snapshots are a separate chain on `refs/snapshots`.
3. **Two tiers of history.** Every Guitar Pro save is captured with nothing
   asked of the user. Only named versions form the official history and only
   they are pushed.
4. **Normalize before writing a blob, always.** `.gp` files are zip containers
   whose headers change on every save. Git clean/smudge filters are forbidden —
   git2 does not run them, so one would look configured and do nothing. See
   `docs/normalize-gp.md`.
5. **A local commit never blocks on the network.** Push is queued and
   best-effort. Pull is fast-forward only; there is no merge UI in v1.
6. **Diff at the measure level.** The natural unit of musical change is the
   measure, not the byte. `CONTEXT.md` defines *measure* vs *bar* — they are not
   synonyms, and the distinction runs through the whole engine.

## Running tasks

Always use Nx — never invoke compilers or test runners directly.

```bash
pnpm nx dev @gpt/companion            # tauri dev: Vite on :4210 + the Rust host
pnpm nx bundle @gpt/companion         # tauri build: the .app / .dmg
pnpm nx test @gpt/gpt-core            # test one project
pnpm nx run-many -t test              # test everything (vitest)
pnpm nx run-many -t typecheck         # tsc --build, everywhere
pnpm nx affected -t test              # only what changed
pnpm nx cargo-test @gpt/companion     # the Rust suite
pnpm nx cargo-clippy @gpt/companion   # clippy, warnings are errors
pnpm lint                             # eslint; only over registered paths
```

`APPLE_SIGNING_IDENTITY="-"` in front of `bundle` produces the ad-hoc signed
alpha build. See `apps/companion/README.md` for what that means downstream.

## Adding a new project

Use Nx generators — never create project files by hand:

```bash
pnpm nx g @nx/react:library packages/my-lib --bundler=vite --unitTestRunner=vitest
pnpm nx sync  # always run after scaffolding to sync tsconfig references
```

`apps/companion` is the exception and stays hand-written: there is no official
Nx plugin for Tauri, so its `project.json` targets shell out to `tauri` and
`cargo` directly.

## Code conventions

- **Comments** — Add a comment only when the WHY is non-obvious: a hidden
  constraint, a subtle invariant, a workaround for a specific bug, or behaviour
  that would surprise a reader. Never describe WHAT the code does. Never
  reference milestone numbers or sprint context in source — those belong in
  commit messages.
- **Workspace imports.** Import internal packages as `@gpt/gpt-core`, never via
  relative paths that cross package boundaries.
- **No `.js` import extensions.** `tsconfig.base.json` sets `nodenext`, and
  every project overrides it with `moduleResolution: bundler`. Relative imports
  carry no file extension anywhere in this workspace.
- **No non-null assertions (`!`) in production code.** Use type narrowing
  (`if (!x) return`) or widen the guard.
- **No `as` type assertions** unless casting to or from `unknown` at a system
  boundary — Tauri IPC and `JSON.parse` are the two that qualify. Prefer type
  guards.
- **`cn()` for all className construction.** Never `[...].join(" ")` — `cn()`
  resolves Tailwind conflicts correctly.
- **No dead code.** Remove unreferenced files and placeholder components rather
  than leaving them with a TODO.

## Testing conventions

- Vitest for TypeScript, `cargo test` for Rust.
- Test file names: `<subject>.spec.ts` / `<subject>.spec.tsx`.
- Test names: **`should <action> when <condition>`**, structured with Given /
  When / Then comments. The Rust suite names its tests as sentences instead —
  `a_burst_of_writes_debounces_into_one_capture`.
- Mock external I/O in TypeScript unit tests. The Rust tests do the opposite
  where it is cheap: real temp dirs, real fs events, real bare repos in a
  tempdir for push and fetch. libgit2 treats a local bare repo as a real remote,
  so sync logic is covered without a network.
- Do NOT write tests for placeholder or skeleton components.
- Two things no suite covers, both manual walkthroughs:
  `docs/alpha-smoke-test.md` (the whole loop, against the bundle) and
  `docs/forgejo-check.md` (TLS and token auth against a real server).

## Frontend code style

- **`function` keyword** — React components and top-level named functions must
  use `function` declarations, not arrow-function assignments.
- **No CSS modules** — `.module.css` / `.module.scss` imports are banned. Use
  Tailwind. Enforced via `no-restricted-imports`.
- **UI library — shadcn/ui first, every time.** This is non-negotiable. Before
  writing any markup:
  1. Check `apps/companion/src/components/ui/` for an existing primitive.
  2. If missing, search the registry with the **shadcn MCP**
     (`mcp__shadcn__search_items_in_registries`,
     `mcp__shadcn__view_items_in_registries`).
  3. Install with `pnpm dlx shadcn@latest add @shadcn/<name>` from
     `apps/companion/`. The config is `apps/companion/components.json`; aliases
     use `@/...`.
  4. Theme via `apps/companion/src/styles/app.css` (Tailwind v4 `@theme inline`
     maps Gitarpro tokens onto shadcn's slots). Never override component
     internals — adjust the theme variables instead.
  5. Use **shadcn variant names verbatim** (`default | destructive | outline |
     secondary | ghost | link`). Do not invent `primary`/`subtle`/`danger`.
  6. Use **shadcn slot classes** (`bg-background`, `text-foreground`,
     `text-muted-foreground`, `bg-card`, `bg-accent`, `border-border`,
     `text-destructive`). Never `text-fg-meta`, `border-border-subtle`,
     `text-fg-muted` — those are dead.
  7. Never re-implement Button, Card, Tabs, ScrollArea, Tooltip, Empty, Alert,
     Skeleton, Separator, Badge, ToggleGroup, Spinner, Dialog, etc.
- **Base UI** — use only for headless primitives shadcn does not ship.
- **Two window surfaces** — the panel (`src/panel/`) is frameless, transparent,
  always-on-top and never recreated; the extended window (`src/extended/`) is a
  normal decorated window created lazily. Separate Vite inputs, separate entry
  HTML. **Panel latency is the product**: if hotkey→visible exceeds ~100 ms, fix
  that before adding anything to it.
- **`var(--color-accent)` means two things.** In raw CSS it is the brand red
  from `tokens.css`; only the `@theme inline` utilities carry shadcn's
  hover-surface meaning. Name the token you actually want.
- **Design system** — tokens from `colors_and_type.css`, Bauhaus for UI text,
  Space Mono for hashes and paths, 2px radii, accent colour sparingly.
- **Skill** — invoke the `frontend-design` skill when implementing UI.

## Linting

Linting is `pnpm lint` at the root. There is no `lint` target on any project,
so `nx run-many -t lint` silently does nothing.

The root `eslint.config.mjs` is **per-path opt-in**, not workspace-wide: the
final `export default` lists each project's files explicitly, and a project
that is not listed there is linted by nothing at all. A new project has to
register itself. Key rules:

- `@typescript-eslint/no-explicit-any` — error
- `react-hooks/rules-of-hooks` — error
- `@typescript-eslint/consistent-type-imports` — enforced (`import type`)
- `no-restricted-syntax` (React files) — PascalCase components must be
  `function` declarations
- `no-restricted-imports` (React files) — CSS module imports banned
- `@eslint-react/no-nested-component-definitions` — error
- Test files get relaxed rules (`no-explicit-any` and `no-non-null-assertion`
  off)

> React rules use `@eslint-react/eslint-plugin` (ESLint 10 compatible) rather
> than the legacy `eslint-plugin-react@7.x`, which is broken on ESLint 10.

---

## AlphaTab rules

- **`loadScoreFromBytes` always needs a true `Uint8Array`.** Wrap with
  `new Uint8Array(bytes)` — AlphaTab calls `.subarray()` internally, which does
  not exist on `ArrayBuffer`. A bare `bytes.buffer` or `bytes.buffer.slice()`
  throws `TypeError: this._buffer.subarray is not a function`.

- **Bar bounds lookup.** After `postRenderFinished`, use
  `api.boundsLookup.findMasterBarByIndex(i)` (not `api.renderer.boundsLookup`).
  Returns `MasterBarBounds { visualBounds: { x, y, w, h } }`.

- **Overlay injection.** Inject overlay divs imperatively into `viewportEl`, the
  same way AlphaTab's own cursor elements go in. Use
  `position:absolute;inset:0;pointer-events:none;overflow:visible` on the
  container, and clean up with `viewportEl.removeChild(container)` on teardown.

- **The cursor sits at z-index 1000.** Contain it with `isolation: isolate` on
  the stage rather than trying to outbid it from an overlay.

- **`optimizeDeps.exclude`.** Every Vite config importing AlphaTab must have
  `optimizeDeps: { exclude: ["@coderline/alphatab"] }`. Without it, esbuild
  strips `import.meta.url` worklet references and rendering silently breaks.

- **The webview CSP must allow `blob:` scripts and workers.** AlphaTab renders
  through a worker and plays through an audio worklet.

- **`isReadyForPlayback` resets on load.** Set it back to `false` whenever a new
  score starts loading — a stale `true` causes premature `play()` calls.

- **`stop()` can throw.** Wrap in try/catch (AlphaTab 1.8.x bug). After
  catching, dispatch a `stopped` event manually to reset UI state.

- **`Score.tempo` is getter-only.** It is computed from
  `masterBars[0].tempoAutomations[0].value`. To change tempo, mutate the
  existing `Automation` at `ratioPosition === 0`, or create one via
  `new model.Automation()`. `score.tempo = value` throws at runtime.

- **Diffs are computed in the webview, never serialized.** `ScoreDiff` holds
  live `alphaTab.model.Score` objects that do not survive JSON. `getVersionBlob`
  returns raw bytes for exactly this reason — fetch both versions, then call
  `diffScores()` client-side.

---

## Base UI (`@base-ui/react`) rules

- **`asChild` does not exist in Base UI.** That is a Radix/shadcn pattern. Base
  UI uses a `render` prop — `<Tooltip.Trigger render={<button />}>`. Passing
  `asChild` is silently ignored.

- **`data-orientation` ≠ `data-horizontal:`.** Base UI sets
  `data-orientation="horizontal"` (a string attribute); Tailwind's
  `data-horizontal:` expands to `[data-horizontal]:` (a boolean attribute
  selector). They do not match and the utility is silently dropped. Use
  hardcoded dimension classes instead. (`data-disabled:` works because Base UI
  sets `data-disabled=""`.)

---

## Synchronized scroll pattern

When mirroring scroll between two containers, use an `isSyncing` ref to prevent
mutual listener loops. Reset via `requestAnimationFrame`, not `setTimeout`, so
the flag clears in the same paint cycle:

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

When imperatively setting `scrollTop` from a click handler, also set
`isSyncing.current = true` before touching both elements.

> Note that the diff panes are **anchored, not scroll-synced** — see
> `docs/adr/0005`. The pattern above still applies wherever two viewports do
> need to track each other.

---

## `@gpt/alphatab-react` package rules

- Always update `packages/alphatab-react/src/index.ts` when adding an export.
  Forgetting breaks consumers silently — tree-shaking hides a missing export
  until runtime.
- The `@gpt/source` export condition lets Vite resolve TypeScript source
  directly, and `apps/companion/vite.config.mts` honours it. This is what keeps
  `tauri dev` on source: the fallback is each package's `dist`, which nothing
  rebuilds during a dev session, so edits to the diff engine would show up in
  typecheck and tests but silently not in the running app.

---

## Merge algorithm rules

`gpt-core` still owns merge and it is still tested. There is no UI on it —
locked decision 8 keeps merge out of v1, and pull fast-forwards or stops.

- **`MergeCell<T>` is the core abstraction.** Every mergeable scalar at every
  level — meta, masterBar, beat, note — is one `MergeCell<T>`. Adding a field is
  one line: `field: cell(base.field, ours.field, theirs.field)`.

- **Boolean fields cannot produce 3-way conflicts.** Two states can never all
  differ. Only numeric and string fields can conflict.

- **"Both-added" notes use `newField(ours, theirs)`, not `cell()`.** When both
  sides add a note at a string that did not exist in base, `cell(ours, ours,
  theirs)` accidentally auto-resolves to theirs — it looks like "base == ours,
  take theirs".

- **`diff.ts` stays bar-level; `merge.ts` goes to note-level.** The diff is for
  visualization (highlighting whole bars); the merge needs note precision to
  minimize what a user must resolve by hand. Do not conflate them.

- **`fingerprint.ts` is the shared source of truth.** Both import from it. Never
  duplicate `barFingerprint`, `noteSnapshot` or `beatSnapshot`.

- **`BarDiff.changed` always carries `changedFields: BarChangedField[]`** —
  `"notes"`, `"beats"`, `"articulation"`, `"dynamics"`. Populate via
  `categorizeBarChanges()`, not by adding fields to the fingerprint.

- **`ConflictLocation.path` format:** `meta.tempo`,
  `masterBar[2].timeSignatureNumerator`,
  `track[0].bar[4].voice[0].beat[2].note[s=3].fret`,
  `track[0].bar[4].voice[0].structuralBeats`.

---

## Milestone status

The companion's plan, the decisions behind it, and what each milestone actually
landed versus what it was scoped to: `docs/companion-v1-plan.md`. That file is
the record — do not duplicate its status here, it only goes stale.

Architecture decision records are in `docs/adr/`.
