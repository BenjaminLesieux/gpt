// ── Generic cell ──────────────────────────────────────────────────────────────
//
// Every mergeable scalar field is wrapped in one of these two shapes.
// Adding a new field to any merge struct is one line: `field: cell(b, o, t)`.

/** Auto-resolved: only one side changed, or both changed to the same value. */
export interface Resolved<T> {
  readonly status: "resolved";
  readonly value: T;
}

/**
 * Both sides changed this field differently from the common ancestor.
 * The user must pick `ours`, `theirs`, or supply a custom value.
 */
export interface Conflicted<T> {
  readonly status: "conflict";
  readonly base: T;
  readonly ours: T;
  readonly theirs: T;
}

export type MergeCell<T> = Resolved<T> | Conflicted<T>;

// ── Note ─────────────────────────────────────────────────────────────────────
//
// One merged note within a beat, keyed by guitar string number.
// Every property that is musically meaningful and directly settable is covered.

export interface NoteFieldsMerge {
  // Pitch & position
  fret:               MergeCell<number>;
  // Articulations
  isDead:             MergeCell<boolean>;
  isGhost:            MergeCell<boolean>;
  isStaccato:         MergeCell<boolean>;
  isHammerPullOrigin: MergeCell<boolean>;
  isLeftHandTapped:   MergeCell<boolean>;
  // Bends
  bendType:           MergeCell<number>;
  bendStyle:          MergeCell<number>;
  isContinuedBend:    MergeCell<boolean>;
  // Harmonics
  harmonicType:       MergeCell<number>;
  harmonicValue:      MergeCell<number>;
  // Slides
  slideInType:        MergeCell<number>;
  slideOutType:       MergeCell<number>;
  // Sustain
  vibrato:            MergeCell<number>;
  isLetRing:          MergeCell<boolean>;
  isPalmMute:         MergeCell<boolean>;
  // Dynamics & accent
  accentuated:        MergeCell<number>;
  dynamics:           MergeCell<number>;
  // Trill
  trillValue:         MergeCell<number>;
  trillSpeed:         MergeCell<number>;
  // Fingering
  leftHandFinger:     MergeCell<number>;
  rightHandFinger:    MergeCell<number>;
  // Duration modifier
  durationPercent:    MergeCell<number>;
}

export interface NoteMerge {
  /** Guitar string number — the identity key for this note within a beat. */
  readonly string: number;
  readonly fields: NoteFieldsMerge;
  readonly hasConflict: boolean;
}

// ── Beat ─────────────────────────────────────────────────────────────────────

export interface BeatFieldsMerge {
  // Rhythm
  duration:          MergeCell<number>;
  dots:              MergeCell<number>;
  tupletNumerator:   MergeCell<number>;
  tupletDenominator: MergeCell<number>;
  // Articulation / expression
  isLetRing:         MergeCell<boolean>;
  isPalmMute:        MergeCell<boolean>;
  isLegatoOrigin:    MergeCell<boolean>;
  fade:              MergeCell<number>;
  ottava:            MergeCell<number>;
  // Bass techniques
  pop:               MergeCell<boolean>;
  slap:              MergeCell<boolean>;
  tap:               MergeCell<boolean>;
  // Strum
  brushType:         MergeCell<number>;
  brushDuration:     MergeCell<number>;
  // Annotation
  text:              MergeCell<string | null>;
}

/**
 * A note that only exists on one side of the merge — not present in base.
 * Both sides independently added or disagreed on whether a note on this string should exist.
 */
export interface StructuralNoteConflict {
  readonly string: number;
  /**
   * added-ours     — note on this string only exists in ours (theirs removed or never had it)
   * added-theirs   — note on this string only exists in theirs
   * removed-ours   — existed in base and theirs, ours removed it
   * removed-theirs — existed in base and ours, theirs removed it
   */
  readonly kind:
    | "added-ours"
    | "added-theirs"
    | "removed-ours"
    | "removed-theirs";
}

export interface BeatMerge {
  readonly index: number;
  readonly fields: BeatFieldsMerge;
  /** Notes present on all three sides (or cleanly auto-resolved). */
  readonly notes: NoteMerge[];
  /** Notes where presence differs between ours and theirs — always a conflict. */
  readonly structuralNoteConflicts: StructuralNoteConflict[];
  readonly hasConflict: boolean;
}

