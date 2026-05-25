import { useAlphaTabContext } from "../context/AlphaTabContext";
import type { Score } from "../types/events";

export interface UseScoreResult {
  score: Score | null;
  isLoading: boolean;
  error: Error | null;
}

/** Reactive score state. Must be called inside an <AlphaTab.Root>. */
export function useScore(): UseScoreResult {
  const { score, isLoading, error } = useAlphaTabContext();
  return { score, isLoading, error };
}
