import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * Typed wrappers over the Rust commands — the only place that calls `invoke`.
 */

export type VersionKind = 'named' | 'snapshot';

export interface Version {
  id: string;
  /** Empty for auto-snapshots: only named versions carry a message. */
  message: string;
  /** Unix seconds. */
  timestamp: number;
  kind: VersionKind;
}

export type RemoteAuth =
  | { kind: 'none' }
  | { kind: 'token'; username: string }
  | { kind: 'ssh'; keyPath: string };

export interface Remote {
  url: string;
  auth: RemoteAuth;
}

export interface TrackedFile {
  id: string;
  path: string;
  name: string;
  /** Unix seconds. */
  addedAt: number;
  remote?: Remote;
}

/**
 * `pending` covers both "queued" and "being retried" — from the outside they
 * are the same thing, a push still on its way. `failed` means the host has
 * stopped trying and a person has to intervene; a plain network failure never
 * reaches it, because retrying that eventually works.
 */
export type PushState = 'unconfigured' | 'idle' | 'pending' | 'failed';

export interface PushStatus {
  state: PushState;
  /** Unix seconds. */
  lastPushedAt: number | null;
  error: string | null;
}

/**
 * How a score stands against its remote, counted in named versions.
 *
 * `diverged` is a destination, not a waypoint: v1 has no merge, so a score
 * edited in two places is something the user has to resolve, and the UI must
 * say so rather than offering a button that cannot work.
 */
export type SyncState =
  | { kind: 'unconfigured' }
  | { kind: 'upToDate' }
  | { kind: 'behind'; versions: number }
  | { kind: 'ahead'; versions: number }
  | { kind: 'diverged'; ahead: number; behind: number };

export interface Pulled {
  /** Where the score stands now that the pull is done. */
  state: SyncState;
  /** The version now in the file; `null` when there was nothing to take. */
  version: Version | null;
  /** What was on disk beforehand, when it was worth keeping. */
  safety: Version | null;
}

/**
 * What the active file is anchored to.
 *
 * Guitar Pro leaves `AXDocument` empty, so the host only ever learns the score's
 * *name* from its window — `unmatched` covers both "we don't track it" and
 * "two tracked files answer to that name".
 */
export type Binding =
  | { kind: 'guitarPro' }
  | { kind: 'unmatched'; name: string }
  | { kind: 'blind' }
  | { kind: 'idle' };

export interface FileSavedEvent {
  id: string;
  path: string;
  /** `null` when the save changed nothing musically. */
  version: Version | null;
}

export interface PushStatusChangedEvent {
  id: string;
  status: PushStatus;
}

// ── Windows ──────────────────────────────────────────────────────────────

/** Show the panel if hidden, hide it if visible. */
export function togglePanel(): Promise<void> {
  return invoke('toggle_panel');
}

/** Dismiss the panel (Escape, or after a commit). */
export function hidePanel(): Promise<void> {
  return invoke('hide_panel');
}

/** Create the extended window on first call, focus it afterwards. */
export function openExtendedWindow(): Promise<void> {
  return invoke('open_extended_window');
}

// ── Tracked files ────────────────────────────────────────────────────────

export function listTrackedFiles(): Promise<TrackedFile[]> {
  return invoke('list_tracked_files');
}

/** Rejects if the path is already tracked or isn't a Guitar Pro file. */
export function trackFile(path: string): Promise<TrackedFile> {
  return invoke('track_file', { path });
}

/**
 * Opens the native picker. Resolves with `null` when the user cancels — the
 * host holds the panel open for the duration of the dialog.
 */
export function pickAndTrackFile(): Promise<TrackedFile | null> {
  return invoke('pick_and_track_file');
}

/** Keeps the history: re-tracking the same file finds it again. */
export function untrackFile(id: string): Promise<void> {
  return invoke('untrack_file', { id });
}

/** The file the panel commits: the score Guitar Pro has open where the host can
 * see it, the most recently saved tracked file otherwise. */
export function getActiveFile(): Promise<TrackedFile | null> {
  return invoke('get_active_file');
}

