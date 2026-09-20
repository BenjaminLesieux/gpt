# The measure is the unit of merge

`mergeScores` is 587 lines that three-way merge a score field by field, down to
`note.leftHandFinger`. The proposal here is to delete almost all of it: **a
measure, in one track, is the smallest thing a merge may resolve.** Either your
bar 12 wins or theirs does. There is no half.

Not built. This is the design.

---

## 1. Why sub-bar merging is wrong, not just expensive

The `cell()` rule at the top of `merge.ts` is correct for **independent**
values:

```
ours == theirs               → take ours
base == ours, base != theirs → take theirs
base == theirs, base != ours → take ours
all three differ             → conflict
```

Title and tempo are independent: taking your title and my tempo yields a score
both of us would recognise. **The fields inside a bar are not independent.**
`duration`, `dots`, `tupletNumerator`, `isRest` and the note list co-vary —
they are one utterance about one span of time. Merge them separately and you
get a bar neither side wrote:

> Base: four quarter notes, all fret 5.
> I change the rhythm to a triplet figure. You change the third note to fret 7.
> Field-wise nothing collides — I touched `duration`, you touched `fret`.
> The merge succeeds, with no conflict, and produces a triplet figure with a
> fret 7 in it. **Neither of us played that.**

That is worse than a conflict. A conflict is a question; this is a confident
wrong answer, written into the song the band plays, silently.

Music is not a config file. Changing one note *is* changing the measure,
because what a measure means is the whole of it sounding together. The unit the
merge resolves should be the unit a musician can listen to and judge, and the
smallest such unit is a bar in a track.

## 2. The code already agrees with you

**`mergeBar` is already fingerprint-first.** Its opening lines compare
`barFingerprint` on all three sides and return immediately in three cases out
of four — equal, ours-only, theirs-only. The voice/beat/note descent runs only
in the fourth case: *both sides changed the same bar differently*. Which is to
say, it runs **only on conflicts**.

And in that case its output is used by nobody:

- **`applyMerge` throws it away.** Its own header: *"Conflict bars → left as
  ours' version. User must resolve via the desktop UI."* The merged score never
  contains a field-merged bar. Not once.
- **`collectConflicts` flattens it to a sentence** —
  `track[0].bar[4].voice[0].beat[0].note[s=1].fret`. ADR 0008 and Decision 7 of
  `people-branches-and-proposals.md` already settled that the hub's answer to a
  conflict is *bar 19, Guitar 1* and a button that opens the app, because
  choosing means hearing both. Nothing needs beat-and-field precision, and no
  UI has ever been designed that could present it.

So roughly 400 lines compute a tree that is discarded on one path and truncated
to a bar number on the other. It is not that the note-level merge is too
complex for the value it delivers — it delivers **none**, on every path through
the function.

## 3. What measure-level merging gains

Simplicity is the smaller prize. The real one:

**Insertion tolerance.** `mergeTracks` walks `base.tracks[t]` / `ours.tracks[t]`
positionally, and `mergeBar` takes `staves[0].bars[mbIdx]` positionally. So
today:

- insert one bar at measure 5 on a branch and every measure after it compares as
  changed — the merge reports a conflict in the whole rest of the song;
- drag a track in Guitar Pro (which it lets you do freely) and the merge merges
  the guitar into the drums.

The diff had both problems and **solved them already**. ADR 0002 — alignment is
score-level, attribution is per-track — gives `diffScores` an LCS over measure
fingerprints (`align.ts`) and a `TrackPairing` that ties tracks by identity
rather than index. The note-level merge is a second, worse implementation of
alignment sitting beside a correct one.

Once a bar is an opaque token, a track is a **sequence of lines** and the merge
is textbook `diff3`. Everything git knows about merging line-oriented files
becomes available, for free, and `align.ts` is already the hard half of it.

## 4. The algorithm

Three-way, over the alignment the diff already computes.

```ts
export type Side = 'ours' | 'theirs';

export interface MeasureCell {
  /** Index into the pairing, not into either score's track list. */
  trackIndex: number;
  /** Display measure number in the merged score. */
  measure: number;
}

export type CellMerge =
  | { cell: MeasureCell; status: 'unchanged' }
  | { cell: MeasureCell; status: 'taken'; from: Side }
  | { cell: MeasureCell; status: 'conflict' };

export interface MergeResult {
  meta: ScoreMetaMerge;          // unchanged: four independent scalars
  spine: SpineOp[];              // measures added, removed, or re-metered
  cells: CellMerge[];
  conflicts: ConflictLocation[]; // "Guitar 1, measure 19"
  hasConflicts: boolean;
}
```

