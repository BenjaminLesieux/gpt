import { describe, it, expect } from 'vitest';
import { barsForTrack, changeCounts, changedBars, diffScores } from './diff';
import type { Bar, Beat, Note } from './types/score';
import {
  makeBar,
  makeBeat,
  makeBendPoints,
  makeNote,
  makeScore,
  makeTrack,
  makeVoice,
} from './__fixtures__/buildScore';

// Minimal bar with a single beat containing one note at the given fret
function simpleBar(fret: number): Bar {
  return makeBar([makeVoice([makeBeat([makeNote(1, fret)])])]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('diffScores', () => {
  describe('when scores are identical', () => {
    it('should mark all bars as equal when both scores have the same content', () => {
      // Given two identical single-track scores with one bar
      const bar = simpleBar(5);
      const track = makeTrack('Guitar', [bar]);
      const score = makeScore([track], 1);

      // When diffed with itself
      const result = diffScores(score, score);

      // Then the bar is equal and summary reports no changes
      expect(barsForTrack(result, 0)[0]!.type).toBe('equal');
      expect(result.summary).toBe('No changes');
    });

    it('should return an empty meta diff when metadata is unchanged', () => {
      // Given two identical scores — tempo lives on the first master bar in the
      // real model, so the score needs at least one measure to carry it
      const score = makeScore([], 1, {
        title: 'Same',
        artist: 'Same',
        tempo: 120,
      });

      // When diffed
      const result = diffScores(score, score);

      // Then meta diff has no entries
      expect(result.meta.title).toBeUndefined();
      expect(result.meta.artist).toBeUndefined();
      expect(result.meta.tempo).toBeUndefined();
    });
  });

  describe('when a bar is added in head', () => {
    it('should mark the extra bar as added when head has more master bars than base', () => {
      // Given base has 1 bar and head has 2 bars for the same track
      const track1 = makeTrack('Guitar', [simpleBar(5)]);
      const track2 = makeTrack('Guitar', [simpleBar(5), simpleBar(7)]);
      const base = makeScore([track1], 1);
      const head = makeScore([track2], 2);

      // When diffed
      const result = diffScores(base, head);

      // Then the second bar is added
      const bars = barsForTrack(result, 0);
      expect(bars[0]!.type).toBe('equal');
      expect(bars[1]!.type).toBe('added');
    });

    it('should include the added bar in the diff entry', () => {
      // Given head has an extra bar
      const newBar = simpleBar(9);
      const base = makeScore([makeTrack('Guitar', [simpleBar(5)])], 1);
      const head = makeScore([makeTrack('Guitar', [simpleBar(5), newBar])], 2);

      // When diffed
      const result = diffScores(base, head);

      // Then the added entry references the new bar object
      const added = barsForTrack(result, 0)[1]!;
      if (added.type === 'added') {
        expect(added.bar).toBe(newBar);
      } else {
        expect.fail("Expected bar diff type to be 'added'");
      }
    });
  });

  describe('when a bar is removed in head', () => {
    it('should mark the missing bar as removed when head has fewer master bars', () => {
      // Given base has 2 bars and head has only 1
      const removedBar = simpleBar(7);
      const base = makeScore(
        [makeTrack('Guitar', [simpleBar(5), removedBar])],
        2,
      );
      const head = makeScore([makeTrack('Guitar', [simpleBar(5)])], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then the second bar is removed
      const bars = barsForTrack(result, 0);
      expect(bars[0]!.type).toBe('equal');
      expect(bars[1]!.type).toBe('removed');
    });

    it('should include the removed bar in the diff entry', () => {
      // Given a bar that exists in base but not in head
      const droppedBar = simpleBar(7);
      const base = makeScore(
        [makeTrack('Guitar', [simpleBar(5), droppedBar])],
        2,
      );
      const head = makeScore([makeTrack('Guitar', [simpleBar(5)])], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then the removed entry references the dropped bar
      const removed = barsForTrack(result, 0)[1]!;
      if (removed.type === 'removed') {
        expect(removed.bar).toBe(droppedBar);
      } else {
        expect.fail("Expected bar diff type to be 'removed'");
      }
    });
  });

  describe('when a bar content changes', () => {
    it('should mark the bar as changed when fret values differ', () => {
      // Given the same bar index but different fret in base (5) vs head (7)
      const base = makeScore([makeTrack('Guitar', [simpleBar(5)])], 1);
      const head = makeScore([makeTrack('Guitar', [simpleBar(7)])], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then the bar is changed
      expect(barsForTrack(result, 0)[0]!.type).toBe('changed');
    });

    it('should expose both base and head bar in a changed entry', () => {
      // Given bars with fret 5 vs fret 9
      const baseBar = simpleBar(5);
      const headBar = simpleBar(9);
      const base = makeScore([makeTrack('Guitar', [baseBar])], 1);
      const head = makeScore([makeTrack('Guitar', [headBar])], 1);

      // When diffed
      const result = diffScores(base, head);
      const diff = barsForTrack(result, 0)[0]!;

      // Then both bar references are accessible
      if (diff.type === 'changed') {
        expect(diff.base).toBe(baseBar);
        expect(diff.head).toBe(headBar);
      } else {
        expect.fail("Expected bar diff type to be 'changed'");
      }
    });

    it('should mark bar as equal when note order differs but content is the same', () => {
      // Given two bars that have the same notes on different strings (sorted by string)
      const bar1 = makeBar([
        makeVoice([makeBeat([makeNote(2, 5), makeNote(1, 3)])]),
      ]);
      const bar2 = makeBar([
        makeVoice([makeBeat([makeNote(1, 3), makeNote(2, 5)])]),
      ]);
      const base = makeScore([makeTrack('Guitar', [bar1])], 1);
      const head = makeScore([makeTrack('Guitar', [bar2])], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then bars are equal because fingerprint sorts notes by string
      expect(barsForTrack(result, 0)[0]!.type).toBe('equal');
    });
  });

  describe('when a track is added or removed', () => {
    it('should mark all bars as added when a track exists only in head', () => {
      // Given base has no tracks and head has one track with one bar
      const base = makeScore([], 0);
      const head = makeScore([makeTrack('Guitar', [simpleBar(5)])], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then all bars of the new track are added
      expect(barsForTrack(result, 0)[0]!.type).toBe('added');
    });

    it('should mark all bars as removed when a track exists only in base', () => {
      // Given base has a track and head has none
      const base = makeScore([makeTrack('Guitar', [simpleBar(5)])], 1);
      const head = makeScore([], 0);

      // When diffed
      const result = diffScores(base, head);

      // Then all bars of the dropped track are removed
      expect(barsForTrack(result, 0)[0]!.type).toBe('removed');
    });
  });

  describe('edits the fingerprint used to miss', () => {
    // Each case is an edit a musician can make in Guitar Pro that produced no
    // diff at all, because the field was absent from the bar fingerprint.

    function barWithNote(overrides: Partial<Note>): Bar {
      return makeBar([makeVoice([makeBeat([makeNote(1, 5, overrides)])])]);
    }

    function barWithBeat(overrides: Partial<Beat>): Bar {
      return makeBar([makeVoice([makeBeat([makeNote(1, 5)], overrides)])]);
    }

    function expectChanged(baseBar: Bar, headBar: Bar) {
      const result = diffScores(
        makeScore([makeTrack('Guitar', [baseBar])], 1),
        makeScore([makeTrack('Guitar', [headBar])], 1),
      );
      return expect(barsForTrack(result, 0)[0]!.type);
    }

    it("should detect a change when a bend's shape is edited", () => {
      // Given the same bend type but a different curve
      const base = barWithNote({
        bendType: 1,
        bendPoints: makeBendPoints([
          [0, 0],
          [60, 4],
        ]),
      });
      const head = barWithNote({
        bendType: 1,
        bendPoints: makeBendPoints([
          [0, 0],
          [60, 8],
        ]),
      });

      // When diffed / Then the bar is changed
      expectChanged(base, head).toBe('changed');
    });

    it('should detect a change when a note becomes tied to the previous one', () => {
      // Given two notes at the same pitch, the second gaining a tie. The tie
      // must have a real origin: Score.finish() drops an isTieDestination
      // whose origin note cannot be found, so a lone tied note is a fixture
      // that cannot exist in a parsed file.
      const twoNotes = (tied: boolean) =>
        makeBar([
          makeVoice([
            makeBeat([makeNote(1, 5)]),
            makeBeat([makeNote(1, 5, { isTieDestination: tied })]),
          ]),
        ]);

      const result = diffScores(
        makeScore([makeTrack('Guitar', [twoNotes(false)])], 1),
        makeScore([makeTrack('Guitar', [twoNotes(true)])], 1),
      );
      const bar = barsForTrack(result, 0)[0]!;

      // Then the diff both flags the bar and explains it
      expect(bar.type).toBe('changed');
      if (bar.type === 'changed') {
        expect(bar.changedFields.length).toBeGreaterThan(0);
      }
    });

    it("should detect a change when a beat's dynamics are edited", () => {
      // Given a beat that goes from mezzo-forte to fortissimo
      expectChanged(
        barWithBeat({ dynamics: 4 as Beat['dynamics'] }),
        barWithBeat({ dynamics: 7 as Beat['dynamics'] }),
      ).toBe('changed');
    });

    it('should detect a change when a beat becomes a grace note', () => {
      // Given a beat turned into a grace note
      expectChanged(
        barWithBeat({ graceType: 0 as Beat['graceType'] }),
        barWithBeat({ graceType: 2 as Beat['graceType'] }),
      ).toBe('changed');
    });

    it('should detect a change when a whammy bar dive is edited', () => {
      // Given a beat whose whammy curve moves
      expectChanged(
        barWithBeat({
          whammyBarType: 2 as Beat['whammyBarType'],
          whammyBarPoints: makeBendPoints([[0, 0]]),
        }),
        barWithBeat({
          whammyBarType: 2 as Beat['whammyBarType'],
          whammyBarPoints: makeBendPoints([[0, -4]]),
        }),
      ).toBe('changed');
    });

    it.each([
      [
        'a bend curve',
        { bendType: 1, bendPoints: makeBendPoints([[0, 4]]) },
        { bendType: 1, bendPoints: makeBendPoints([[0, 8]]) },
      ],
      ['a fingering', { leftHandFinger: 1 }, { leftHandFinger: 3 }],
    ])(
      'should always name at least one changed field when %s changes',
      (_label, baseOverrides, headOverrides) => {
        // Given a bar whose only edit is the field under test
        const result = diffScores(
          makeScore(
            [
              makeTrack('Guitar', [
                barWithNote(baseOverrides as Partial<Note>),
              ]),
            ],
            1,
          ),
          makeScore(
            [
              makeTrack('Guitar', [
                barWithNote(headOverrides as Partial<Note>),
              ]),
            ],
            1,
          ),
        );
        const bar = barsForTrack(result, 0)[0]!;

        // Then the diff both flags the bar and explains it — an unexplained
        // "changed" bar renders as a highlight with no chip in the UI
        expect(bar.type).toBe('changed');
        if (bar.type === 'changed') {
          expect(bar.changedFields.length).toBeGreaterThan(0);
        }
      },
    );

    it.each([
      ['dynamics', { dynamics: 4 }, { dynamics: 7 }],
      ['a grace note', { graceType: 0 }, { graceType: 2 }],
      [
        'a whammy dive',
        { whammyBarType: 2, whammyBarPoints: [{ offset: 0, value: 0 }] },
        { whammyBarType: 2, whammyBarPoints: [{ offset: 0, value: -4 }] },
      ],
      ['a pick stroke', { pickStroke: 0 }, { pickStroke: 1 }],
    ])(
      'should always name at least one changed field when beat %s changes',
      (_label, baseOverrides, headOverrides) => {
        // Given a bar whose only edit is the beat-level field under test
        const result = diffScores(
          makeScore(
            [
              makeTrack('Guitar', [
                barWithBeat(baseOverrides as Partial<Beat>),
              ]),
            ],
            1,
          ),
          makeScore(
            [
              makeTrack('Guitar', [
                barWithBeat(headOverrides as Partial<Beat>),
              ]),
            ],
            1,
          ),
        );
        const bar = barsForTrack(result, 0)[0]!;

        // Then the bar is both flagged and explained
        expect(bar.type).toBe('changed');
        if (bar.type === 'changed') {
          expect(bar.changedFields.length).toBeGreaterThan(0);
        }
      },
    );

    it('should detect a pitch change on an instrument written without frets', () => {
      // Given a piano-style note, where pitch lives in octave/tone rather than
      // string/fret — both of which stay at -1
      expectChanged(
        barWithNote({ string: -1, fret: -1, octave: 4, tone: 0 }),
        barWithNote({ string: -1, fret: -1, octave: 4, tone: 7 }),
      ).toBe('changed');
    });
  });

  describe('percussion tracks', () => {
    // Drum notes carry no string — alphaTab reports string === -1 for every one
    // of them — and identify their instrument via percussionArticulation.
    function drumNote(articulation: number): Note {
      return makeNote(-1, 0, { percussionArticulation: articulation });
    }

    function drumTrack(bars: Bar[]) {
      return makeTrack('Drums', bars, { percussion: true });
    }

    it('should mark the bar as changed when a drum note swaps to a different instrument', () => {
      // Given one drum hit that becomes a different articulation (kick → snare)
      const base = makeScore(
        [
          drumTrack([
            makeBar([makeVoice([makeBeat([drumNote(35)])])]),
          ]),
        ],
        1,
      );
      const head = makeScore(
        [
          drumTrack([
            makeBar([makeVoice([makeBeat([drumNote(38)])])]),
          ]),
        ],
        1,
      );

      // When diffed
      const result = diffScores(base, head);

      // Then the change is visible
      expect(barsForTrack(result, 0)[0]!.type).toBe('changed');
    });

    it('should detect a change to one of several drum notes sharing the same beat', () => {
      // Given a beat with three simultaneous hits, one of which changes
      const baseBeat = makeBeat([drumNote(35), drumNote(42), drumNote(38)]);
      const headBeat = makeBeat([drumNote(35), drumNote(46), drumNote(38)]);
      const base = makeScore(
        [drumTrack([makeBar([makeVoice([baseBeat])])])],
        1,
      );
      const head = makeScore(
        [drumTrack([makeBar([makeVoice([headBeat])])])],
        1,
      );

      // When diffed
      const result = diffScores(base, head);
      const bar = barsForTrack(result, 0)[0]!;

      // Then the bar is changed and attributed to notes — not silently collapsed
      // by keying every same-string note into one map entry
      expect(bar.type).toBe('changed');
      if (bar.type === 'changed') {
        expect(bar.changedFields).toContain('notes');
      }
    });

    it('should report no change when simultaneous drum hits are listed in a different order', () => {
      // Given the same chord of drum hits, written in a different order
      const base = makeScore(
        [
          drumTrack([
            makeBar([makeVoice([makeBeat([drumNote(35), drumNote(42)])])]),
          ]),
        ],
        1,
      );
      const head = makeScore(
        [
          drumTrack([
            makeBar([makeVoice([makeBeat([drumNote(42), drumNote(35)])])]),
          ]),
        ],
        1,
      );

      // When diffed
      const result = diffScores(base, head);

      // Then ordering alone is not a change
      expect(barsForTrack(result, 0)[0]!.type).toBe('equal');
    });
  });

  describe('when a bar is inserted in the middle', () => {
    it('should mark only the inserted bar as added and leave shifted bars equal', () => {
      // Given head inserts one new bar between the first and second bar
      const base = makeScore(
        [makeTrack('Guitar', [simpleBar(1), simpleBar(2), simpleBar(3)])],
        3,
      );
      const head = makeScore(
        [
          makeTrack('Guitar', [
            simpleBar(1),
            simpleBar(99),
            simpleBar(2),
            simpleBar(3),
          ]),
        ],
        4,
      );

      // When diffed
      const result = diffScores(base, head);

      // Then the shift does not cascade — the three original bars stay equal
      expect(barsForTrack(result, 0).map((b) => b.type)).toEqual([
        'equal',
        'added',
        'equal',
        'equal',
      ]);
    });

    it('should address the base and head panes with separate indexes when bars shift', () => {
      // Given a bar inserted at position 1, so every later bar sits one further right in head
      const base = makeScore(
        [makeTrack('Guitar', [simpleBar(1), simpleBar(2)])],
        2,
      );
      const head = makeScore(
        [makeTrack('Guitar', [simpleBar(1), simpleBar(99), simpleBar(2)])],
        3,
      );

      // When diffed
      const result = diffScores(base, head);
      const bars = barsForTrack(result, 0);

      // Then the shifted bar reports where it lives in each score
      expect(bars.map((b) => [b.baseIndex, b.headIndex])).toEqual([
        [0, 0],
        [null, 1],
        [1, 2],
      ]);
    });
  });

  describe('when a bar is deleted from the middle', () => {
    it('should mark only the deleted bar as removed and leave shifted bars equal', () => {
      // Given head drops the second of three bars
      const base = makeScore(
        [makeTrack('Guitar', [simpleBar(1), simpleBar(2), simpleBar(3)])],
        3,
      );
      const head = makeScore(
        [makeTrack('Guitar', [simpleBar(1), simpleBar(3)])],
        2,
      );

      // When diffed
      const result = diffScores(base, head);

      // Then only the dropped bar is removed
      expect(barsForTrack(result, 0).map((b) => b.type)).toEqual([
        'equal',
        'removed',
        'equal',
      ]);
    });
  });

  describe('measure alignment', () => {
    // measures[] is the canonical alignment (ADR 0002): computed once for the
    // whole score; every per-track view is a projection of it.

    it('should expose one alignment that every track shares when a measure is inserted', () => {
      // Given a measure inserted before position 1 in both tracks
      const base = makeScore(
        [
          makeTrack('Guitar', [simpleBar(1), simpleBar(2)]),
          makeTrack('Bass', [simpleBar(3), simpleBar(4)]),
        ],
        2,
      );
      const head = makeScore(
        [
          makeTrack('Guitar', [simpleBar(1), simpleBar(9), simpleBar(2)]),
          makeTrack('Bass', [simpleBar(3), simpleBar(9), simpleBar(4)]),
        ],
        3,
      );

      // When diffed
      const result = diffScores(base, head);

      // Then there is a single answer to "where did the measure go in"
      expect(
        result.measures.map((m) => [m.type, m.baseIndex, m.headIndex]),
      ).toEqual([
        ['equal', 0, 0],
        ['added', null, 1],
        ['equal', 1, 2],
      ]);
    });

    it('should attribute a changed measure to the track that edited it', () => {
      // Given only the bass changing in a two-track measure
      const base = makeScore(
        [
          makeTrack('Guitar', [simpleBar(1)]),
          makeTrack('Bass', [simpleBar(3)]),
        ],
        1,
      );
      const head = makeScore(
        [
          makeTrack('Guitar', [simpleBar(1)]),
          makeTrack('Bass', [simpleBar(4)]),
        ],
        1,
      );

      // When diffed
      const result = diffScores(base, head);
      const measure = result.measures[0]!;

      // Then the measure changed, and the attribution names the bass alone
      expect(measure.type).toBe('changed');
      if (measure.type === 'changed') {
        expect(measure.masterBarChanged).toBe(false);
        expect(measure.changedTracks.map((t) => t.trackIndex)).toEqual([1]);
      }
    });

    it('should flag only the master bar when no track content changed', () => {
      // Given a time signature rewrite and untouched bars
      const base = makeScore([makeTrack('Guitar', [simpleBar(1)])], 1);
      const head = makeScore([makeTrack('Guitar', [simpleBar(1)])], 1);
      head.masterBars[0]!.timeSignatureNumerator = 3;

      // When diffed
      const result = diffScores(base, head);
      const measure = result.measures[0]!;

      // Then the measure changed at the master-bar level with no track blamed
      expect(measure.type).toBe('changed');
      if (measure.type === 'changed') {
        expect(measure.masterBarChanged).toBe(true);
        expect(measure.changedTracks).toEqual([]);
      }
      // And the projection keeps the guitar's bar equal
      expect(barsForTrack(result, 0)[0]!.type).toBe('equal');
    });
  });

  describe('when a track repeats itself', () => {
    // Music repeats, so a bar usually has identical twins elsewhere in the song
    // and there are several ways to match the same number of them. Length alone
    // does not choose, and the arbitrary winner used to be one that pairs a bar
    // with a distant twin — which then reads as a deletion here and an insertion
    // there instead of an edit in place.
    it('should pair repeated bars with the twin they sit next to, not the first one available', () => {
      // Given a four-bar riff whose outer two bars are rewritten in head
      const base = makeScore(
        [
          makeTrack('Guitar', [
            simpleBar(1),
            simpleBar(1),
            simpleBar(1),
            simpleBar(1),
          ]),
        ],
        4,
      );
      const head = makeScore(
        [
          makeTrack('Guitar', [
            simpleBar(9),
            simpleBar(1),
            simpleBar(1),
            simpleBar(9),
          ]),
        ],
        4,
      );

      // When diffed
      const result = diffScores(base, head);

      // Then the two untouched bars stay put and the rewrites stay in place —
      // matching bar 1 against bar 2 instead would report the same edit as a
      // deletion plus an insertion a bar away
      expect(
        barsForTrack(result, 0).map((b) => [b.type, b.baseIndex, b.headIndex]),
      ).toEqual([
        ['changed', 0, 0],
        ['equal', 1, 1],
        ['equal', 2, 2],
        ['changed', 3, 3],
      ]);
    });

    it('should still prefer the longer match when staying near the diagonal would cost one', () => {
      // Given a bar genuinely inserted in the middle of a repeating riff
      const base = makeScore(
        [
          makeTrack('Guitar', [
            simpleBar(1),
            simpleBar(2),
            simpleBar(1),
            simpleBar(2),
          ]),
        ],
        4,
      );
      const head = makeScore(
        [
          makeTrack('Guitar', [
            simpleBar(1),
            simpleBar(2),
            simpleBar(9),
            simpleBar(1),
            simpleBar(2),
          ]),
        ],
        5,
      );

      // When diffed
      const result = diffScores(base, head);

      // Then the insertion is reported as one, not smeared into four edits
      expect(barsForTrack(result, 0).map((b) => b.type)).toEqual([
        'equal',
        'equal',
        'added',
        'equal',
        'equal',
      ]);
    });
  });

  describe('when Guitar Pro re-spells a silent bar', () => {
    // Adding a note anywhere makes Guitar Pro rewrite the empty measures of that
    // track: a single whole rest comes back as, say, a quarter rest plus a
    // dotted-half rest. Nothing sounds or looks different, so nothing may be
    // reported — otherwise a one-note edit lights up the whole song.
    const wholeRest = () =>
      makeBar([makeVoice([makeBeat([], { duration: 1 })])]);
    const splitRest = () =>
      makeBar([
        makeVoice([
          makeBeat([], { duration: 4 }),
          makeBeat([], { duration: 2, dots: 1 }),
        ]),
      ]);

    it('should treat a bar of silence as equal however the rests are subdivided', () => {
      // Given the same empty measure written two ways
      const base = makeScore([makeTrack('Guitar', [wholeRest()])], 1);
      const head = makeScore([makeTrack('Guitar', [splitRest()])], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then it is silence either way
      expect(barsForTrack(result, 0)[0]!.type).toBe('equal');
      expect(result.summary).toBe('No changes');
    });

    it('should still report a silent bar that gains a note', () => {
      // Given an empty measure that head fills
      const base = makeScore([makeTrack('Guitar', [wholeRest()])], 1);
      const head = makeScore([makeTrack('Guitar', [simpleBar(5)])], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then the edit is not swallowed by the silence rule
      expect(barsForTrack(result, 0)[0]!.type).toBe('changed');
    });

    it('should still report a rest that carries a written marking', () => {
      // Given a rest that head labels with text — printed above the staff, so visible
      const base = makeScore([makeTrack('Guitar', [wholeRest()])], 1);
      const head = makeScore(
        [
          makeTrack('Guitar', [
            makeBar([makeVoice([makeBeat([], { duration: 1, text: 'N.C.' })])]),
          ]),
        ],
        1,
      );

      // When diffed
      const result = diffScores(base, head);

      // Then silence with something written on it is not plain silence
      expect(barsForTrack(result, 0)[0]!.type).toBe('changed');
    });

    it('should ignore the dynamic a rest inherits from the beat before it', () => {
      // Given the same rest, reached under two different dynamic markings
      const rest = (dynamics: number) =>
        makeBar([
          makeVoice([
            makeBeat([makeNote(1, 5)]),
            makeBeat([], { duration: 4, dynamics }),
          ]),
        ]);
      const base = makeScore([makeTrack('Guitar', [rest(5)])], 1);
      const head = makeScore([makeTrack('Guitar', [rest(4)])], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then nothing is reported — a rest has no dynamic to hear
      expect(barsForTrack(result, 0)[0]!.type).toBe('equal');
    });

    it('should still report a dynamic change on a sounding note', () => {
      // Given the same note played at two different dynamics
      const played = (dynamics: number) =>
        makeBar([
          makeVoice([makeBeat([makeNote(1, 5, { dynamics })], { dynamics })]),
        ]);
      const base = makeScore([makeTrack('Guitar', [played(3)])], 1);
      const head = makeScore([makeTrack('Guitar', [played(2)])], 1);

      // When diffed
      const result = diffScores(base, head);
      const bar = barsForTrack(result, 0)[0]!;

      // Then it surfaces, attributed to the dynamics
      expect(bar.type).toBe('changed');
      if (bar.type === 'changed') {
        expect(bar.changedFields).toEqual(['dynamics']);
      }
    });
  });

  describe('when tracks are reordered', () => {
    it('should report no content changes when two unchanged tracks swap positions', () => {
      // Given the same two tracks, listed in the opposite order in head
      const guitar = () =>
        makeTrack('Guitar', [simpleBar(5)], {
          playbackInfo: { primaryChannel: 0, program: 24 },
        });
      const bass = () =>
        makeTrack('Bass', [simpleBar(3)], {
          playbackInfo: { primaryChannel: 1, program: 33 },
        });
      const base = makeScore([guitar(), bass()], 1);
      const head = makeScore([bass(), guitar()], 1);

      // When diffed
      const result = diffScores(base, head);

      // Then every bar of every track is equal — reordering is not a content change
      const allBars = result.tracks.flatMap((t) =>
        barsForTrack(result, t.trackIndex),
      );
      expect(allBars.every((b) => b.type === 'equal')).toBe(true);
      expect(result.summary).toBe('No changes');
    });
  });

  describe('meta diff', () => {
    it('should detect a title change when titles differ', () => {
      // Given base and head have different titles
      const base = makeScore([], 0, { title: 'Draft' });
      const head = makeScore([], 0, { title: 'Final' });

      // When diffed
      const result = diffScores(base, head);

      // Then meta.title captures [before, after]
      expect(result.meta.title).toEqual(['Draft', 'Final']);
    });

    it('should detect a tempo change when tempos differ', () => {
      // Given base tempo 120 and head tempo 140
      const base = makeScore([], 1, { tempo: 120 });
      const head = makeScore([], 1, { tempo: 140 });

      // When diffed
      const result = diffScores(base, head);

      // Then meta.tempo captures [before, after]
      expect(result.meta.tempo).toEqual([120, 140]);
    });

    it('should omit unchanged meta fields from the diff', () => {
      // Given scores that differ only in tempo
      const base = makeScore([], 1, { title: 'Same', tempo: 100 });
      const head = makeScore([], 1, { title: 'Same', tempo: 110 });

      // When diffed
      const result = diffScores(base, head);

      // Then title is absent from meta diff
      expect(result.meta.title).toBeUndefined();
      expect(result.meta.tempo).toBeDefined();
    });
  });

  describe('changedBars and changeCounts', () => {
    it('should count changed, added and removed bars for the track', () => {
      // Given a track where one bar changed and one was added
      const base = makeScore([makeTrack('Guitar', [simpleBar(5)])], 1);
      const head = makeScore(
        [makeTrack('Guitar', [simpleBar(7), simpleBar(9)])],
        2,
      );

      // When counted
      const counts = changeCounts(diffScores(base, head), 0);

      // Then the tally matches the bars, and total is their sum
      expect(counts).toEqual({ changed: 1, added: 1, removed: 0, total: 2 });
    });

    it('should report zero for a track the edit left alone', () => {
      // Given two tracks where only the bass changes
      const base = makeScore(
        [
          makeTrack('Guitar', [simpleBar(5)]),
          makeTrack('Bass', [simpleBar(3)]),
        ],
        1,
      );
      const head = makeScore(
        [
          makeTrack('Guitar', [simpleBar(5)]),
          makeTrack('Bass', [simpleBar(4)]),
        ],
        1,
      );

      // When both tracks are counted
      const result = diffScores(base, head);

      // Then the guitar is untouched even though the measure changed
      expect(changeCounts(result, 0).total).toBe(0);
      expect(changeCounts(result, 1).total).toBe(1);
    });

    it('should count a measure once for the whole score, whichever track changed', () => {
      // Given a measure changed in the bass and another in the guitar
      const base = makeScore(
        [
          makeTrack('Guitar', [simpleBar(5), simpleBar(6)]),
          makeTrack('Bass', [simpleBar(3), simpleBar(3)]),
        ],
        2,
      );
      const head = makeScore(
        [
          makeTrack('Guitar', [simpleBar(5), simpleBar(9)]),
          makeTrack('Bass', [simpleBar(4), simpleBar(3)]),
        ],
        2,
      );

      // When counted score-wide
      const result = diffScores(base, head);

      // Then both measures count once each, not once per track
      expect(changeCounts(result, null).total).toBe(2);
      expect(changedBars(result, null).map((b) => b.masterBarIndex)).toEqual([0, 1]);
    });

    it('should address each pane with its own index after an insertion', () => {
      // Given a bar inserted at the top, shifting every later bar in head
      const base = makeScore([makeTrack('Guitar', [simpleBar(5), simpleBar(6)])], 2);
      const head = makeScore(
        [makeTrack('Guitar', [simpleBar(9), simpleBar(5), simpleBar(6)])],
        3,
      );

      // When the changes are read score-wide
      const changes = changedBars(diffScores(base, head), null);

      // Then the added bar exists only in head
      expect(changes).toEqual([
        { type: 'added', masterBarIndex: 0, baseIndex: null, headIndex: 0 },
      ]);
    });
  });

  describe('summary', () => {
    it('should describe changed and added bars by track name', () => {
      // Given a track where one bar changed and one was added
      const base = makeScore([makeTrack('Guitar', [simpleBar(5)])], 1);
      const head = makeScore(
        [makeTrack('Guitar', [simpleBar(7), simpleBar(9)])],
        2,
      );

      // When diffed
      const result = diffScores(base, head);

      // Then summary names the track and lists counts
      expect(result.summary).toContain('Guitar');
      expect(result.summary).toContain('1 changed');
      expect(result.summary).toContain('1 added');
    });

    it("should return 'No changes' when both scores are empty", () => {
      // Given two empty scores
      const score = makeScore([], 0);

      // When diffed with itself
      const result = diffScores(score, score);

      // Then summary is the no-changes sentinel
      expect(result.summary).toBe('No changes');
    });

    it('should list all tracks that have changes separated by a middle dot', () => {
      // Given two tracks, both with changes
      const base = makeScore(
        [
          makeTrack('Guitar', [simpleBar(5)]),
          makeTrack('Bass', [simpleBar(3)]),
        ],
        1,
      );
      const head = makeScore(
        [
          makeTrack('Guitar', [simpleBar(7)]),
          makeTrack('Bass', [simpleBar(4)]),
        ],
        1,
      );

      // When diffed
      const result = diffScores(base, head);

      // Then both track names appear in the summary
      expect(result.summary).toContain('Guitar');
      expect(result.summary).toContain('Bass');
      expect(result.summary).toContain('·');
    });
  });
});
