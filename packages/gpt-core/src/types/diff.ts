import type { Score, Bar } from "./score";

// ── Bar diff ──────────────────────────────────────────────────────────────────
//
// Bars are aligned by content, not by position: inserting a measure shifts every
// later measure in head, and pairing on position alone would report the whole
// rest of the song as changed. So a bar carries its position in *each* score.
//
//   baseIndex — index into the base staff's bars, or null when type is "added"
//   headIndex — index into the head staff's bars, or null when type is "removed"
//
// Consumers rendering side-by-side (e.g. <TabDiff>) must address the base pane
// with baseIndex and the head pane with headIndex; the two diverge after any
// insertion or deletion. masterBarIndex is the display measure number — head's
// position where head has one, otherwise base's — and is what the CLI prints.
//
// When type is "changed", changedFields categorizes what changed inside the bar.

export type BarChangedField =
  | "notes"        // note pitch, fret, or presence changed
  | "beats"        // beat count, duration, or rhythm changed
  | "articulation" // bend, slide, vibrato, let-ring, palm-mute, etc.
  | "dynamics";    // accent, dynamic value

interface BarPosition {
  masterBarIndex: number;
  baseIndex: number | null;
  headIndex: number | null;
}

export type BarDiff =
  | ({ type: "equal" }   & BarPosition)
  | ({ type: "added";   bar: Bar; baseIndex: null } & Omit<BarPosition, "baseIndex">)
  | ({ type: "removed"; bar: Bar; headIndex: null } & Omit<BarPosition, "headIndex">)
  | ({
      type: "changed";
      base: Bar;
      head: Bar;
      /** At least one entry is always present when type is "changed". */
      changedFields: BarChangedField[];
    } & BarPosition);

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
