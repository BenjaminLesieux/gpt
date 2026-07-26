import { importer } from '@coderline/alphatab';
import type { Score } from '@gpt/gpt-core';

/**
 * Parse `.gp` bytes into an alphaTab score — the input for `diffScores`.
 *
 * AlphaTab calls `.subarray()` on what it is given, so the buffer has to be a
 * true zero-offset `Uint8Array`; the IPC layer hands back views over a larger
 * ArrayBuffer, and the copy is what makes them safe.
 */
export function parseScore(bytes: Uint8Array): Score {
  return importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(bytes));
}
