import { useReducer, useEffect, useCallback } from "react";
import * as alphaTab from "@coderline/alphatab";
import { useAlphaTabContext } from "../context/AlphaTabContext";
import type { Beat } from "../types/events";

export type PlaybackState = "idle" | "playing" | "paused";

export interface UsePlaybackResult {
  state: PlaybackState;
  currentBeat: Beat | null;
  isReadyForPlayback: boolean;
  play: () => boolean;
  pause: () => void;
  stop: () => void;
  playPause: () => void;
}

type PlaybackData = { state: PlaybackState; currentBeat: Beat | null };
type PlaybackAction =
  | { type: "stateChanged"; payload: alphaTab.synth.PlayerStateChangedEventArgs }
  | { type: "beatChanged"; beat: Beat }
  | { type: "stopped" };

const IDLE_DATA: PlaybackData = { state: "idle", currentBeat: null };

function playbackReducer(_: PlaybackData, action: PlaybackAction): PlaybackData {
  switch (action.type) {
    case "stateChanged":
      if (action.payload.stopped) return IDLE_DATA;
      return {
        state: action.payload.state === alphaTab.synth.PlayerState.Playing ? "playing" : "paused",
        currentBeat: _.currentBeat,
      };
    case "beatChanged":
      return { state: _.state, currentBeat: action.beat };
    case "stopped":
      return IDLE_DATA;
  }
}

export function usePlayback(): UsePlaybackResult {
  const { api, isReadyForPlayback } = useAlphaTabContext();
  const [data, dispatch] = useReducer(playbackReducer, IDLE_DATA);

  useEffect(() => {
    if (!api) {
      dispatch({ type: "stopped" });
      return;
    }

    const onStateChanged = (e: alphaTab.synth.PlayerStateChangedEventArgs) =>
      dispatch({ type: "stateChanged", payload: e });
    const onStop = () => dispatch({ type: "stopped" });
    const onBeat = (beat: Beat) => dispatch({ type: "beatChanged", beat });

    api.playerStateChanged.on(onStateChanged);
    api.playerFinished.on(onStop);
    api.playedBeatChanged.on(onBeat);

    return () => {
      api.playerStateChanged.off(onStateChanged);
      api.playerFinished.off(onStop);
      api.playedBeatChanged.off(onBeat);
    };
  }, [api]);

  const play = useCallback(() => api?.play() ?? false, [api]);
  const pause = useCallback(() => api?.pause(), [api]);
  const stop = useCallback(() => {
    try {
      api?.stop();
    } catch {
      // AlphaTab 1.8.x bug: stop() throws InvalidStateError when the underlying
      // AudioScheduledSourceNode was never started (e.g. play() was called but
      // the AudioContext was still suspended). Reset local state manually.
      dispatch({ type: "stopped" });
    }
  }, [api, dispatch]);
  const playPause = useCallback(() => api?.playPause(), [api]);

  return {
    state: data.state,
    currentBeat: data.currentBeat,
    isReadyForPlayback,
    play,
    pause,
    stop,
    playPause,
  };
}
