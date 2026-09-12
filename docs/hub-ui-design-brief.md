# Gitarpro Hub — UI design brief

A self-contained prompt for Claude Design. It assumes no access to this
repository: everything the designer needs — product, screens, states, copy
rules and brand tokens — is below. Paste it whole.

> **Scope note for us, not for the designer.** `docs/hub-v1-plan.md` ships the
> hub as an API: signup, login, create score, list scores. Nothing in it draws
> a pixel. This brief covers the thinnest web surface those four endpoints can
> back, and deliberately stops there — no screen below needs a route that v1
> does not already have. Everything past that (score viewer, share links,
> comments) stays out, and the layout is asked to leave room for it rather than
> to pretend it exists.

---

## The prompt

### What this is

**Gitarpro** is version control for Guitar Pro scores — git for musicians. A
musician works in Guitar Pro (a desktop notation app that is not extensible),
and a resident **companion** app on their Mac watches the file: every save is a
silent snapshot, a global hotkey opens a small panel where they type a message
and hit Enter, and that becomes a named version. Two seconds, then back to
Guitar Pro. The companion pushes those versions to a plain HTTPS git remote.

**The hub** is what sits on the other end of that remote. It is a small web app
that provisions the git side for a musician who should never learn what a git
remote is. One job, end to end:

1. They make an account.
2. They click **Create score** and name it.
3. They get back three values — a **URL**, a **username** and a **token**.
4. They paste those into the companion's *Set up sync* dialog, which has
   exactly three fields with exactly those names.
5. Their versions land on the server from then on, invisibly.

That handoff is the entire product surface. Design it as the product it is, not
as a settings page.

### Who is looking at it

A guitarist, not a developer. They have never used GitHub, and if they had,
nothing here should remind them of it. They arrived because the companion app
told them to. They are mildly anxious that they are about to lose their work.
The screen's job is to make them feel that their song is now somewhere safe,
and to get them back to playing.

They are on a laptop, indoors, probably at night, probably next to a guitar.

### What to design

Eight artboards on one canvas, desktop-first at 1280×832, plus the three marked
*(narrow)* repeated at 640px wide.

1. **Sign up** — email, password, submit. The first screen a new user sees, so
   it carries the one-sentence explanation of what an account is *for*
   ("somewhere for your versions to live"). A link to log in. *(narrow)*

2. **Log in** — email, password, submit. A link to sign up. Show the error
   state inline: wrong email or password, stated as one plain sentence, no
   field-level red rain. *(narrow)*

3. **Scores — empty.** The state that matters most, because every new account
   starts here and it is one click from the payoff. A single primary action:
   **Create score**. Say what a score is in one line. Do not fill the space
   with onboarding cards.

4. **Create score** — a dialog over the list. One field: the score's name
   ("Untitled riff", "Bridge rewrite"). One button: **Create**. A line of
   reassurance that this takes a few seconds because a repository is being made
   on the server.

5. **Credentials handoff — the hero screen.** Shown once, immediately after a
   score is created, and never again. Three values, each on its own row, each
   monospace, each with its own copy control:

   - **URL** — `https://git.example.com/gp7x4k2m/s9q3v1.git`
   - **Username** — `gp7x4k2m`
   - **Token** — `a1b2c3d4e5f6...` (48 chars, monospace, wraps or truncates
     with a copy affordance — never a row of dots, the user must be able to see
     it)

   Two things must be unmissable and must not look like the same thing:

   - **The token is shown once.** It is not stored anywhere it can be read
     back. Closing this screen destroys the only copy. This is a warning.
   - **Where these go**: the companion app's *Set up sync* dialog, whose three
     fields carry these three names. This is an instruction, and it is the
     reason the user is here — give it more weight than the warning, not less.

   Include a "Copy all three" affordance. Design the confirmed state of a copy
   control, not just its resting state.

6. **Scores — list.** Rows of scores the account owns. Per row: the name the
   user typed, the clone URL in monospace, when it was created, and the name of
   the token that was minted for it. **No token value** — it does not exist any
   more, and the row must not imply it could be recovered. Row density around
   40px; this is a dense information list, not a card grid. Include the primary
   **Create score** action in the same frame.

7. **A score that did not finish provisioning.** Real state, not a hypothetical:
   the hub creates a repository and mints a token as two separate remote calls,
   and the second one can fail. The row exists, the repository may exist, the
   token does not. The row needs a state and a **Finish setup** action that
   retries. Design it as a neutral, retryable condition — not a failure, not a
   destructive red.

8. **The hub cannot reach the git server.** A whole-page degraded state.
   Existing scores still show; **Create score** is unavailable and says why in
   one sentence a musician can act on. No stack trace, no status code.

Also show, as a strip or an inset on the canvas rather than as its own
artboard: the signed-in **header** (product wordmark, the account's email, log
out) and the **button, input, badge and dialog** primitives you settle on.

### How it should feel

