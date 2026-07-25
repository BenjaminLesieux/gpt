// AlphaTab model type aliases — use model.X for instance-type annotations.
export type { Score, Track, Staff, Bar, Voice, Beat, Note, MasterBar } from "./types/score";

// GPT-specific diff/version control types
export type { ScoreDiff, TrackDiff, BarDiff, BarChangedField, MetaDiff } from "./types/diff";
export type { Commit, CommitAuthor, Branch, RepoStatus } from "./types/commit";

// Merge types
export type {
  MergeCell,
  Resolved,
  Conflicted,
  NoteFieldsMerge,
  NoteMerge,
  BeatFieldsMerge,
  BeatMerge,
  StructuralNoteConflict,
  StructuralBeatConflict,
  VoiceMerge,
  BarMerge,
  BarMergeStatus,
  MasterBarFieldsMerge,
  MasterBarMerge,
  TrackMerge,
  ScoreMetaMerge,
  ConflictLocation,
  MergeResult,
} from "./types/merge";

// Conflict sidecar types (serializable — no AT deps)
export type { ConflictSidecar, FileConflictState, SidecarConflict } from "./types/conflicts";
export { CONFLICT_SIDECAR, unresolvedCount, isFullyResolved } from "./types/conflicts";

// Core functions
export { serialize, deserialize } from "./serializer";
export { diffScores } from "./diff";
export { mergeScores } from "./merge";
export { applyMerge } from "./applyMerge";

// Guitar Pro file normalization (git clean filter)
export { normalizeGp } from "./normalizeGp";
export type { NormalizeGpOptions } from "./normalizeGp";
