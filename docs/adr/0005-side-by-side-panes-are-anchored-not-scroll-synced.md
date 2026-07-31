# Side-by-side panes are anchored to the alignment, not scroll-synced

`TabDiff` copied `scrollTop` from one pane to the other. It now scrolls by
**anchor**: find the measure at the top of the source pane, look up its aligned
counterpart ([ADR 0002](./0002-alignment-is-score-level-attribution-is-per-track.md)),
and position the other pane on that. Both panes also render with a fixed
`display.barsPerRow` so their systems correspond.

## Why

Pixel sync assumes the two scores lay out identically. They never do — adding a
single note changes a staff's height, which shifts every system below it. The
drift accumulates, so by measure 40 the two panes show different music. This is
visible with *zero* structural change.

Between two anchors, base spans *n* measures and head spans *m*. Progress is
interpolated across the interval. When *m* = 0 — a pure insertion — interpolation
degenerates to holding the short pane still until the long one reaches the next
anchor, so that behaviour comes for free rather than as a special case.

## Highlights are painted at the altitude of the change

The old overlay used `MasterBarBounds.visualBounds`, documented as covering
*all bars of this master bar* — every staff in the system. A bass-only edit
painted across the guitars, contradicting per-track attribution.

alphaTab exposes the whole chain: `MasterBarBounds.bars[]` → `BarBounds.beats[]`
→ `NoteBounds.noteHeadBounds`. So the highlight matches the change: the measure
box when a measure is added or removed, the staff's bar when a bar property
changes (clef, key signature), the beat when rhythm changes, the note head when
a note changes.

Two layers, because fine highlights are unfindable while scrolling:

- a **subtle bar tint, always painted** — "something happened here";
- the **precise mark plus tooltip, on hover** — "here is exactly what".

Hover is what makes precision affordable. Twelve permanent halos on a
twelve-note edit are unreadable; on hover they answer a question the reader just
asked, and they carry the intent string ([ADR 0004](./0004-the-diff-reports-facts-intent-is-derived.md)).

## Rejected: GitHub-style padding rows

GitHub pads the deleted side with blank rows so lines correspond 1:1. It can,
because a line of code has a fixed height. A measure does not: variable width,
variable height, and systems reflow. Emulating it means synthesising a ghost
`Bar` and `MasterBar` into the rendered model, so the pane no longer shows the
real score — and Guitar Pro's automatic bar numbering would then be wrong for
every measure after the ghost, with no way to correct it short of painting the
numbers ourselves.

Deferred, not refused. The benefit appears only after an insertion or deletion;
in-place modifications are the common case, and anchoring is required either way.
