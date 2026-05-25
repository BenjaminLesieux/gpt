# @gpt/alphatab-react — Implementation Plan

## Status

A skeleton already exists under `packages/alphatab-react/src/`. It has the right
bones (`Root`, `Viewport`, `TabScore`, three hooks, a context, theme presets) but
covers only a fraction of the alphaTab surface area. This plan extends and
hardens that skeleton into a complete, production-ready library.

---

## 1. Architecture Overview

The library is organised in **three layers** that users interact with at different
levels of abstraction.

```
┌─────────────────────────────────────────────────────┐
│  Layer 3 — Convenience                              │
│  TabScore                                           │
├─────────────────────────────────────────────────────┤
│  Layer 2 — Headless hooks                           │
│  useScore  usePlayback  usePlayerPosition           │
│  usePlayerControls  useTrackControl  useAlphaTabApi │
├─────────────────────────────────────────────────────┤
│  Layer 1 — Core primitives                          │
│  <Root>  <Viewport>   AlphaTabContext               │
└─────────────────────────────────────────────────────┘
```

### Layer 1 — Core primitives

| Component | Responsibility |
|-----------|---------------|
| `<Root>` | Creates & owns the `AlphaTabApi` instance. Provides `AlphaTabContext`. Accepts all configuration props and every alphaTab event as an `on*` callback prop. Handles score loading, track re-rendering, and live prop updates. Destroys the API on unmount. |
| `<Viewport>` | A plain `<div>` that alphaTab renders into. Registers itself with `Root` via a ref callback from context so that `Root` knows when to initialise AT. Forwards all standard `div` props (class, style, aria-*, etc.) to the host element. |

**Why Root owns the API, not Viewport:**
Viewport is ephemeral — it can be conditionally rendered, wrapped in `Suspense`,
etc. If the API lived in Viewport, all configuration state would be lost on
remount. Root is the stable anchor; Viewport is just the render target.

**Communication between Root and Viewport:**
Root puts a `_registerViewport` function into context. Viewport calls it with a
ref callback:

```tsx
// Root provides
_registerViewport: (el: HTMLElement | null) => void

// Viewport consumes
<div ref={_registerViewport} {...props} />
```

When the div mounts, `_registerViewport(el)` fires → `new AlphaTabApi(el, …)`.
When it unmounts, `_registerViewport(null)` fires → `api.destroy()`.

### Layer 2 — Headless hooks

All hooks must be called inside a `<Root>` subtree. They read from `AlphaTabContext`
and subscribe to specific AT events.

| Hook | Returns |
|------|---------|
| `useScore()` | `{ score, isLoading, error }` |
| `usePlayback()` | `{ state, currentBeat, play, pause, stop }` |
| `usePlayerPosition()` | `{ currentTime, currentTick, endTime, endTick, progress, isSeek }` |
| `usePlayerControls()` | volume, speed, loop, metronome getters + setters |
| `useTrackControl(index)` | per-track mute, solo, volume |
| `useAlphaTabApi()` | `{ api }` escape hatch |

**Why hooks instead of more context fields:**
`playerPositionChanged` fires on every animation frame (60 fps). Putting
`currentTime` into React context would cause the entire provider tree to
re-render 60 times per second. Hooks give users opt-in subscription — only
components that call `usePlayerPosition()` re-render on position ticks.

### Layer 3 — Convenience

`<TabScore>` composes `Root` + `Viewport` into a single element for the common
case of "just show me the score." It accepts the union of `RootProps` and
`ViewportProps`. Power users reach for `Root` + `Viewport` directly.

---

## 2. Proposed API Design

### 2.1 Simple rendering

```tsx
import { TabScore, darkTheme } from "@gpt/alphatab-react";

function Sheet({ url }: { url: string }) {
  return (
    <TabScore
      src={url}
      layout="page"
      zoom={1.0}
      settings={darkTheme}
      className="h-full overflow-auto"
      onScoreLoaded={(score) => console.log(score.title)}
      onError={(err) => console.error(err)}
    />
  );
}
```

### 2.2 Custom layout with controls

