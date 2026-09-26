# The companion and the hub draw a score from the same components

The companion's extended window and the hub's score page show the same two
things: a history of versions, and one version rendered and playable. Each app
built its own. They now share one set of components, split the way the repo
already splits Base UI from shadcn:

- **`@gpt/alphatab-react` gains the unstyled behaviour** — what a player has to
  get right regardless of how it looks.
- **`@gpt/ui` gains the styled components** built on it, and the history,
  from the same shadcn primitives everything else uses.

Where the two copies disagreed, **the more complete one won and the other was
deleted** — not kept as a variant. No new package.

## What forced it

The copies had already drifted, and always in the same direction: the one worked
on more recently was better and the other did not know.

- **The player.** The companion's has a track picker, a scrub bar, loop and
  three speeds. The hub's plays and stops. Both configure alphaTab identically
  and each re-implements, with its own warning comment, the two things that
  break it: the viewport must never unmount while loading, and alphaTab's
  cursor must be contained in its own stacking context.
- **The history.** The hub's groups by day and by session, draws branch lanes,
  names who pushed and what each version touched, and selects a range. The
  companion's is a flat list — and the companion is about to get branches
  (#17), with the lanes it will need sitting in the other app.
- **Relative time.** The companion's is localized; the hub's builds `20m` by
  hand and pins everything else to English.

## Why this split

**`@gpt/alphatab-react` stays publishable.** Its `AGENTS.md` promises a
GPT-agnostic wrapper, so it cannot hold shadcn or our copy. What it can hold is
behaviour with no opinion about appearance — and the two traps above are
exactly that. A score frame that keeps the viewport mounted, isolates the
cursor and puts loading and error content *over* it turns two comments into an
API nobody can get wrong. Scrubbing — the thumb following the pointer rather
than the player while dragging — is the other piece of behaviour living inside
a styled component today.

**`@gpt/ui` already styles headless primitives.** Every component in it is
shadcn over Base UI. A score player over alphaTab's unstyled parts is the same
relationship one level up. The package gains a dependency on
`@gpt/alphatab-react`, but it has no barrel: only a file that imports
`@gpt/ui/score/player` pays for alphaTab.

**Copy comes in as props**, the way shadcn components take `children`. The
player has seven labels, all short. So the shared components do not need i18n
of their own, and neither app has to adopt the other's.

## i18n in the hub, separately

The hub gets i18next with the companion's setup — English and French, detector
and fallback identical — as its own `lib/i18n.ts`. Not because sharing needs it
but because the hub was always going to be translated, and every string moved
into shared components would otherwise be moved twice.

The `en-GB` pin in `relative-time.ts` was right for an English-only interface:
*il y a 21 minutes* inside an English sentence was a bug. With the sentence
translated too, dates follow the interface language. English keeps day-first
ordering by formatting through `en-GB`, which is what the pin protected.

## The line: data in, fetching stays home

Shared components take data as props and report intent through callbacks.
Fetching stays in each app — Tauri IPC and a byte cache in the companion,
TanStack Query over HTTP in the hub. The player takes `src: string | Uint8Array`,
so the hub passes a URL alphaTab streams and the companion passes bytes it
already holds.

Columns a surface cannot fill are absent, never faked. Until the companion
signs its versions ([ADR 0011](0011-the-companion-needs-an-account.md)) it has
no author to show, and it never has scope — the hub derives that on push.

## Refused

- **A new `score-ui` package.** Proposed first. It existed only because neither
  package could hold styled alphaTab components with copy; splitting behaviour
  from style removes the reason.
- **The hub inside the companion.** A webview of `hub-web` would put a browser
  session in the desktop app, and a session is deliberately not a push
  credential.
- **Sharing whole screens.** The panel, sync bar, remote and restore dialogs are
  the companion's; sign-in, invites and the credentials handoff are the hub's.
- **The diff view in the hub.** `DiffStage` needs `gpt-core` parsing in the
  browser, which ADR 0008 kept out of `hub-web`.
- **A shared data layer.** One hook over IPC-or-HTTP is an interface with two
  implementations that share nothing but the name.

## What it costs

- **`@gpt/ui` stops being primitives only.** Its README changes to say so: it
  holds shadcn primitives and the product components both apps render.
- **A shared change is checked twice.** A player tweak lands in a 520px
  inspector and a full-width stage. The history is laid out with container
  queries, not viewport breakpoints, because in the companion it sits in a
  304px rail inside a wide window.
- **The companion's history changes shape.** Rows go from 28px to 40px, gain
  day headers, and lose the `01 02 03` ordinals the hub never had. Its compare
  pin survives as an option of the shared list.
- **The history's props carry its copy** — around eight labels and a function
  for the session line, which needs plurals. More than the player; still less
  than a second list.
- **The hub's bundle takes i18next**, about 15 KB gzipped on every page.
