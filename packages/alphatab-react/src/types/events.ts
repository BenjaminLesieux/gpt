import type * as alphaTab from "@coderline/alphatab";

// Model types
export type Score = alphaTab.model.Score;
export type Beat = alphaTab.model.Beat;
export type Note = alphaTab.model.Note;
export type Track = alphaTab.model.Track;

// Rendering event args
export type RenderFinishedEventArgs = alphaTab.rendering.RenderFinishedEventArgs;
export type ResizeEventArgs = alphaTab.ResizeEventArgs;

// Where things landed on the page — the bridge from a model position to pixels
export type BoundsLookup = alphaTab.rendering.BoundsLookup;
export type Bounds = alphaTab.rendering.Bounds;
export type MasterBarBounds = alphaTab.rendering.MasterBarBounds;

// The imperative handle <Root> hands back through onApiReady
export type AlphaTabApi = alphaTab.AlphaTabApi;

// Playback event args
export type PlayerStateChangedEventArgs = alphaTab.synth.PlayerStateChangedEventArgs;
export type PositionChangedEventArgs = alphaTab.synth.PositionChangedEventArgs;
export type ActiveBeatsChangedEventArgs = alphaTab.synth.ActiveBeatsChangedEventArgs;
export type PlaybackRangeChangedEventArgs = alphaTab.synth.PlaybackRangeChangedEventArgs;
export type MidiEventsPlayedEventArgs = alphaTab.synth.MidiEventsPlayedEventArgs;
export type PlaybackHighlightChangeEventArgs = alphaTab.PlaybackHighlightChangeEventArgs;

// MIDI types
export type MidiFile = alphaTab.midi.MidiFile;

// Load progress
export type ProgressEventArgs = alphaTab.ProgressEventArgs;

// Player state
export type PlayerState = alphaTab.synth.PlayerState;

// Settings input — the union the AlphaTabApi constructor accepts
export type AlphaTabSettings = ConstructorParameters<typeof alphaTab.AlphaTabApi>[1];

// Cursor customization — derived from the api property since ICursorHandler is a global declare interface
export type CursorHandler = NonNullable<InstanceType<typeof alphaTab.AlphaTabApi>['customCursorHandler']>;

/**
 * CSS classes injected onto alphaTab's stable cursor DOM elements.
 * All Tailwind utilities work — these elements have no competing CSS rules.
 *
 * Omit a key to use the built-in default. Pass `""` to suppress the default.
 *
 * Beat cursor width: alphaTab's `setBounds()` sets an inline `style.width` that
 * overrides normal CSS. Use Tailwind's `!important` modifier (e.g. `!w-0.5`) or
 * `<AlphaTab.Cursor beatWidth={n} />` to override it.
 *
 * Note highlights (.at-highlight) are added/removed dynamically on SVG elements
 * during playback — class injection isn't feasible. Use `highlightColor` instead.
 */
export interface CursorClassNames {
  /** Classes for the bar highlight (.at-cursor-bar). Default: `"bg-warning/18"` */
  bar?: string;
  /** Classes for the beat cursor line (.at-cursor-beat). Default: `"bg-warning/85"` */
  beat?: string;
  /** Classes for the selection wrapper (.at-selection). Default: `"bg-warning/14"` */
  selection?: string;
  /**
   * Fill + stroke colour for currently-played notes (.at-highlight *).
   * Any CSS color value; injected as `--at-highlight-color` on the viewport.
   * SVG engine only — html5 canvas ignores it.
   */
  highlightColor?: string;
}