```tsx
import { AlphaTab, usePlayback, useScore, usePlayerPosition } from "@gpt/alphatab-react";

function Player({ src }: { src: string }) {
  return (
    <AlphaTab.Root src={src} layout="horizontal" zoom={1.2}>
      <AlphaTab.Viewport className="flex-1 overflow-x-auto" />
      <Controls />
    </AlphaTab.Root>
  );
}

function Controls() {
  const { state, play, pause, stop } = usePlayback();
  const { progress, currentTime } = usePlayerPosition();
  const { score, isLoading } = useScore();

  if (isLoading) return <Spinner />;

  return (
    <div className="flex items-center gap-2">
      <button onClick={state === "playing" ? pause : play}>
        {state === "playing" ? "Pause" : "Play"}
      </button>
      <button onClick={stop}>Stop</button>
      <ProgressBar value={progress} />
      <span>{formatTime(currentTime)}</span>
      {score && <span>{score.title}</span>}
    </div>
  );
}
```

### 2.3 Beat interaction (e.g., selection highlighting)

```tsx
<AlphaTab.Root
  src={src}
  onBeatMouseDown={(beat) => setSelectedBeat(beat)}
  onBeatMouseUp={() => setSelectedBeat(null)}
>
  <AlphaTab.Viewport />
</AlphaTab.Root>
```

### 2.4 Per-track control

```tsx
function TrackMixer({ score }: { score: Score }) {
  return (
    <div>
      {score.tracks.map((track, i) => (
        <TrackStrip key={track.index} index={i} name={track.name} />
      ))}
    </div>
  );
}

function TrackStrip({ index, name }: { index: number; name: string }) {
  const { isMuted, setMuted, isSolo, setSolo, volume, setVolume } =
    useTrackControl(index);

  return (
    <div>
      <span>{name}</span>
      <button onClick={() => setMuted(!isMuted)}>M</button>
      <button onClick={() => setSolo(!isSolo)}>S</button>
      <input
        type="range" min={0} max={1} step={0.01}
        value={volume}
        onChange={(e) => setVolume(Number(e.target.value))}
      />
    </div>
  );
}
```

### 2.5 Escape hatch — raw API access

```tsx
function DownloadButton() {
  const { api } = useAlphaTabApi();
  return <button onClick={() => api?.downloadMidi()}>Export MIDI</button>;
}
```

### 2.6 Approach comparison

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Headless hooks + Root/Viewport** | Style-agnostic, flexible, composable, matches existing skeleton | Requires users to build their own UI | ✅ **Chosen** |
| Radix-style with pre-built UI components (PlayButton, StopButton, etc.) | Less boilerplate for simple cases | Imposes visual design on callers; doubled scope; hard to theme | ✗ |
| Single monolithic `<AlphaTabPlayer>` with 50 props | Dead simple for basic cases | Props explosion, impossible to customise layout | ✗ |

The headless hooks approach is chosen because:
1. This is a rendering library, not a design system. Callers own their UI.
2. The existing skeleton already commits to this pattern (`Root` + hooks).
3. It matches what mature headless libraries (Radix, Base UI, TanStack Table) do.

---

## 3. State & Lifecycle Management

### 3.1 API Lifecycle

```
User renders <Root src="…">
  │
  ├─ Root renders context provider (api=null, isLoading=false)
  │
  └─ User renders <Viewport> inside Root
       │
       ├─ Viewport div mounts → ref callback fires → _registerViewport(el)
       │    │
       │    ├─ If old api exists → api.destroy()
       │    ├─ new AlphaTabApi(el, settings)
       │    └─ setApi(atApi)
       │
       ├─ useEffect([api, src]) → api.load(src) → events fire → setScore / setError
       │
       └─ Viewport div unmounts → _registerViewport(null)
            │
            └─ api.destroy() → api = null
```

### 3.2 Context shape (authoritative)

```ts
interface AlphaTabContextValue {
  api: AlphaTabApi | null;
  score: Score | null;
  isLoading: boolean;
  error: Error | null;
  isReadyForPlayback: boolean;   // NEW — driven by playerReady event
  _registerViewport: (el: HTMLElement | null) => void;
}
```

`playerState` and `currentBeat` are intentionally NOT in context — they change
at playback frequency. Hooks subscribe directly to the API.

### 3.3 Live prop update policy

| Prop | Can update after mount? | Mechanism |
|------|------------------------|-----------|
| `src` | Yes | `api.load()` re-triggered by `useEffect([api, src])` |
| `tracks` | Yes | `api.renderTracks()` re-triggered by `useEffect([api, score, tracks])` |
| `zoom` | Yes | `api.settings.display.scale = zoom; api.updateSettings()` |
| `layout` | No | AT does not support runtime layout switch. Users must remount `<Root>` with a new `key` prop. Document this clearly. |
| `settings` | Partial | Deep-merge user-provided settings; call `api.updateSettings()`. Fields under `core.*` (engine, fontDirectory) require a full remount. |

