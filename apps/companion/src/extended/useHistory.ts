import { useCallback, useEffect, useState } from 'react';
import { listSnapshots, listVersions, onFileSaved, type Version } from '@/lib/ipc';

export interface History {
  /** Named versions, newest first — the official history. */
  versions: Version[];
  /** Auto-snapshots, newest first — recovery material. */
  snapshots: Version[];
  loading: boolean;
  error: string | null;
  reload(): void;
}

const EMPTY: Pick<History, 'versions' | 'snapshots'> = { versions: [], snapshots: [] };

/**
 * Both tiers of history for one tracked file.
 *
 * A Guitar Pro save of the file on screen adds a snapshot underneath the
 * window; the watcher event is what keeps the timeline honest without polling.
 */
export function useHistory(fileId: string | null): History {
  const [entries, setEntries] = useState(EMPTY);
  const [loading, setLoading] = useState(fileId !== null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!fileId) {
      setEntries(EMPTY);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void Promise.all([listVersions(fileId), listSnapshots(fileId)])
      .then(([versions, snapshots]) => {
        if (!cancelled) {
          setEntries({ versions, snapshots });
          setError(null);
        }
      })
      .catch((cause) => !cancelled && setError(String(cause)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fileId, nonce]);

  const reload = useCallback(() => setNonce((current) => current + 1), []);

  useEffect(() => {
    const subscription = onFileSaved((event) => {
      if (event.id === fileId && event.version) reload();
    });
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, [fileId, reload]);

  return { ...entries, loading, error, reload };
}
