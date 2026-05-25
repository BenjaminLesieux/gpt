# GPT — Implementation Plan

Working document. Check off items as they land. Each milestone has a gate condition — we don't start the next until the gate passes.

---

## Current state

| Package | Status |
|---|---|
| `@gpt/gpt-core` | ✅ Types, diff algorithm, 3-way merge, serializer — fully tested (1,200+ LOC specs) |
| `@gpt/alphatab-react` | ✅ AlphaTab.Root/Viewport, TabScore, TabDiff with bar overlays, PlayTimeline, useAutoScroll |
| `@gpt/cli` | ✅ init/add/commit/log/status/show/diff/branch/checkout/merge + `gpt serve` HTTP bridge |
| `@gpt/desktop` | ✅ History browser, commit workflow, diff view, branch switcher, merge conflict UI |
| `@gpt/gpt-metadata` | ❌ Not started — needed for platform indexing (Phase 1) |
| `@gpt/forgejo-api` | ❌ Not started — typed Forgejo REST client (Phase 1) |

---

## Milestone 1 — CLI: load and version `.gp` files

> Goal: prove the full pipeline end-to-end in the terminal before touching the UI.

- [x] **1.1 — `AlphaTabLayer` (highest risk, spike first)**
  - Run AlphaTab headless in Node.js (no DOM, no canvas)
  - Parse a real `.gp` file → `model.Score` using `importer.ScoreLoader.loadScoreFromBytes`
  - If AlphaTab requires DOM: evaluate jsdom shim vs spawning a child Electron process as a "parser service"
  - Write a vitest integration test that loads a sample `.gp` file and asserts `score.tracks.length > 0`

- [x] **1.2 — `gpt diff` command**
  - `gpt diff` — working tree vs last commit
  - `gpt diff <hash1> <hash2>` — between two commits
  - Uses `GitLayer.readBlob` → `AlphaTabLayer.parse` → `diffScores()` → human output
  - `--json` flag outputs `ScoreDiff` as JSON for the desktop bridge

- [x] **1.3 — `gpt status`**
  - Show staged vs unstaged `.gp` files
  - For staged files, show a one-line diff summary (reuse `diffScores().summary`)
  - `--json` flag for machine output
  - Note: `statusEffect` (testable, no layers) + `statusCommand` (wires Live layers) split pattern — same pattern should be applied to `diff` if/when it needs unit tests

- [x] **1.4 — `gpt show <hash>`**
  - Print commit metadata + per-track change summary vs parent
  - `--export <path>` flag: write the `.gp` file at that commit to disk
  - Note: short hash expansion via `log()` walk; single file → writes to `<path>`, multiple → writes to `<path>/<filename>`

**🚦 Gate:** Running `gpt init && gpt add song.gp && gpt commit -m "init" && (edit song.gp) && gpt add song.gp && gpt diff` produces a human-readable musical diff in the terminal.

---

## Milestone 2 — Desktop: open repo and browse history

> Goal: a musician can open a folder, see a commit list, and read the tablature.

- [x] **2.1 — `gpt serve`**
  - HTTP server on `:7337`
  - REST endpoints mirroring all CLI commands: `GET /log`, `GET /status`, `POST /commit`, `GET /diff`, etc.
  - Response shape: same `{ ok, data }` / `{ ok, error }` JSON protocol as `--json` flag
  - Desktop will use this in dev; bundled app spawns the binary and calls stdio

- [x] **2.2 — Open repo dialog**
  - File picker → validate that selected folder is a gpt repo (`.git/` present)
  - If not: offer to `gpt init`
  - Saves path to Zustand `repo.repoPath`

- [x] **2.3 — History browser**
  - Commit list from `useCommitLog()` rendered as dense Bauhaus rows
  - Click a commit → stores `history.selectedCommitHash`, drives detail pane
  - First commit auto-selected on load; skeleton + empty + error states
  - Commit detail pane shows message, author, email, date, full + parent hashes

- [x] **2.4 — Tab viewer**
  - `gpt show <hash> --export` → binary buffer → `<TabScore src={buffer} />`
  - Track selector if score has multiple tracks
  - Loading/error states

**🚦 Gate:** Open a folder, see commits, click one, the tablature renders.

---