// ── Voice ─────────────────────────────────────────────────────────────────────

/**
 * Beat counts differ between ours and theirs: positional note-level merging
 * is impossible for this voice. User must choose a whole-voice resolution.
 */
export interface StructuralBeatConflict {
  readonly baseCount: number;
  readonly oursCount: number;
  readonly theirsCount: number;
}

export interface VoiceMerge {
  readonly index: number;
  /** Populated only when structuralBeatConflict is null. */
  readonly beats: BeatMerge[];
  /** Set when ours and theirs both changed this voice but with incompatible beat counts. */
  readonly structuralBeatConflict: StructuralBeatConflict | null;
  readonly hasConflict: boolean;
}

// ── Bar ───────────────────────────────────────────────────────────────────────

/**
 * equal          — neither side changed this bar vs base
 * ours-only      — bar exists only in ours (added; theirs doesn't have it)
 * theirs-only    — bar exists only in theirs
 * auto-resolved  — exactly one side changed; taken automatically
 * conflict       — both sides changed differently; inspect voices for detail
 */
export type BarMergeStatus =
  | "equal"
  | "ours-only"
  | "theirs-only"
  | "auto-resolved"
  | "conflict";

export interface BarMerge {
  readonly masterBarIndex: number;
  readonly status: BarMergeStatus;
  /**
   * Set when status is "auto-resolved": which version was kept.
   * "both-same" means both sides changed to the same value vs base.
   */
  readonly resolvedFrom?: "ours" | "theirs" | "both-same";
  /** Populated only when status is "conflict". */
  readonly voices: VoiceMerge[];
  readonly hasConflict: boolean;
}

// ── MasterBar ─────────────────────────────────────────────────────────────────
//
// Covers the measure-level metadata that any musician might change independently:
// time signature, feel, repeats, section boundaries.

export interface MasterBarFieldsMerge {
  // Time signature
  timeSignatureNumerator:   MergeCell<number>;
  timeSignatureDenominator: MergeCell<number>;
  timeSignatureCommon:      MergeCell<boolean>;
  isFreeTime:               MergeCell<boolean>;
  // Feel
  tripletFeel:              MergeCell<number>;
  isAnacrusis:              MergeCell<boolean>;
  // Structure
  isDoubleBar:              MergeCell<boolean>;
  // Repeats
  isRepeatStart:            MergeCell<boolean>;
  repeatCount:              MergeCell<number>;
  alternateEndings:         MergeCell<number>;
}

export interface MasterBarMerge {
  readonly index: number;
  readonly fields: MasterBarFieldsMerge;
  readonly hasConflict: boolean;
}

// ── Track ─────────────────────────────────────────────────────────────────────

export interface TrackMerge {
  readonly trackIndex: number;
  readonly trackName: string;
  readonly bars: BarMerge[];
  readonly hasConflict: boolean;
}

// ── Score meta ────────────────────────────────────────────────────────────────

export interface ScoreMetaMerge {
  readonly title:  MergeCell<string>;
  readonly artist: MergeCell<string>;
  readonly album:  MergeCell<string>;
  readonly tempo:  MergeCell<number>;
  readonly hasConflict: boolean;
}

// ── Result ────────────────────────────────────────────────────────────────────

/**
 * A pointer to one specific conflict in the merge tree.
 * Used by the CLI to list conflicts and by the UI to navigate them.
 */
export interface ConflictLocation {
  /**
   * Dot-notation path to the conflict.
   * Examples:
   *   "meta.tempo"
   *   "masterBar[2].timeSignatureNumerator"
   *   "track[0].bar[4].voice[0].beat[2].note[s=3].fret"
   *   "track[0].bar[4].voice[0].beat[2].structuralNote[s=3]"
   *   "track[0].bar[4].voice[0].structuralBeats"
   */
  readonly path: string;
  readonly kind: "field" | "structural-note" | "structural-beat";
  readonly description: string;
}

export interface MergeResult {
  readonly meta: ScoreMetaMerge;
  readonly masterBars: MasterBarMerge[];
  readonly tracks: TrackMerge[];
  readonly hasConflicts: boolean;
  readonly conflictCount: number;
  readonly conflicts: ConflictLocation[];
}
