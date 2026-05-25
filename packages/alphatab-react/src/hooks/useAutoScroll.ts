import { useEffect } from "react";
import { useAlphaTabContext } from "../context/AlphaTabContext";

/**
 * Scrolls the nearest scrollable ancestor so the active beat cursor stays
 * visible during playback. Fires on every `playedBeatChanged` event.
 */
export function useAutoScroll(): void {
  const { api, viewportEl } = useAlphaTabContext();

  useEffect(() => {
    if (!api || !viewportEl) return;

    const onBeatChanged = () => {
      const cursor = viewportEl.querySelector(".at-cursor-beat");
      if (!cursor) return;
      cursor.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    };

    api.playedBeatChanged.on(onBeatChanged);
    return () => {
      api.playedBeatChanged.off(onBeatChanged);
    };
  }, [api, viewportEl]);
}
