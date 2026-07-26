import { useEffect, type RefObject } from 'react';

/** Only `panel-*` keyframes replay; transitions and spinners are left alone. */
const PREFIX = 'panel-';

/**
 * Replays the panel's entry animation whenever `token` changes.
 *
 * The webview is never remounted — showing the panel is a window operation, so
 * CSS animations would only ever run once, at startup, behind a hidden window.
 */
export function useEnterAnimation(ref: RefObject<HTMLElement | null>, token: number) {
  useEffect(() => {
    const node = ref.current;
    if (!node?.getAnimations || typeof CSSAnimation === 'undefined') return;

    for (const animation of node.getAnimations({ subtree: true })) {
      if (animation instanceof CSSAnimation && animation.animationName.startsWith(PREFIX)) {
        animation.cancel();
        animation.play();
      }
    }
  }, [ref, token]);
}
