import { describe, it, expect } from "vitest";
import { diffScores } from "./diff.js";
import type { Score, Bar, Beat, Note, Voice, Track, Staff, MasterBar } from "./types/score.js";

// ─── Test factory helpers ─────────────────────────────────────────────────────
// Build minimal AlphaTab-shaped mock objects. The diff algorithm only reads
// properties — it never calls AlphaTab methods — so plain objects cast to the
// right types are sufficient.

function makeNote(string: number, fret: number, overrides: Partial<Note> = {}): Note {
  return {
    string,
    fret,
    isDead: false,
    isHammerPullOrigin: false,
    bendType: 0,
    slideInType: 0,
    slideOutType: 0,
    vibrato: 0,
    isLetRing: false,
    isPalmMute: false,
    harmonicType: 0,
    trillValue: 0,
    accentuated: 0,
    ...overrides,
  } as unknown as Note;
}

function makeBeat(notes: Note[], overrides: Partial<Beat> = {}): Beat {
  return {
    duration: 4,
    dots: 0,
    isRest: notes.length === 0,
    tupletNumerator: 1,
    tupletDenominator: 1,
    notes,
    ...overrides,
  } as unknown as Beat;
}

function makeVoice(beats: Beat[]): Voice {
  return { index: 0, beats } as unknown as Voice;
}

function makeBar(voices: Voice[]): Bar {
  return { voices } as unknown as Bar;
}

function makeMasterBar(index: number): MasterBar {
  return { index, timeSignatureNumerator: 4, timeSignatureDenominator: 4 } as unknown as MasterBar;
}

function makeStaff(bars: Bar[]): Staff {
  return { bars } as unknown as Staff;
}

function makeTrack(name: string, bars: Bar[]): Track {
  return { index: 0, name, staves: [makeStaff(bars)] } as unknown as Track;
}

function makeScore(tracks: Track[], masterBarCount: number, overrides: Partial<Score> = {}): Score {
  const masterBars = Array.from({ length: masterBarCount }, (_, i) => makeMasterBar(i));
  return {
    title: "Test Song",
    artist: "Artist",
    tempo: 120,
    tracks,
    masterBars,
    ...overrides,
  } as unknown as Score;
}

