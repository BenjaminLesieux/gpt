import { useReducer, useEffect, useCallback } from "react";
import { useAlphaTabContext } from "../context/AlphaTabContext";

export interface UsePlayerControlsResult {
  /** Master volume as a percentage (0–1). @default 1 */
  masterVolume: number;
  setMasterVolume: (volume: number) => void;
  /** Playback speed as a percentage (0.1–8). @default 1 */
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  /** Whether playback loops back to the start when finished. @default false */
  isLooping: boolean;
  setIsLooping: (loop: boolean) => void;
  /** Metronome volume (0–1). Set > 0 to enable the metronome. @default 0 */
  metronomeVolume: number;
  setMetronomeVolume: (volume: number) => void;
  /** Count-in metronome volume (0–1). Set > 0 to enable. @default 0 */
  countInVolume: number;
  setCountInVolume: (volume: number) => void;
}

type ControlsState = {
  masterVolume: number;
  playbackSpeed: number;
  isLooping: boolean;
  metronomeVolume: number;
  countInVolume: number;
};

type ControlsAction =
  | { type: "sync"; value: ControlsState }
  | { type: "setMasterVolume"; value: number }
  | { type: "setPlaybackSpeed"; value: number }
  | { type: "setIsLooping"; value: boolean }
  | { type: "setMetronomeVolume"; value: number }
  | { type: "setCountInVolume"; value: number };

const DEFAULT: ControlsState = {
  masterVolume: 1,
  playbackSpeed: 1,
  isLooping: false,
  metronomeVolume: 0,
  countInVolume: 0,
};

function controlsReducer(state: ControlsState, action: ControlsAction): ControlsState {
  switch (action.type) {
    case "sync": return action.value;
    case "setMasterVolume": return { ...state, masterVolume: action.value };
    case "setPlaybackSpeed": return { ...state, playbackSpeed: action.value };
    case "setIsLooping": return { ...state, isLooping: action.value };
    case "setMetronomeVolume": return { ...state, metronomeVolume: action.value };
    case "setCountInVolume": return { ...state, countInVolume: action.value };
  }
}

export function usePlayerControls(): UsePlayerControlsResult {
  const { api } = useAlphaTabContext();
  const [controls, dispatch] = useReducer(controlsReducer, DEFAULT);

  // Sync all values atomically when the api instance changes.
  useEffect(() => {
    if (!api) return;
    dispatch({
      type: "sync",
      value: {
        masterVolume: api.masterVolume,
        playbackSpeed: api.playbackSpeed,
        isLooping: api.isLooping,
        metronomeVolume: api.metronomeVolume,
        countInVolume: api.countInVolume,
      },
    });
  }, [api]);

  const setMasterVolume = useCallback(
    (volume: number) => {
      if (!api) return;
      api.masterVolume = volume;
      dispatch({ type: "setMasterVolume", value: volume });
    },
    [api],
  );

  const setPlaybackSpeed = useCallback(
    (speed: number) => {
      if (!api) return;
      api.playbackSpeed = speed;
      dispatch({ type: "setPlaybackSpeed", value: speed });
    },
    [api],
  );

  const setIsLooping = useCallback(
    (loop: boolean) => {
      if (!api) return;
      api.isLooping = loop;
      dispatch({ type: "setIsLooping", value: loop });
    },
    [api],
  );

  const setMetronomeVolume = useCallback(
    (volume: number) => {
      if (!api) return;
      api.metronomeVolume = volume;
      dispatch({ type: "setMetronomeVolume", value: volume });
    },
    [api],
  );

  const setCountInVolume = useCallback(
    (volume: number) => {
      if (!api) return;
      api.countInVolume = volume;
      dispatch({ type: "setCountInVolume", value: volume });
    },
    [api],
  );

  return {
    ...controls,
    setMasterVolume,
    setPlaybackSpeed,
    setIsLooping,
    setMetronomeVolume,
    setCountInVolume,
  };
}
