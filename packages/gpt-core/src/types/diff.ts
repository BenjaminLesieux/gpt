import type { Score, Bar } from "./score.js";

// ── Bar diff ──────────────────────────────────────────────────────────────────
//
// masterBarIndex corresponds to Score.masterBars[i].index — the shared measure number.
// When type is "changed", changedFields categorizes what changed inside the bar.
// Used by the CLI summary and the <TabDiff> chip breakdown.

export type BarChangedField =
  | "notes"        // note pitch, fret, or presence changed
  | "beats"        // beat count, duration, or rhythm changed
  | "articulation" // bend, slide, vibrato, let-ring, palm-mute, etc.
  | "dynamics";    // accent, dynamic value

export type BarDiff =
  | { type: "equal";   masterBarIndex: number }
  | { type: "added";   masterBarIndex: number; bar: Bar }
  | { type: "removed"; masterBarIndex: number; bar: Bar }
  | {
      type: "changed";
      masterBarIndex: number;
      base: Bar;
      head: Bar;
      /** At least one entry is always present when type is "changed". */
      changedFields: BarChangedField[];
    };

// ── Track diff ────────────────────────────────────────────────────────────────

export interface TrackDiff {
  trackIndex: number;
  trackName: string;
  bars: BarDiff[];
}

// ── Score meta diff ───────────────────────────────────────────────────────────

export interface MetaDiff {
  title?:  [string, string];
  artist?: [string, string];
  album?:  [string, string];
  tempo?:  [number, number];
  /** Indexes of master bars whose measure-level fields changed (time sig, repeats, feel…). */
  masterBarChanges?: number[];
}

export interface ScoreDiff {
  base: Score;
  head: Score;
  meta: MetaDiff;
  tracks: TrackDiff[];
  summary: string;
}