/** Manual override for the panel's file switcher. */
export function setActiveFile(id: string): Promise<TrackedFile> {
  return invoke('set_active_file', { id });
}

/** Resolved by the host as the panel is shown, so this is a cheap read. */
export function guitarProBinding(): Promise<Binding> {
  return invoke('guitar_pro_binding');
}

/** Puts up the macOS accessibility prompt and opens the pane that grants it. */
export function requestAccessibility(): Promise<void> {
  return invoke('request_accessibility');
}

// ── Versions ─────────────────────────────────────────────────────────────

/** Rejects when the file on disk is already its newest named version — a name
 * has to be given to a save that actually happened. */
export function commitNamed(id: string, message: string): Promise<Version> {
  return invoke('commit_named', { id, message });
}

/** What {@link commitNamed} would decide, without committing anything. */
export function hasPendingChange(id: string): Promise<boolean> {
  return invoke('has_pending_change', { id });
}

export function listVersions(id: string, limit?: number): Promise<Version[]> {
  return invoke('list_versions', { id, limit });
}

export function listSnapshots(id: string, limit?: number): Promise<Version[]> {
  return invoke('list_snapshots', { id, limit });
}

/** `rev` is a version id from {@link listVersions} / {@link listSnapshots}. */
export async function getVersionBlob(id: string, rev: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>('get_version_blob', { id, rev }));
}

/** Resolves with the safety snapshot taken before overwriting, if any. */
export function restoreVersion(id: string, rev: string): Promise<Version | null> {
  return invoke('restore_version', { id, rev });
}

// ── Remote ───────────────────────────────────────────────────────────────

/**
 * `url: null` clears the remote and its token together.
 *
 * The token goes straight to the keychain — never into `url`, and never into
 * `config.json`. Omitting it while setting a URL keeps whatever is already
 * stored, so the URL can be corrected without retyping the secret.
 */
export function setRemote(
  id: string,
  url: string | null,
  auth?: RemoteAuth,
  token?: string,
): Promise<void> {
  return invoke('set_remote', { id, url, auth, token });
}

export function pushStatus(id: string): Promise<PushStatus> {
  return invoke('push_status', { id });
}

/** Local, as of the last fetch — cheap enough to call on every repaint. */
export function syncState(id: string): Promise<SyncState> {
  return invoke('sync_state', { id });
}

/**
 * Asks the remote what it holds and answers with the fresh verdict. Waits on
 * the network, so it belongs behind a spinner. Writes nothing to the score.
 */
export function fetchRemote(id: string): Promise<SyncState> {
  return invoke('fetch_remote', { id });
}

/**
 * Fetches, then takes the newest remote version into the score on disk when
 * it builds on what we already have.
 *
 * Rejects when the score changed in both places: v1 has no merge, so that is
 * for a person to sort out. Whatever was on disk is snapshotted first, and
 * comes back as `safety` if it was worth keeping.
 */
export function pullRemote(id: string): Promise<Pulled> {
  return invoke('pull_remote', { id });
}

// ── Events ───────────────────────────────────────────────────────────────

/** Fires after every Guitar Pro save of a tracked file, debounced. */
export function onFileSaved(handler: (event: FileSavedEvent) => void): Promise<UnlistenFn> {
  return listen<FileSavedEvent>('file-saved', ({ payload }) => handler(payload));
}

export function onTrackedFilesChanged(
  handler: (files: TrackedFile[]) => void,
): Promise<UnlistenFn> {
  return listen<TrackedFile[]>('tracked-files-changed', ({ payload }) => handler(payload));
}

/**
 * Fires after every push attempt. Pushes happen on a background thread and
 * nobody is waiting on them, so polling `pushStatus` would mean either a timer
 * or a stale badge.
 */
export function onPushStatusChanged(
  handler: (event: PushStatusChangedEvent) => void,
): Promise<UnlistenFn> {
  return listen<PushStatusChangedEvent>('push-status-changed', ({ payload }) => handler(payload));
}
