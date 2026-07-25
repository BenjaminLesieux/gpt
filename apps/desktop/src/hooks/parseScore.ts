import * as alphaTab from '@coderline/alphatab';

// AlphaTab calls .subarray() internally, so it needs a true Uint8Array.
// new Uint8Array(typedArray) always produces a zero-offset copy.
export function parseScore(bytes: Uint8Array): alphaTab.model.Score {
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(bytes));
}
