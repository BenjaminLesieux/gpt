import { useCallback, useState } from "react";
import { useAlphaTabContext } from "../context/AlphaTabContext";
import { usePlayerPosition } from "./usePlayerPosition";

export interface UseSeekResult {
  /** Position from 0 to 100. */
  value: number;
  onValueChange: (value: number | readonly number[]) => void;
  onValueCommitted: (value: number | readonly number[]) => void;
  disabled: boolean;
}

function toScalar(value: number | readonly number[]): number {
  return typeof value === "number" ? value : (value[0] ?? 0);
}

/**
 * A playback position for a 0–100 slider. While dragging, the value follows
 * the pointer rather than the player, so position events do not fight the drag;
 * the player seeks on commit. Must be called inside an <AlphaTab.Root>.
 */
export function useSeek(): UseSeekResult {
  const { api, isReadyForPlayback } = useAlphaTabContext();
  const { endTime, progress } = usePlayerPosition();
  const [scrub, setScrub] = useState<number | null>(null);

  const onValueChange = useCallback(
    (value: number | readonly number[]) => setScrub(toScalar(value)),
    [],
  );

  const onValueCommitted = useCallback(
    (value: number | readonly number[]) => {
      setScrub(null);
      if (api && endTime > 0) api.timePosition = (toScalar(value) / 100) * endTime;
    },
    [api, endTime],
  );

  return {
    value: scrub ?? progress * 100,
    onValueChange,
    onValueCommitted,
    disabled: !isReadyForPlayback || endTime === 0,
  };
}