**Step 1 — align both sides to base, once.** Reuse the score-level measure
fingerprint from `diff.ts`: `alignIndexes(baseMeasures, oursMeasures)` and
`alignIndexes(baseMeasures, theirsMeasures)`, joined through base. That gives,
for each base measure, its position on each side, plus the measures each side
added or removed. Track pairing comes from the same place the diff gets it.

**Step 2 — resolve the spine.** A measure inserted by one side is inserted. A
measure removed by one side is removed. Both sides inserting at the same base
position is a conflict unless their fingerprints match. The master bar (time
signature, repeats, feel) is one token, compared by `masterBarFingerprint`.

**Step 3 — resolve each cell.** For every paired (track, measure), compare three
bar fingerprints. This is `cell()` verbatim, applied to strings instead of to
`note.trillSpeed`:

```ts
function resolveCell(base: string, ours: string, theirs: string): CellMerge['status'] {
  if (ours === theirs)  return 'unchanged';   // includes both-changed-identically
  if (base === ours)    return 'taken';       // from: 'theirs'
  if (base === theirs)  return 'taken';       // from: 'ours'
  return 'conflict';
}
```

**Step 4 — apply.** Copy whole `Bar` objects. `taken:'theirs'` splices their bar
into our track at that measure; `unchanged` and `conflict` keep ours. No field
writing, no object construction — `applyMerge` loses its per-field walk and
becomes a splice.

That is the entire engine. Call it 120 lines including the spine.

### The one extra rule

**A meter change conflicts with any content edit in the same measure.** If I
change bar 12 from 4/4 to 3/4 while you write a bass line for bar 12, the
fingerprints say the master bar and the bar are separate tokens and both merge
cleanly — into a measure holding four beats of material in three beats of time.
Coupling them is one condition, and it is the conservative direction.

```ts
// ponytail: meter and content are coupled for the whole measure, across every
// track. Finer would be per-track and would need to know what fits a bar.
```

## 5. What this loses, honestly

- **Two sides editing different fields of the same bar now conflict.** I change
  the rhythm, you change a fret, same bar → a question instead of an answer.
  This is the point: the answer it used to give was a bar neither of us wrote.
- **Two sides editing different master-bar fields of the same measure now
  conflict.** I set a repeat, you change the triplet feel → conflict, where
  per-field merging resolved it. Rare, and the cost of one token per measure.
- **Conflict descriptions get coarser** — *Guitar 1, measure 19*, not *beat 3's
  duration*. Nothing consumed the precision and no UI could have shown it.

Nothing else. Every case the old engine resolved *and could be trusted on* — the
band's common case, two people on two tracks — resolves identically, because
`base == ours` and `base == theirs` are fingerprint comparisons on both designs.
`mergeScores`' clean path does not change at all.

## 6. What it costs to build

Each line is a commit.

1. **`refactor(gpt-core): merge measures, not notes`** — the engine above,
   reusing `align.ts` and the diff's track pairing. `merge.ts` 587 → ~120;
   `types/merge.ts` 252 → ~50 (every `*FieldsMerge`, `MergeCell`,
   `StructuralNoteConflict` and `StructuralBeatConflict` goes). Meta keeps
   `cell()`.
2. **`refactor(gpt-core): apply a merge by splicing bars`** — `applyMerge` drops
   its field walk. The AlphaTab `model.*` construction goes with it; only meta
   still writes fields.
3. **`test(gpt-core): merge the cases a band actually hits`** — rewrite
   `merge.spec.ts` (784 lines, most of it asserting the internal tree) around
   outcomes: two tracks in parallel, insertion on one side, track reorder, the
   same bar twice, meter vs content. The insertion and reorder cases fail on
   `main` today; write them first.
4. **`refactor(gpt-core): a conflict is a measure`** — sidecar `schemaVersion: 2`,
   `path` becomes `track[2].measure[18]`, `kind` collapses to one case.
   `mergeScores`, `applyMerge` and `ConflictSidecar` are exported and consumed by
   **nothing** outside `gpt-core` — verified by grep across `apps/` and
   `packages/`. This contract is free to change exactly once, and this is the
   moment.

Then ADR 0008's dry run stands unchanged, and it gets easier: *what it would do*
is now a list of measures, which is a sentence a musician reads.

## 7. Open

- **Voices.** A bar with two voices is one token here, so a bassline in voice 1
  and a slap figure in voice 2 conflict if both change. Probably correct —
  they are one bar of one instrument — but it is the one place where the atom
  might be too big, and worth a real file before deciding.
- **Beat-level alignment inside a bar** (`align.ts` says it is used at two
  scales) becomes unused by the merge. The diff still wants it for display, so
  it stays; check nothing else drops out with it.
