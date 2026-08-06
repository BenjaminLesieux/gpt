# Gitarpro Companion — v1 Implementation Plan

Self-contained brief for an implementing agent. All product decisions below are FINAL (validated with the owner); do not relitigate them.

## Vision

Gitarpro pivots from a full Electron desktop app to a **resident companion app** (macOS menu bar; Windows tray later). Guitar Pro is not extensible, so this app is the substitute for an "IDE git sidebar". The core gesture: user works in Guitar Pro → hits a global hotkey → a panel appears → types a message → Enter = named version committed → back to Guitar Pro. Two seconds, total.

## Locked decisions

1. **Two surfaces.** Hotkey panel = quick commit/push + recent versions of active file, nothing else. An "extended window" (openable from panel) holds everything richer.
2. **1 `.gp` file = 1 project.** No multi-file repos. Explicit opt-in: user adds files via drag & drop or picker → "tracked files" list. Each tracked file is watched individually (fs events). "Active file" = most recently saved tracked file. (Future refinement, NOT v1: detect Guitar Pro's frontmost document via accessibility APIs.)
3. **Two-tier history** (IntelliJ local-history model):
   - Every Guitar Pro save of a tracked file → silent **auto-snapshot** (unnamed, auto-pruned).
   - Hotkey commit → **named version**. Only named versions form the official history and get pushed.
4. **Real git, fully hidden.** One bare repo per tracked file under the app data dir. Named versions = commits on `main`; auto-snapshots = commits on `refs/snapshots` (pruning = dropping/rewriting that ref). Git only stores; all semantic diffing stays in `gpt-core`. User never sees git concepts.
5. **Tauri v2** (not Electron). macOS first, Windows later. Rust side: libgit2 (`git2` crate), fs watching (`notify` crate), tray, global shortcut. UI stays React; `gpt-core` and `alphatab-react` are reused in the webview.
6. **Keep the Nx workspace.** Keep `packages/gpt-core` and `packages/alphatab-react`. New app: `apps/companion`. Delete `apps/desktop`, `apps/desktop-e2e` and `apps/cli` once companion replaces them (M6) — the CLI's only unique feature is the `normalize-gp` git clean filter, which decision 4 and the constraints below forbid using anyway.
7. **Optional git remote from v1.** Per-file (or global) remote URL + token/SSH auth. Push is async, background, best-effort (silent retry, discreet failure badge). **A local commit must never fail or block because of the network.**
8. **No merge / no branches in v1.** gpt-core's merge code stays in the package (tested), zero UI on it. Extended window v1 scope: version timeline (+ access to auto-snapshots for recovery), visual diff between any two versions, restore a version (safety snapshot first), audio playback via alphaTab.
9. **Hosting platform: deferred, contract sealed.** Later platform = vanilla unmodified git server (Forgejo/Gitea) + separate Gitarpro web app with its own DB (accounts, share links, comments, parsed-score cache). Git = source of truth for scores/history; DB = social/meta only. **No custom sync protocol, ever.** v1 only needs to push to a standard git URL.
10. **Transition.** Current WIP is committed as-is on `feat/this-is-the-beginning` (archive). Pivot work happens on a fresh branch off it (or main after merge — owner's call).

## Architecture

```
apps/companion/            # Tauri v2 app
  src-tauri/               # Rust: tray, global shortcut, windows, git2, notify watcher, IPC commands
  src/                     # React UI (panel + extended window)
packages/gpt-core/         # unchanged — parse/serialize/diff/normalize .gp
packages/alphatab-react/   # unchanged — score rendering
```

- **App data** (`~/Library/Application Support/Gitarpro/`): `config.json` (tracked files: id, absolute path, remote URL, prefs) + `repos/<id>/` (bare git repos).
- **Windows (Tauri):** panel = frameless, always-created-hidden webview toggled by hotkey/tray (show/hide, never recreate — must appear <100ms), hides on blur. Extended window = normal decorated window, lazily created.
- **Commit pipeline (both tiers):** read `.gp` → normalize → write blob/tree/commit to the bare repo via git2. All of it in the Rust host: auto-snapshots fire from the watcher thread and must never depend on a live webview. Normalization is therefore a Rust port of `gpt-core/normalizeGp` (`src-tauri/src/normalize.rs`) — pure zip-container surgery, no score semantics. Git filters remain forbidden by design.
- **IPC surface (Rust commands, roughly):** `listTrackedFiles`, `trackFile(path)`, `untrackFile(id)`, `getActiveFile`, `commitNamed(id, message)`, `listVersions(id)`, `listSnapshots(id)`, `getVersionBlob(id, ref)`, `restoreVersion(id, ref)`, `setRemote(id, url, auth)`, `pushStatus(id)`. Watcher emits `file-saved` events to the webview.
- **Diff view:** load two blobs → `gpt-core` parse + diff → render with `alphatab-react` + custom annotations (changed measures/tracks highlighted). This is the killer feature; budget polish time for it.

## Milestones

**M0 — Archive (sequential, first).** Commit all current WIP on `feat/this-is-the-beginning` as an archive commit. Create pivot branch.

**M1 — Scaffold.** `apps/companion`: Tauri v2 + Vite + React wired into Nx (no official Nx plugin — write `project.json` targets calling `tauri dev`/`tauri build`; mirror the vite setup from the old desktop app). Tray icon, global shortcut (tauri plugins: `tray-icon`, `global-shortcut`), hidden panel window toggling. Port shadcn/ui setup (`components.json`, Tailwind v4 theme from `apps/desktop/src/styles/app.css`) — CLAUDE.md's shadcn-first rules apply to companion too.

**M2 — Core domain (Rust).** config.json store; `notify` watcher on tracked files (debounce saves); git2 bare-repo init; auto-snapshot on save to `refs/snapshots`; named commit on `main`; snapshot pruning (keep N days / M count); IPC commands above.

**M3 — Panel UI.** ✅ Active file display, message input, Enter-to-commit, recent named versions list, file switcher (`⌘K`), "open extended window" affordance. Optimize for keyboard-only flow and dismissal speed.

M3 added two commands the contract in M2 did not anticipate, both because the panel was otherwise a dead end: `pickAndTrackFile` (nothing could be tracked from the UI at all) and `setActiveFile` (the switcher needs a manual override — the host only moved the active file on save or commit). The picker runs host-side and holds the panel open while the modal has focus.

**M4 — Extended window.** ✅ Timeline of named versions + snapshot recovery view; visual diff (gpt-core + alphatab-react); restore with pre-restore safety snapshot; audio playback of a version.

M4 needed no new Rust: M2's `listVersions` / `listSnapshots` / `getVersionBlob` / `restoreVersion` covered it. Two things did change outside the UI. The webview CSP had to allow `blob:` scripts and workers — alphaTab renders through a worker and plays through an audio worklet. And bringing alphaTab into a Vite 8 (rolldown) app extended the existing `@coderline/alphatab-vite` patch: the bridge that re-wraps Vite plugins per environment also re-wraps rolldown's *builtin* plugins, whose bindings reject a `transform` whose options carry no `moduleType`.

**M5 — Remote.** ✅ Remote URL + auth settings; background push queue after named commits; status badge; retry logic.

M5 grew a half the plan did not scope: **pull**. Push alone is a backup, not version control — a version you can never get back is only insurance — so the milestone landed the round trip. Four things that follow are worth writing down.

*Pull fast-forwards or stops.* Decision 8 puts merge out of v1, so a score changed in both places is reported and left alone: no button, and a tooltip saying how to resolve it by hand. `gpt-core`'s merge stays where it is. Storage enforces this a second time — `git::fast_forward_named` refuses to move `main` somewhere that drops versions, whatever the caller believed.

*Failures are two kinds, not one.* A refused push or a rejected token answers identically however long you wait, so the queue stops and raises the badge. Everything else backs off to a five-minute ceiling and never gives up. Treating them alike gets one of them wrong: retrying a refusal is pointless, and giving up on a closed laptop is worse.

*HTTPS only.* The plan said "token/SSH"; `ssh` would build libssh2 into the bundle for a case nobody has asked for. `RemoteAuth::Ssh` still exists in the descriptor and is refused by the credential callback, so adding it later is a build flag and a branch. Enabling `https` does drag in `openssl-sys` even on macOS, where libgit2 uses SecureTransport and never calls it — `libgit2-sys` declares the dependency for the whole of unix. It is a build-machine requirement for a crate that goes unused.

*Tested against a bare repo in a tempdir.* libgit2 treats one as a real remote: same negotiation, same refspecs, same fast-forward rule, no network to make the suite flaky. What that leaves uncovered — TLS and token auth — is a manual walkthrough in [`forgejo-check.md`](forgejo-check.md).

Not done, and deliberately: **clone-to-track**, i.e. adding a score from a remote URL on a second machine. v1 assumes the `.gp` already exists locally and gets pointed at a remote. That is its own story.

**M6 — Cleanup & ship.** Delete `apps/desktop`, `apps/desktop-e2e`, `apps/cli`; macOS bundle/signing via Tauri bundler; smoke-test the full loop (track → save → snapshot → hotkey commit → diff → restore → push).

Deleting the CLI orphans the TypeScript `normalizeGp` (`packages/gpt-core/src/normalizeGp.ts` + spec + the `index.ts` exports) — the CLI is its last consumer, so it goes too, leaving `apps/companion/src-tauri/src/normalize.rs` as the single implementation. Two caveats:

- The Rust port does **not** implement the `volatileElements` option (blanking named XML elements). It is unused today; if a Guitar Pro version turns out to rewrite an element inside `score.gpif` on every save, port the option to Rust *before* deleting the TS version.
- `docs/normalize-gp.md` explains why `.gp` bytes churn — worth keeping, but retarget it at `normalize.rs` and drop the `.gitattributes` clean-filter recipe.

### Parallelization

- After M1: **M2 (Rust core) ∥ M3 (panel UI)** — agree on the IPC contract first, M3 develops against mocked IPC.
- After M2: **M4 ∥ M5** are independent.
- M4's diff component can start even earlier as a pure-web spike (gpt-core + alphatab-react in a plain vite page) ∥ everything else.

## Constraints & pitfalls

- **Normalization is app-level, always.** Never attempt git clean/smudge filters (prior project doctrine; also irrelevant with git2 but the rule stands: normalize before writing blobs so diffs stay stable). It lives in `normalize.rs`; everything that understands a *score* (parse/diff/merge) stays in `gpt-core`.
- `.gp` files are binary zips (~hundreds of KB); git won't delta them well — acceptable, don't optimize.
- TS packages use `moduleResolution: bundler` (overriding the nodenext base) — no `.js` import extensions.
- Prefer `pnpm nx ...` for all tasks; use the shadcn MCP for any new UI primitive (see CLAUDE.md).
- Panel latency is the product. If hotkey→visible exceeds ~100ms, fix that before adding features.
- Rust is new territory in this repo: keep the Rust layer thin (storage/watching/IPC only); all Guitar Pro domain logic stays in TypeScript (`gpt-core`).

## Explicitly out of scope (v1)

Merge UI, branches, hosting platform build-out, Guitar Pro window detection, Windows build, collaboration features.
