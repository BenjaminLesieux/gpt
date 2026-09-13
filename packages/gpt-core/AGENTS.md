# @gpt/gpt-core

## Purpose

The score-aware half of Gitarpro, with no UI and no runtime of its own:

- **Diff engine** — what changed between two scores, aligned by content and
  attributed per track.
- **Merge engine** — three-way merge at note level, reporting conflicts rather
  than guessing at them.
- **Layout helpers** — `alignedSystems` and `barContent`, for a consumer
  drawing two scores side by side.

**One runtime dependency: `@coderline/alphatab`.** The types here are AlphaTab's
own model classes (`model.Score`, `model.Bar`, …) rather than a canonical tree
of our own — the comment at the top of `types/score.ts` says why they are
aliased the way they are.

**AlphaTab's importer runs under Node with no DOM.** `vite.config.mts` sets
`environment: 'node'` and `diff.integration.spec.ts` parses a real four-track
`.gp` through `importer.ScoreLoader.loadScoreFromBytes` on every test run. Its
*renderer* is a different matter and does need a DOM; nothing here reaches it,
and nothing should start.

## Who uses it

- `apps/companion` — `diffScores`, behind the extended window's diff view.
- `packages/alphatab-react` — `alignedSystems`, `changedBars`, `changedContent`
  in `<TabDiff>`.
- `apps/hub` — not yet. [ADR 0008](../../docs/adr/0008-the-hub-parses-scores-and-merges-them.md)
  makes it a consumer, for branch track scope and for merging.

## Dormant, and why

`mergeScores`, `applyMerge`, `CONFLICT_SIDECAR`, `unresolvedCount`,
`isFullyResolved` and `barsForTrack` have no consumer today. They are not
speculative — their consumer was `apps/cli/src/commands/merge.ts`, deleted in
`9a6c7b5 refactor: delete the CLI`. That command is the prior art for how the
merge and resolve loop fit together:

```sh
git show 229021d:apps/cli/src/commands/merge.ts
```

`types/commit.ts` (`Commit`, `Branch`, `RepoStatus`) is orphaned the same way.

## Public API

```typescript
// AlphaTab model aliases
import type { Score, Track, Staff, Bar, Voice, Beat, Note, MasterBar } from "@gpt/gpt-core";

// Diff
import { diffScores, barsForTrack, changedBars, changeCounts } from "@gpt/gpt-core";
import type { ScoreDiff, MeasureDiff, BarDiff, TrackPairing } from "@gpt/gpt-core";

// Merge
import { mergeScores, applyMerge } from "@gpt/gpt-core";
import type { MergeResult, MergeCell, ConflictLocation } from "@gpt/gpt-core";

// Side-by-side layout
import { alignedSystems, barContent, changedContent, DEFAULT_BARS_PER_ROW } from "@gpt/gpt-core";

// Conflict sidecar (serializable — carries no AlphaTab types)
import { CONFLICT_SIDECAR, unresolvedCount, isFullyResolved } from "@gpt/gpt-core";
```

## Source layout

```
src/
  types/
    score.ts      — AlphaTab model aliases
    diff.ts       — ScoreDiff, MeasureDiff, BarDiff, TrackPairing
    merge.ts      — MergeResult and its cell/conflict types
    conflicts.ts  — the serializable sidecar
    commit.ts     — Commit, Branch, RepoStatus (orphaned, see above)
  align.ts        — LCS over bar fingerprints
  compare.ts      — field-level comparison
  fingerprint.ts  — the bar fingerprint allowlist
  diff.ts         — score-level alignment, per-track projection
  merge.ts        — three-way merge
  applyMerge.ts   — writes a MergeResult back onto a score
  barContent.ts   — what changed inside a bar, for marking
  systems.ts      — row breaks shared by both panes
  index.ts        — public re-exports
```

## Key invariants

1. **Diff never mutates its inputs.** Both `base` and `head` are treated as
   immutable; `diff.integration.spec.ts` reparses its fixture on every call to
   keep that honest.
2. **Measures are aligned by content, not by index.** `diffScores` runs an LCS
   over bar fingerprints, so inserting a measure reports one added bar instead
   of marking every later measure changed. Consequently a `BarDiff` carries
   **two** positions — `baseIndex` and `headIndex` — which diverge after any
   structural edit; anything rendering base and head side by side must address
   each pane with its own index. `masterBarIndex` is the display number only.
   Tracks are paired on identity (name + instrument + tuning) first, falling
   back to position.
3. **Alignment is score-level; attribution is per track.**
   [ADR 0002](../../docs/adr/0002-alignment-is-score-level-attribution-is-per-track.md).
4. **The diff reports facts; intent is derived.**
   [ADR 0004](../../docs/adr/0004-the-diff-reports-facts-intent-is-derived.md).
5. **The fingerprint is an allowlist with a drift test.** Adding a field to the
   model does not silently change what counts as a changed bar.
   [ADR 0003](../../docs/adr/0003-fingerprint-is-an-allowlist-with-a-drift-test.md).
6. **`ScoreDiff.summary` is read by a musician.** Keep it free of jargon.

## Adding new logic

- New types → `src/types/`
- New algorithms → top-level `src/*.ts`
- Re-export through `src/index.ts`
- Never import from `apps/` — this package must remain a clean dependency leaf
- Never import AlphaTab's renderer; only `importer` and `model`

## Testing

```bash
pnpm nx build @gpt/gpt-core
pnpm nx test @gpt/gpt-core
```

All logic here must be unit-tested. Tests live in `src/**/*.spec.ts`.
Every exported function wants the happy path, the edges (empty, single
element) and the boundaries.

Test naming: **`should <action> when <condition>`**, Given / When / Then inside.

The alignment in `diff.ts` and the merge in `merge.ts` are the critical pair —
a regression in either breaks everything downstream of it.