## Milestone 3 — Desktop: commit workflow

> Goal: a musician can save a new version without touching the terminal.

- [x] **3.1 — Status panel**
  - List of changed `.gp` files from `useRepoStatus()`
  - Staged / Unstaged sections with colored status badges (A/M/D/?)
  - Click a file → preview its tablature at HEAD in the right pane (mirrors JetBrains Git layout)
  - New / untracked files show a "no previous snapshot" empty state instead of the viewer
  - Lazy-loaded AlphaTab viewer (same `Suspense` pattern as the history tab viewer)

- [x] **3.2 — Stage file**
  - `+` button on hover (right side of each unstaged row, JetBrains-style) → `useStageFile()` → `gpt add` → invalidate status query
  - Per-file `isStaging` spinner while mutation is pending; success/error toasts via sonner
  - Staged rows have no action button (unstage needs `gpt reset HEAD` — not in API yet)

- [x] **3.3 — Commit panel**
  - Textarea + "Save snapshot" button pinned below the file list (JetBrains layout)
  - Disabled when nothing staged or message empty; Cmd+↵ keyboard shortcut
  - Submit → `useCommit()` → `gpt commit` → invalidate log + status → success/error toasts
  - On success: clears message, clears tab-viewer selection
  - New/untracked files now show their working-tree tablature (via `GET /workdir/file/:filename`) instead of an empty state

- [x] **3.4 — Playback**
  - Play / pause / stop + scrub slider + loop + speed controls via `PlayTimeline` (already wired in both history and status tab viewers)
  - Beat cursor highlight via `enableElementHighlighting` + `cursorClassNames` on `<AlphaTab.Viewport>`
  - Fixed: `stop()` no longer crashes on `InvalidStateError` (AlphaTab 1.8.x bug — wrapped in try-catch, dispatches `stopped` to reset state)
  - Fixed: `isReadyForPlayback` now resets to `false` when a new score starts loading, preventing premature play() calls
  - Fixed: tab viewer resets selected file + track + render error when the viewed commit changes (was showing a 404 for files missing in the new commit)
  - Auto-scroll: `useAutoScroll` hook (in `packages/alphatab-react`) listens to `playedBeatChanged` and calls `scrollIntoView` on `.at-cursor-beat` — built into `<AlphaTab.Viewport>` automatically
  - Slider fill: fixed Base UI `data-orientation` vs Tailwind `data-horizontal:` mismatch — `SliderPrimitive.Track` and `Indicator` now have explicit `h-1.5`/`h-full` classes so the progress fill is always visible

**🚦 Gate:** Open a `.gp` file, edit it externally, stage it, write a message, commit — new entry appears in the history browser.

---

## Milestone 4 — Diff view and branching

- [x] **4.1 — `gpt branch` / `gpt checkout` CLI commands**
  - `gpt branch <name>` — create branch
  - `gpt checkout <name>` — switch branch
  - `gpt branch --json` — for desktop branch picker (GET /branch, POST /branch, POST /checkout)

- [x] **4.2 — Branch switcher in desktop**
  - `<BranchSwitcher>` in sidebar: popover lists branches, checkmarks current, inline input to create new
  - On checkout → invalidates log + status + branches queries; success/error toasts

- [x] **4.3 — `<TabDiff>` component in `@gpt/alphatab-react`**
  - Accepts `base: Uint8Array`, `head: Uint8Array`, `diff: ScoreDiff`
  - Two side-by-side panes: base (before) left, head (after) right
  - Highlights changed bars with overlays: removed=red, changed=amber on base; added=green, changed=amber on head
  - Uses `api.boundsLookup.findMasterBarByIndex()` after `postRenderFinished` to position overlays precisely
  - `BarOverlays` injects overlay divs imperatively into the viewport element (no react-dom portal needed)
  - Compact per-pane header with chip counts (C/A/R); colors configurable via props with Gitarpro token defaults

- [x] **4.4 — Diff view screen in desktop**
  - `GitCompare` button appears on commit row hover → sets `diffCommitHash` in store
  - When two commits selected, `HistoryView` shows `DiffView` instead of `CommitDetail`
  - `useDiffScores` hook: fetches both score files in parallel, parses with AlphaTab client-side, calls `diffScores()`
  - `DiffView`: header with base↔head commit pills, file + track selector dropdowns, `<TabDiff>` lazy-loaded
  - Older commit auto-detected as base, newer as head by log position; close button restores commit detail

