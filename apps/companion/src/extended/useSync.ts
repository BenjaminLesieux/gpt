import { useCallback, useEffect, useState } from 'react';
import {
  fetchRemote,
  onPushStatusChanged,
  pullRemote,
  syncState,
  type Pulled,
  type SyncState,
} from '@/lib/ipc';

const UNCONFIGURED: SyncState = { kind: 'unconfigured' };

export interface Sync {
  state: SyncState;
  /** A network call is in flight — the two that block are check and pull. */
  busy: boolean;
  error: string | null;
  /** Asks the remote what it has. Changes nothing about the score. */
  check(): Promise<void>;
  /** `null` when the pull was refused; the reason is in `error`. */
  pull(): Promise<Pulled | null>;
  reload(): void;
  clearError(): void;
}

/**
 * Where a score stands against its remote.
 *
 * The standing is read locally and re-read whenever something could have moved
 * it, so the window is never showing a stale verdict for free. Only `check`
 * and `pull` touch the network, and only because the user asked.
 */
export function useSync(fileId: string | null): Sync {
  const [state, setState] = useState<SyncState>(UNCONFIGURED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const reload = useCallback(() => setReloads((count) => count + 1), []);

  useEffect(() => {
    if (!fileId) {
      setState(UNCONFIGURED);
      return;
    }
    let cancelled = false;
    void syncState(fileId)
      .then((next) => !cancelled && setState(next))
      .catch((cause) => !cancelled && setError(String(cause)));
    return () => {
      cancelled = true;
    };
  }, [fileId, reloads]);

  // A push landing is the usual reason this score stops being ahead, and
  // nobody is waiting on it — without this the count would sit there stale.
  useEffect(() => {
    const subscription = onPushStatusChanged(({ id }) => {
      if (id === fileId) reload();
    });
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, [fileId, reload]);

  const check = useCallback(async () => {
    if (!fileId) return;
    setBusy(true);
    try {
      setState(await fetchRemote(fileId));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }, [fileId]);

  const pull = useCallback(async () => {
    if (!fileId) return null;
    setBusy(true);
    try {
      const pulled = await pullRemote(fileId);
      setState(pulled.state);
      return pulled;
    } catch (cause) {
      // Refused, most likely because the score changed in both places. The
      // host has already left the file alone.
      setError(String(cause));
      reload();
      return null;
    } finally {
      setBusy(false);
    }
  }, [fileId, reload]);

  return {
    state,
    busy,
    error,
    check,
    pull,
    reload,
    clearError: useCallback(() => setError(null), []),
  };
}