The `settingsRef` approach (snapshotting at mount) must be kept for `core.*`
values only. Display/notation settings go through `updateSettings()`.

### 3.4 React 18 Strict Mode

Strict mode double-invokes `useEffect` cleanup+setup in development. Because
`registerViewport` is a ref callback (not a `useEffect` dependency), AT
initialises exactly once per `<div>` mount, which is correct. The ref callback
fires `destroy()` before re-initialising, making it idempotent.

### 3.5 Settings deep-merge strategy

```ts
// Root.tsx
function mergeSettings(
  layout: LayoutMode,
  zoom: number,
  user: Record<string, unknown>
): Record<string, unknown> {
  // core.* is snapshotted at mount (immutable after init)
  // display.* and player.* are re-mergeable via updateSettings()
}
```

When `zoom` or `settings` props change, a separate `useEffect` syncs them:

```ts
useEffect(() => {
  if (!api) return;
  api.settings.display.scale = zoom;
  // merge other updatable settings…
  api.updateSettings();
}, [api, zoom, /* updatable settings keys */]);
```

---

## 4. Event System Mapping

### 4.1 Complete event → prop table

Every alphaTab event is surfaced as an optional callback prop on `<Root>` and
`<TabScore>`. Naming convention: camelCase with `on` prefix.

#### Rendering events

| AT event | Prop | Callback type |
|----------|------|---------------|
| `renderStarted` | `onRenderStarted` | `(resize: boolean) => void` |
| `renderFinished` | `onRenderFinished` | `(result: RenderFinishedEventArgs) => void` |
| `postRenderFinished` | `onPostRenderFinished` | `() => void` |
| `resize` | `onResize` | `(e: ResizeEventArgs) => void` |
| `settingsUpdated` | `onSettingsUpdated` | `() => void` |

#### Score events

| AT event | Prop | Callback type |
|----------|------|---------------|
| `scoreLoaded` | `onScoreLoaded` | `(score: Score) => void` |
| `error` | `onError` | `(error: Error) => void` |

#### Beat / Note interaction events

| AT event | Prop | Callback type |
|----------|------|---------------|
| `beatMouseDown` | `onBeatMouseDown` | `(beat: Beat) => void` |
| `beatMouseMove` | `onBeatMouseMove` | `(beat: Beat) => void` |
| `beatMouseUp` | `onBeatMouseUp` | `(beat: Beat \| null) => void` |
| `noteMouseDown` | `onNoteMouseDown` | `(note: Note) => void` |
| `noteMouseMove` | `onNoteMouseMove` | `(note: Note) => void` |
| `noteMouseUp` | `onNoteMouseUp` | `(note: Note \| null) => void` |

#### Playback events

| AT event | Prop | Callback type |
|----------|------|---------------|
| `playerReady` | `onPlayerReady` | `() => void` |
| `playerStateChanged` | `onPlayerStateChanged` | `(e: PlayerStateChangedEventArgs) => void` |
| `playerFinished` | `onPlayerFinished` | `() => void` |
| `playerPositionChanged` | `onPlayerPositionChanged` | `(e: PositionChangedEventArgs) => void` |
| `playedBeatChanged` | `onPlayedBeatChanged` | `(beat: Beat) => void` |
| `activeBeatsChanged` | `onActiveBeatsChanged` | `(e: ActiveBeatsChangedEventArgs) => void` |
| `playbackRangeChanged` | `onPlaybackRangeChanged` | `(e: PlaybackRangeChangedEventArgs) => void` |
| `playbackRangeHighlightChanged` | `onPlaybackRangeHighlightChanged` | `(e: PlaybackRangeChangedEventArgs) => void` |

#### MIDI events

| AT event | Prop | Callback type |
|----------|------|---------------|
| `midiLoad` | `onMidiLoad` | `(e: MidiFileLoadedEventArgs) => void` |
| `midiLoaded` | `onMidiLoaded` | `(e: MidiFileLoadedEventArgs) => void` |
| `midiEventsPlayed` | `onMidiEventsPlayed` | `(e: MidiEventsPlayedEventArgs) => void` |

#### SoundFont events

| AT event | Prop | Callback type |
|----------|------|---------------|
| `soundFontLoad` | `onSoundFontLoad` | `(e: ProgressEventArgs) => void` |
| `soundFontLoaded` | `onSoundFontLoaded` | `() => void` |

