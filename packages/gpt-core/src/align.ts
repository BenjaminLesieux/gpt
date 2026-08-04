// Sequence alignment over fingerprints.
//
// Used at two scales: measures across a score, and beats inside a bar. Both ask
// the same question — which item on the left is which item on the right — and
// both are wrong in the same way if answered positionally, where one insertion
// makes everything after it read as changed.

/** A pair is [leftIndex, rightIndex]; null on either side means the item exists in only one sequence. */
export type IndexPair = [number | null, number | null];

/** A pair the LCS matched outright — both sides always present. */
type Anchor = [number, number];

// Guard on the LCS tables (two of them, four bytes a cell) so a pathologically
// long score can't blow up memory. Sized when the LCS ran once per track; the
// single score-level run makes this the whole budget rather than one of N, and
// at the cap the two tables cost 32 MB, transiently. After trimming that is a
// 2000×2000-measure edit window — far beyond any real score. Beyond it the
// middle section falls back to positional pairing — degraded, never wrong.
const MAX_LCS_CELLS = 4_000_000;

/** Pairs off two fingerprint sequences, in reading order. */
export function alignIndexes(left: string[], right: string[]): IndexPair[] {
  // Real edits touch a handful of items, so trimming the untouched head and
  // tail usually shrinks the LCS to a tiny window — and makes the common
  // "nothing changed" case linear.
  let lo = 0;
  while (lo < left.length && lo < right.length && left[lo] === right[lo]) lo++;

  let tail = 0;
  while (
    tail < left.length - lo &&
    tail < right.length - lo &&
    left[left.length - 1 - tail] === right[right.length - 1 - tail]
  ) {
    tail++;
  }

  const pairs: IndexPair[] = [];
  for (let i = 0; i < lo; i++) pairs.push([i, i]);
  pairs.push(
    ...alignMiddle(left, right, lo, left.length - tail, right.length - tail),
  );
  for (let k = tail - 1; k >= 0; k--) {
    pairs.push([left.length - 1 - k, right.length - 1 - k]);
  }
  return pairs;
}

function alignMiddle(
  left: string[],
  right: string[],
  lo: number,
  leftEnd: number,
  rightEnd: number,
): IndexPair[] {
  const n = leftEnd - lo;
  const m = rightEnd - lo;
  if (n <= 0 && m <= 0) return [];

  const pairs: IndexPair[] = [];
  if (n <= 0) {
    for (let h = lo; h < rightEnd; h++) pairs.push([null, h]);
    return pairs;
  }
  if (m <= 0) {
    for (let b = lo; b < leftEnd; b++) pairs.push([b, null]);
    return pairs;
  }

  const anchors =
    n * m <= MAX_LCS_CELLS ? lcsAnchors(left, right, lo, leftEnd, rightEnd) : [];

  // Walk the anchors, filling each gap between them positionally. The trailing
  // sentinel closes the gap after the last anchor.
  const sentinel: Anchor = [leftEnd, rightEnd];
  let b = lo;
  let h = lo;
  for (const [anchorB, anchorH] of [...anchors, sentinel]) {
    const gapB = anchorB - b;
    const gapH = anchorH - h;
    const paired = Math.min(gapB, gapH);
    for (let k = 0; k < paired; k++) pairs.push([b + k, h + k]);
    for (let k = paired; k < gapB; k++) pairs.push([b + k, null]);
    for (let k = paired; k < gapH; k++) pairs.push([null, h + k]);

    if (anchorB < leftEnd) pairs.push([anchorB, anchorH]);
    b = anchorB + 1;
    h = anchorH + 1;
  }
  return pairs;
}

/**
 * Longest common subsequence of fingerprints, as [leftIndex, rightIndex] pairs.
 *
 * Music repeats itself, so a score routinely offers dozens of ways to match the
 * same number of measures — a riff played in measure 12 is byte-identical to the
 * one in measure 92. Length alone does not choose between them, and the
 * arbitrary winner is often one that pairs a measure with a far-away twin, which
 * then reads as a long deletion plus a long insertion instead of an edit in
 * place. So the table carries a second number: among the alignments of maximal
 * length, prefer the one whose matches sit closest to the diagonal.
 */
function lcsAnchors(
  left: string[],
  right: string[],
  lo: number,
  leftEnd: number,
  rightEnd: number,
): Anchor[] {
  const n = leftEnd - lo;
  const m = rightEnd - lo;

  // len[i][j] = LCS length of left[lo+i..] and right[lo+j..]
  // drift[i][j] = smallest total |i-j| over the matches of any such alignment
  const len: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  );
  const drift: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const matches = left[lo + i] === right[lo + j];
      // Taking a match never shortens the LCS, but it can drag the alignment off
      // the diagonal, so it competes with the two skips rather than short-
      // circuiting them.
      let bestLen = len[i + 1]![j]!;
      let bestDrift = drift[i + 1]![j]!;

      const skipRightLen = len[i]![j + 1]!;
      const skipRightDrift = drift[i]![j + 1]!;
      if (better(skipRightLen, skipRightDrift, bestLen, bestDrift)) {
        bestLen = skipRightLen;
        bestDrift = skipRightDrift;
      }

      if (matches) {
        const matchLen = len[i + 1]![j + 1]! + 1;
        const matchDrift = drift[i + 1]![j + 1]! + Math.abs(i - j);
        if (better(matchLen, matchDrift, bestLen, bestDrift)) {
          bestLen = matchLen;
          bestDrift = matchDrift;
        }
      }

      len[i]![j] = bestLen;
      drift[i]![j] = bestDrift;
    }
  }

  // Replay the same choice forwards, collecting the matches it takes.
  const anchors: Anchor[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (
      left[lo + i] === right[lo + j] &&
      len[i]![j] === len[i + 1]![j + 1]! + 1 &&
      drift[i]![j] === drift[i + 1]![j + 1]! + Math.abs(i - j)
    ) {
      anchors.push([lo + i, lo + j]);
      i++;
      j++;
    } else if (
      better(
        len[i + 1]![j]!,
        drift[i + 1]![j]!,
        len[i]![j + 1]!,
        drift[i]![j + 1]!,
      )
    ) {
      i++;
    } else {
      j++;
    }
  }
  return anchors;
}

/** Longer wins; equal length is settled by staying nearer the diagonal. */
function better(
  len: number,
  drift: number,
  bestLen: number,
  bestDrift: number,
): boolean {
  return len > bestLen || (len === bestLen && drift < bestDrift);
}
