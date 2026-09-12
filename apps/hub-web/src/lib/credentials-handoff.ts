import { useSyncExternalStore } from 'react';
import type { CreatedScore } from './api';

/**
 * The credentials screen is shown once and never again, so the values behind
 * it live in memory and nowhere else — not in the URL, not in the query cache,
 * not in storage. A reload loses them, which is the truth: the server kept no
 * copy either.
 */
let pending: CreatedScore | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function handOff(score: CreatedScore) {
  pending = score;
  emit();
}

export function clearHandoff() {
  pending = null;
  emit();
}

export function usePendingHandoff(): CreatedScore | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
    () => null
  );
}

/** Read without subscribing, for a router guard. */
export function peekHandoff(): CreatedScore | null {
  return pending;
}
