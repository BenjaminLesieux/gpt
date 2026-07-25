import { invoke } from '@tauri-apps/api/core';

/**
 * Typed wrappers over the Rust commands.
 *
 * Everything the webview asks of the host goes through this module — no bare
 * `invoke` calls in components. The domain commands (tracked files, versions,
 * snapshots…) land here in M2; M1 only ships the window plumbing.
 */

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
