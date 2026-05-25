# Session Notes — Milestones 3.4 → 4.4

Technical discoveries, gotchas, and patterns from implementing playback, diff view, branch switching, and the `<TabDiff>` component.

---

## AlphaTab

### `loadScoreFromBytes` requires a true `Uint8Array`

AlphaTab calls `.subarray()` internally. Passing an `ArrayBuffer` throws:

```
TypeError: this._buffer.subarray is not a function
```

Always wrap with `new Uint8Array(bytes)` — this produces a zero-offset copy with the required method, even when the input already is a `Uint8Array` (guards against offset/detached views):

```ts
alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(bytes))
```

### Bar bounds lookup

After `postRenderFinished` fires, use:

```ts
api.boundsLookup.findMasterBarByIndex(masterBarIndex)
// → MasterBarBounds { visualBounds: { x, y, w, h } }
```

**Not** `api.renderer.boundsLookup` — that path doesn't exist on `AlphaTabApi`.

### Overlay injection pattern

Inject overlay `<div>`s imperatively into the viewport element — same technique AlphaTab uses for its own cursor. Avoids needing `react-dom` in `@gpt/alphatab-react`:

```ts
const container = document.createElement("div");
container.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible;";
viewportEl.appendChild(container);
api.postRenderFinished.on(paint);
// cleanup: viewportEl.removeChild(container)
```

### Auto-scroll during playback

Listen to `api.playedBeatChanged`, then `scrollIntoView` on `.at-cursor-beat` inside the viewport element. The outer `overflow:auto` div in `TabViewer` acts as the scroll ancestor automatically:

```ts
api.playedBeatChanged.on(() => {
  viewportEl.querySelector(".at-cursor-beat")
    ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
});
```

This is built into `<Viewport>` via `useAutoScroll` — no opt-in needed per consumer.

### `optimizeDeps.exclude` for AlphaTab

Both Vite configs (`apps/desktop` and `packages/alphatab-react`) must have:

```ts
optimizeDeps: { exclude: ["@coderline/alphatab"] }
```

Without this, esbuild pre-bundling strips the `import.meta.url` worklet references AlphaTab needs, causing silent render failures.

### `isReadyForPlayback` must reset on new score load

Set `isReadyForPlayback = false` when a new score starts loading. Without this, stale `true` state causes premature `play()` calls on the new score before AlphaTab is ready.

### `stop()` can throw `InvalidStateError`

Wrap in try/catch — AlphaTab 1.8.x has a bug where `stop()` throws when called in certain states. After catching, dispatch `stopped` event manually to reset UI state.

---

## Base UI (`@base-ui-components/react`)

### `data-orientation` vs `data-horizontal:`

Base UI sets `data-orientation="horizontal"` (a **string** attribute). Tailwind's `data-horizontal:` expands to `[data-horizontal]:` which requires a **boolean** `data-horizontal` attribute. These do **not** match — the class is silently ignored.

`data-disabled:` **does** work because Base UI sets `data-disabled=""` (boolean-style empty string).

**Fix for `slider.tsx`:** Use hardcoded height classes, not orientation-conditional ones:

```tsx
// Track
<SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
  // Indicator
  <SliderPrimitive.Indicator className="h-full bg-primary" />
```

---

## Synchronized scroll (diff panes)

Use an `isSyncing` ref to break the mutual scroll-listener loop. Reset via `requestAnimationFrame` (not `setTimeout`) so it clears in the same paint cycle:

```ts
const isSyncing = useRef(false);
const syncFrom = (source: HTMLDivElement, target: HTMLDivElement) => () => {
  if (isSyncing.current) return;
  isSyncing.current = true;
  target.scrollTop  = source.scrollTop;
  target.scrollLeft = source.scrollLeft;
  requestAnimationFrame(() => { isSyncing.current = false; });
};
```

---

## JetBrains-style gutter mini-map

- Fixed 12px-wide strip to the right of the two diff panes.
- Tracks `scrollHeight`, `scrollTop`, `clientHeight` of the head pane via `scroll` listener + `ResizeObserver`.
- `BarOverlays` reports painted pixel rects via `onPainted` callback → stored in state → fed to `DiffGutter`.
- Viewport indicator: `top = scrollTop / scrollHeight`, `height = clientHeight / scrollHeight` — use `transition: top 80ms linear` for smooth tracking.
- Click handler: `ratio = (clientY - gutterTop) / gutterHeight` → `scrollTop = ratio * scrollHeight` on both panes.
- Set `isSyncing.current = true` in `navigateTo` to prevent the scroll event from echoing back.

