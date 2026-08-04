import {
  useRef,
  useState,
  useReducer,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import * as alphaTab from "@coderline/alphatab";
import { AlphaTabContext } from "../context/AlphaTabContext";
import type {
  AlphaTabSettings,
  Score,
  Beat,
  Note,
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
} from "../types/events";

// ─── Event prop types ─────────────────────────────────────────────────────────

export interface RootEventProps {
  // ── Rendering ──────────────────────────────────────────────────────
  onRenderStarted?: (isResize: boolean) => void;
  onRenderFinished?: (result: RenderFinishedEventArgs) => void;
  onPostRenderFinished?: () => void;
  onResize?: (e: ResizeEventArgs) => void;
  onSettingsUpdated?: () => void;

  // ── Score ───────────────────────────────────────────────────────────
  onScoreLoaded?: (score: Score) => void;
  onError?: (error: Error) => void;

  // ── Beat / Note interaction ─────────────────────────────────────────
  onBeatMouseDown?: (beat: Beat) => void;
  onBeatMouseMove?: (beat: Beat) => void;
  onBeatMouseUp?: (beat: Beat | null) => void;
  onNoteMouseDown?: (note: Note) => void;
  onNoteMouseMove?: (note: Note) => void;
  onNoteMouseUp?: (note: Note | null) => void;

  // ── Playback ────────────────────────────────────────────────────────
  onPlayerReady?: () => void;
  onPlayerStateChanged?: (e: PlayerStateChangedEventArgs) => void;
  onPlayerFinished?: () => void;
  onPlayerPositionChanged?: (e: PositionChangedEventArgs) => void;
  onPlayedBeatChanged?: (beat: Beat) => void;
  onActiveBeatsChanged?: (e: ActiveBeatsChangedEventArgs) => void;
  onPlaybackRangeChanged?: (e: PlaybackRangeChangedEventArgs) => void;
  onPlaybackRangeHighlightChanged?: (e: PlaybackHighlightChangeEventArgs) => void;

  // ── MIDI ────────────────────────────────────────────────────────────
  onMidiLoad?: (e: MidiFile) => void;
  onMidiLoaded?: (e: PositionChangedEventArgs) => void;
  onMidiEventsPlayed?: (e: MidiEventsPlayedEventArgs) => void;

  // ── SoundFont ───────────────────────────────────────────────────────
  onSoundFontLoad?: (e: ProgressEventArgs) => void;
  onSoundFontLoaded?: () => void;
}

export interface RootProps extends RootEventProps {
  /** The score to render — raw file bytes or a URL string. */
  src: Uint8Array | string | null;
  /** Indices of tracks to display. Omit to render all tracks. */
  tracks?: number[];
  /**
   * How many bars to put in each row, one entry per row. Given, the pane stops
   * choosing its own row breaks and takes these — which is what lets two panes
   * showing different scores put the same measure on the same row. Rows past
   * the end of the array fall back to alphaTab's own count.
   *
   * Omit to let alphaTab lay the score out as it sees fit.
   */
  systemsLayout?: number[];
  /**
   * AlphaTab settings (JSON form or Settings instance).
   * Snapshotted at mount — core engine settings require remount to change.
   * Live updates to zoom use the dedicated `zoom` prop instead.
   */
  settings?: AlphaTabSettings;
  /**
   * Page (vertical scroll) or horizontal scroll layout.
   * Changing this after mount requires remounting <Root> via a `key` prop.
   * @default "page"
   */
  layout?: "page" | "horizontal";
  /** Render scale factor — live-updatable. @default 1.0 */
  zoom?: number;
  /**
   * Fires when the AlphaTabApi instance is created (with the api) or destroyed (with null).
   * Useful for storing an imperative ref outside the React tree.
   */
  onApiReady?: (api: alphaTab.AlphaTabApi | null) => void;
  children: ReactNode;
}

// ─── Score load state (combined to allow atomic updates) ──────────────────────

type ScoreLoadState =
  | { status: "idle"; score: null; error: null }
  | { status: "loading"; score: null; error: null }
  | { status: "loaded"; score: alphaTab.model.Score; error: null }
  | { status: "error"; score: null; error: Error };

type ScoreLoadAction =
  | { type: "loading" }
  | { type: "loaded"; score: alphaTab.model.Score }
  | { type: "error"; error: Error }
  | { type: "reset" };

const IDLE: ScoreLoadState = { status: "idle", score: null, error: null };

function scoreReducer(_: ScoreLoadState, action: ScoreLoadAction): ScoreLoadState {
  switch (action.type) {
    case "loading": return { status: "loading", score: null, error: null };
    case "loaded": return { status: "loaded", score: action.score, error: null };
    case "error": return { status: "error", score: null, error: action.error };
    case "reset": return IDLE;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** alphaTab's "every track" sentinel for `load`; an omitted list means track 0 alone. */
const ALL_TRACKS = [-1];

function buildAtSettings(
  layout: "page" | "horizontal",
  zoom: number,
  userSettings?: AlphaTabSettings,
  useModelLayout = false,
): AlphaTabSettings {
  if (userSettings instanceof alphaTab.Settings) {
    userSettings.display.scale = zoom;
    userSettings.display.layoutMode =
      layout === "horizontal" ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page;
    if (useModelLayout) {
      userSettings.display.systemsLayoutMode = alphaTab.SystemsLayoutMode.UseModelLayout;
    }
    return userSettings;
  }

  // After the instanceof check userSettings narrows to SettingsJson | undefined.
  const json = userSettings;
  return {
    ...json,
    core: {
      engine: "html5",
      logLevel: alphaTab.LogLevel.None,
      fontDirectory: "/font/",
      scriptFile: "/alphaTab.worker.mjs",
      ...json?.core,
    },
    display: {
      layoutMode:
        layout === "horizontal" ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page,
      scale: zoom,
      ...(useModelLayout
        ? { systemsLayoutMode: alphaTab.SystemsLayoutMode.UseModelLayout }
        : {}),
      ...json?.display,
    },
  } as AlphaTabSettings;
}

/**
 * Row breaks are a property of the score, not of the settings — alphaTab reads
 * them off the model, and only once `systemsLayoutMode` puts the model in
 * charge, which the pane's own settings do.
 */
function applySystemsLayout(score: alphaTab.model.Score, systemsLayout: number[]) {
  score.systemsLayout = [...systemsLayout];
  // The score-level array is read only while several tracks are on screen; with
  // a single track alphaTab asks that track instead, so both have to be set.
  for (const track of score.tracks) track.systemsLayout = [...systemsLayout];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Root({
  src,
  tracks,
  systemsLayout,
  settings,
  layout = "page",
  zoom = 1.0,
  onApiReady,
  children,
  // Event props
  onRenderStarted,
  onRenderFinished,
  onPostRenderFinished,
  onResize,
  onSettingsUpdated,
  onScoreLoaded,
  onError,
  onBeatMouseDown,
  onBeatMouseMove,
  onBeatMouseUp,
  onNoteMouseDown,
  onNoteMouseMove,
  onNoteMouseUp,
  onPlayerReady,
  onPlayerStateChanged,
  onPlayerFinished,
  onPlayerPositionChanged,
  onPlayedBeatChanged,
  onActiveBeatsChanged,
  onPlaybackRangeChanged,
  onPlaybackRangeHighlightChanged,
  onMidiLoad,
  onMidiLoaded,
  onMidiEventsPlayed,
  onSoundFontLoad,
  onSoundFontLoaded,
}: RootProps) {
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const [api, setApi] = useState<alphaTab.AlphaTabApi | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);
  const [loadState, dispatch] = useReducer(scoreReducer, IDLE);
  const [isReadyForPlayback, setIsReadyForPlayback] = useState(false);

  // Snapshot settings that cannot be changed after init. The layout mode goes in
  // here rather than being switched on later: updating settings mid-load makes
  // alphaTab lay the score out a second time, over the first.
  const initSettingsRef = useRef({
    layout,
    zoom,
    settings,
    useModelLayout: systemsLayout !== undefined,
  });

  // Keep latest callbacks in a ref — avoids re-subscribing on every render.
  const callbacksRef = useRef<RootEventProps>({});
  callbacksRef.current = {
    onRenderStarted,
    onRenderFinished,
    onPostRenderFinished,
    onResize,
    onSettingsUpdated,
    onScoreLoaded,
    onError,
    onBeatMouseDown,
    onBeatMouseMove,
    onBeatMouseUp,
    onNoteMouseDown,
    onNoteMouseMove,
    onNoteMouseUp,
    onPlayerReady,
    onPlayerStateChanged,
    onPlayerFinished,
    onPlayerPositionChanged,
    onPlayedBeatChanged,
    onActiveBeatsChanged,
    onPlaybackRangeChanged,
    onPlaybackRangeHighlightChanged,
    onMidiLoad,
    onMidiLoaded,
    onMidiEventsPlayed,
    onSoundFontLoad,
    onSoundFontLoaded,
  };

  const onApiReadyRef = useRef(onApiReady);
  onApiReadyRef.current = onApiReady;

  // Read from inside the load handler, which must not re-run when either changes.
  const systemsLayoutRef = useRef(systemsLayout);
  systemsLayoutRef.current = systemsLayout;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  /** What the api was last told to draw, so the same request is not made twice. */
  const rendered = useRef<{ tracks?: number[]; systemsLayout?: number[] }>({});

  // Called by <Viewport> via ref-callback when its div mounts/unmounts.
  const registerViewport = useCallback((el: HTMLElement | null) => {
    if (apiRef.current) {
      apiRef.current.destroy();
      apiRef.current = null;
      onApiReadyRef.current?.(null);
    }
    setApi(null);
    setViewportEl(null);
    dispatch({ type: "reset" });
    setIsReadyForPlayback(false);

    if (!el) return;

    const { layout: l, zoom: z, settings: s, useModelLayout } = initSettingsRef.current;
    const atApi = new alphaTab.AlphaTabApi(el, buildAtSettings(l, z, s, useModelLayout));
    // Bound here rather than with the other callbacks below: a byte source is
    // parsed synchronously inside `api.load()`, so an unreadable file emits
    // `error` before any effect has had a chance to subscribe.
    atApi.error.on((e: Error) => callbacksRef.current.onError?.(e));
    apiRef.current = atApi;
    setApi(atApi);
    setViewportEl(el);
    onApiReadyRef.current?.(atApi);
  }, []);

  // ── Score loading ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!api || !src) return;

    const onLoaded = (s: alphaTab.model.Score) => {
      // alphaTab starts rendering the moment the score is parsed, and this
      // event is the last thing it does before that. A layout applied any later
      // means one render with alphaTab's own row breaks and a second with ours,
      // both drawing into the same pane.
      if (systemsLayoutRef.current) {
        applySystemsLayout(s, systemsLayoutRef.current);
      }
      rendered.current = {
        tracks: tracksRef.current,
        systemsLayout: systemsLayoutRef.current,
      };
      dispatch({ type: "loaded", score: s });
    };
    const onErr = (e: Error) => dispatch({ type: "error", error: e });

    dispatch({ type: "loading" });
    // Reset readiness so the play button stays disabled until new MIDI is ready.
    setIsReadyForPlayback(false);
    api.scoreLoaded.on(onLoaded);
    api.error.on(onErr);
    // Told which tracks to show, alphaTab lays the score out once. Left to
    // guess it renders the first track, and the effect below immediately lays
    // it out again for the rest — two passes drawing into the same pane, whose
    // leftovers stay on screen.
    api.load(typeof src === "string" ? src : src.buffer, tracksRef.current ?? ALL_TRACKS);

    return () => {
      api.scoreLoaded.off(onLoaded);
      api.error.off(onErr);
    };
  }, [api, src]);

  // ── Track selection and row layout (live) ─────────────────────────────────
  // Both go in before the same render: the layout lives on the score, so it has
  // to be in place by the time renderTracks ships the model off to the worker.
  useEffect(() => {
    if (!api || loadState.status !== "loaded") return;
    // What the load already rendered. Laying it out again would be a second
    // pass over the same answer, and the pane keeps whatever the slower one
    // leaves behind.
    const done = rendered.current;
    if (done.tracks === tracks && done.systemsLayout === systemsLayout) return;

    const { score } = loadState;
    if (systemsLayout) {
      applySystemsLayout(score, systemsLayout);
      // A pane that mounted without a layout is still on alphaTab's own row
      // breaks; this is the one place the mode has to be switched at runtime.
      if (
        api.settings.display.systemsLayoutMode !==
        alphaTab.SystemsLayoutMode.UseModelLayout
      ) {
        api.settings.display.systemsLayoutMode =
          alphaTab.SystemsLayoutMode.UseModelLayout;
        api.updateSettings();
      }
    }
    const toRender = tracks
      ? tracks.map((i) => score.tracks[i]).filter(Boolean)
      : [...score.tracks];
    if (toRender.length === 0) return;

    rendered.current = { tracks, systemsLayout };
    api.renderTracks(toRender);
  }, [api, loadState, tracks, systemsLayout]);

  // ── Zoom (live) ────────────────────────────────────────────────────────────
  // Only apply after a score is loaded — calling render() on the uninitialized
  // player triggers a recursive `loadedMidiInfo` getter loop in alphaTab.
  useEffect(() => {
    if (!api || loadState.status !== "loaded") return;
    // The api was built with the zoom it mounted at, so on load there is
    // nothing to change — re-rendering here would only race the render the
    // score load already started.
    if (api.settings.display.scale === zoom) return;
    api.settings.display.scale = zoom;
    api.updateSettings();
    api.render();
  }, [api, zoom, loadState.status]);

  // ── isReadyForPlayback ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!api) return;
    const handler = () => setIsReadyForPlayback(true);
    api.playerReady.on(handler);
    return () => api.playerReady.off(handler);
  }, [api]);

  // ── All event callbacks — bound once per api instance ─────────────────────
  useEffect(() => {
    if (!api) return;

    const onPostRenderFinishedH = () => callbacksRef.current.onPostRenderFinished?.();
    const onSettingsUpdatedH = () => callbacksRef.current.onSettingsUpdated?.();
    const onPlayerReadyH = () => callbacksRef.current.onPlayerReady?.();
    const onPlayerFinishedH = () => callbacksRef.current.onPlayerFinished?.();
    const onSoundFontLoadedH = () => callbacksRef.current.onSoundFontLoaded?.();

    const onRenderStartedH = (isResize: boolean) =>
      callbacksRef.current.onRenderStarted?.(isResize);
    const onRenderFinishedH = (e: RenderFinishedEventArgs) =>
      callbacksRef.current.onRenderFinished?.(e);
    const onResizeH = (e: ResizeEventArgs) => callbacksRef.current.onResize?.(e);
    const onScoreLoadedH = (s: Score) => callbacksRef.current.onScoreLoaded?.(s);
    const onBeatMouseDownH = (b: Beat) => callbacksRef.current.onBeatMouseDown?.(b);
    const onBeatMouseMoveH = (b: Beat) => callbacksRef.current.onBeatMouseMove?.(b);
    const onBeatMouseUpH = (b: Beat | null) => callbacksRef.current.onBeatMouseUp?.(b);
    const onNoteMouseDownH = (n: Note) => callbacksRef.current.onNoteMouseDown?.(n);
    const onNoteMouseMoveH = (n: Note) => callbacksRef.current.onNoteMouseMove?.(n);
    const onNoteMouseUpH = (n: Note | null) => callbacksRef.current.onNoteMouseUp?.(n);
    const onPlayerStateChangedH = (e: PlayerStateChangedEventArgs) =>
      callbacksRef.current.onPlayerStateChanged?.(e);
    const onPlayerPositionChangedH = (e: PositionChangedEventArgs) =>
      callbacksRef.current.onPlayerPositionChanged?.(e);
    const onPlayedBeatChangedH = (b: Beat) => callbacksRef.current.onPlayedBeatChanged?.(b);
    const onActiveBeatsChangedH = (e: ActiveBeatsChangedEventArgs) =>
      callbacksRef.current.onActiveBeatsChanged?.(e);
    const onPlaybackRangeChangedH = (e: PlaybackRangeChangedEventArgs) =>
      callbacksRef.current.onPlaybackRangeChanged?.(e);
    const onPlaybackRangeHighlightChangedH = (e: PlaybackHighlightChangeEventArgs) =>
      callbacksRef.current.onPlaybackRangeHighlightChanged?.(e);
    const onMidiLoadH = (e: MidiFile) => callbacksRef.current.onMidiLoad?.(e);
    const onMidiLoadedH = (e: PositionChangedEventArgs) =>
      callbacksRef.current.onMidiLoaded?.(e);
    const onMidiEventsPlayedH = (e: MidiEventsPlayedEventArgs) =>
      callbacksRef.current.onMidiEventsPlayed?.(e);
    const onSoundFontLoadH = (e: ProgressEventArgs) =>
      callbacksRef.current.onSoundFontLoad?.(e);

    api.postRenderFinished.on(onPostRenderFinishedH);
    api.settingsUpdated.on(onSettingsUpdatedH);
    api.playerReady.on(onPlayerReadyH);
    api.playerFinished.on(onPlayerFinishedH);
    api.soundFontLoaded.on(onSoundFontLoadedH);

    api.renderStarted.on(onRenderStartedH);
    api.renderFinished.on(onRenderFinishedH);
    api.resize.on(onResizeH);
    api.scoreLoaded.on(onScoreLoadedH);
    api.beatMouseDown.on(onBeatMouseDownH);
    api.beatMouseMove.on(onBeatMouseMoveH);
    api.beatMouseUp.on(onBeatMouseUpH);
    api.noteMouseDown.on(onNoteMouseDownH);
    api.noteMouseMove.on(onNoteMouseMoveH);
    api.noteMouseUp.on(onNoteMouseUpH);
    api.playerStateChanged.on(onPlayerStateChangedH);
    api.playerPositionChanged.on(onPlayerPositionChangedH);
    api.playedBeatChanged.on(onPlayedBeatChangedH);
    api.activeBeatsChanged.on(onActiveBeatsChangedH);
    api.playbackRangeChanged.on(onPlaybackRangeChangedH);
    api.playbackRangeHighlightChanged.on(onPlaybackRangeHighlightChangedH);
    api.midiLoad.on(onMidiLoadH);
    // alphaTab 1.8.2 bug: AlphaSynthWebWorkerApi.loadedMidiInfo getter calls itself
    // recursively. EventEmitterOfT.on() calls fireOnRegister() immediately on subscribe,
    // which triggers the getter and causes a stack overflow. The listener is still pushed
    // to _listeners before the throw, so .off() cleanup works correctly.
    try { api.midiLoaded.on(onMidiLoadedH); } catch { /* ignore alphatab bug */ }
    api.midiEventsPlayed.on(onMidiEventsPlayedH);
    api.soundFontLoad.on(onSoundFontLoadH);

    return () => {
      api.postRenderFinished.off(onPostRenderFinishedH);
      api.settingsUpdated.off(onSettingsUpdatedH);
      api.playerReady.off(onPlayerReadyH);
      api.playerFinished.off(onPlayerFinishedH);
      api.soundFontLoaded.off(onSoundFontLoadedH);

      api.renderStarted.off(onRenderStartedH);
      api.renderFinished.off(onRenderFinishedH);
      api.resize.off(onResizeH);
      api.scoreLoaded.off(onScoreLoadedH);
      api.beatMouseDown.off(onBeatMouseDownH);
      api.beatMouseMove.off(onBeatMouseMoveH);
      api.beatMouseUp.off(onBeatMouseUpH);
      api.noteMouseDown.off(onNoteMouseDownH);
      api.noteMouseMove.off(onNoteMouseMoveH);
      api.noteMouseUp.off(onNoteMouseUpH);
      api.playerStateChanged.off(onPlayerStateChangedH);
      api.playerPositionChanged.off(onPlayerPositionChangedH);
      api.playedBeatChanged.off(onPlayedBeatChangedH);
      api.activeBeatsChanged.off(onActiveBeatsChangedH);
      api.playbackRangeChanged.off(onPlaybackRangeChangedH);
      api.playbackRangeHighlightChanged.off(onPlaybackRangeHighlightChangedH);
      api.midiLoad.off(onMidiLoadH);
      api.midiLoaded.off(onMidiLoadedH);
      api.midiEventsPlayed.off(onMidiEventsPlayedH);
      api.soundFontLoad.off(onSoundFontLoadH);
    };
  }, [api]);

  const contextValue = useMemo(
    () => ({
      api,
      score: loadState.score,
      isLoading: loadState.status === "loading",
      error: loadState.error,
      isReadyForPlayback,
      viewportEl,
      _registerViewport: registerViewport,
    }),
    [api, loadState, isReadyForPlayback, viewportEl, registerViewport],
  );

  return (
    <AlphaTabContext value={contextValue}>
      {children}
    </AlphaTabContext>
  );
}
