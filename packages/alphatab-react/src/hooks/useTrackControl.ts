import { useReducer, useEffect, useCallback } from "react";
import { useAlphaTabContext } from "../context/AlphaTabContext";
import type { Track } from "../types/events";

export interface UseTrackControlResult {
  isMuted: boolean;
  setMuted: (muted: boolean) => void;
  isSolo: boolean;
  setSolo: (solo: boolean) => void;
  /** Track volume as a percentage (0–1). @default 1 */
  volume: number;
  setVolume: (volume: number) => void;
}

type TrackState = { isMuted: boolean; isSolo: boolean; volume: number };
type TrackAction =
  | { type: "setMuted"; value: boolean }
  | { type: "setSolo"; value: boolean }
  | { type: "setVolume"; value: number }
  | { type: "reset" };

const DEFAULT_STATE: TrackState = { isMuted: false, isSolo: false, volume: 1 };

function trackReducer(state: TrackState, action: TrackAction): TrackState {
  switch (action.type) {
    case "setMuted": return { ...state, isMuted: action.value };
    case "setSolo": return { ...state, isSolo: action.value };
    case "setVolume": return { ...state, volume: action.value };
    case "reset": return DEFAULT_STATE;
  }
}

/**
 * Controls playback properties (mute, solo, volume) for a single track.
 *
 * @param trackIndex - Zero-based index of the track within the current score.
 *
 * Must be called inside an <AlphaTab.Root> subtree after a score has loaded.
 * Returns no-op setters when the api or score is not yet available.
 */
export function useTrackControl(trackIndex: number): UseTrackControlResult {
  const { api, score } = useAlphaTabContext();
  const [state, dispatch] = useReducer(trackReducer, DEFAULT_STATE);

  // Reset local state when the score changes (new file loaded).
  useEffect(() => {
    dispatch({ type: "reset" });
  }, [score]);

  const getTrack = useCallback((): Track | undefined => {
    return score?.tracks[trackIndex];
  }, [score, trackIndex]);

  const setMuted = useCallback(
    (muted: boolean) => {
      const track = getTrack();
      if (!api || !track) return;
      api.changeTrackMute([track], muted);
      dispatch({ type: "setMuted", value: muted });
    },
    [api, getTrack],
  );

  const setSolo = useCallback(
    (solo: boolean) => {
      const track = getTrack();
      if (!api || !track) return;
      api.changeTrackSolo([track], solo);
      dispatch({ type: "setSolo", value: solo });
    },
    [api, getTrack],
  );

  const setVolume = useCallback(
    (vol: number) => {
      const track = getTrack();
      if (!api || !track) return;
      api.changeTrackVolume([track], vol);
      dispatch({ type: "setVolume", value: vol });
    },
    [api, getTrack],
  );

  return {
    isMuted: state.isMuted,
    setMuted,
    isSolo: state.isSolo,
    setSolo,
    volume: state.volume,
    setVolume,
  };
}
