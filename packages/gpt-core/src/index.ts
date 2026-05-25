// AlphaTab model type aliases — use model.X for instance-type annotations.
export type { Score, Track, Staff, Bar, Voice, Beat, Note, MasterBar } from "./types/score.js";

// GPT-specific diff/version control types
export type { ScoreDiff, TrackDiff, BarDiff, BarChangedField, MetaDiff } from "./types/diff.js";
export type { Commit, CommitAuthor, Branch, RepoStatus } from "./types/commit.js";

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
} from "./types/merge.js";

// Conflict sidecar types (serializable — no AT deps)
export type { ConflictSidecar, FileConflictState, SidecarConflict } from "./types/conflicts.js";
export { CONFLICT_SIDECAR, unresolvedCount, isFullyResolved } from "./types/conflicts.js";

// Core functions
export { serialize, deserialize } from "./serializer.js";
export { diffScores } from "./diff.js";
export { mergeScores } from "./merge.js";
export { applyMerge } from "./applyMerge.js";
