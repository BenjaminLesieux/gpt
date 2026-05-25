import { useMemo } from 'react';
import * as alphaTab from '@coderline/alphatab';
import { diffScores } from '@gpt/gpt-core';
import type { ScoreDiff } from '@gpt/gpt-core';
import { useShowFile } from './useGpt';

function parseScore(bytes: Uint8Array): alphaTab.model.Score {
  // AlphaTab calls .subarray() internally, so it needs a true Uint8Array.
  // new Uint8Array(typedArray) always produces a zero-offset copy.
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(bytes));
}

export interface UseDiffScoresResult {
  diff: ScoreDiff | null;
  baseBytes: Uint8Array | undefined;
  headBytes: Uint8Array | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function useDiffScores(
  repoPath: string | null,
  baseHash: string | null,
  headHash: string | null,
  file: string | null,
): UseDiffScoresResult {
  const baseQuery = useShowFile(repoPath, baseHash, file);
  const headQuery = useShowFile(repoPath, headHash, file);

  const isLoading = baseQuery.isLoading || headQuery.isLoading;
  const error = (baseQuery.error ?? headQuery.error) as Error | null;

  const diff = useMemo<ScoreDiff | null>(() => {
    if (!baseQuery.data || !headQuery.data) return null;
    try {
      const baseScore = parseScore(baseQuery.data);
      const headScore = parseScore(headQuery.data);
      return diffScores(baseScore, headScore);
    } catch (e) {
      console.error('[useDiffScores] failed to compute diff:', e);
      return null;
    }
  }, [baseQuery.data, headQuery.data]);

  return {
    diff,
    baseBytes: baseQuery.data,
    headBytes: headQuery.data,
    isLoading,
    error,
  };
}
