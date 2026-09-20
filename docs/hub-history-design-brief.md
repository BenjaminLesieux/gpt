# Gitarpro Hub — score history UI design brief

A self-contained prompt for Claude Design. It assumes no access to this
repository: product, data, screens, states, copy rules and brand tokens are all
below. Paste it whole.

> **Scope note for us, not for the designer.** None of this exists yet.
> `hub-web` is a list of scores and no detail route
> (`docs/people-branches-and-proposals.md`, commits 6/7/9). The hub also has no
> history endpoint — it proxies git and can read `git log` server-side, which is
> where the data below comes from. This brief deliberately asks only for what a
> `git log --all` plus `score_members` and `score_pushes` can answer. Anything
> needing notation rendering stays out: Decision 7 says the hub reports and the
> companion resolves, and `hub-web` depends on neither alphaTab nor `gpt-core`.

---

## The prompt

### What this is

**Gitarpro** is version control for Guitar Pro scores — git for musicians. A
musician works in Guitar Pro (a desktop notation app that is not extensible),
and a resident **companion** app on their Mac watches the file: every save is a
silent snapshot, a global hotkey opens a small panel where they type a message
and hit Enter, and that becomes a named **version**. Two seconds, then back to
Guitar Pro. The companion pushes those versions to the **hub**, a small web app
that holds the band's copy of every score.

A score has **members** — a band, not one person. Everyone's versions land in
the same history. People work on named **branches** when they are doing separate
things ("Bass line", "New chorus"); a branch **lands** when its author says it
is done, and most of them land cleanly and silently because two people editing
two different tracks never collide.

**What is missing is the one thing that makes a history worth having: no way to
look at it.** The hub knows every version, who made it, when, on which branch,
and what landed when — and shows none of it. This brief is that screen.

### Who is looking at it

A guitarist, not a developer. They have never used GitHub and nothing here
should remind them of one — no octopus graphs, no rainbow lanes, no hashes as
the primary identifier. They are on a laptop, indoors, probably at night,
probably next to a guitar.

They come to this screen with one of four questions, in this order of frequency:

1. *What happened to this song lately?* — glance, scroll, leave.
2. *What did Sam change on Tuesday?* — find a person's work in time.
3. *Where is the bass line up to, and has it landed yet?* — the state of work
   in flight.
4. *When did the chorus get like this, and what did it sound like before?* —
   navigate backwards to a point in time, then take it into the app.

Design for 1 and 2. Make 3 legible without a second screen. For 4, the screen's
honest answer is to hand the version to the companion — see *What this screen
cannot do*.

### The data, exactly

Every element below is real and available. Do not invent fields; do not draw a
field that is not here.

**A version** (one git commit):
- a message the musician typed — *"try the 7th in the bridge"*, *"drums
  finally right"*. Sentence fragments, lowercase, typed in two seconds. Some
  are empty-ish: *"wip"*, *"."*. Design for scrappy copy, not for release
  notes.
- an author: a **member** of the score. Accounts have an email and no display
  name yet, so identity is initials derived from the email local part
  (`ben.lesieux@gmail.com` → `BL`) with the full address in a tooltip. Squares,
  2px radius. Never a photograph — there is no upload and the page makes no
  third-party requests.
- a timestamp.
- a short id (7 hex chars). Present but subordinate: metadata, never the title
  of a row.
- parents: one normally, two for a merge, zero for the first.
- **tracks touched** and **bars changed** — derived server-side by diffing
  against the parent, e.g. *Bass, 12 bars*. Never declared by the user, so it
  is never stale and never lies. A version may touch several tracks.

**A branch**: a name, a tip, who has pushed to it, its derived track scope, how
far ahead of the main line it is, and one of three states — *in flight*,
*landed*, *needs a decision* (either it conflicts, or its author marked it *ask
the band first*).

**A conflict**, when there is one: the hub computes the merge and can name
exactly where it fails — *bar 19, Guitar 1* — and who has to decide.

**The shape of a real history.** This is the most important constraint on the
drawing, and the thing most commit-graph UIs get wrong:

- The overwhelmingly common case is **one straight line**. Most scores never
  branch at all.
