import { describe, it, expect } from 'vitest';
import { barContent, changedContent } from './barContent';
import { diffScores } from './diff';
import type { Bar, Beat, Note } from './types/score';
import {
  makeBar,
  makeBeat,
  makeNote,
  makeScore,
  makeTrack,
  makeVoice,
} from './__fixtures__/buildScore';

// A bar of one beat per entry, each entry the notes of that beat.
function bar(beats: Note[][], overrides: Partial<Beat>[] = []): Bar {
  return makeBar([
    makeVoice(beats.map((notes, i) => makeBeat(notes, overrides[i] ?? {}))),
  ]);
}

describe('barContent', () => {
  describe('when a note is added to an existing beat', () => {
    it('should mark only the new note, and only on the head side', () => {
      // Given a beat that gains a second note
      const base = bar([[makeNote(1, 5)]]);
      const head = bar([[makeNote(1, 5), makeNote(2, 7)]]);

      // When the bar's content is diffed
      const marks = barContent(base, head);

      // Then nothing is removed and the added note alone is marked
      expect(marks.base).toEqual([]);
      expect(marks.head).toEqual([
        { voiceIndex: 0, beatIndex: 0, noteIndex: 1 },
      ]);
    });
  });

  describe('when a note is deleted from a beat', () => {
    it('should mark the deleted note on the base side only', () => {
      // Given a beat that loses its second note
      const base = bar([[makeNote(1, 5), makeNote(2, 7)]]);
      const head = bar([[makeNote(1, 5)]]);

      // When the bar's content is diffed
      const marks = barContent(base, head);

      // Then the note is marked where it still exists — the base pane
      expect(marks.base).toEqual([
        { voiceIndex: 0, beatIndex: 0, noteIndex: 1 },
      ]);
      expect(marks.head).toEqual([]);
    });
  });

  describe('when a fret is changed', () => {
    it('should mark the old note on base and the new note on head', () => {
      // Given fret 1 on the third string becomes fret 2
      const base = bar([[makeNote(3, 1)]]);
      const head = bar([[makeNote(3, 2)]]);

      // When the bar's content is diffed
      const marks = barContent(base, head);

      // Then both sides carry a mark on that note — red on the 1, green on the 2
      expect(marks.base).toEqual([
        { voiceIndex: 0, beatIndex: 0, noteIndex: 0 },
      ]);
      expect(marks.head).toEqual([
        { voiceIndex: 0, beatIndex: 0, noteIndex: 0 },
      ]);
    });

    it('should leave the untouched notes of the same chord unmarked', () => {
      // Given a three-note chord where only the middle note moves
      const base = bar([[makeNote(1, 5), makeNote(2, 7), makeNote(3, 9)]]);
      const head = bar([[makeNote(1, 5), makeNote(2, 8), makeNote(3, 9)]]);

      // When the bar's content is diffed
      const marks = barContent(base, head);

      // Then only that note is marked, on either side
      expect(marks.base).toEqual([
        { voiceIndex: 0, beatIndex: 0, noteIndex: 1 },
      ]);
      expect(marks.head).toEqual([
        { voiceIndex: 0, beatIndex: 0, noteIndex: 1 },
      ]);
    });
  });

  describe('when a beat-level field changes', () => {
    it('should mark the whole beat rather than its notes', () => {
      // Given a beat whose duration changes but whose note does not
      const base = bar([[makeNote(1, 5)]], [{ duration: 4 }]);
      const head = bar([[makeNote(1, 5)]], [{ duration: 8 }]);

      // When the bar's content is diffed
      const marks = barContent(base, head);

      // Then the mark covers the beat — noteIndex is null on both sides
      expect(marks.base).toEqual([
        { voiceIndex: 0, beatIndex: 0, noteIndex: null },
      ]);
      expect(marks.head).toEqual([
        { voiceIndex: 0, beatIndex: 0, noteIndex: null },
      ]);
    });
  });

  describe('when a beat is inserted at the top of the bar', () => {
    it('should mark the inserted beat and leave the shifted ones alone', () => {
      // Given a bar whose two beats are pushed along by a new first beat
      const base = bar([[makeNote(1, 5)], [makeNote(1, 7)]]);
      const head = bar([[makeNote(1, 3)], [makeNote(1, 5)], [makeNote(1, 7)]]);

      // When the bar's content is diffed
      const marks = barContent(base, head);

      // Then only the insertion is marked — the beats it displaced are not
      expect(marks.base).toEqual([]);
      expect(marks.head).toEqual([
        { voiceIndex: 0, beatIndex: 0, noteIndex: null },
      ]);
    });
  });

  describe('when nothing changed', () => {
    it('should return no marks for identical bars', () => {
      // Given two bars with the same content
      const base = bar([[makeNote(1, 5)]]);
      const head = bar([[makeNote(1, 5)]]);

      // When the bar's content is diffed
      const marks = barContent(base, head);

      // Then neither side is marked
      expect(marks).toEqual({ base: [], head: [] });
    });
  });
});

