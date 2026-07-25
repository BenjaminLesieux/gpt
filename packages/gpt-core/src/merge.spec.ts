import { describe, it, expect } from "vitest";
import { mergeScores } from "./merge";
import type { Score, Bar, Beat, Note, Voice, Track, Staff, MasterBar } from "./types/score";
import type { MergeCell } from "./types/merge";

// ─── Helpers — mirrors diff.spec.ts factories ─────────────────────────────────

function r<T>(v: T): MergeCell<T> {
  return { status: "resolved", value: v };
}

function note(string: number, fret: number, overrides: Partial<Note> = {}): Note {
  return {
    string,
    fret,
    isDead: false,
    isGhost: false,
    isStaccato: false,
    isHammerPullOrigin: false,
    isLeftHandTapped: false,
    isContinuedBend: false,
    bendType: 0,
    bendStyle: 0,
    harmonicType: 0,
    harmonicValue: 0,
    slideInType: 0,
    slideOutType: 0,
    vibrato: 0,
    isLetRing: false,
    isPalmMute: false,
    accentuated: 0,
    dynamics: 0,
    trillValue: 0,
    trillSpeed: 0,
    leftHandFinger: 0,
    rightHandFinger: 0,
    durationPercent: 1,
    ...overrides,
  } as unknown as Note;
}

function beat(notes: Note[], overrides: Partial<Beat> = {}): Beat {
  return {
    duration: 4,
    dots: 0,
    isRest: notes.length === 0,
    tupletNumerator: 1,
    tupletDenominator: 1,
    isLetRing: false,
    isPalmMute: false,
    isLegatoOrigin: false,
    fade: 0,
    ottava: 0,
    pop: false,
    slap: false,
    tap: false,
    brushType: 0,
    brushDuration: 0,
    text: null,
    notes,
    ...overrides,
  } as unknown as Beat;
}

function voice(beats: Beat[]): Voice {
  return { index: 0, beats } as unknown as Voice;
}

function bar(voices: Voice[]): Bar {
  return { voices } as unknown as Bar;
}

function masterBar(index: number, overrides: Partial<MasterBar> = {}): MasterBar {
  return {
    index,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    timeSignatureCommon: false,
    isFreeTime: false,
    isAnacrusis: false,
    tripletFeel: 0,
    isRepeatStart: false,
    repeatCount: 0,
    alternateEndings: 0,
    isDoubleBar: false,
    ...overrides,
  } as unknown as MasterBar;
}

function staff(bars: Bar[]): Staff {
  return { bars } as unknown as Staff;
}

function track(name: string, bars: Bar[]): Track {
  return { index: 0, name, staves: [staff(bars)] } as unknown as Track;
}

function score(
  tracks: Track[],
  masterBarCount: number,
  overrides: Partial<Score> = {},
): Score {
  const mBars = Array.from({ length: masterBarCount }, (_, i) => masterBar(i));
  return {
    title: "Test Song",
    artist: "Artist",
    album: "",
    tempo: 120,
    tracks,
    masterBars: mBars,
    ...overrides,
  } as unknown as Score;
}

