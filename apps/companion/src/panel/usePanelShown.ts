import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * A token that changes every time the panel comes to the front.
 *
 * The panel's webview is created once at startup and only ever shown and
 * hidden, so there is no mount to hang "the panel just opened" work off.
 * Focus is that signal: reloading state, refocusing the message input and
 * replaying the entry animation all key off this.
 */
export function usePanelShown(): number {
  const [shownAt, setShownAt] = useState(() => Date.now());

  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) setShownAt(Date.now());
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  return shownAt;
}
