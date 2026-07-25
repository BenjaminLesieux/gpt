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
| `pnpm nx cargo-check @gpt/companion` | `cargo check` on `src-tauri`                             |

## Layout

```
src/
  panel/      # hotkey panel (index.html)
  extended/   # extended window (extended.html)
  components/ # shadcn/ui primitives — install via `pnpm dlx shadcn@latest add`
  lib/ipc.ts  # the only place that calls `invoke`
  styles/     # Gitarpro design tokens → Tailwind v4 theme (ported from apps/desktop)
src-tauri/
  src/lib.rs      # app builder, commands, window events
  src/panel.rs    # show/hide/position the hotkey panel
  src/window.rs   # lazily created extended window
  src/tray.rs     # menu bar icon + menu
  src/shortcut.rs # global shortcut registration
```

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

## Notes

- The app runs as a macOS *accessory* (no dock icon); the tray is the only
  entrypoint.
- The tray currently reuses the app icon. A monochrome template icon that
  adapts to light/dark menu bars is a M6 task.
- `Space Mono` (design-system mono face) is not vendored yet; the fallback
  stack (`Fira Code`, `Courier New`) carries it. The Bauhaus faces are local.