**🚦 Gate:** Select two commits in the history browser, open the diff view, changed bars are visually highlighted.

---

## Milestone 5 — Merge

> This is the hardest milestone. Design the UX carefully before writing code.

- [x] **5.1 — 3-way merge algorithm in `@gpt/gpt-core`**
  - `mergeScores(base: Score, ours: Score, theirs: Score): MergeResult`
  - `MergeResult`: merged `Score` + list of `BarConflict` (bars changed in both branches differently)
  - Auto-resolve non-conflicting bars (only one side changed)
  - Tested thoroughly before CLI integration

- [x] **5.2 — `gpt merge <branch>` CLI command**
  - Find common ancestor via `git merge-base`
  - Parse all three versions → `mergeScores()`
  - Write merged `.gp` to working tree
  - Write `.gpt-conflicts.json` sidecar listing unresolved bars
  - Exit code 1 if conflicts exist, 0 if clean merge
  - HTTP API: `GET/POST /merge`, `PUT /merge/resolve`, `POST /merge/finalize`, `DELETE /merge`
  - `finalizeData()` applies bar-level resolutions, re-exports, stages, commits, removes sidecar

- [x] **5.3 — Conflict resolution UI**
  - `MergeView` replaces the placeholder — detects active merge via `GET /merge` on load
  - No merge active → `MergeStartPanel`: branch picker dropdown + "Start merge" button
  - Clean / fast-forward result → success banner with "View history" shortcut
  - Conflicts → `MergeConflictView`: file rail (left) + scrollable conflict list (right)
  - Each `ConflictRow` shows kind badge (FIELD/NOTE/BEAT), human-readable path, description
  - Expand row → "Accept Ours" / "Accept Theirs" version buttons; collapses on resolve
  - "All ours ‹‹" / "All theirs ››" bulk shortcuts per file
  - Optimistic cache update via `onMutate` — resolution feels instant
  - Progress bar + `N/M` counter in the header; turns green when fully resolved
  - Commit message input appears when all conflicts are resolved; "Commit merge" finalizes
  - Abort button removes sidecar; sidebar Merge nav item shows unresolved count badge
  - `humanPath()` converts raw paths like `track[0].bar[4].voice[0].beat[2].note[s=3].fret` → "Track 1 · Bar 5 · Voice 1 · Beat 3 · String 3"

**🚦 Gate:** Two branches with a conflicting edit on the same bar can be merged with the visual chooser, producing a valid `.gp` file.

---

## Milestone 6 — Daily Driver Polish (v1.1)

> Goal: close the gaps between "impressive demo" and "tool a musician opens every day."

- [ ] **6.1 — Unstage support**
  - CLI: `gpt reset HEAD <file>` command
  - HTTP: `DELETE /staged?dir=<path>&file=<filename>`
  - Desktop: `-` button on staged file rows (mirrors the `+` on unstaged)

- [ ] **6.2 — Recent repositories**
  - Electron main saves the last N repo paths to `userData/recent-repos.json`
  - `OpenRepoView` shows a "Recents" list before the folder picker; click to open directly
  - IPC handlers: `repos:getRecent` / `repos:addRecent`

- [ ] **6.3 — Stage All / Unstage All**
  - Header-level "Stage All" button in the unstaged section of the Status panel
  - Calls `/add` sequentially for each unstaged file (or a future batch endpoint)
  - Disable with a spinner while in-flight

- [ ] **6.4 — File watcher (auto-refresh)**
  - Electron main: `chokidar` on the opened repo directory
  - On `.gp` file change event: emit `repo:filesChanged` IPC event to renderer
  - Desktop: listen to IPC event in a React effect → invalidate `status` query
  - Gate: edit a `.gp` file in Guitar Pro externally → status panel updates within 2s without a focus change

- [ ] **6.5 — Diff in Status panel**
  - When a staged or unstaged file is selected, show `<TabDiff>` instead of `<TabScore>`
  - Base = HEAD version (`/show/:hash/file/:path`); head = working-tree version (`/workdir/file/:path`)
  - Reuses existing `useDiffScores` hook — wire it into `StatusTabViewer`