// Minimal bar with a single beat containing one note at the given fret
function simpleBar(fret: number): Bar {
  return makeBar([makeVoice([makeBeat([makeNote(1, fret)])])]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("diffScores", () => {
  describe("when scores are identical", () => {
    it("should mark all bars as equal when both scores have the same content", () => {
      // Given two identical single-track scores with one bar
      const bar = simpleBar(5);
      const track = makeTrack("Guitar", [bar]);
      const score = makeScore([track], 1);

      // When diffed with itself
      const result = diffScores(score, score);

      // Then the bar is equal and summary reports no changes
      expect(result.tracks[0]!.bars[0]!.type).toBe("equal");
      expect(result.summary).toBe("No changes");
    });

    it("should return an empty meta diff when metadata is unchanged", () => {
      // Given two identical scores
      const score = makeScore([], 0, { title: "Same", artist: "Same", tempo: 120 });

      // When diffed
      const result = diffScores(score, score);

      // Then meta diff has no entries
      expect(result.meta.title).toBeUndefined();
      expect(result.meta.artist).toBeUndefined();
      expect(result.meta.tempo).toBeUndefined();
    });
  });

  describe("when a bar is added in head", () => {
    it("should mark the extra bar as added when head has more master bars than base", () => {
      // Given base has 1 bar and head has 2 bars for the same track
      const track1 = makeTrack("Guitar", [simpleBar(5)]);
      const track2 = makeTrack("Guitar", [simpleBar(5), simpleBar(7)]);
      const base = makeScore([track1], 1);
      const head = makeScore([track2], 2);

      // When diffed
      const result = diffScores(base, head);

      // Then the second bar is added
      const bars = result.tracks[0]!.bars;
      expect(bars[0]!.type).toBe("equal");
      expect(bars[1]!.type).toBe("added");
    });

    it("should include the added bar in the diff entry", () => {
      // Given head has an extra bar
      const newBar = simpleBar(9);
      const base = makeScore([makeTrack("Guitar", [simpleBar(5)])], 1);
      const head = makeScore([makeTrack("Guitar", [simpleBar(5), newBar])], 2);

      // When diffed
      const result = diffScores(base, head);

      // Then the added entry references the new bar object
      const added = result.tracks[0]!.bars[1]!;
      if (added.type === "added") {
        expect(added.bar).toBe(newBar);
      } else {
        expect.fail("Expected bar diff type to be 'added'");
      }
    });
  });

  describe("when a bar is removed in head", () => {
    it("should mark the missing bar as removed when head has fewer master bars", () => {
      // Given base has 2 bars and head has only 1
      const removedBar = simpleBar(7);
      const base = makeScore([makeTrack("Guitar", [simpleBar(5), removedBar])], 2);
      const head = makeScore([makeTrack("Guitar", [simpleBar(5)])], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then the second bar is removed
      const bars = result.tracks[0]!.bars;
      expect(bars[0]!.type).toBe("equal");
      expect(bars[1]!.type).toBe("removed");
    });

    it("should include the removed bar in the diff entry", () => {
      // Given a bar that exists in base but not in head
      const droppedBar = simpleBar(7);
      const base = makeScore([makeTrack("Guitar", [simpleBar(5), droppedBar])], 2);
      const head = makeScore([makeTrack("Guitar", [simpleBar(5)])], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then the removed entry references the dropped bar
      const removed = result.tracks[0]!.bars[1]!;
      if (removed.type === "removed") {
        expect(removed.bar).toBe(droppedBar);
      } else {
        expect.fail("Expected bar diff type to be 'removed'");
      }
    });
  });

  describe("when a bar content changes", () => {
    it("should mark the bar as changed when fret values differ", () => {
      // Given the same bar index but different fret in base (5) vs head (7)
      const base = makeScore([makeTrack("Guitar", [simpleBar(5)])], 1);
      const head = makeScore([makeTrack("Guitar", [simpleBar(7)])], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then the bar is changed
      expect(result.tracks[0]!.bars[0]!.type).toBe("changed");
    });

    it("should expose both base and head bar in a changed entry", () => {
      // Given bars with fret 5 vs fret 9
      const baseBar = simpleBar(5);
      const headBar = simpleBar(9);
      const base = makeScore([makeTrack("Guitar", [baseBar])], 1);
      const head = makeScore([makeTrack("Guitar", [headBar])], 1);

      // When diffed
      const result = diffScores(base, head);
      const diff = result.tracks[0]!.bars[0]!;

      // Then both bar references are accessible
      if (diff.type === "changed") {
        expect(diff.base).toBe(baseBar);
        expect(diff.head).toBe(headBar);
      } else {
        expect.fail("Expected bar diff type to be 'changed'");
      }
    });

    it("should mark bar as equal when note order differs but content is the same", () => {
      // Given two bars that have the same notes on different strings (sorted by string)
      const bar1 = makeBar([makeVoice([makeBeat([makeNote(2, 5), makeNote(1, 3)])])]);
      const bar2 = makeBar([makeVoice([makeBeat([makeNote(1, 3), makeNote(2, 5)])])]);
      const base = makeScore([makeTrack("Guitar", [bar1])], 1);
      const head = makeScore([makeTrack("Guitar", [bar2])], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then bars are equal because fingerprint sorts notes by string
      expect(result.tracks[0]!.bars[0]!.type).toBe("equal");
    });
  });

  describe("when a track is added or removed", () => {
    it("should mark all bars as added when a track exists only in head", () => {
      // Given base has no tracks and head has one track with one bar
      const base = makeScore([], 0);
      const head = makeScore([makeTrack("Guitar", [simpleBar(5)])], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then all bars of the new track are added
      expect(result.tracks[0]!.bars[0]!.type).toBe("added");
    });

    it("should mark all bars as removed when a track exists only in base", () => {
      // Given base has a track and head has none
      const base = makeScore([makeTrack("Guitar", [simpleBar(5)])], 1);
      const head = makeScore([], 0);

      // When diffed
      const result = diffScores(base, head);

      // Then all bars of the dropped track are removed
      expect(result.tracks[0]!.bars[0]!.type).toBe("removed");
    });
  });

  describe("meta diff", () => {
    it("should detect a title change when titles differ", () => {
      // Given base and head have different titles
      const base = makeScore([], 0, { title: "Draft" });
      const head = makeScore([], 0, { title: "Final" });

      // When diffed
      const result = diffScores(base, head);

      // Then meta.title captures [before, after]
      expect(result.meta.title).toEqual(["Draft", "Final"]);
    });

    it("should detect a tempo change when tempos differ", () => {
      // Given base tempo 120 and head tempo 140
      const base = makeScore([], 0, { tempo: 120 });
      const head = makeScore([], 0, { tempo: 140 });

      // When diffed
      const result = diffScores(base, head);

      // Then meta.tempo captures [before, after]
      expect(result.meta.tempo).toEqual([120, 140]);
    });

    it("should omit unchanged meta fields from the diff", () => {
      // Given scores that differ only in tempo
      const base = makeScore([], 0, { title: "Same", tempo: 100 });
      const head = makeScore([], 0, { title: "Same", tempo: 110 });

      // When diffed
      const result = diffScores(base, head);

      // Then title is absent from meta diff
      expect(result.meta.title).toBeUndefined();
      expect(result.meta.tempo).toBeDefined();
    });
  });

  describe("summary", () => {
    it("should describe changed and added bars by track name", () => {
      // Given a track where one bar changed and one was added
      const base = makeScore([makeTrack("Guitar", [simpleBar(5)])], 1);
      const head = makeScore([makeTrack("Guitar", [simpleBar(7), simpleBar(9)])], 2);

      // When diffed
      const result = diffScores(base, head);

      // Then summary names the track and lists counts
      expect(result.summary).toContain("Guitar");
      expect(result.summary).toContain("1 changed");
      expect(result.summary).toContain("1 added");
    });

    it("should return 'No changes' when both scores are empty", () => {
      // Given two empty scores
      const score = makeScore([], 0);

      // When diffed with itself
      const result = diffScores(score, score);

      // Then summary is the no-changes sentinel
      expect(result.summary).toBe("No changes");
    });

    it("should list all tracks that have changes separated by a middle dot", () => {
      // Given two tracks, both with changes
      const base = makeScore(
        [makeTrack("Guitar", [simpleBar(5)]), makeTrack("Bass", [simpleBar(3)])],
        1
      );
      const head = makeScore(
        [makeTrack("Guitar", [simpleBar(7)]), makeTrack("Bass", [simpleBar(4)])],
        1
      );

      // When diffed
      const result = diffScores(base, head);

      // Then both track names appear in the summary
      expect(result.summary).toContain("Guitar");
      expect(result.summary).toContain("Bass");
      expect(result.summary).toContain("·");
    });
  });
});
