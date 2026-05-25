// ── Primitive components — compose for custom layouts ─────────────────────────
export { Root } from "./components/Root";
export type { RootProps, RootEventProps } from "./components/Root";
export { Viewport } from "./components/Viewport";
export type { ViewportProps } from "./components/Viewport";
export { Cursor } from "./components/Cursor";
export type { CursorProps } from "./components/Cursor";

// ── Namespace export — Radix-style composable API ─────────────────────────────
import { Root } from "./components/Root";
import { Viewport } from "./components/Viewport";
import { Cursor } from "./components/Cursor";
export const AlphaTab = { Root, Viewport, Cursor };

// ── Convenience wrapper ────────────────────────────────────────────────────────
export { TabScore } from "./components/TabScore";
export type { TabScoreProps } from "./components/TabScore";

// ── Diff viewer ───────────────────────────────────────────────────────────────
export { TabDiff } from "./components/TabDiff";
export type { TabDiffProps, TabDiffColorConfig, TabDiffBorderConfig } from "./components/TabDiff";

// ── Hooks — must be used inside <AlphaTab.Root> ────────────────────────────────
export { useScore } from "./hooks/useScore";
export type { UseScoreResult } from "./hooks/useScore";

export { useAlphaTabApi } from "./hooks/useAlphaTabApi";
export type { UseAlphaTabApiResult } from "./hooks/useAlphaTabApi";

export { usePlayback } from "./hooks/usePlayback";
export type { UsePlaybackResult, PlaybackState } from "./hooks/usePlayback";

export { usePlayerPosition } from "./hooks/usePlayerPosition";
export type { UsePlayerPositionResult } from "./hooks/usePlayerPosition";

export { usePlayerControls } from "./hooks/usePlayerControls";
export type { UsePlayerControlsResult } from "./hooks/usePlayerControls";

export { useTrackControl } from "./hooks/useTrackControl";
export type { UseTrackControlResult } from "./hooks/useTrackControl";

export { useAutoScroll } from "./hooks/useAutoScroll";

// ── Presets ───────────────────────────────────────────────────────────────────
export { darkTheme, lightTheme } from "./presets/themes";

// ── Context (advanced) ────────────────────────────────────────────────────────
export { AlphaTabContext, useAlphaTabContext, AlphaTabProvider } from "./context/AlphaTabContext";
export type { AlphaTabContextValue } from "./context/AlphaTabContext";

// ── Event arg type aliases (no need to import from @coderline/alphatab) ───────
export type {
  AlphaTabSettings,
  CursorClassNames,
  CursorHandler,
  Score,
  Beat,
  Note,
  Track,
  RenderFinishedEventArgs,
  ResizeEventArgs,
  PlayerStateChangedEventArgs,
  PositionChangedEventArgs,
  ActiveBeatsChangedEventArgs,
  PlaybackRangeChangedEventArgs,
  PlaybackHighlightChangeEventArgs,
  MidiEventsPlayedEventArgs,
  MidiFile,
  ProgressEventArgs,
  PlayerState,
} from "./types/events";