- [ ] **6.6 — Fix staleTime flicker**
  - Set `staleTime: 2000` for `/log` and `/branch` queries
  - Leave `staleTime: 0` for `/status` and `/merge` (must stay fresh)

- [ ] **6.7 — Keyboard shortcuts**
  - Space: play/pause in any tab viewer
  - Cmd+S: stage all unstaged files (mirrors "save" muscle memory)
  - Cmd+Enter: already works for commit — surface it visually with a `<Kbd>` badge

- [ ] **6.8 — Empty-state first-run guidance**
  - When a new repo has zero commits, StatusView shows a guided "Add your first Guitar Pro file" state
  - Step indicators: (1) Add a `.gp` file to this folder → (2) It'll appear here → (3) Stage it → (4) Commit

- [ ] **6.9 — React Error Boundaries**
  - Wrap `<AlphaTab.Root>` and `<TabDiff>` in Error Boundaries that render `<TabViewerErrorState>`
  - AlphaTab 1.8.x throws in certain states (see `stop()` workaround) — a rogue throw should not unmount the whole view

- [ ] **6.10 — Fix `gpt-core` dev rebuild requirement**
  - CLI resolves `@gpt/gpt-core` to `packages/gpt-core/dist/index.js` at runtime; editing `src/` has zero effect until a manual `pnpm nx build @gpt/gpt-core`
  - Fix: add a `pre-serve` Nx lifecycle hook that auto-builds `gpt-core`, or use `tsx` path aliases to import from `src/` in dev

- [ ] **6.11 — Production distribution pipeline**
  - Add `electron-builder` config with `.dmg` (macOS), `.exe`/NSIS (Windows), `.AppImage` (Linux) targets
  - CI step in GitHub Actions: build + sign + notarize on each release tag
  - Verify `process.resourcesPath/bin/gpt` bundled CLI binary loads correctly in production build
  - Wire `electron-updater` for auto-update from GitHub Releases

**🚦 Gate:** Open the app fresh, open a new repo, complete the first commit without leaving the app or reading docs. A signed `.dmg` can be downloaded and installed on a clean macOS machine.

---

## Milestone 7 — Git Power Features (v1.2)

> Goal: expose the git features that translate most naturally to music workflows.

- [ ] **7.1 — Tags**
  - CLI: `gpt tag <name> [<hash>]`, `gpt tag --list`, `gpt tag --delete <name>`
  - HTTP: `GET /tags`, `POST /tags`, `DELETE /tags/:name`
  - Desktop: tag chips on commit rows in history; "Tag this version" button in commit detail pane
  - Design: tag pills distinct from branch chips (different accent color)

- [ ] **7.2 — File history view**
  - Desktop: right-click a file in the Status panel → "View file history"
  - Navigates to a filtered history view showing only commits that touched that file
  - HTTP: `GET /log?file=<path>` (isomorphic-git supports `filepath` option in `git.log()`)
  - Each commit row shows the per-file change summary (reuse `show` endpoint logic)

- [ ] **7.3 — Restore file to version**
  - In history browser commit detail: "Restore this file" button per file
  - Calls `GET /show/:hash/file/:filename` → writes to working tree via new `POST /restore` endpoint
  - Confirmation dialog: "This will overwrite the current working-tree version of `<filename>`."

- [ ] **7.4 — Commit amend**
  - CLI: `gpt commit --amend` flag
  - HTTP: `POST /commit { amend: true }`
  - Desktop: "Amend last commit" toggle in commit panel (enabled only when nothing is staged)

- [ ] **7.5 — Stash**
  - CLI: `gpt stash`, `gpt stash pop`, `gpt stash list`
  - isomorphic-git has no native stash — implement via a dedicated `refs/gpt-stash/<n>` ref + tree commit
  - Desktop: "Stash changes" button in status panel header; stash list in a Sheet drawer

- [ ] **7.6 — Cross-branch diff**
  - Desktop: in the diff view, allow selecting branch names (not just commit hashes) for base/head
  - HTTP: `GET /diff?ref1=<branch>&ref2=<branch>` resolves to commit hashes server-side
  - Reuse existing `<BranchSwitcher>` component in dropdown mode