### 4.2 Binding strategy

All event callbacks are bound inside a single `useEffect` in `Root` that fires
whenever `api` changes. Callbacks are stored in a stable ref to avoid
subscribe/unsubscribe churn when the user passes an inline arrow function:

```ts
// Root.tsx
const callbacksRef = useRef<RootEventProps>({});
callbacksRef.current = { onBeatMouseDown, onBeatMouseMove, … };

useEffect(() => {
  if (!api) return;

  const handlers = {
    beatMouseDown: (beat: Beat) => callbacksRef.current.onBeatMouseDown?.(beat),
    beatMouseMove: (beat: Beat) => callbacksRef.current.onBeatMouseMove?.(beat),
    // …all other events
  };

  for (const [event, handler] of Object.entries(handlers)) {
    (api as any)[event].on(handler);
  }

  return () => {
    for (const [event, handler] of Object.entries(handlers)) {
      (api as any)[event].off(handler);
    }
  };
}, [api]);
```

Using `callbacksRef` means the `useEffect` only runs when `api` changes
(not on every render when users pass new inline functions), while still always
calling the latest version of each callback.

### 4.3 Type safety

All event arg types are re-exported from a `types/events.ts` barrel so users
do not need to import from `@coderline/alphatab` directly:

```ts
// types/events.ts
export type {
  PositionChangedEventArgs,
  PlayerStateChangedEventArgs,
  ActiveBeatsChangedEventArgs,
  PlaybackRangeChangedEventArgs,
  ResizeEventArgs,
  RenderFinishedEventArgs,
  MidiFileLoadedEventArgs,
  MidiEventsPlayedEventArgs,
  ProgressEventArgs,
} from "@coderline/alphatab";
```

---

## 5. Extensibility Strategy

### 5.1 Escape hatches (from lowest to highest level)

1. **`useAlphaTabApi()`** — returns `{ api: AlphaTabApi | null }`. Gives full
   access to every method and property. The caller is responsible for cleanup.

2. **Event props on `<Root>`** — all 22 events are available as props. No hook
   needed for one-off listeners.

3. **`useAlphaTabContext()`** — exported for users who want to build their own
   hooks that sit inside the `Root` subtree.

4. **`settings` prop** — pass any alphaTab settings object; it is deep-merged
   with defaults. Full AT configuration is always accessible.

### 5.2 Custom providers

If a user needs a radically different lifecycle (e.g., sharing a single AT
instance across multiple viewports, or deferring init until explicit user
action), they can construct their own provider using the exported `AlphaTabContext`
type and shape, bypassing `Root` entirely.

### 5.3 Refs for imperative control

```tsx
// User needs imperative access outside the React tree (e.g., from a Zustand action)
function MyApp() {
  const apiRef = useRef<AlphaTabApi | null>(null);

  return (
    <AlphaTab.Root src={src} onApiReady={(api) => { apiRef.current = api; }}>
      <AlphaTab.Viewport />
    </AlphaTab.Root>
  );
}
```

`onApiReady` is a new lifecycle prop (distinct from AT events) that fires
when the AT instance is created and ready, passing the api as an argument.
It fires again with `null` on destroy.

---

## 6. File & Folder Structure

```
packages/alphatab-react/
  src/
    context/
      AlphaTabContext.tsx        # Context type, createContext, useAlphaTabContext
    components/
      Root.tsx                   # API lifecycle, event binding, context provision
      Viewport.tsx               # DOM render target, forwards div props
      TabScore.tsx               # Convenience: Root + Viewport in one element
    hooks/
      useAlphaTabApi.ts          # Escape hatch — raw api
      useScore.ts                # score / isLoading / error
      usePlayback.ts             # state / currentBeat / play / pause / stop
      usePlayerPosition.ts       # currentTime / currentTick / endTime / progress  [NEW]
      usePlayerControls.ts       # masterVolume / playbackSpeed / isLooping / etc. [NEW]
      useTrackControl.ts         # per-track mute / solo / volume                  [NEW]
    presets/
      themes.ts                  # darkTheme, lightTheme
    types/
      events.ts                  # Re-exports of AT event arg types                [NEW]
    index.ts                     # Public barrel
```

### What each new file does

**`hooks/usePlayerPosition.ts`**

Subscribes to `api.playerPositionChanged`. Returns:

