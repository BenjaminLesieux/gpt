# Producing the diff test fixtures

The diff algorithm is verified at three levels (see
[ADR 0003](./adr/0003-fingerprint-is-an-allowlist-with-a-drift-test.md)):
property tests as the backbone, hand-written examples to pin regressions, and
**real Guitar Pro file pairs** as the safety net.

This document covers the third, because it is the only part that cannot be
generated in code. Guitar Pro rewrites things on save that no in-memory
mutation reproduces — it re-spells rests, de-duplicates its object pool,
renumbers ids, stamps timestamps. Those rewrites are the single largest source
of false "this file changed" reports, and the only authority on them is the
application itself.

## What we already know about the base file

`packages/gpt-core/src/__fixtures__/sample.gp` — container `VERSION` 7.0:

| | |
|---|---|
| Measures | 36, all 8/4 |
| Sections | `Intro` (m. 1), `Couplet` (m. 5) |
| Tracks | 0 `Electric Bass`, 1 `Clean Guitar`, 2 `Clean Guitar`, 3 `Drumkit` |

Note that tracks 1 and 2 have **the same name**. That is useful, not a problem —
it is exactly the case that breaks naive track pairing.

## Protocol

Three rules, and they matter more than the edits themselves:

1. **One edit per file.** If a pair contains two changes, a failing test cannot
   tell you which one broke.
2. **Always "Save As" a new file — never overwrite.** Both sides of every pair
   must survive.
3. **Same Guitar Pro version for every file.** A version upgrade rewrites the
   container, which would show up in every pair at once and mask the real edits.
   Record the version in the manifest below.

### Step 0 — the shared base

Open `sample.gp`, change **nothing**, and Save As
`packages/gpt-core/src/__fixtures__/edits/00-base.gp`.

This is deliberate. `sample.gp` was written by whatever version produced it; if
you edit it directly with a newer Guitar Pro, every pair carries both your edit
*and* a format upgrade. Re-saving once first isolates the two. **Every pair
below is `00-base.gp` → the new file.**

### The pairs

Each row: open `00-base.gp`, make exactly the one edit, Save As the filename.

| File | Edit | Verifies |
|---|---|---|
| `01-resave.gp` | none at all — open and save | The floor. Diff must report **zero** changes. Catches timestamp and pool-shuffle noise ([ADR 0001](./adr/0001-diff-against-the-alphatab-model-not-the-gpif-xml.md)). |
| `02-fret.gp` | Electric Bass, measure 5: change the **first note's fret** by one | Precision — exactly one note, one measure, one track flagged. |
| `03-insert-measure.gp` | Insert an empty measure **before measure 10** | Score-level alignment ([ADR 0002](./adr/0002-alignment-is-score-level-attribution-is-per-track.md)). Measures 10–36 must stay `equal`, not cascade. |
| `04-delete-measure.gp` | Delete **measure 10** | Same, in reverse. |
| `05-split-beat.gp` | Electric Bass, measure 5: replace the **first quarter note with two eighths** | Beat alignment by musical time. Later beats in the bar must stay `equal`. |
| `06-key-signature.gp` | Change the **key signature** of the whole score | `Bar.keySignature` — invisible to the current fingerprint. |
| `07-capo.gp` | Put a **capo on fret 2** on track 1 (`Clean Guitar`) | `Staff.capo` — invisible today; nothing below the staff changed. |
| `08-tempo-change.gp` | Add a **tempo change at measure 30** | `MasterBar.tempoAutomations` — invisible today; `diffMeta` only reads the initial tempo. |
| `09-chord-symbol.gp` | Change a **chord symbol** above a beat (e.g. C → C♯) | The tooltip's data source: `Chord.name` behind `Beat.chordId`. |
| `10-track-order.gp` | **Move the Drumkit track** above the two Clean Guitars | Track pairing with two identically-named tracks. Must report zero content changes. |
| `11-rename-section.gp` | Rename the section `Couplet` to `Refrain` | `MasterBar.section` — invisible today. |

If a measure named above turns out to be empty in your copy, use the nearest one
that is not and write the real number in the manifest. The test assertions are
generated from the manifest, not hard-coded.

### Manifest

Create `packages/gpt-core/src/__fixtures__/edits/manifest.json` alongside the
files:

```json
{
  "guitarProVersion": "8.1.x",
  "base": "00-base.gp",
  "pairs": [
    { "file": "01-resave.gp", "edit": "none", "expect": "no-changes" },
    { "file": "02-fret.gp",   "edit": "fret", "track": 0, "measure": 5, "expect": "one-note" }
  ]
}
```

Recording the Guitar Pro version is not bureaucracy: when a future version
changes its save behaviour, the manifest is what tells us whether a newly
failing test is a regression in our code or a change in theirs.

## Why not just script this

There is no headless Guitar Pro, and writing `.gp` files ourselves would test our
writer rather than Guitar Pro's. The point of this tier is precisely to observe
behaviour we do not control.