**🚦 Gate:** A musician can tag "album-version", view history for one specific file, restore an old version, stash WIP, and compare two branches side-by-side.

---

## Milestone 8 — Remote Backup & Sharing (v1.3)

> Goal: musicians can back up their repo to any standard git remote (GitHub, Gitea, NAS).

- [ ] **8.1 — `gpt remote add/remove/list`**
  - Wraps isomorphic-git `addRemote` / `deleteRemote` / `listRemotes`
  - HTTP: `GET /remotes`, `POST /remotes`, `DELETE /remotes/:name`

- [ ] **8.2 — `gpt push`**
  - isomorphic-git `push()` with HTTPS + personal-access-token auth
  - Desktop: "Push" button in sidebar; first-use auth dialog (token input saved to system keychain via Electron `safeStorage`)

- [ ] **8.3 — `gpt pull`**
  - isomorphic-git `fetch()` + `merge()` (reuses milestone 5 merge logic)
  - Desktop: "Pull" button; shows incoming commit count before pulling

- [ ] **8.4 — `gpt clone`**
  - isomorphic-git `clone()` with progress events
  - Desktop: "Clone from URL" option in `OpenRepoView`

**🚦 Gate:** A musician pushes their repo to GitHub and pulls it on another machine with all history intact.

---

## Milestone 9 — Commit Graph & Visual History (v1.4)

> Goal: the history feels like a music production session timeline, not a text list.

- [ ] **9.1 — DAG layout from API**
  - `GET /log` already returns `parentHashes` — add branch-tip metadata per commit row
  - Compute graph lane assignments client-side (topological sort + lane allocation)

- [ ] **9.2 — Graph lanes in the history panel**
  - Render commit graph as SVG lanes in the left gutter of the history list (GitKraken-style)
  - Each branch gets a lane color; merge commits show converging connectors

- [ ] **9.3 — Merge conflict tab preview**
  - In `MergeConflictView`, expand a conflict row to show a mini `<TabScore>` for "ours" and "theirs" side-by-side
  - Uses `GET /show/:hash/file/:path` for both sides; musicians can hear before choosing

- [ ] **9.4 — Print / Export PDF**
  - AlphaTab's `print()` API
  - "Export PDF" button in the tab viewer toolbar

**🚦 Gate:** The history panel shows a visual branch graph; merge conflicts show tab previews for both sides.

---

## Milestone 10 — Platform Foundation (v2.0)

> Goal: self-hostable "GitHub for Music" — one `docker compose up` gives you a full Git hosting platform with music-aware file rendering. Forgejo is the Git backend; we build the music layer on top via its API.

### Architecture

```
Browser → Next.js Web App (apps/web)
             ├── Forgejo REST API  — repos, auth, PRs, issues, push/pull
             └── Renderer Service (apps/renderer) — AlphaTab headless, metadata, diffs

Desktop App → gpt push/pull → Forgejo (standard HTTPS git remote)
```

**What Forgejo handles for free:** user registration, OAuth (GitHub/Google/etc.), repo CRUD, push/pull/clone/fork, pull requests, issue tracker, webhooks, CI runners (Gitea Actions = GitHub Actions syntax), SSH keys, org/team permissions, public/private repos.

**What we build:** music-specific UI layer and headless renderer service.

**Self-hosting cost:** ~$6–11/month (Forgejo + renderer + Next.js on a single 2GB VPS + Caddy for TLS).

### New monorepo additions

| Path | Description |
|---|---|
| `apps/web` | Next.js 15 (App Router) — the music platform UI |
| `apps/renderer` | Hono service — AlphaTab headless, metadata extraction, SVG diff rendering |
| `packages/gpt-metadata` | Headless score parser: extract title, artist, tracks, BPM, key, duration from `.gp` |
| `packages/forgejo-api` | Typed Forgejo REST client (autogenerated from their OpenAPI spec) |

### Tasks

- [ ] **10.1 — OpenAPI spec for `gpt serve`**
  - Add `@hono/zod-openapi` to the CLI server; annotate all existing routes with Zod schemas
  - Emit `openapi.json` as a build artifact; use it to generate a typed client for `apps/web`
  - This is prerequisite for both the web platform and any future third-party integrations

