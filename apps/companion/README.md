# @gpt/companion

Gitarpro's resident companion app (macOS menu bar; Windows tray later). Built
with Tauri v2 — Rust host + React webview. See
[`docs/companion-v1-plan.md`](../../docs/companion-v1-plan.md) for the product
brief and milestones.

## Prerequisites

A Rust toolchain is required (Tauri builds the host binary with Cargo):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

`cargo`, `rustfmt` and `clippy` must be on `PATH` (`rustup component add rustfmt clippy`).

## Targets

| Command                             | What it does                                             |
| ----------------------------------- | -------------------------------------------------------- |
| `pnpm nx dev @gpt/companion`         | `tauri dev` — Vite on :4210 + the Rust host, hot reload  |
| `pnpm nx build @gpt/companion`       | `vite build` — webview assets only, into `dist/`         |
| `pnpm nx bundle @gpt/companion`      | `tauri build` — the macOS `.app` / `.dmg`                |
| `pnpm nx typecheck @gpt/companion`   | `tsc --build`                                            |
| `pnpm nx test @gpt/companion`        | `vitest` — the webview's unit tests                      |
| `pnpm nx cargo-check @gpt/companion` | `cargo check` on `src-tauri`                             |
| `pnpm nx cargo-test @gpt/companion`  | `cargo test` on `src-tauri`                              |

## Layout

```
src/
  panel/      # hotkey panel (index.html) — see "Panel" below
  extended/   # extended window (extended.html)
  components/ # shadcn/ui primitives — install via `pnpm dlx shadcn@latest add`
  lib/ipc.ts  # the only place that calls `invoke`
  lib/time.ts # compact locale-aware relative times
  styles/     # Gitarpro design tokens → Tailwind v4 theme (ported from apps/desktop)
src-tauri/
  src/lib.rs       # app builder, state setup, window events
  src/commands.rs  # the IPC surface
  src/config.rs    # config.json — tracked files, snapshot policy
  src/state.rs     # shared state: config, active file, watcher
  src/git.rs       # bare repo per tracked file (git2)
  src/normalize.rs # deterministic .gp rebuild (port of gpt-core's normalizeGp)
  src/watcher.rs   # save detection → auto-snapshot
  src/events.rs    # events pushed to the webview
  src/panel.rs     # show/hide/position the hotkey panel
  src/window.rs    # lazily created extended window
  src/tray.rs      # menu bar icon + menu
  src/shortcut.rs  # global shortcut registration
```

## Storage

`~/Library/Application Support/com.gitarpro.companion/` (Tauri's
`app_data_dir`, keyed by the bundle identifier):

```
config.json     # tracked files, remotes, snapshot policy
repos/<id>/     # one bare repo per tracked file
```

Each repo holds a single blob, `score.gp`, whatever the file is called on disk.
Named versions are commits on `refs/heads/main`; silent auto-snapshots are a
separate chain on `refs/snapshots`, pruned to the newest 200 within 14 days.
Pruning rewrites the kept snapshots, so their ids change — re-list rather than
holding one across a prune.

Bytes are run through `normalize_gp` before hashing, so a Guitar Pro save that
changed no music produces no new version. That is a Rust port of `gpt-core`'s
`normalizeGp`: auto-snapshots fire from a background thread and must not depend
on a live webview. It only rebuilds the zip container — everything that
understands a *score* stays in `gpt-core`.

Untracking keeps the repo, so re-tracking the same path finds its history.

## IPC

Every command is wrapped and typed in [`src/lib/ipc.ts`](src/lib/ipc.ts):
`listTrackedFiles`, `trackFile`, `pickAndTrackFile`, `untrackFile`,
`getActiveFile`, `setActiveFile`, `commitNamed`, `listVersions`,
`listSnapshots`, `getVersionBlob`, `restoreVersion`, `setRemote`, `pushStatus`,
plus the window controls. Two events go the other way: `file-saved` (after each
debounced save of a tracked file) and `tracked-files-changed`.

`pickAndTrackFile` opens the picker from the *Rust* side, so the webview needs
no dialog capability. It holds the panel open for the duration — the dialog
takes focus, and the panel dismisses itself on blur.

`getVersionBlob` returns raw bytes rather than a JSON array — scores are
hundreds of KB, and alphaTab wants a `Uint8Array` anyway.

## Windows

Two webview entrypoints, built as separate Vite inputs:

- **panel** (`index.html`) — frameless, transparent, always-on-top, created
  hidden at startup and only ever shown/hidden. Toggled by **⌘⇧G** or a left
  click on the tray icon; dismissed with `Esc` or on blur. It is never
  recreated: hotkey → visible has to stay under ~100 ms.
- **extended** (`extended.html`) — normal decorated window, created on first
  request and hidden (not destroyed) when closed.

Blur-to-dismiss is disabled in debug builds — opening devtools steals focus and
would make the panel vanish while you work on it.

## Panel

Three mutually exclusive views inside one 420×320 card, composed from
[`PanelShell.tsx`](src/panel/PanelShell.tsx):

- **[`TrackFirstFile`](src/panel/TrackFirstFile.tsx)** — nothing tracked yet.
- **[`CommitView`](src/panel/CommitView.tsx)** — the main gesture. Active file,
  what has changed since the last named version, message field. `Enter` commits
  and the panel dismisses itself after a short confirmation.
- **[`FileSwitcher`](src/panel/FileSwitcher.tsx)** — `⌘K`, or click the file
  name. `Esc` steps back to the commit view; a second `Esc` closes the panel.

[`usePanelSession`](src/panel/usePanelSession.ts) is the only thing that talks
to the host, and [`usePanelShown`](src/panel/usePanelShown.ts) is what makes
"the panel just opened" observable: the webview is created once at startup and
only shown and hidden, so there is no mount to hang that work off. Window focus
is the signal — it re-reads state, refocuses the message field, and replays the
entry animation via [`useEnterAnimation`](src/panel/useEnterAnimation.ts).

Two styling notes worth knowing before touching `styles/app.css`:

- The unlayered `:focus-visible` fallback ring excludes `[data-slot]`, because
  unlayered rules outrank every Tailwind utility and shadcn controls all draw
  their own focus state.
- In raw CSS, `var(--color-accent)` is the **brand red** from `tokens.css`, not
  shadcn's hover surface — only the `@theme inline` utilities carry the shadcn
  meaning. Name the token you actually want.

## Notes

- The app runs as a macOS *accessory* (no dock icon); the tray is the only
  entrypoint.
- The tray currently reuses the app icon. A monochrome template icon that
  adapts to light/dark menu bars is a M6 task.
- `Space Mono` (design-system mono face) is not vendored yet; the fallback
  stack (`Fira Code`, `Courier New`) carries it. The Bauhaus faces are local.
- `git2` is built without `ssh`/`https` — nothing is pushed until M5, and the
  network features drag in openssl/libssh2. M5 re-enables them.
- `setRemote` stores a URL and an auth *descriptor* only. Tokens belong in the
  keychain (M5); `config.json` is plain text.