- When a branch exists there are **one or two**, they live **days**, and they
  are **3–15 versions long** before they land.
- Versions arrive in **bursts**: eleven in one evening, then nothing for three
  weeks. A time-proportional axis renders that as an unreadable clot next to a
  void. **Order by topology; express time as grouping, not as distance.**
- Total length is tens to a few hundred.

There will never be a forty-lane graph. A design that needs one to look good is
the wrong design.

### What this screen cannot do

Say this plainly in the design rather than hinting at it. The hub cannot render
notation: there is no tablature, no staff, no playback, no visual diff of the
music on this page. Hearing two versions means opening them in the companion,
which has the score stage, the diff view and playback.

So a version's detail is **facts and an exit**: message, who, when, which
tracks, how many bars, and a control that opens that version in Gitarpro. Design
that exit as a first-class destination, not as a fallback apology. The same is
true of a conflict: the screen names the bar and the track, and the button hands
the decision to the app.

### What to design

Artboards on one canvas, desktop-first at 1280×832, plus the two marked
*(narrow)* repeated at 640px wide.

1. **The score page, ordinary state.** One score, one line of history, one
   person, ~15 versions. This is the screen 80% of the time and it is the one
   that has to be beautiful. It carries the page header: score name, member
   avatars, and the actions that already exist (invite someone, set up another
   machine). The history is the page's body, not a tab inside it.

2. **Two branches in flight.** *Ben is on Bass, Sam is on Drums, these don't
   overlap* — that sentence is the whole value of the feature and the screen
   should make it true at a glance, from the lanes and the derived track scope.
   Show a branch's tip, its author, and how far along it is.

3. **A branch that landed.** The merge knot and what the history looks like
   afterwards: the branch's versions are still there, still attributed, and the
   line rejoins. Landing is routine and silent — do not celebrate it.

4. **A branch that needs a decision.** Two causes, one state: it conflicts
   (*bar 19, Guitar 1* — name it), or its author asked for the band's
   agreement. Whoever must decide is named. The action opens the companion.
   This is the one place the accent earns a second appearance on a screen.

5. **A version selected, and a range selected.** The inspector: one version's
   facts and its exit to the app. Then the same surface when two versions are
   picked as a range — *between these two: 14 bars across Guitar 1 and Bass, 6
   versions, three days* — with the same exit. Decide whether this is a right
   rail, an expanding row, or a detail region, and show which you picked.

6. **Empty — nothing has been pushed yet.** The state immediately after a score
   is created, where the user is waiting for their first version to appear and
   is quietly unsure whether they set the app up correctly. One line, and the
   one thing they could check. This state resolves itself the moment they hit
   the hotkey in Guitar Pro.

7. **A long history.** 200+ versions. Show how day or session grouping holds up
   under scroll, what stays pinned, and where the boundary is between what is
   loaded and what is not. Also show the fast way back to a specific week —
   without building a calendar.

8. **The graph at 640px.** *(narrow)* Lanes have to degrade, not shrink. Decide
   what survives.

9. **Loading.** *(narrow + wide)* The history is a server round-trip over git.
   Skeleton, not spinner.

Also show as a strip on the canvas, not as its own artboard: **the graph's own
vocabulary** — a version node, an edge, a branch tip, a merge knot, the current
head, a selected row, a hovered row — and any badge or chip you introduce.

### How the graph should behave

- **The list is the content; the graph is a rail beside it.** Every version is a
  row of text a screen reader reads in order. The drawing lives in a fixed
  left gutter and is decorative in the accessibility tree. Rows are keyboard
  reachable, top to bottom, with a visible focus ring.
- **Row density around 40px**, matching the score list. This is a dense
  information list, not a card feed.
- **No rainbow lanes.** Branch colour is how every other git UI distinguishes
  lanes and it is forbidden here: the accent is rationed to one meaning per
  screen. Distinguish lanes by position, by weight, and by a label at the
  branch head. The main line is the brightest; branches are dimmer.
- **Time is grouping, not geometry.** Date or session headers between clusters
  of rows. Relative for recent (*Today*, *Yesterday*, *Tuesday*), absolute past
  a week.
