import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  commitNamed,
  getActiveFile,
  guitarProBinding,
  hasPendingChange,
  listSnapshots,
  listTrackedFiles,
  listVersions,
  onFileSaved,
  onTrackedFilesChanged,
  pickAndTrackFile,
  setActiveFile,
  type Binding,
  type TrackedFile,
  type Version,
} from '@/lib/ipc';

/** All the panel has room for; the extended window owns the full timeline. */
const RECENT_VERSIONS = 5;

interface Roster {
  files: TrackedFile[];
  active: TrackedFile | null;
  binding: Binding;
}

interface Ledger {
  versions: Version[];
  snapshots: Version[];
  pendingChange: boolean | null;
}

export interface PanelSession {
  files: TrackedFile[];
  active: TrackedFile | null;
  /** What the active file is anchored to — see {@link Binding}. */
  binding: Binding;
  /** Newest first, capped at what the panel can show. */
  versions: Version[];
  /** Auto-snapshots taken since the newest named version. */
  unnamedSaves: number;
  /**
   * Whether the active file holds a save its newest named version doesn't.
   * `false` means a commit would be refused; `null` means the host couldn't
   * say, and the refusal (if any) will come from the commit itself.
   */
  pendingChange: boolean | null;
  /** Newest recorded change of the active file, unix seconds. */
  lastChangeAt: number | null;
  error: string | null;
  reportError(message: string): void;
  clearError(): void;
  select(id: string): Promise<void>;
  addFile(): Promise<void>;
  commit(id: string, message: string): Promise<Version>;
}

const EMPTY_ROSTER: Roster = { files: [], active: null, binding: { kind: 'idle' } };
const EMPTY_LEDGER: Ledger = { versions: [], snapshots: [], pendingChange: null };

/**
 * Everything the panel knows, and the only place that talks to the host.
 *
 * `shownAt` re-reads state each time the panel comes to the front: it can be
 * hidden for hours while Guitar Pro saves keep landing, and the host resolves
 * which score is open on the way to showing the panel.
 */
export function usePanelSession(shownAt: number): PanelSession {
  const [roster, setRoster] = useState<Roster>(EMPTY_ROSTER);
  const [ledger, setLedger] = useState<Ledger>(EMPTY_LEDGER);
  const [error, setError] = useState<string | null>(null);
  // Bumped when the active file's history moves under us.
  const [ledgerNonce, setLedgerNonce] = useState(0);

  const activeId = roster.active?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listTrackedFiles(), getActiveFile(), guitarProBinding()])
      .then(([files, active, binding]) => {
        if (!cancelled) setRoster({ files, active: active ?? files[0] ?? null, binding });
      })
      .catch((cause) => !cancelled && setError(String(cause)));
    return () => {
      cancelled = true;
    };
  }, [shownAt]);

  useEffect(() => {
    if (!activeId) {
      setLedger(EMPTY_LEDGER);
      return;
    }
    let cancelled = false;
    void Promise.all([
      listVersions(activeId, RECENT_VERSIONS),
      listSnapshots(activeId),
      // Reading the score off disk can fail on its own; that must not cost the
      // panel its history. The commit is guarded host-side either way.
      hasPendingChange(activeId).catch(() => null),
    ])
      .then(([versions, snapshots, pendingChange]) => {
        if (!cancelled) setLedger({ versions, snapshots, pendingChange });
      })
      .catch((cause) => !cancelled && setError(String(cause)));
    return () => {
      cancelled = true;
    };
  }, [activeId, shownAt, ledgerNonce]);

  // The watcher fires whether or not the panel is open — a save while it is
  // visible has to move the active file and the history with it.
  useEffect(() => {
    const subscription = onFileSaved(({ id }) => {
      setRoster((current) => ({
        ...current,
        active: current.files.find((file) => file.id === id) ?? current.active,
      }));
      setLedgerNonce((nonce) => nonce + 1);
    });
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const subscription = onTrackedFilesChanged((files) => {
      setRoster((current) => ({
        ...current,
        files,
        active: files.find((file) => file.id === current.active?.id) ?? files[0] ?? null,
      }));
    });
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, []);

  const select = useCallback(async (id: string) => {
    try {
      const active = await setActiveFile(id);
      setRoster((current) => ({ ...current, active }));
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  // The host emits `tracked-files-changed`, which fills in the roster; this
  // only has to point the panel at what was just added.
  const addFile = useCallback(async () => {
    try {
      const added = await pickAndTrackFile();
      if (added) setRoster((current) => ({ ...current, active: added }));
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  const commit = useCallback(async (id: string, message: string) => {
    const version = await commitNamed(id, message);
    setLedgerNonce((nonce) => nonce + 1);
    return version;
  }, []);

  const { unnamedSaves, lastChangeAt } = useMemo(() => {
    const newestNamed = ledger.versions[0]?.timestamp ?? 0;
    const newestSnapshot = ledger.snapshots[0]?.timestamp ?? 0;
    return {
      unnamedSaves: ledger.snapshots.filter((snapshot) => snapshot.timestamp > newestNamed).length,
      lastChangeAt: Math.max(newestNamed, newestSnapshot) || null,
    };
  }, [ledger]);

  const clearError = useCallback(() => setError(null), []);

  return {
    files: roster.files,
    active: roster.active,
    binding: roster.binding,
    versions: ledger.versions,
    unnamedSaves,
    pendingChange: ledger.pendingChange,
    lastChangeAt,
    error,
    reportError: setError,
    clearError,
    select,
    addFile,
    commit,
  };
}