---

## `ScoreDiff` computation in the desktop

**Do not** try to deserialize `ScoreDiff` from HTTP — it contains live `alphaTab.model.Score` objects which cannot survive JSON round-trips.

Instead, fetch both raw `.gp` blobs via `GET /show/:hash/:file`, then compute client-side:

```ts
const baseScore = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(baseBytes));
const headScore = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(headBytes));
return diffScores(baseScore, headScore);
```

This lives in `apps/desktop/src/hooks/useDiffScores.ts`.

---

## `DiffView` — base vs head ordering

The commit log returns commits newest-first (index 0 = most recent). When two commits are selected:

```ts
// Lower index = more recent = head; higher index = older = base
return iA < iB ? { base: b, head: a } : { base: a, head: b };
```

---

## `gpt branch` / `gpt checkout` CLI pattern

- `branchListData(dir)` — Effect using `GitLayer.listBranches` + `GitLayer.currentBranch` in parallel via `Effect.all`.
- `branchCreateCommand` accepts `name` positional arg; creates then auto-checks out.
- HTTP endpoints added to `serve.ts`: `GET /branch`, `POST /branch`, `POST /checkout`.
- `useCheckout` mutation invalidates `log`, `status`, and `branches` queries on success.

---

## `@gpt/alphatab-react` exports

When adding new components/hooks to `packages/alphatab-react`, always update `src/index.ts`. Forgetting breaks consumers silently (tree-shaking hides the missing export until runtime).

Current named exports added this session:
- `useAutoScroll`
- `TabDiff`
- `TabDiffProps`
- `TabDiffColorConfig`
- `TabDiffBorderConfig`

---

## Electron / Vite

- `electron-vite` 5.0.0 uses the **rolldown** bundler (Vite 8.0.9). Some Rollup plugins are incompatible — prefer Vite-native alternatives.
- `titleBarStyle: "hiddenInset"` on macOS: always render views under `<TitleBar>`. Never use `h-screen` inside a view — use `h-full min-h-0`.
- `@gpt/source` export condition in package.json allows Vite to resolve TypeScript source directly without rebuilding the package in dev.

---

## Zustand store shape additions (Milestone 4)

```ts
// HistorySlice
diffCommitHash: string | null;
setDiffCommit: (hash: string | null) => void;
```

---

---

## Milestone 5.1 — Multi-granularity merge algorithm

### Architecture

```
packages/gpt-core/src/
  fingerprint.ts          — shared: barFingerprint, masterBarFingerprint, beatSnapshot, noteSnapshot
  merge.ts                — mergeScores(base, ours, theirs): MergeResult
  merge.spec.ts           — 37 tests covering every granularity level
  types/merge.ts          — all merge types
  types/diff.ts           — enriched with BarChangedField, album, masterBarChanges
  diff.ts                 — enriched: changedFields on "changed" BarDiff, masterBar diff in MetaDiff
```

### `MergeCell<T>` — the core abstraction

Every scalar field at every level is wrapped in one type:
```ts
type MergeCell<T> = Resolved<T> | Conflicted<T>;
// Resolved<T>:  { status: "resolved"; value: T }
// Conflicted<T>: { status: "conflict"; base: T; ours: T; theirs: T }
```

Adding a new mergeable field is one line: `field: cell(base.field, ours.field, theirs.field)`.

### Granularity hierarchy (finest → coarsest)

