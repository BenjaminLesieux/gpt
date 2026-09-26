# Handoff — shared surfaces, and companion sign-in

A brief for whoever picks this up next. It assumes you have read nothing.

**Read first, in this order:**

1. [ADR 0010 — the companion and the hub draw a score from the same components](adr/0010-the-companion-and-the-hub-draw-a-score-from-the-same-components.md)
2. [ADR 0011 — the companion needs an account](adr/0011-the-companion-needs-an-account.md)
3. [Shared score surfaces](shared-score-surfaces.md) and
   [Companion sign-in](companion-sign-in.md) — the parts lists and the order
4. `CLAUDE.md` — shadcn first, `@gpt/ui` subpath imports, variant names

Do not start at item 3. The ADRs carry the decisions; the design docs carry the
detail.

## The one-paragraph version

The companion and the hub each built a history and a player, and the copies
drifted. The more complete copy of each moves into shared code — behaviour in
`@gpt/alphatab-react`, styling in `@gpt/ui` — and the other is deleted. The hub
learns French on the way. Separately, every version the companion makes is
signed `companion@gitarpro.app`, so the hub cannot say who did what; the
companion now requires signing in to a hub through the browser, and signs every
version as that account.

## The two milestones are independent

Neither blocks the other. The shared history hides the author square when there
is no author, so it ships before sign-in and gains authors when sign-in lands.

## Non-negotiables

- **The more complete copy wins; the other is deleted.** No `variant="hub"`.
- **`@gpt/alphatab-react` stays publishable.** No shadcn, no copy, no GPT
  concepts. Behaviour only.
- **Shared components take data and labels as props.** They never call IPC or
  HTTP, and never `useTranslation`.
- **Columns a surface cannot fill are absent, never faked.**
- **No password is typed into the companion.** Sign-in is the browser's.
- **A companion token cannot push.** Pushing stays on score tokens.
- **Never rewrite an existing version** to fix its author.
- **Design rules hold**: dark only, 2px radii, no pills, no emoji, the accent
  rationed to the current version.

## Traps

**The alphaTab viewport must stay mounted while it loads**, and its wrapper
needs `isolation: isolate`. Both are what `AlphaTab.Stage` exists to enforce;
until step 2 of the shared milestone lands, both players carry the warning.

**`/connect` must not fall under an API prefix**, in `app/plugins/web.ts` or in
`hub-web/vite.config.mts`. They are two lists kept in step by hand.

**Deep links do not work under `tauri dev`.** Bundle, install to
`/Applications`, then test the sign-in round trip.

## Open, and not yours to decide

**Commit author or push record, when they disagree?** ADR 0011's last section.
Ask the owner before building anything that depends on the answer.

## How to work

- `pnpm nx run-many -t typecheck test -p hub-web @gpt/companion @gpt/ui @gpt/alphatab-react`
  for the shared milestone; add `@gpt/hub` and `pnpm nx run @gpt/companion:cargo-test`
  for sign-in. Nx for every task.
- One commit per issue, message in the repo's voice — lowercase, what it does
  for the person using it.
