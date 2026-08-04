import type { Score, Bar } from "./score";

// ── Measure alignment ─────────────────────────────────────────────────────────
//
// Alignment is score-level: "which base measure is which head measure" has one
// true answer, computed once over a measure fingerprint — the master bar plus
// every paired track's bar at that slot — and shared by every track (ADR 0002).
// Attribution stays per track: within a changed measure, changedTracks lists
// exactly the tracks whose bar changed. Editing the bass leaves the guitar
// unchanged.
//
//   baseIndex — the measure's position in base, or null when type is "added"
//   headIndex — the measure's position in head, or null when type is "removed"

export interface TrackBarChange {
  /** Index into ScoreDiff.tracks — the pairing order, not either score's track list. */
  trackIndex: number;
  /** At least one entry is always present. */
  changedFields: BarChangedField[];
}

export type MeasureDiff =
  | { type: "equal";   baseIndex: number; headIndex: number }
  | { type: "added";   baseIndex: null;   headIndex: number }
  | { type: "removed"; baseIndex: number; headIndex: null }
  | {
      type: "changed";
      baseIndex: number;
      headIndex: number;
      /** Master-bar fields (time signature, repeats, feel…) changed. */
      masterBarChanged: boolean;
      /** Tracks whose bar changed here; a track absent from this list is unchanged. */
      changedTracks: TrackBarChange[];
    };

// ── Track pairing ─────────────────────────────────────────────────────────────
//
// Guitar Pro lets you drag tracks around, so array position is not identity.
// A pairing ties a base track to its head counterpart; either side is null for
// a track that exists in only one score. barsForTrack takes trackIndex.

export interface TrackPairing {
  /** Position in ScoreDiff.tracks. */
  trackIndex: number;
  trackName: string;
  /** Index into base.tracks, or null when the track only exists in head. */
  baseTrack: number | null;
  /** Index into head.tracks, or null when the track only exists in base. */
  headTrack: number | null;
}

// ── Bar diff — the per-track projection ───────────────────────────────────────
//
// The view a track-thinking consumer (a side-by-side pane, the CLI) renders.
// Never stored: barsForTrack derives it from the canonical measure alignment,
// so the alignment exists in exactly one place.
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

// ── Change positions and tallies ──────────────────────────────────────────────
//
// What a side-by-side pane highlights and what a track picker chips: where the
// changes are, without the bar payload. Both are read through one lens —
// changedBars(diff, trackIndex) — where a null trackIndex means the whole score,
// i.e. a measure counts as changed when any track's bar or the master bar did.

export interface ChangedBar {
  type: "added" | "removed" | "changed";
  /** Display measure number — head's position where head has one, else base's. */
  masterBarIndex: number;
  baseIndex: number | null;
  headIndex: number | null;
}

export interface ChangeCounts {
  changed: number;
  added: number;
  removed: number;
  /** changed + added + removed — zero for a track this edit left alone. */
  total: number;
}

// ── Content marks — the inside of a changed measure ───────────────────────────
//
// A changed measure is almost never uniformly changed: one note moved and the
// other fifteen stayed put. A content mark says which note head or which beat
// actually carries the edit, so a renderer can colour that note instead of
// washing the whole measure.
//
// There is no "changed" mark. A note whose fret went from 1 to 2 is a red mark
// on the base pane's 1 and a green mark on the head pane's 2 — the same way a
// text diff spells a changed line. So base marks are what the edit took away
// and head marks are what it brought, and nothing else needs a colour.
//
// Every index is in the pane's own score: the panes disagree about track order
// the moment a track is dragged, and about measure numbers after any insertion.

export interface ContentMark {
  masterBarIndex: number;
  trackIndex: number;
  staffIndex: number;
  voiceIndex: number;
  /** Beat position within the voice — Beat.index in the model. */
  beatIndex: number;
  /** Position within Beat.notes, or null when the mark covers the whole beat. */
  noteIndex: number | null;
}

/** Where a mark sits inside one bar, before the bar itself is located. */
export type BarContentMark = Omit<
  ContentMark,
  'masterBarIndex' | 'trackIndex' | 'staffIndex'
>;

/** base — what the edit removed; head — what it added. */
export interface ContentMarks<T = ContentMark> {
  base: T[];
  head: T[];
}

// ── Score meta diff ───────────────────────────────────────────────────────────

export interface MetaDiff {
  title?:  [string, string];
  artist?: [string, string];
  album?:  [string, string];
  tempo?:  [number, number];
  /** Display measure numbers whose master-bar fields changed (time sig, repeats, feel…). */
  masterBarChanges?: number[];
}

export interface ScoreDiff {
  base: Score;
  head: Score;
  meta: MetaDiff;
  /** Base ↔ head track pairing, in base order, then tracks only head has. */
  tracks: TrackPairing[];
  /** The canonical score-level alignment, in reading order. */
  measures: MeasureDiff[];
  summary: string;
}