```ts
interface UsePlayerPositionResult {
  currentTime: number;   // ms
  currentTick: number;
  endTime: number;       // ms
  endTick: number;
  progress: number;      // 0–1, currentTime / endTime
  isSeek: boolean;
}
```

Resets to zero when `api` is null or playback stops.

**`hooks/usePlayerControls.ts`**

Reads from and writes to `api` properties. Returns:

```ts
interface UsePlayerControlsResult {
  masterVolume: number;
  setMasterVolume: (vol: number) => void;    // 0–1
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void; // 0.1–8.0
  isLooping: boolean;
  setIsLooping: (loop: boolean) => void;
  metronomeVolume: number;
  setMetronomeVolume: (vol: number) => void; // 0–1
  countInVolume: number;
  setCountInVolume: (vol: number) => void;   // 0–1
}
```

These are mutable api properties (not events), so a setter is simply
`api.masterVolume = vol`. Local React state mirrors the API value so the
hook is reactive (re-renders when setter is called).

**`hooks/useTrackControl.ts`**

```ts
function useTrackControl(trackIndex: number): {
  isMuted: boolean;
  setMuted: (muted: boolean) => void;
  isSolo: boolean;
  setSolo: (solo: boolean) => void;
  volume: number;
  setVolume: (vol: number) => void; // 0–1
}
```

AT provides no getter for mute/solo state, so this hook maintains local
boolean state and calls `api.changeTrackMute(tracks, muted)` on change.
The track object is derived from `score.tracks[trackIndex]`. Volume uses
`api.changeTrackVolume`.

**`types/events.ts`**

Re-exports all AT event argument types so callers never need to import
from `@coderline/alphatab` directly for typing purposes.

### Index barrel (updated)

```ts
// Primitives
export { Root, type RootProps } from "./components/Root.js";
export { Viewport, type ViewportProps } from "./components/Viewport.js";
export const AlphaTab = { Root, Viewport };

// Convenience
export { TabScore, type TabScoreProps } from "./components/TabScore.js";

// Hooks
export { useScore, type UseScoreResult } from "./hooks/useScore.js";
export { useAlphaTabApi, type UseAlphaTabApiResult } from "./hooks/useAlphaTabApi.js";
export { usePlayback, type UsePlaybackResult, type PlaybackState } from "./hooks/usePlayback.js";
export { usePlayerPosition, type UsePlayerPositionResult } from "./hooks/usePlayerPosition.js";
export { usePlayerControls, type UsePlayerControlsResult } from "./hooks/usePlayerControls.js";
export { useTrackControl, type UseTrackControlResult } from "./hooks/useTrackControl.js";

// Presets
export { darkTheme, lightTheme } from "./presets/themes.js";

// Context (advanced)
export { AlphaTabContext, useAlphaTabContext, type AlphaTabContextValue } from "./context/AlphaTabContext.js";

// Event arg types (re-exports from @coderline/alphatab)
export type {
  PositionChangedEventArgs,
  PlayerStateChangedEventArgs,
  ActiveBeatsChangedEventArgs,
  PlaybackRangeChangedEventArgs,
  ResizeEventArgs,
  RenderFinishedEventArgs,
  MidiFileLoadedEventArgs,
  MidiEventsPlayedEventArgs,
  ProgressEventArgs,
} from "./types/events.js";
```

---

## 7. Key Design Decisions (summary)

| Decision | Rationale |
|----------|-----------|
| Root owns the API, not Viewport | Root is stable; Viewport is conditionally rendered. Lifecycle must survive viewport remounts. |
| Ref-callback for viewport registration instead of useEffect | Avoids StrictMode double-fire; cleanup is synchronous and imperative. |
| Callbacks stored in ref to avoid re-subscribing | Inline arrow functions in JSX create new references every render. Ref pattern pays zero subscription cost on re-render. |
| Player position NOT in context | Fires 60 fps; would re-render entire tree. Opt-in via hook. |
| Layout changes require key-prop remount | AT engine does not support runtime layout switch. Document clearly and throw a dev warning if layout prop changes. |
| No pre-built UI controls (buttons, sliders) | Library is style-agnostic. User builds their UI from hooks. Controls would require a design system dependency. |
| Event arg types re-exported from library | Users should not need to import from `@coderline/alphatab` for normal usage. Keeps the import graph clean. |
| `onApiReady` lifecycle prop | Gives users an imperative ref to the API without requiring them to call `useAlphaTabApi()` from a child component. |
