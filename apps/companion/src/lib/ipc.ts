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

export type PushState = 'unconfigured' | 'idle' | 'pending' | 'failed';

export interface PushStatus {
  state: PushState;
  lastPushedAt: number | null;
  error: string | null;
}

export interface FileSavedEvent {
  id: string;
  path: string;
  /** `null` when the save changed nothing musically. */
  version: Version | null;
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

/** The most recently saved tracked file — what the panel commits by default. */
export function getActiveFile(): Promise<TrackedFile | null> {
  return invoke('get_active_file');
}

/** Manual override for the panel's file switcher. */
export function setActiveFile(id: string): Promise<TrackedFile> {
  return invoke('set_active_file', { id });
}

// ── Versions ─────────────────────────────────────────────────────────────

export function commitNamed(id: string, message: string): Promise<Version> {
  return invoke('commit_named', { id, message });
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

// ── Remote (M5 does the pushing) ─────────────────────────────────────────

/** `null` clears the remote. Secrets go to the keychain, never to `url`. */
export function setRemote(id: string, url: string | null, auth?: RemoteAuth): Promise<void> {
  return invoke('set_remote', { id, url, auth });
}

export function pushStatus(id: string): Promise<PushStatus> {
  return invoke('push_status', { id });
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