describe('changedContent', () => {
  it('should address each mark in its own pane score when a measure was inserted', () => {
    // Given an anchor measure, an insertion before it, and an edit after it —
    // so the edited measure is bar 1 in base and bar 2 in head
    const anchor = () => bar([[makeNote(4, 2)]]);
    const base = makeScore(
      [makeTrack('Guitar', [anchor(), bar([[makeNote(1, 5)]])])],
      2,
    );
    const head = makeScore(
      [
        makeTrack('Guitar', [
          bar([[makeNote(2, 3)]]),
          anchor(),
          bar([[makeNote(1, 6)]]),
        ]),
      ],
      3,
    );

    // When the score's content marks are collected for that track
    const marks = changedContent(diffScores(base, head), 0);

    // Then each mark is numbered in its own pane's score
    expect(marks.base).toEqual([
      {
        masterBarIndex: 1,
        trackIndex: 0,
        staffIndex: 0,
        voiceIndex: 0,
        beatIndex: 0,
        noteIndex: 0,
      },
    ]);
    expect(marks.head).toEqual([
      {
        masterBarIndex: 2,
        trackIndex: 0,
        staffIndex: 0,
        voiceIndex: 0,
        beatIndex: 0,
        noteIndex: 0,
      },
    ]);
  });

  it('should skip added and removed measures, which are whole-measure facts', () => {
    // Given head simply appends a measure
    const base = makeScore([makeTrack('Guitar', [bar([[makeNote(1, 5)]])])], 1);
    const head = makeScore(
      [makeTrack('Guitar', [bar([[makeNote(1, 5)]]), bar([[makeNote(1, 7)]])])],
      2,
    );

    // When the score's content marks are collected
    const marks = changedContent(diffScores(base, head), null);

    // Then the added measure contributes nothing at note level
    expect(marks).toEqual({ base: [], head: [] });
  });

  it('should report only the requested track when one is given', () => {
    // Given an edit in the bass while the guitar is untouched
    const guitar = () => makeTrack('Guitar', [bar([[makeNote(1, 5)]])]);
    const bass = (fret: number) =>
      makeTrack('Bass', [bar([[makeNote(1, fret)]])], {
        playbackInfo: { primaryChannel: 2, program: 33 },
      });
    const diff = diffScores(
      makeScore([guitar(), bass(3)], 1),
      makeScore([guitar(), bass(5)], 1),
    );

    // When marks are collected for the guitar and for the bass
    const forGuitar = changedContent(diff, 0);
    const forBass = changedContent(diff, 1);

    // Then only the bass carries marks
    expect(forGuitar).toEqual({ base: [], head: [] });
    expect(forBass.base).toHaveLength(1);
    expect(forBass.base[0]!.trackIndex).toBe(1);
  });
});
