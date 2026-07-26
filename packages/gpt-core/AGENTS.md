# @gpt/gpt-core

## Purpose

The shared algorithmic core of GPT. Contains:
- **Canonical types** — the language-agnostic representation of a Guitar Pro score
- **Serializer** — converts a `CanonicalScore` to/from deterministic JSON
- **Diff engine** — structural diff between two `CanonicalScore` objects
- **Merge engine** — 3-way merge logic (to be added in Milestone 3)

This package has **zero runtime dependencies** (no Effect, no AlphaTab, no Node APIs). It is pure TypeScript computation, importable in any environment: Node.js CLI, Electron renderer, web, tests.

## Public API

```typescript
// Types
import type { CanonicalScore, CanonicalTrack, CanonicalMeasure } from "@gpt/gpt-core";
import type { ScoreDiff, TrackDiff, MeasureDiff } from "@gpt/gpt-core";
import type { Commit, Branch, RepoStatus } from "@gpt/gpt-core";

// Functions
import { serialize, deserialize } from "@gpt/gpt-core";   // CanonicalScore ↔ JSON string
import { diffScores } from "@gpt/gpt-core";                // (base, head) → ScoreDiff
```

## Source layout

```
src/
  types/
    score.ts     — CanonicalScore tree (Score → Track → Measure → Beat → Note)
    diff.ts      — ScoreDiff, TrackDiff, MeasureDiff, BeatHunk
    commit.ts    — Commit, Branch, RepoStatus (used by CLI and desktop)
  serializer.ts  — normalize + JSON round-trip
  diff.ts        — structural diff algorithm
  index.ts       — public re-exports
```

## Key invariants

1. **`serialize` is deterministic.** Given the same logical score, it always produces the same string, regardless of input ordering. This is what makes diffing reliable.
2. **Diff never mutates inputs.** Both `base` and `head` are treated as immutable.
3. **Measures are aligned by content, not by index.** `diffScores` runs an LCS over bar fingerprints, so inserting or deleting a measure reports one added/removed bar instead of marking every later measure as changed. Consequently a `BarDiff` carries **two** positions — `baseIndex` and `headIndex` — which diverge after any structural edit; anything rendering base and head side by side must address each pane with its own index. `masterBarIndex` is the display measure number only. Tracks are paired the same way: on identity (name + instrument + tuning) first, falling back to position.
4. **`ScoreDiff.summary` is human-readable.** It is shown directly in the desktop UI and CLI output. Keep it musician-friendly (no technical jargon).

## Adding new logic

- New types → `src/types/`
- New algorithms (merge, rebase) → top-level `src/*.ts` files
- Re-export everything through `src/index.ts`
- Never import from `apps/` — this package must remain a clean dependency leaf

## Testing

Build and test:
```bash
pnpm nx build @gpt/gpt-core
pnpm nx test @gpt/gpt-core
```

All logic in this package must be unit-tested. Tests live in `src/**/*.spec.ts`.
Coverage requirement: every exported function must have tests for the happy path, edge cases (empty arrays, single element), and error/boundary conditions.

Test naming: **`should <action> when <condition>`**
Structure: Given / When / Then inside each test.

The serializer and diff algorithm are the most critical — any regression there breaks the entire diff/merge pipeline.
