# Gitarpro

Version control for Guitar Pro scores, for people who do not want to know that.

Guitar Pro is not extensible, so Gitarpro sits beside it: a macOS menu-bar app
that watches the `.gp` files you point it at. Every save Guitar Pro makes is
captured silently. When a version is worth keeping, a global hotkey brings up a
small panel, you name it, and press Enter — about two seconds, without leaving
the score.

Underneath it is real git — one bare repository per tracked file — and you never
see a commit, a branch or a hash. What you see instead is what changed
*musically*: which measures moved, which bars a track gained or lost, rendered
as tablature next to the version it came from.

## Where things are

| Project                                            | What it is                                              |
| -------------------------------------------------- | ------------------------------------------------------- |
| [`apps/companion`](apps/companion)                   | The app. Tauri v2 — Rust host, React webview.           |
| [`packages/gpt-core`](packages/gpt-core)             | The diff and merge engine. Knows what a score is.       |
| [`packages/alphatab-react`](packages/alphatab-react) | React bindings for AlphaTab — rendering and playback.   |

The split that matters: everything that understands *music* is TypeScript in
`gpt-core`. The Rust host stores bytes, watches files and talks to remotes, and
knows nothing about a note.

## Getting it running

Needs [pnpm](https://pnpm.io) and a [Rust toolchain](https://rustup.rs).

```bash
pnpm install
pnpm nx dev @gpt/companion
```

Then `pnpm nx bundle @gpt/companion` for a `.app` and `.dmg`. See the
[companion README](apps/companion/README.md) for signing, and what an ad-hoc
build means for Gatekeeper and the Accessibility permission.

```bash
pnpm nx run-many -t test        # vitest, everywhere
pnpm nx cargo-test @gpt/companion
pnpm lint
```

Tasks go through Nx, always — `pnpm nx ...`, never the underlying tool.

## Reading further

- [`docs/companion-v1-plan.md`](docs/companion-v1-plan.md) — the product brief,
  the decisions that are settled, and what each milestone actually landed
  versus what it was scoped to.
- [`CONTEXT.md`](CONTEXT.md) — the vocabulary. *Measure* and *bar* are not
  synonyms here, and the distinction runs through the whole diff engine.
- [`docs/adr/`](docs/adr) — why the diff reads AlphaTab's model rather than the
  GPIF XML, and what the fingerprint is allowed to notice.
- [`docs/alpha-smoke-test.md`](docs/alpha-smoke-test.md) and
  [`docs/forgejo-check.md`](docs/forgejo-check.md) — the two walkthroughs for
  what no test covers.

## Status

Alpha. macOS only. No merge and no branches by design — a score changed in two
places is reported and left alone rather than combined badly.

> **Being retired:** `apps/desktop`, `apps/desktop-e2e` and `apps/cli` are the
> pre-pivot Electron app and its engine, kept only until M6 removes them. Do not
> build on them.