1. **Note fields** — fret, isDead, isGhost, isStaccato, isHammerPullOrigin, isLeftHandTapped, bendType, bendStyle, isContinuedBend, harmonicType, harmonicValue, slideInType, slideOutType, vibrato, isLetRing, isPalmMute, accentuated, dynamics, trillValue, trillSpeed, leftHandFinger, rightHandFinger, durationPercent
2. **Beat fields** — duration, dots, tupletNumerator, tupletDenominator, isLetRing, isPalmMute, isLegatoOrigin, fade, ottava, pop, slap, tap, brushType, brushDuration, text
3. **Structural note conflicts** — one side removes a note the other keeps/changes (flagged separately)
4. **Structural beat conflicts** — both sides changed voice beat count differently (whole voice can't be merged positionally)
5. **Bar-level** — fingerprint comparison determines status: equal / auto-resolved (ours|theirs|both-same) / conflict
6. **MasterBar fields** — timeSignatureNumerator, timeSignatureDenominator, timeSignatureCommon, isFreeTime, tripletFeel, isAnacrusis, isDoubleBar, isRepeatStart, repeatCount, alternateEndings
7. **Score meta** — title, artist, album, tempo

### 3-way resolution rule (applies at every level)

```
cell(base, ours, theirs):
  ours == theirs           → resolved(ours)        — same on both sides
  base == ours             → resolved(theirs)       — only theirs changed
  base == theirs           → resolved(ours)         — only ours changed
  all differ               → conflict(base, ours, theirs)
```

Boolean fields CANNOT produce 3-way conflicts (only 2 states exist). Only numeric/string fields can.

### "Both-added" edge case

When both sides add a note at the same string (no base note), use `newField(ours, theirs)` not `cell()`:
```ts
function newField<T>(ours: T, theirs: T): MergeCell<T> {
  if (ours === theirs) return { status: "resolved", value: ours };
  // No ancestor: ours appears as "base" for UI reference
  return { status: "conflict", base: ours, ours, theirs };
}
```
Do NOT use `cell(ours, ours, theirs)` — that accidentally auto-resolves to theirs.

### `diff.ts` enrichments

- `BarDiff.changed` now includes `changedFields: BarChangedField[]` — categories: `"notes"`, `"beats"`, `"articulation"`, `"dynamics"`.
- `MetaDiff` now includes `album?: [string, string]` and `masterBarChanges?: number[]` (indexes of master bars with changed time sig, repeats, etc.)
- `fingerprint.ts` is shared between diff and merge — both use the same snapshot functions.
- `diff.ts` does NOT provide note-level detail in its output (bar-level is right for visualization). `merge.ts` provides note-level detail (needed for conflict resolution).

### `ConflictLocation.path` format

```
meta.tempo
masterBar[2].timeSignatureNumerator
track[0].bar[4].voice[0].beat[2].note[s=3].fret
track[0].bar[4].voice[0].beat[2].structuralNote[s=3]
track[0].bar[4].voice[0].structuralBeats
```

---

## Files created / significantly modified this session

| File | What changed |
|---|---|
| `packages/alphatab-react/src/hooks/useAutoScroll.ts` | New — auto-scroll to cursor during playback |
| `packages/alphatab-react/src/components/Viewport.tsx` | Added `useAutoScroll()` call |
| `packages/alphatab-react/src/components/TabDiff.tsx` | New — full diff viewer with overlays, sync scroll, gutter |
| `packages/alphatab-react/src/index.ts` | New exports |
| `apps/desktop/src/components/ui/slider.tsx` | Fixed invisible track/fill (Base UI orientation attribute) |
| `apps/desktop/src/hooks/useDiffScores.ts` | New — client-side diff computation |
| `apps/desktop/src/features/history/DiffView.tsx` | New — diff view screen |
| `apps/desktop/src/views/HistoryView.tsx` | Wired DiffView, diffPair resolution |
| `apps/desktop/src/store/index.ts` | Added `diffCommitHash` / `setDiffCommit` |
| `apps/desktop/src/components/history/CommitRow.tsx` | Added compare button |
| `apps/desktop/src/features/history/HistoryBrowser.tsx` | Wired compare actions |
| `apps/desktop/src/components/chrome/BranchSwitcher.tsx` | New — branch popover |
| `apps/desktop/src/views/RepoShell.tsx` | Replaced static branch label with `<BranchSwitcher>` |
| `apps/cli/src/commands/branch.ts` | New — branch/checkout CLI commands |
| `apps/cli/src/commands/serve.ts` | Added `/branch`, `/checkout` HTTP endpoints |
| `apps/cli/src/main.ts` | Registered branch + checkout subcommands |
| `apps/desktop/src/api/client.ts` | Added `branches`, `createBranch`, `checkout` |
| `apps/desktop/src/hooks/useGpt.ts` | Added `useBranches`, `useCheckout`, `useCreateBranch` |
