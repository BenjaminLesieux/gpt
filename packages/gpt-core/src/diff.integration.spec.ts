import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importer, model } from '@coderline/alphatab';
import { diffScores } from './diff';
import type { BarDiff, ScoreDiff } from './types/diff';
import type { Score } from './types/score';

// ─── Real-file regression suite ───────────────────────────────────────────────
//
// The hand-built mocks in diff.spec.ts pin the algorithm; these pin it against a
// real Guitar Pro file — 36 bars across 4 tracks, one of them a drum kit. Every
// case here is an edit a musician makes in a couple of clicks, and the numbers in
// the assertions are the ones that were wrong: a single inserted measure used to
// report 76 changed bars, and reordering two tracks used to report 72.

const FIXTURE = readFileSync(
  join(import.meta.dirname, '__fixtures__/sample.gp'),
);

/** A fresh parse each call — diffScores must never mutate its inputs. */
function loadFixture(): Score {
  return importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(FIXTURE));
}

function tally(diff: ScoreDiff) {
  const all: BarDiff[] = diff.tracks.flatMap((track) => track.bars);
  return {
    equal: all.filter((bar) => bar.type === 'equal').length,
    changed: all.filter((bar) => bar.type === 'changed').length,
    added: all.filter((bar) => bar.type === 'added').length,
    removed: all.filter((bar) => bar.type === 'removed').length,
  };
}

/** An empty measure, as Guitar Pro creates when you insert one. */
function emptyBar(): model.Bar {
  const bar = new model.Bar();
  const voice = new model.Voice();
  const beat = new model.Beat();
  beat.isEmpty = false;
  voice.addBeat(beat);
  bar.addVoice(voice);
  return bar;
}

describe('diffScores against a real Guitar Pro file', () => {
  it('should report no changes when a file is compared against an untouched parse of itself', () => {
    // Given the same file parsed twice
    const diff = diffScores(loadFixture(), loadFixture());

    // Then nothing is flagged — this is the floor every other case builds on
    expect(tally(diff)).toEqual({
      equal: 144,
      changed: 0,
      added: 0,
      removed: 0,
    });
    expect(diff.summary).toBe('No changes');
  });

  it('should report exactly one changed bar when one note is added to one beat', () => {
    // Given a single extra note on the first beat of bar 5 of the second track
    const head = loadFixture();
    const note = new model.Note();
    note.string = 1;
    note.fret = 12;
    head.tracks[1]!.staves[0]!.bars[4]!.voices[0]!.beats[0]!.addNote(note);

    // When diffed
    const diff = diffScores(loadFixture(), head);

    // Then one bar of one track is flagged, and it is the bar that was edited
    expect(tally(diff)).toMatchObject({ changed: 1, added: 0, removed: 0 });
    const changed = diff.tracks[1]!.bars.filter(
      (bar) => bar.type === 'changed',
    );
    expect(changed).toHaveLength(1);
    expect(changed[0]!.masterBarIndex).toBe(4);
  });

  it('should not cascade down the song when a measure is inserted in every track', () => {
    // Given one measure inserted at bar 5 of all four tracks
    const head = loadFixture();
    head.addMasterBar(new model.MasterBar());
    for (const track of head.tracks) {
      track.staves[0]!.bars.splice(4, 0, emptyBar());
    }

    // When diffed
    const diff = diffScores(loadFixture(), head);

    // Then only the four new measures are flagged — the 31 measures that shifted
    // right in each track stay equal
    expect(tally(diff)).toEqual({
      equal: 144,
      changed: 0,
      added: 4,
      removed: 0,
    });
  });

  it('should keep base and head pane indexes aligned to their own score after an insertion', () => {
    // Given one measure inserted at bar 5 of the first track only
    const head = loadFixture();
    head.tracks[0]!.staves[0]!.bars.splice(4, 0, emptyBar());

    // When diffed
    const diff = diffScores(loadFixture(), head);
    const bars = diff.tracks[0]!.bars;

    // Then a bar after the insertion points at a different index in each score,
    // which is what a side-by-side view needs to highlight the right measures
    const lastBar = bars.at(-1)!;
    expect(lastBar.type).toBe('equal');
    expect(lastBar.baseIndex).toBe(35);
    expect(lastBar.headIndex).toBe(36);
  });

  it('should report no changes when two tracks are reordered', () => {
    // Given the bass and the first guitar swapped in the track list
    const head = loadFixture();
    const [bass, guitar] = [head.tracks[0]!, head.tracks[1]!];
    head.tracks[0] = guitar;
    head.tracks[1] = bass;

    // When diffed
    const diff = diffScores(loadFixture(), head);

    // Then moving a track is not a content change
    expect(tally(diff)).toMatchObject({ changed: 0, added: 0, removed: 0 });
    expect(diff.summary).toBe('No changes');
  });

  it('should report one changed bar when a single drum hit changes instrument', () => {
    // Given one hit on the drum track retuned to a different articulation.
    // Every drum note reports string === -1, which used to collapse a whole
    // drum chord into one entry and hide the edit entirely.
    const head = loadFixture();
    const drums = head.tracks[3]!;
    const hit = drums.staves[0]!.bars.flatMap((bar) =>
      bar.voices.flatMap((voice) =>
        voice.beats.filter((beat) => beat.notes.length > 0),
      ),
    )[0]!;
    expect(hit.notes[0]!.string).toBe(-1); // drums carry no string
    hit.notes[0]!.percussionArticulation += 1;

    // When diffed
    const diff = diffScores(loadFixture(), head);

    // Then the edit surfaces, attributed to the notes
    expect(tally(diff)).toMatchObject({ changed: 1, added: 0, removed: 0 });
    const changed = diff.tracks[3]!.bars.find((bar) => bar.type === 'changed')!;
    expect(changed.type).toBe('changed');
    if (changed.type === 'changed') {
      expect(changed.changedFields).toContain('notes');
    }
  });

  it('should stay silent about empty measures Guitar Pro re-spelled on save', () => {
    // Given every empty measure rewritten from one whole rest into a quarter
    // rest plus a dotted-half rest — what GP does to a track the moment you add
    // a note to it anywhere
    const head = loadFixture();
    let respelled = 0;
    for (const track of head.tracks) {
      for (const bar of track.staves[0]!.bars) {
        for (const voice of bar.voices) {
          if (voice.beats.length !== 1 || !voice.beats[0]!.isRest) continue;
          const tail = new model.Beat();
          tail.duration = model.Duration.Half;
          tail.dots = 1;
          voice.beats[0]!.duration = model.Duration.Quarter;
          voice.addBeat(tail);
          respelled++;
        }
      }
    }
    expect(respelled).toBeGreaterThan(0);

    // When diffed
    const diff = diffScores(loadFixture(), head);

    // Then the song reads as untouched, because it is
    expect(tally(diff)).toEqual({
      equal: 144,
      changed: 0,
      added: 0,
      removed: 0,
    });
    expect(diff.summary).toBe('No changes');
  });

  it('should not mutate either input score', () => {
    // Given a diff run over two fresh parses
    const base = loadFixture();
    const head = loadFixture();
    const barCountBefore = base.tracks.map((t) => t.staves[0]!.bars.length);

    diffScores(base, head);

    // Then the inputs are untouched and a second diff agrees with the first
    expect(base.tracks.map((t) => t.staves[0]!.bars.length)).toEqual(
      barCountBefore,
    );
    expect(diffScores(base, head).summary).toBe('No changes');
  });
});
