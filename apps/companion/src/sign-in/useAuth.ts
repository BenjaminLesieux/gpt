import { useCallback, useEffect, useState } from 'react';
import { authState, onAuthStateChanged, signIn, signOut, type AuthState } from '@/lib/ipc';

export interface Auth {
  /** `null` until the host has answered. */
  state: AuthState | null;
  /** The sign-in could not even start — the browser did not open. */
  error: string | null;
  /** Opens `hub` in the browser; again, it starts over. */
  signIn(hub: string): void;
  /** Rejects with the host's reason; the state is left as it was. */
  signOut(): Promise<void>;
}

/** Whether the companion is signed in. Both windows gate on it. */
export function useAuth(): Auth {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const subscription = onAuthStateChanged(setState);
    void authState()
      .then((current) => !cancelled && setState(current))
      .catch((cause) => !cancelled && setError(String(cause)));
    return () => {
      cancelled = true;
      void subscription.then((stop) => stop());
    };
  }, []);

  const start = useCallback((hub: string) => {
    setError(null);
    signIn(hub).then(setState, (cause) => setError(String(cause)));
  }, []);

  const stop = useCallback(() => signOut().then(setState), []);

  return { state, error, signIn: start, signOut: stop };
}
