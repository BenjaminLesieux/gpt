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

OpenSSL headers must also be findable at build time (`brew install openssl@3`).
Nothing links against them — on Apple targets libgit2 speaks HTTPS through
SecureTransport — but `libgit2-sys` declares `openssl-sys` for the whole of
unix, so enabling `https` builds it regardless.

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

## Bundling

`tauri build` signs with whatever `APPLE_SIGNING_IDENTITY` holds; the config
names no identity, so the same target serves both cases below.

```bash
APPLE_SIGNING_IDENTITY="-" pnpm nx bundle @gpt/companion
```

That is the alpha build: ad-hoc signed, hardened runtime on (Tauri's default),
notarization skipped. Two consequences to know before handing the `.dmg` to
anyone.

*Gatekeeper rejects it.* `spctl -a` says so, and a first launch needs
right-click → **Open**, or `xattr -dr com.apple.quarantine /Applications/Gitarpro.app`.
Nothing is wrong with the build; it simply has no Developer ID behind it.

*The Accessibility grant does not survive a rebuild.* An ad-hoc signature has no
team identity, so TCC remembers the app by the hash of its code. Every build
changes that hash, and the permission the app needs to read which score Guitar
Pro has in front (see [`guitar_pro.rs`](src-tauri/src/guitar_pro.rs)) has to be
granted again — remove the stale entry in **System Settings → Privacy & Security
→ Accessibility** first, since macOS will not replace it on its own. A Developer
ID signature is keyed to the team instead, and does survive.

For a distributable build, swap the identity for a real one and add the
notarization credentials — no config change, only environment:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com" APPLE_PASSWORD="app-specific-password" APPLE_TEAM_ID="TEAMID"
pnpm nx bundle @gpt/companion
```

Tauri notarizes and staples when all three of the second group are present, and
prints `skipping app notarization` when they are not.

> If the DMG step fails with `error running bundle_dmg.sh`, look in `/Volumes`
> for a leftover `Gitarpro <version>` mount from an interrupted run and
> `hdiutil detach` it. The script mounts under that name and does not reuse or
> clean up one it did not create.

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
  src/remote.rs    # push, fetch, and where a score stands against its remote
  src/push.rs      # the background push queue
  src/pull.rs      # taking a remote version into the score on disk
  src/secrets.rs   # remote tokens, in the system keychain
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

Remote tokens are **not** in `config.json` — that file is plain text and holds a
descriptor only (URL, auth kind, username). The token lives in the login
keychain under service `com.gitarpro.companion`, keyed by the tracked file's id.
Two scores on the same server therefore hold two copies of one token: the price
of a secret whose lifetime is exactly one config entry, so clearing a remote can
delete its token without wondering who else was using it.

## Sync

A third ref, `refs/remotes/origin/main`, mirrors what the remote last said. It
is never checked out and only ever written by a fetch, which is what lets
`syncState` answer *up to date / ahead / behind / diverged* without a network.

- **Push** is automatic and never blocks. `commitNamed` enqueues; the queue
  thread in `push.rs` does the rest. Only `refs/heads/main` travels —
  `refs/snapshots` is local scratch that gets pruned and rewritten, so a remote
  could make no use of it. The refspec has no leading `+`: a remote that moved
  on is refused, never forced.
- **Failures split in two.** A refused push or a rejected token will answer the
  same however long we wait, so the queue stops and raises a badge. Anything
  else (no network, server down) backs off — doubling from 5s to a 5-minute
  ceiling — and never gives up. A fresh commit resets the backoff.
- **Pull is fast-forward only.** Locked decision 8 keeps merge out of v1, so a
  score changed in both places is reported and left alone. What is on disk is
  snapshotted before it is replaced, exactly as a restore does, and disk is
  written before the ref moves — that ordering fails towards "still behind,
  pull again" rather than "up to date, holding the old music".

Only HTTPS is built. `git2`'s `ssh` feature would pull libssh2 into the bundle
and nothing has asked for it; `RemoteAuth::Ssh` exists in the descriptor and is
refused by the credential callback.

## IPC

Every command is wrapped and typed in [`src/lib/ipc.ts`](src/lib/ipc.ts):
`listTrackedFiles`, `trackFile`, `pickAndTrackFile`, `untrackFile`,
`getActiveFile`, `setActiveFile`, `commitNamed`, `listVersions`,
`listSnapshots`, `getVersionBlob`, `restoreVersion`, `setRemote`, `pushStatus`,
`syncState`, `fetchRemote`, `pullRemote`, plus the window controls. Three events
go the other way: `file-saved` (after each debounced save of a tracked file),
`tracked-files-changed`, and `push-status-changed`.

`fetchRemote` and `pullRemote` are `async` commands wrapped in
`spawn_blocking`: a plain Tauri command runs on the main thread, and these wait
on a server.

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
  entrypoint. `LSUIElement` in [`src-tauri/Info.plist`](src-tauri/Info.plist)
  says so before AppKit launches — `set_activation_policy` in `lib.rs` runs from
  `setup`, by which point the dock icon has already appeared and gone.
- The tray draws [`icons/tray.png`](src-tauri/icons/tray.png), a black-on-alpha
  plectrum flagged as a template so macOS recolours it for the menu bar it lands
  in. The brand has only a logotype and `gpt` is unreadable at 16pt, so the tray
  carries a glyph the rest of the app does not use.
- `Space Mono` (design-system mono face) is not vendored yet; the fallback
  stack (`Fira Code`, `Courier New`) carries it. The Bauhaus faces are local.
- Verifying sync against a real server is a manual step — see
  [`docs/forgejo-check.md`](../../docs/forgejo-check.md). The automated tests
  push and fetch against a bare repo in a tempdir, which exercises the
  refspecs and the fast-forward rule but not TLS or token auth.