- [ ] **10.2 — `packages/gpt-metadata`**
  - Headless AlphaTab score parser (Node.js, no DOM)
  - Returns: `{ title, artist, album, tracks: [{ name, instrument, stringCount }], bpm, bars, timeSignature, keySignature }`
  - Used by the renderer service to index `.gp` files on push (via Forgejo webhook)

- [ ] **10.3 — `apps/renderer` — Hono renderer service**
  - `POST /metadata` — accepts raw `.gp` bytes, returns `ScoreMetadata` JSON
  - `POST /render/bar` — accepts `.gp` bytes + bar index, returns SVG string (for commit diff previews)
  - `POST /diff` — accepts base + head `.gp` bytes, returns `ScoreDiff` JSON (reuses `@gpt/gpt-core`)
  - Webhook consumer: `POST /webhook/forgejo` — on push event, fetches changed `.gp` files and indexes metadata into a search table

- [ ] **10.4 — `packages/forgejo-api`**
  - Download Forgejo's OpenAPI spec and run `openapi-typescript` to generate types
  - Thin typed wrapper around `fetch` — no axios, no runtime schema parsing
  - Handles auth token injection and base URL configuration

- [ ] **10.5 — Docker Compose stack**
  - Services: `forgejo`, `renderer`, `web`, `caddy` (automatic TLS via Let's Encrypt)
  - `forgejo` uses SQLite by default; `POSTGRES_URL` env var switches to PostgreSQL for scale
  - Single `.env.example` with all required variables documented
  - `docker compose up` on a fresh VPS produces a fully working instance

- [ ] **10.6 — Desktop ↔ Platform integration (M8 bridge)**
  - Desktop's M8 push/pull works against any HTTPS git remote — Forgejo is just one instance
  - Add "Connect to GPT Hub" option in `OpenRepoView`: paste instance URL + generate PAT → stored in system keychain
  - No custom sync protocol; standard git push/pull keeps it interoperable with GitHub, GitLab, etc.

**🚦 Gate:** `docker compose up` on a $6 VPS → browse to the URL → register → create a repo → push from the desktop app → repo appears in the web UI with `.gp` files rendered.

---

## Milestone 11 — Web UI MVP (v2.1)

> Goal: a musician can browse a public repo, play the tabs, and see commit history — all in the browser.

- [ ] **11.1 — Forgejo OAuth login**
  - Next.js app authenticates via Forgejo's OAuth2 flow (Forgejo is the identity provider)
  - Server-side session with `iron-session` or similar; no separate user database
  - Public repos browsable without login

- [ ] **11.2 — Repo browser**
  - File tree with `.gp` file detection — shows AlphaTab player inline (lazy-loaded WASM)
  - Metadata chips on `.gp` files: track count, BPM, duration (from renderer service index)
  - Non-`.gp` files show raw content as before

- [ ] **11.3 — In-browser tab player**
  - AlphaTab running client-side (WASM) with SoundFont loaded from CDN
  - Track selector, play/pause/stop, speed, loop — mirrors desktop player UX
  - Lazy-loaded: only initializes when a `.gp` file is opened

- [ ] **11.4 — Commit history with music diffs**
  - Commit list page reuses Forgejo API (`GET /repos/{owner}/{repo}/commits`)
  - Commit detail: changed `.gp` files call the renderer service for `ScoreDiff` JSON
  - Renders `<TabDiff>` client-side with bar-level highlights — same component as desktop

- [ ] **11.5 — Discover page**
  - Lists public repos, sortable by recent push / stars / forks
  - Filter by: instrument (guitar/bass/drums/keys), time signature, BPM range
  - Metadata comes from the renderer service's search index (SQLite FTS or PostgreSQL full-text)
  - No ElasticSearch — keep it cheap

- [ ] **11.6 — Embeddable player**
  - `<iframe src="https://hub.example.com/embed/{owner}/{repo}/{path}">` renders a self-contained tab player
  - Can be embedded in any website, blog post, forum
  - Respects repo visibility (private repos return 403)

**🚦 Gate:** Visit a public repo URL in the browser → play the tabs → browse commits → see musical diffs — no desktop app required.

---

## Milestone 12 — Social Layer (v2.2)

> Goal: musicians can collaborate, share, and build on each other's work.

- [ ] **12.1 — Fork + Pull Request with music diff review**
  - Fork/PR workflow is native to Forgejo — wire it into the custom UI
  - PR diff view shows music diffs (bar-level highlights) instead of raw text diffs for `.gp` files
  - PR comments can be anchored to a specific bar (like GitHub's line comments)

- [ ] **12.2 — Stars and follows**
  - Forgejo has stars natively (`POST /repos/{owner}/{repo}/stargazers`)
  - "Following" feed: activity stream of repos you star or users you follow

- [ ] **12.3 — Track-level attribution**
  - `.gp` files contain track metadata (instrument, player name)
  - Show per-track contributor list on repo page: "Guitar — @username"
  - Computed from commit history + track-name matching heuristic

- [ ] **12.4 — CI: auto-render previews on push**
  - Forgejo Action (`.forgejo/workflows/preview.yml`) runs on every push
  - Calls renderer service to generate PNG previews of the first bar of each `.gp` file
  - Attaches previews as workflow artifacts; shown in PR review UI

**🚦 Gate:** Fork a public repo, edit a track, open a PR with bar-level diff comments, get it merged — all in the browser.

---

## Future (post v2.2)

### Real-time collaboration
- `gpt sync` command backed by a Cloudflare Worker relay
- CRDT at the bar level using **Yjs** (`Y.Array` of bars per track)
- Relay is stateless — passes Yjs ops, stores last committed `.gp` in R2

### Marketplace
- Sell tabs, license songs, attribute contributors
- Stripe integration via Forgejo webhooks (purchase → grant repo access)

---

## Architectural notes

### Known footguns

| Issue | Severity | Fix |
|---|---|---|
| `gpt-core` requires manual rebuild in dev | Medium | Add pre-serve Nx lifecycle hook or tsx path alias (M6.10) |
| `staleTime: 0` causes focus-refetch flicker on `/log` and `/branch` | Medium | One-line fix per query — do in M6.6, not later |
| No React Error Boundaries around AlphaTab | High | AlphaTab throws in certain 1.8.x states; a rogue throw silently unmounts the view (M6.9) |
| No production distribution pipeline | High | App exists only on dev machine until M6.11 |
| No OpenAPI spec for `gpt serve` | Medium | Without it, web client will diverge from desktop client silently (M10.1) |
| AlphaTab `stop()` throws `InvalidStateError` | Low | Wrapped in try/catch; revisit on AlphaTab ≥1.9.x |

### Platform decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-05-15 | Use Forgejo as Git backend, not a custom git server | Forgejo is 10 years of git-server work: auth, SSH, HTTP push/pull, forks, PRs, CI. Don't rebuild it. |
| 2026-05-15 | Custom Next.js frontend on top of Forgejo API, not a Forgejo fork | Forgejo's UI is Go `html/template` — too hard to inject AlphaTab WASM. Layering on the REST API gives full React control. |
| 2026-05-15 | Desktop push/pull targets Forgejo via standard HTTPS git | Keeps interoperability with GitHub, GitLab, etc. No custom sync protocol. |
| 2026-05-15 | Renderer service is a separate Hono process, not bundled into Next.js | AlphaTab WASM is heavy; isolating it lets the renderer scale independently and run server-side without polluting the web app bundle. |
| 2026-05-15 | SQLite by default for both Forgejo and renderer search index | Keeps self-hosting cost at $6–11/month on a single VPS. `POSTGRES_URL` env var upgrades to PostgreSQL for scale. |

## Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-04-20 | Use AlphaTab `model.*` namespace for all model types | Direct named imports from `@coderline/alphatab` don't resolve in ESM build |
| 2026-04-20 | `JsonConverter` lives in `model`, `ScoreLoader` in `importer` | Discovered via runtime inspection — not obvious from docs |
| 2026-04-20 | Remove custom `CanonicalScore` types from `gpt-core` | AlphaTab's model is more complete; maintaining a parallel type system adds risk |
| 2026-04-20 | Diff at the `Bar` level (one Bar = one measure in one staff of one track) | Natural musical unit; aligns with AlphaTab's model hierarchy |
| 2026-04-20 | `barFingerprint()` uses only property access, no AT method calls | Allows tests to use plain cast objects without instantiating real AT classes |