function simpleBar(fret: number): Bar {
  return bar([voice([beat([note(1, fret)])])]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("mergeScores", () => {
  // ── Identical scores ─────────────────────────────────────────────────────

  describe("when all three scores are identical", () => {
    it("should produce no conflicts and all bars equal", () => {
      // Given
      const s = score([track("Guitar", [simpleBar(5)])], 1);

      // When
      const result = mergeScores(s, s, s);

      // Then
      expect(result.hasConflicts).toBe(false);
      expect(result.conflictCount).toBe(0);
      expect(result.tracks[0]!.bars[0]!.status).toBe("equal");
    });

    it("should produce resolved cells for all meta fields", () => {
      // Given
      const s = score([], 0, { title: "X", artist: "Y", album: "Z", tempo: 90 });

      // When
      const result = mergeScores(s, s, s);

      // Then
      expect(result.meta.title).toEqual(r("X"));
      expect(result.meta.artist).toEqual(r("Y"));
      expect(result.meta.album).toEqual(r("Z"));
      expect(result.meta.tempo).toEqual(r(90));
      expect(result.meta.hasConflict).toBe(false);
    });
  });

  // ── Meta conflicts ───────────────────────────────────────────────────────

  describe("score meta", () => {
    it("should auto-resolve tempo when only ours changed", () => {
      // Given
      const base   = score([], 0, { tempo: 120 });
      const ours   = score([], 0, { tempo: 140 });
      const theirs = score([], 0, { tempo: 120 });

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.meta.tempo).toEqual(r(140));
      expect(result.hasConflicts).toBe(false);
    });

    it("should auto-resolve tempo when only theirs changed", () => {
      // Given
      const base   = score([], 0, { tempo: 120 });
      const ours   = score([], 0, { tempo: 120 });
      const theirs = score([], 0, { tempo: 100 });

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.meta.tempo).toEqual(r(100));
    });

    it("should auto-resolve when both changed to the same value", () => {
      // Given
      const base   = score([], 0, { tempo: 120 });
      const ours   = score([], 0, { tempo: 160 });
      const theirs = score([], 0, { tempo: 160 });

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.meta.tempo).toEqual(r(160));
      expect(result.hasConflicts).toBe(false);
    });

    it("should conflict when both changed to different tempos", () => {
      // Given
      const base   = score([], 0, { tempo: 120 });
      const ours   = score([], 0, { tempo: 140 });
      const theirs = score([], 0, { tempo: 160 });

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.meta.tempo).toEqual({ status: "conflict", base: 120, ours: 140, theirs: 160 });
      expect(result.meta.hasConflict).toBe(true);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts[0]!.path).toBe("meta.tempo");
    });

    it("should conflict when both changed title to different strings", () => {
      // Given
      const base   = score([], 0, { title: "Draft" });
      const ours   = score([], 0, { title: "Final" });
      const theirs = score([], 0, { title: "Release" });

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.meta.title).toEqual({ status: "conflict", base: "Draft", ours: "Final", theirs: "Release" });
    });
  });

  // ── MasterBar (measure metadata) ─────────────────────────────────────────

  describe("masterBar fields", () => {
    it("should auto-resolve time signature when only ours changed", () => {
      // Given
      const base   = score([], 1, {});
      const ours   = score([], 1, {});
      const theirs = score([], 1, {});
      ours.masterBars[0] = masterBar(0, { timeSignatureNumerator: 3 });

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.masterBars[0]!.fields.timeSignatureNumerator).toEqual(r(3));
      expect(result.masterBars[0]!.hasConflict).toBe(false);
    });

    it("should conflict when both changed time signature differently", () => {
      // Given
      const base   = score([], 1, {});
      const ours   = score([], 1, {});
      const theirs = score([], 1, {});
      ours.masterBars[0]   = masterBar(0, { timeSignatureNumerator: 3 });
      theirs.masterBars[0] = masterBar(0, { timeSignatureNumerator: 6 });

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      const tsNum = result.masterBars[0]!.fields.timeSignatureNumerator;
      expect(tsNum).toEqual({ status: "conflict", base: 4, ours: 3, theirs: 6 });
      expect(result.masterBars[0]!.hasConflict).toBe(true);
      expect(result.conflicts[0]!.path).toBe("masterBar[0].timeSignatureNumerator");
    });

    it("should auto-resolve repeat markers when only theirs added a repeat", () => {
      // Given
      const base   = score([], 1, {});
      const ours   = score([], 1, {});
      const theirs = score([], 1, {});
      theirs.masterBars[0] = masterBar(0, { isRepeatStart: true, repeatCount: 2 });

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.masterBars[0]!.fields.isRepeatStart).toEqual(r(true));
      expect(result.masterBars[0]!.fields.repeatCount).toEqual(r(2));
      expect(result.hasConflicts).toBe(false);
    });
  });

  // ── Bar-level ────────────────────────────────────────────────────────────

  describe("bar status", () => {
    it("should mark bar as equal when unchanged on both sides", () => {
      // Given
      const b = simpleBar(5);
      const base   = score([track("G", [b])], 1);
      const ours   = score([track("G", [b])], 1);
      const theirs = score([track("G", [b])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.tracks[0]!.bars[0]!.status).toBe("equal");
    });

    it("should auto-resolve to ours when only ours changed the bar", () => {
      // Given
      const base   = score([track("G", [simpleBar(5)])], 1);
      const ours   = score([track("G", [simpleBar(7)])], 1);
      const theirs = score([track("G", [simpleBar(5)])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      const bar = result.tracks[0]!.bars[0]!;
      expect(bar.status).toBe("auto-resolved");
      expect(bar.resolvedFrom).toBe("ours");
      expect(bar.hasConflict).toBe(false);
    });

    it("should auto-resolve to theirs when only theirs changed the bar", () => {
      // Given
      const base   = score([track("G", [simpleBar(5)])], 1);
      const ours   = score([track("G", [simpleBar(5)])], 1);
      const theirs = score([track("G", [simpleBar(9)])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      const bar = result.tracks[0]!.bars[0]!;
      expect(bar.status).toBe("auto-resolved");
      expect(bar.resolvedFrom).toBe("theirs");
    });

    it("should auto-resolve as both-same when both sides made the same change", () => {
      // Given
      const base   = score([track("G", [simpleBar(5)])], 1);
      const ours   = score([track("G", [simpleBar(9)])], 1);
      const theirs = score([track("G", [simpleBar(9)])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      const bar = result.tracks[0]!.bars[0]!;
      expect(bar.status).toBe("auto-resolved");
      expect(bar.resolvedFrom).toBe("both-same");
      expect(bar.hasConflict).toBe(false);
    });

    it("should mark bar as ours-only when ours adds a bar not in base or theirs", () => {
      // Given
      const base   = score([track("G", [])], 0);
      const ours   = score([track("G", [simpleBar(5)])], 1);
      const theirs = score([track("G", [])], 0);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.tracks[0]!.bars[0]!.status).toBe("ours-only");
    });

    it("should mark bar as theirs-only when theirs adds a bar not in base or ours", () => {
      // Given
      const base   = score([track("G", [])], 0);
      const ours   = score([track("G", [])], 0);
      const theirs = score([track("G", [simpleBar(5)])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.tracks[0]!.bars[0]!.status).toBe("theirs-only");
    });
  });

  // ── Note-level conflicts ──────────────────────────────────────────────────

  describe("note-level merging within a conflicted bar", () => {
    it("should auto-resolve at note level when only ours changed a fret", () => {
      // Given — base: s1=fret5, ours: s1=fret7, theirs: s1=fret5
      const bBar = bar([voice([beat([note(1, 5)])])]);
      const oBar = bar([voice([beat([note(1, 7)])])]);
      const tBar = bar([voice([beat([note(1, 5)])])]);
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then — bar is in conflict because both sides' fingerprints differ
      // but the note fret should be auto-resolved to ours (7)
      const barMerge = result.tracks[0]!.bars[0]!;
      expect(barMerge.status).toBe("auto-resolved");
      expect(barMerge.resolvedFrom).toBe("ours");
    });

    it("should conflict at note level when both sides changed the same fret differently", () => {
      // Given — base: s1=fret5, ours: s1=fret7, theirs: s1=fret9
      const bBar = bar([voice([beat([note(1, 5)])])]);
      const oBar = bar([voice([beat([note(1, 7)])])]);
      const tBar = bar([voice([beat([note(1, 9)])])]);
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      const barMerge = result.tracks[0]!.bars[0]!;
      expect(barMerge.status).toBe("conflict");
      const fretCell = barMerge.voices[0]!.beats[0]!.notes[0]!.fields.fret;
      expect(fretCell).toEqual({ status: "conflict", base: 5, ours: 7, theirs: 9 });
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.some((c) => c.path.includes(".fret"))).toBe(true);
    });

    it("should auto-resolve articulation when only ours toggled palm mute", () => {
      // Given
      const bBar = bar([voice([beat([note(1, 5, { isPalmMute: false })])])]);
      const oBar = bar([voice([beat([note(1, 5, { isPalmMute: true })])])]);
      const tBar = bar([voice([beat([note(1, 5, { isPalmMute: false })])])]);
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      const barMerge = result.tracks[0]!.bars[0]!;
      expect(barMerge.status).toBe("auto-resolved");
      expect(barMerge.resolvedFrom).toBe("ours");
      expect(barMerge.hasConflict).toBe(false);
    });

    it("should independently merge two non-overlapping articulation changes without conflict", () => {
      // Given — ours enables let-ring, theirs enables palm-mute on the same note.
      // These are different fields, so the merge can satisfy both without conflict.
      const bBar = bar([voice([beat([note(1, 5)])])]);
      const oBar = bar([voice([beat([note(1, 5, { isLetRing: true })])])]);
      const tBar = bar([voice([beat([note(1, 5, { isPalmMute: true })])])]);
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then — each field independently resolved; no conflict needed
      // (boolean fields can never produce a 3-way conflict — only 2 states exist)
      const barMerge = result.tracks[0]!.bars[0]!;
      expect(barMerge.status).toBe("conflict"); // bar fingerprints differ on both sides
      const noteFields = barMerge.voices[0]!.beats[0]!.notes[0]!.fields;
      // isLetRing: base=false, ours=true, theirs=false → only ours changed → resolved: true
      expect(noteFields.isLetRing).toEqual(r(true));
      // isPalmMute: base=false, ours=false, theirs=true → only theirs changed → resolved: true
      expect(noteFields.isPalmMute).toEqual(r(true));
      // The note itself has no remaining conflict after independent field resolution
      expect(barMerge.voices[0]!.beats[0]!.notes[0]!.hasConflict).toBe(false);
    });

    it("should conflict when both changed the same numeric articulation to different values", () => {
      // Given — both changed vibrato type (a numeric enum) differently.
      // vibrato: 0=none, 1=slight, 2=wide
      const bBar = bar([voice([beat([note(1, 5, { vibrato: 0 })])])]);
      const oBar = bar([voice([beat([note(1, 5, { vibrato: 1 })])])]);
      const tBar = bar([voice([beat([note(1, 5, { vibrato: 2 })])])]);
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      const barMerge = result.tracks[0]!.bars[0]!;
      expect(barMerge.status).toBe("conflict");
      const noteFields = barMerge.voices[0]!.beats[0]!.notes[0]!.fields;
      expect(noteFields.vibrato).toEqual({ status: "conflict", base: 0, ours: 1, theirs: 2 });
      expect(barMerge.voices[0]!.beats[0]!.notes[0]!.hasConflict).toBe(true);
    });
  });

  // ── Beat-level conflicts ──────────────────────────────────────────────────

  describe("beat-level merging", () => {
    it("should auto-resolve beat duration when only theirs changed it", () => {
      // Given
      const bBar = bar([voice([beat([note(1, 5)], { duration: 4 })])]);
      const oBar = bar([voice([beat([note(1, 5)], { duration: 4 })])]);
      const tBar = bar([voice([beat([note(1, 5)], { duration: 8 })])]);
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.tracks[0]!.bars[0]!.status).toBe("auto-resolved");
      expect(result.tracks[0]!.bars[0]!.resolvedFrom).toBe("theirs");
    });

    it("should conflict when both changed beat duration to different values", () => {
      // Given
      const bBar = bar([voice([beat([note(1, 5)], { duration: 4 })])]);
      const oBar = bar([voice([beat([note(1, 5)], { duration: 8 })])]);
      const tBar = bar([voice([beat([note(1, 5)], { duration: 16 })])]);
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      const barMerge = result.tracks[0]!.bars[0]!;
      expect(barMerge.status).toBe("conflict");
      const durCell = barMerge.voices[0]!.beats[0]!.fields.duration;
      expect(durCell).toEqual({ status: "conflict", base: 4, ours: 8, theirs: 16 });
      expect(result.conflicts.some((c) => c.path.includes(".duration"))).toBe(true);
    });

    it("should produce a structural beat conflict when both changed beat count differently", () => {
      // Given — base: 2 beats; ours: 3 beats; theirs: 4 beats
      const bBar = bar([voice([beat([note(1, 5)]), beat([note(1, 7)])])]);
      const oBar = bar([voice([beat([note(1, 5)]), beat([note(1, 7)]), beat([note(1, 9)])])]);
      const tBar = bar([voice([beat([note(1, 5)]), beat([note(1, 7)]), beat([note(1, 9)]), beat([note(1, 11)])])]);
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      const barMerge = result.tracks[0]!.bars[0]!;
      expect(barMerge.status).toBe("conflict");
      const sc = barMerge.voices[0]!.structuralBeatConflict;
      expect(sc).not.toBeNull();
      expect(sc!.oursCount).toBe(3);
      expect(sc!.theirsCount).toBe(4);
      expect(sc!.baseCount).toBe(2);
      expect(result.conflicts.some((c) => c.kind === "structural-beat")).toBe(true);
    });

    it("should not produce a structural conflict when both changed to the same beat count", () => {
      // Given — ours and theirs both add one beat to base
      const bBar = bar([voice([beat([note(1, 5)])])]);
      const oBar = bar([voice([beat([note(1, 7)]), beat([note(1, 9)])])]);
      const tBar = bar([voice([beat([note(1, 7)]), beat([note(1, 9)])])]);
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then — identical so auto-resolved, no structural conflict
      expect(result.tracks[0]!.bars[0]!.status).toBe("auto-resolved");
      expect(result.tracks[0]!.bars[0]!.resolvedFrom).toBe("both-same");
    });
  });

  // ── Structural note conflicts ─────────────────────────────────────────────

  describe("structural note conflicts", () => {
    it("should surface structural note conflict when ours removes a note theirs keeps", () => {
      // Given — base: s1=5 s2=7; ours: s1=5 (removed s2); theirs: s1=5 s2=7 (kept)
      const bBar = bar([voice([beat([note(1, 5), note(2, 7)])])]);
      const oBar = bar([voice([beat([note(1, 5)])])]);
      const tBar = bar([voice([beat([note(1, 5), note(2, 9)])])]);  // theirs changed s2 fret
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then — bar is in conflict; structural note conflict on string 2
      const barMerge = result.tracks[0]!.bars[0]!;
      expect(barMerge.status).toBe("conflict");
      const sConflicts = barMerge.voices[0]!.beats[0]!.structuralNoteConflicts;
      expect(sConflicts.some((c) => c.string === 2 && c.kind === "removed-ours")).toBe(true);
      expect(result.conflicts.some((c) => c.kind === "structural-note")).toBe(true);
    });

    it("should auto-resolve when only ours adds a new note on an unused string", () => {
      // Given — base: s1=5; ours: s1=5 s2=7; theirs: s1=5
      const bBar = bar([voice([beat([note(1, 5)])])]);
      const oBar = bar([voice([beat([note(1, 5), note(2, 7)])])]);
      const tBar = bar([voice([beat([note(1, 5)])])]);
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then — only ours changed, auto-resolved
      expect(result.tracks[0]!.bars[0]!.status).toBe("auto-resolved");
      expect(result.tracks[0]!.bars[0]!.resolvedFrom).toBe("ours");
      expect(result.hasConflicts).toBe(false);
    });

    it("should auto-resolve when both sides added the same note on the same string", () => {
      // Given — base: s1=5; ours: s1=5 s2=7; theirs: s1=5 s2=7
      const bBar = bar([voice([beat([note(1, 5)])])]);
      const oBar = bar([voice([beat([note(1, 5), note(2, 7)])])]);
      const tBar = bar([voice([beat([note(1, 5), note(2, 7)])])]);
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then — same change on both sides
      expect(result.tracks[0]!.bars[0]!.status).toBe("auto-resolved");
      expect(result.hasConflicts).toBe(false);
    });

    it("should conflict when both sides added different frets on the same new string", () => {
      // Given — base: s1=5; ours: s1=5 s2=7; theirs: s1=5 s2=9
      const bBar = bar([voice([beat([note(1, 5)])])]);
      const oBar = bar([voice([beat([note(1, 5), note(2, 7)])])]);
      const tBar = bar([voice([beat([note(1, 5), note(2, 9)])])]);
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then — both added s2 but with different frets
      const barMerge = result.tracks[0]!.bars[0]!;
      expect(barMerge.status).toBe("conflict");
      const s2Note = barMerge.voices[0]!.beats[0]!.notes.find((n) => n.string === 2);
      expect(s2Note).toBeDefined();
      expect(s2Note!.hasConflict).toBe(true);
    });
  });

  // ── Multi-bar / multi-track ───────────────────────────────────────────────

  describe("multiple bars and tracks", () => {
    it("should merge each bar independently", () => {
      // Given — bar 0 unchanged, bar 1 changed by ours only
      const base   = score([track("G", [simpleBar(5), simpleBar(7)])], 2);
      const ours   = score([track("G", [simpleBar(5), simpleBar(9)])], 2);
      const theirs = score([track("G", [simpleBar(5), simpleBar(7)])], 2);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      const bars = result.tracks[0]!.bars;
      expect(bars[0]!.status).toBe("equal");
      expect(bars[1]!.status).toBe("auto-resolved");
      expect(bars[1]!.resolvedFrom).toBe("ours");
    });

    it("should merge each track independently", () => {
      // Given — guitar has a conflict, bass is clean
      const bBar = bar([voice([beat([note(1, 5)])])]);
      const oBar = bar([voice([beat([note(1, 7)])])]);
      const tBar = bar([voice([beat([note(1, 9)])])]);

      const base   = score([track("Guitar", [bBar]), track("Bass", [simpleBar(3)])], 1);
      const ours   = score([track("Guitar", [oBar]), track("Bass", [simpleBar(3)])], 1);
      const theirs = score([track("Guitar", [tBar]), track("Bass", [simpleBar(3)])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.tracks[0]!.hasConflict).toBe(true);
      expect(result.tracks[1]!.hasConflict).toBe(false);
    });
  });

  // ── ConflictLocation paths ────────────────────────────────────────────────

  describe("conflict location paths", () => {
    it("should produce a conflict path for a meta field", () => {
      // Given
      const base   = score([], 0, { tempo: 120 });
      const ours   = score([], 0, { tempo: 140 });
      const theirs = score([], 0, { tempo: 160 });

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      const loc = result.conflicts.find((c) => c.path === "meta.tempo");
      expect(loc).toBeDefined();
      expect(loc!.kind).toBe("field");
      expect(loc!.description).toContain("140");
      expect(loc!.description).toContain("160");
    });

    it("should produce a conflict path for a masterBar field", () => {
      // Given
      const base   = score([], 1, {});
      const ours   = score([], 1, {});
      const theirs = score([], 1, {});
      ours.masterBars[0]   = masterBar(0, { timeSignatureNumerator: 3 });
      theirs.masterBars[0] = masterBar(0, { timeSignatureNumerator: 6 });

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.conflicts.some((c) => c.path === "masterBar[0].timeSignatureNumerator")).toBe(true);
    });

    it("should produce a conflict path down to the note field level", () => {
      // Given
      const bBar = bar([voice([beat([note(1, 5)])])]);
      const oBar = bar([voice([beat([note(1, 7)])])]);
      const tBar = bar([voice([beat([note(1, 9)])])]);
      const base   = score([track("Guitar", [bBar])], 1);
      const ours   = score([track("Guitar", [oBar])], 1);
      const theirs = score([track("Guitar", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      const loc = result.conflicts.find((c) => c.path.endsWith(".fret"));
      expect(loc).toBeDefined();
      expect(loc!.path).toBe("track[0].bar[0].voice[0].beat[0].note[s=1].fret");
      expect(loc!.kind).toBe("field");
    });

    it("should produce a structural-beat conflict path", () => {
      // Given — ours: 3 beats, theirs: 4 beats (both different from base 2)
      const bBar = bar([voice([beat([note(1, 5)]), beat([note(1, 7)])])]);
      const oBar = bar([voice([beat([note(1, 5)]), beat([note(1, 7)]), beat([note(1, 9)])])]);
      const tBar = bar([voice([beat([note(1, 5)]), beat([note(1, 7)]), beat([note(1, 9)]), beat([note(1, 11)])])]);
      const base   = score([track("G", [bBar])], 1);
      const ours   = score([track("G", [oBar])], 1);
      const theirs = score([track("G", [tBar])], 1);

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      const loc = result.conflicts.find((c) => c.kind === "structural-beat");
      expect(loc).toBeDefined();
      expect(loc!.path).toBe("track[0].bar[0].voice[0].structuralBeats");
      expect(loc!.description).toContain("3");
      expect(loc!.description).toContain("4");
    });
  });

  // ── Conflict count ────────────────────────────────────────────────────────

  describe("conflictCount", () => {
    it("should count each conflict location separately", () => {
      // Given — tempo + title both conflict
      const base   = score([], 0, { tempo: 120, title: "A" });
      const ours   = score([], 0, { tempo: 140, title: "B" });
      const theirs = score([], 0, { tempo: 160, title: "C" });

      // When
      const result = mergeScores(base, ours, theirs);

      // Then
      expect(result.conflictCount).toBe(2);
      expect(result.conflicts).toHaveLength(2);
    });

    it("should be zero when there are no conflicts", () => {
      // Given
      const s = score([], 0);

      // When
      const result = mergeScores(s, s, s);

      // Then
      expect(result.conflictCount).toBe(0);
      expect(result.hasConflicts).toBe(false);
    });
  });
});
