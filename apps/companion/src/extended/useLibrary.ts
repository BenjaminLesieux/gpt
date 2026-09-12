import { useCallback, useEffect, useState } from 'react';
import {
  getActiveFile,
  listTrackedFiles,
  onTrackedFilesChanged,
  pickAndTrackFile,
  type TrackedFile,
} from '@/lib/ipc';

export interface Library {
  files: TrackedFile[];
  /** The file the window is showing; `null` until the first roster arrives. */
  selected: TrackedFile | null;
  loading: boolean;
  error: string | null;
  select(id: string): void;
  addFile(): Promise<void>;
  /**
   * Seats a file the host has just started tracking. The roster event says the
   * same thing a moment later; showing it now is what keeps the window from
   * blanking between the two.
   */
  adopted(file: TrackedFile): void;
  clearError(): void;
}

/**
 * The tracked files, and which one the extended window is looking at.
 *
 * The panel's notion of "active file" only seeds the initial selection: this
 * window is for browsing, so a save landing in another file must not yank the
 * view away from what the user is reading.
 */
export function useLibrary(): Library {
  const [files, setFiles] = useState<TrackedFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listTrackedFiles(), getActiveFile()])
      .then(([roster, active]) => {
        if (cancelled) return;
        setFiles(roster);
        setSelectedId(active?.id ?? roster[0]?.id ?? null);
      })
      .catch((cause) => !cancelled && setError(String(cause)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const subscription = onTrackedFilesChanged((roster) => {
      setFiles(roster);
      setSelectedId((current) =>
        roster.some((file) => file.id === current) ? current : (roster[0]?.id ?? null),
      );
    });
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, []);

  const addFile = useCallback(async () => {
    try {
      const added = await pickAndTrackFile();
      if (added) setSelectedId(added.id);
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  const adopted = useCallback((file: TrackedFile) => {
    setFiles((roster) =>
      roster.some((tracked) => tracked.id === file.id) ? roster : [...roster, file],
    );
    setSelectedId(file.id);
  }, []);

  return {
    files,
    selected: files.find((file) => file.id === selectedId) ?? null,
    loading,
    error,
    select: setSelectedId,
    addFile,
    adopted,
    clearError: useCallback(() => setError(null), []),
  };
}
