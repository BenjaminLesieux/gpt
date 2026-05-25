import { useReducer, useEffect } from "react";
import type * as alphaTab from "@coderline/alphatab";
import { useAlphaTabContext } from "../context/AlphaTabContext";

export interface UsePlayerPositionResult {
  /** Current playback time in milliseconds. */
  currentTime: number;
  /** Current playback position in MIDI ticks. */
  currentTick: number;
  /** Total song duration in milliseconds. */
  endTime: number;
  /** Total song duration in MIDI ticks. */
  endTick: number;
  /** Playback progress from 0 to 1 (currentTime / endTime). */
  progress: number;
  /** True when the position changed due to a seek rather than normal playback. */
  isSeek: boolean;
}

type PositionState = Omit<UsePlayerPositionResult, "progress">;

const ZERO: PositionState = {
  currentTime: 0,
  currentTick: 0,
  endTime: 0,
  endTick: 0,
  isSeek: false,
};

type PositionAction =
  | { type: "update"; payload: alphaTab.synth.PositionChangedEventArgs }
  | { type: "reset" };

function positionReducer(_: PositionState, action: PositionAction): PositionState {
  if (action.type === "reset") return ZERO;
  const { currentTime, currentTick, endTime, endTick, isSeek } = action.payload;
  return { currentTime, currentTick, endTime, endTick, isSeek };
}

export function usePlayerPosition(): UsePlayerPositionResult {
  const { api } = useAlphaTabContext();
  const [pos, dispatch] = useReducer(positionReducer, ZERO);

  useEffect(() => {
    if (!api) {
      dispatch({ type: "reset" });
      return;
    }

    const onPosition = (e: alphaTab.synth.PositionChangedEventArgs) =>
      dispatch({ type: "update", payload: e });

    api.playerPositionChanged.on(onPosition);

    return () => {
      api.playerPositionChanged.off(onPosition);
    };
  }, [api]);

  const progress = pos.endTime > 0 ? pos.currentTime / pos.endTime : 0;
  return { ...pos, progress };
}