- **The gutter has a hard width budget** — around 24px per lane, three lanes
  maximum before you collapse. Say what happens at four.

### How it should feel

**Bauhaus-dark.** The interface is a precision instrument: functional,
grid-aligned, zero decoration. The reference point is the cold minimalism of
Interpol's *Turn On the Bright Lights* — near-black fields, cold grey
typography, a single controlled accent that appears rarely enough to mean
something.

Hard rules, all of them load-bearing:

- **Dark only.** There is no light theme. Do not design one.
- **Sharp corners.** 2px radius on controls, chips and graph nodes; 4px on
  dialogs. No pills, no large radii, ever. Nodes are squares, not circles.
- **No shadows for decoration.** Surfaces separate by background value and 1px
  borders. The only shadows are functional: a focus ring, and an overlay's
  `0 8px 32px rgba(0,0,0,.6)`.
- **No photography, no illustration, no gradient meshes, no glass, no backdrop
  blur.** If a screen looks empty, it is correct.
- **The accent is rationed.** Cold brick-red, for the primary action, the
  current head, and things needing a decision. A screen with two red things on
  it is wrong — and a graph is exactly where that rule dies if you let it.
- **No emoji.** Anywhere.
- **Motion is 100–150ms ease on hover and active state, and that is all.** No
  page transitions, no springs, no animated graph re-layout.

### How it should speak

Precise, technical, musician-friendly — a senior developer who also plays
guitar. First person about their things ("your scores"). Short declarative
sentences. Sentence case on every label.

Vocabulary, and it is not negotiable: **version**, **branch**, **land** (not
*merge* as a verb in copy), **member**. Never *commit*, *repository*, *remote*,
*ref*, *HEAD*, *rebase*, *diff*, *SHA*, *parent*. Never explain git. Times are
plain English. A version's message is the user's own words and is never
rewritten, truncated mid-word, or given a fake title when it is empty — an
empty message is *Unnamed version* in the secondary colour.

Write the real copy. Real messages in the rows, real names, real dates. Do not
leave lorem, and do not leave `[button label]`.

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

/* Focus ring — neutral on purpose. */
--color-ring:           oklch(80% 0 0 / 70%);

/* Radii */
--radius-sm: 2px;  --radius-md: 2px;  --radius-lg: 4px;

/* Spacing — 4px base: 4 8 12 16 24 32 48 64 96 */

/* Type scale (px) */
--text-xs: 11;  --text-sm: 12;  --text-base: 14;  --text-md: 16;
--text-lg: 18;  --text-xl: 22;  --text-2xl: 28;  --text-3xl: 36;
```

**Type.** The production face is a licensed **Bauhaus** typeface you will not
have. Substitute **Space Grotesk** (Google Fonts). Monospace is **Space Mono**,
and it is not decorative: ids, urls and track names are monospace because they
are read character by character. A version's message is *not* monospace — it is
prose.

### Constraints from the build

React, **shadcn/ui** on **Tailwind v4**, against the tokens above. Stay inside
what those primitives express — button, input, badge, separator, skeleton,
tooltip, scroll area, avatar, empty state, dialog — and name variants the way
shadcn does (`default`, `secondary`, `outline`, `ghost`, `destructive`). Icons
are **lucide**.

The one thing shadcn does not ship is the graph gutter, which will be
hand-drawn SVG. Keep it to straight verticals and one curve shape for a branch
and a join, on a fixed grid — anything a developer has to eyeball will be wrong
on the second render. Give the node and lane geometry in numbers.

Accessibility is not optional: every text pair on these dark surfaces clears
WCAG AA, focus is always visible, the graph is `aria-hidden` beside a real list,
and no state is signalled by colour alone — a branch needing a decision says so
in words.

### Out of scope — do not design these

No tablature or notation rendering, no playback, no visual music diff, no
comments on versions, no reactions, no editing a version's message, no
reverting from the web, no tags or releases, no search across scores, no
settings page, no billing, no marketing page, no light theme.

Do leave the page shell able to grow a left nav later without being redrawn. Do
not draw that nav.
