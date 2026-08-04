import type { MeasureDiff } from './types/diff';

// ── Row alignment ─────────────────────────────────────────────────────────────
//
// Side by side, each pane left to itself breaks its rows where its own content
// happens to fit, so the same measure lands on different rows on the two sides
// and the reader has to hunt for the counterpart of what they are looking at.
//
// The fix is to stop letting the panes choose: derive one row plan from the
// measure alignment and hand each pane its own projection of it. Row k holds
// the same aligned measures on both sides, so measure 99 faces measure 99. The
// two rows can hold different numbers of bars — that is exactly what an
// insertion looks like — but there is always a row k on both sides.

/**
 * Bars per row for each pane, index-aligned: entry k of `base` and entry k of
 * `head` describe the same row. Both arrays always have the same length.
 */
export interface AlignedSystems {
  base: number[];
  head: number[];
}

/** Guitar Pro's own default when a file carries no layout of its own. */
export const DEFAULT_BARS_PER_ROW = 4;

export function alignedSystems(
  measures: MeasureDiff[],
  barsPerRow: number = DEFAULT_BARS_PER_ROW,
): AlignedSystems {
  const target = Math.max(1, Math.floor(barsPerRow));
  const base: number[] = [];
  const head: number[] = [];
  let b = 0;
  let h = 0;

  const closeRow = () => {
    base.push(b);
    head.push(h);
    b = 0;
    h = 0;
  };

  for (const measure of measures) {
    if (measure.baseIndex !== null) b++;
    if (measure.headIndex !== null) h++;
    // A row closes only once both panes have something to put in it. A row of
    // zero bars is not something alphaTab can draw, and skipping it on one side
    // would slide every later row out of step with its counterpart — so a run
    // of inserted measures widens the head row instead of starting a new one.
    if (b > 0 && h > 0 && Math.max(b, h) >= target) closeRow();
  }

  if (b > 0 && h > 0) {
    closeRow();
  } else if (b > 0 || h > 0) {
    // A trailing run only one pane has cannot stand as its own row; it joins
    // the row before it. With no row before it there is nothing to align to —
    // one of the scores is entirely absent — so both panes fall back to their
    // own layout.
    if (base.length === 0) return { base: [], head: [] };
    base[base.length - 1] += b;
    head[head.length - 1] += h;
  }

  return { base, head };
}