**Bauhaus-dark.** The interface is a precision instrument: functional,
grid-aligned, zero decoration. The reference point is the cold minimalism of
Interpol's *Turn On the Bright Lights* — near-black fields, cold grey
typography, a single controlled accent that appears rarely enough to mean
something.

Hard rules, all of them load-bearing:

- **Dark only.** There is no light theme. Do not design one.
- **Sharp corners.** 2px radius on controls and chips, 4px on dialogs. No
  pills, no large radii, ever.
- **No shadows for decoration.** Surfaces are separated by background value and
  1px borders. The only shadows are functional: a focus ring, and an overlay's
  `0 8px 32px rgba(0,0,0,.6)`.
- **No photography, no illustration, no gradient meshes, no glass, no backdrop
  blur.** If a screen looks empty, it is correct.
- **The accent is rationed.** Cold brick-red, for the primary action, active
  states and destructive intent. A screen with two red things on it is wrong.
- **No emoji.** Anywhere. This is professional tooling.
- **Motion is 100–150ms ease on hover and active state, and that is all.** No
  page transitions, no springs. Prefer a skeleton to a spinner — except where
  the user is genuinely waiting on the server (score creation), where an honest
  indeterminate indicator is right.

### How it should speak

Precise, technical, musician-friendly — a senior developer who also plays
guitar. First person about their things ("your scores"). Short declarative
sentences. Sentence case on every label. Never explain git; never use the words
*repository*, *commit*, *remote* or *token scope* in user-facing copy — except
"token", which the companion's own dialog already uses and which the user must
match to a field.

Errors are plain English and say what to do next. Empty states are one line and
one action.

Write the real copy. Do not leave lorem, and do not leave `[button label]`.

### Brand tokens

These are the production values. Use them literally.

```css
/* Surfaces */
--color-bg:             #0c0c0c;  /* page */
--color-surface:        #141414;  /* panels, cards */
--color-surface-raised: #1c1c1c;  /* dialogs, hover targets */
--color-surface-hover:  #242424;
--color-overlay:        rgba(0,0,0,.72);

/* Strokes */
--color-border:         #2a2a2a;
--color-border-subtle:  #1f1f1f;
--color-border-strong:  #3a3a3a;

/* Text */
--color-fg-1:           #f0f0f0;  /* primary */
--color-fg-2:           #8a8a8a;  /* secondary, metadata */
--color-fg-3:           #484848;  /* muted, placeholder, disabled */
--color-fg-inverse:     #0c0c0c;  /* text on accent */

/* Accent — cold brick-red, used sparingly */
--color-accent:         oklch(55% 0.16 22);
--color-accent-bright:  oklch(62% 0.18 22);
--color-accent-dim:     oklch(55% 0.16 22 / 15%);
--color-accent-border:  oklch(55% 0.16 22 / 40%);

/* Status */
--color-success:        oklch(58% 0.13 145);
--color-warning:        oklch(65% 0.14 60);
--color-info:           oklch(60% 0.12 230);

/* Focus ring — neutral on purpose. Red is spoken for by the brand and by
   destructive actions; a red ring makes every focused field look failed. */
--color-ring:           oklch(80% 0 0 / 70%);

/* Radii */
--radius-sm: 2px;  --radius-md: 2px;  --radius-lg: 4px;

/* Spacing — 4px base: 4 8 12 16 24 32 48 64 96 */

/* Type scale (px) */
--text-xs: 11;  --text-sm: 12;  --text-base: 14;  --text-md: 16;
--text-lg: 18;  --text-xl: 22;  --text-2xl: 28;  --text-3xl: 36;
```

**Type.** The production display and UI face is a licensed **Bauhaus**
typeface, which you will not have. Substitute **Space Grotesk** (Google Fonts)
— geometric, Bauhaus-adjacent, the closest available stand-in. Monospace is
**Space Mono**, and it is not decorative: URLs, usernames and tokens are
monospace because the user has to read and compare them character by
character.

The wordmark is a text logotype: `gpt` in monospace, with the `t` in the
accent.

### Constraints from the build

This will be built in React with **shadcn/ui** on **Tailwind v4**, against the
token set above. Stay inside what those primitives can express — button,
input, label, dialog, badge, separator, skeleton, tooltip, empty state — and
name variants the way shadcn does (`default`, `secondary`, `outline`, `ghost`,
`destructive`). Do not invent a control that would have to be built from
scratch to satisfy one screen.

Accessibility is not optional: every text pair on these dark surfaces must
clear WCAG AA, focus is always visible, and the copy controls need accessible
names ("Copy token", not "Copy").

### Out of scope — do not design these

No score viewer, no tablature rendering, no diff view, no share links, no
comments, no collaborators, no billing, no settings page, no marketing or
landing page, no password reset, no email verification, no OAuth buttons. The
server has no route behind any of them.

Do leave the shell — header and content region — able to grow a left nav later
without being redrawn. Do not draw that nav.
