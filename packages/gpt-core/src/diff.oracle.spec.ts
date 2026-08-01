import { describe, it, expect } from 'vitest';
import { model } from '@coderline/alphatab';
import { barsForTrack, diffScores } from './diff';
import type { ScoreDiff } from './types/diff';
import type { Bar, Score } from './types/score';
import {
  makeBar,
  makeBeat,
  makeNote,
  makeScore,
  makeTrack,
  makeVoice,
  type ScoreOptions,
} from './__fixtures__/buildScore';

// ─── The oracle ───────────────────────────────────────────────────────────────
//
// One property, applied to every case: the diff reports exactly the applied
// edit — the edited element is flagged, and nothing else is. Each test builds
// base and head as two independent scores rather than mutating a finished one,
// because Score.finish() computes state (displayStart, tie resolution) that an
// in-place edit would leave stale. The only exceptions are fields finish()
// neither derives nor consumes (keySignature, capo, section, tempoAutomations,
// time signature), which may be set after the build.
//
// report() flattens a ScoreDiff into the complete list of reported facts: one
// entry per non-equal bar, one per changed meta field. Asserting with toEqual
// on that whole list is what turns "the right bar is flagged" into "the right
// bar, and nothing else".

type Fact =
  | {
      fact: 'bar';
      track: string;
      type: 'changed' | 'added' | 'removed';
      measure: number;
    }
  | { fact: 'meta'; field: string };

function report(diff: ScoreDiff): Fact[] {
  const facts: Fact[] = [];
  for (const field of Object.keys(diff.meta)) {
    facts.push({ fact: 'meta', field });
  }
  for (const track of diff.tracks) {
    for (const bar of barsForTrack(diff, track.trackIndex)) {
      if (bar.type === 'equal') continue;
      facts.push({
        fact: 'bar',
        track: track.trackName,
        type: bar.type,
        measure: bar.masterBarIndex,
      });
    }
  }
  return facts;
}

// ─── Fixture: a two-track song ────────────────────────────────────────────────
// Two tracks with distinct content, so an edit attributed to the wrong track
// cannot hide — the other track's silence is part of every assertion.

const beatOf = (fret: number) => makeBeat([makeNote(1, fret)]);
const barOf = (...frets: number[]) =>
  makeBar([makeVoice(frets.map((fret) => beatOf(fret)))]);
const emptyBar = () => makeBar([makeVoice([makeBeat([])])]);

function song(bass: Bar[], guitar: Bar[], options: ScoreOptions = {}): Score {
  if (bass.length !== guitar.length) {
    throw new Error('both tracks need one bar per measure');
  }
  return makeScore(
    [
      makeTrack('Bass', bass, {
        playbackInfo: { primaryChannel: 1, program: 33 },
      }),
      makeTrack('Guitar', guitar),
    ],
    bass.length,
    options,
  );
}

const bassBars = () => [barOf(3), barOf(5), barOf(7)];
const guitarBars = () => [barOf(10, 12), barOf(12), barOf(15)];

describe('the diff reports exactly the applied edit', () => {
  it('should report nothing when no edit was applied', () => {
    // Given the same song built twice
    const base = song(bassBars(), guitarBars());
    const head = song(bassBars(), guitarBars());

    // Then the report is empty — not "mostly empty"
    const diff = diffScores(base, head);
    expect(report(diff)).toEqual([]);
    expect(diff.summary).toBe('No changes');
  });

  it('should report one changed bar of one track when one fret changes', () => {
    // Given the bass alone changing one fret in measure 1
    const base = song(bassBars(), guitarBars());
    const head = song([barOf(3), barOf(6), barOf(7)], guitarBars());

    // Then the report is that bar, and nothing about the guitar or the meta
    expect(report(diffScores(base, head))).toEqual([
      { fact: 'bar', track: 'Bass', type: 'changed', measure: 1 },
    ]);
  });

  it('should report one changed bar when a note is added to an existing beat', () => {
    // Given the guitar's measure 1 beat gaining a second note
    const withDouble = [
      barOf(10, 12),
      makeBar([makeVoice([makeBeat([makeNote(1, 12), makeNote(2, 12)])])]),
      barOf(15),
    ];
    const base = song(bassBars(), guitarBars());
    const head = song(bassBars(), withDouble);

    // Then exactly that bar is reported
    expect(report(diffScores(base, head))).toEqual([
      { fact: 'bar', track: 'Guitar', type: 'changed', measure: 1 },
    ]);
  });

  it('should report one added bar per track when a measure is inserted', () => {
    // Given an empty measure inserted before measure 1, in every track —
    // which is the only way Guitar Pro inserts one
    const base = song(bassBars(), guitarBars());
    const head = song(
      [barOf(3), emptyBar(), barOf(5), barOf(7)],
      [barOf(10, 12), emptyBar(), barOf(12), barOf(15)],
    );

    // Then the report is the two new bars — nothing about the master bars,
    // none of which changed
    expect(report(diffScores(base, head))).toEqual([
      { fact: 'bar', track: 'Bass', type: 'added', measure: 1 },
      { fact: 'bar', track: 'Guitar', type: 'added', measure: 1 },
    ]);
  });

  it('should report one removed bar per track when a measure is deleted', () => {
    // Given measure 1 deleted from every track
    const base = song(bassBars(), guitarBars());
    const head = song([barOf(3), barOf(7)], [barOf(10, 12), barOf(15)]);

    // Then the report is the two dropped bars
    expect(report(diffScores(base, head))).toEqual([
      { fact: 'bar', track: 'Bass', type: 'removed', measure: 1 },
      { fact: 'bar', track: 'Guitar', type: 'removed', measure: 1 },
    ]);
  });

  it('should locate the insertion identically in a track whose bars are all interchangeable', () => {
    // Given a guitar that has not recorded yet — every measure silent, so its
    // bars alone cannot say where the new measure went. A per-track alignment
    // answered "at the end" for the guitar and "measure 1" for the bass;
    // score-level alignment gives the one true answer for both (ADR 0002)
    const silentGuitar = (count: number) =>
      Array.from({ length: count }, () => emptyBar());
    const base = song(bassBars(), silentGuitar(3));
    const head = song(
      [barOf(3), emptyBar(), barOf(5), barOf(7)],
      silentGuitar(4),
    );

    expect(report(diffScores(base, head))).toEqual([
      { fact: 'bar', track: 'Bass', type: 'added', measure: 1 },
      { fact: 'bar', track: 'Guitar', type: 'added', measure: 1 },
    ]);
  });

  it('should report only the meta field when the title changes', () => {
    // Given an edit that touches no music at all
    const base = song(bassBars(), guitarBars(), { title: 'Draft' });
    const head = song(bassBars(), guitarBars(), { title: 'Final' });

    // Then no bar of any track is dragged into the report
    expect(report(diffScores(base, head))).toEqual([
      { fact: 'meta', field: 'title' },
    ]);
  });

  it('should report only the meta field when the initial tempo changes', () => {
    // Given the tempo automation on the first master bar changing
    const base = song(bassBars(), guitarBars(), { tempo: 120 });
    const head = song(bassBars(), guitarBars(), { tempo: 140 });

    expect(report(diffScores(base, head))).toEqual([
      { fact: 'meta', field: 'tempo' },
    ]);
  });

  it('should report a time signature change as a master-bar fact', () => {
    // Given measure 1 rewritten from 4/4 to 3/4 — a master-bar field finish()
    // does not derive, so setting it after the build is safe
    const base = song(bassBars(), guitarBars());
    const head = song(bassBars(), guitarBars());
    head.masterBars[1]!.timeSignatureNumerator = 3;

    expect(report(diffScores(base, head))).toEqual([
      { fact: 'meta', field: 'masterBarChanges' },
    ]);
  });

  // ── Edits the diff cannot see yet ───────────────────────────────────────────
  //
  // ADR 0003: the fingerprint is an allowlist, and these fields are not on it.
  // Each edit below currently produces an empty report — "No changes" — which
  // is data loss from the user's point of view. The tests are written with
  // it.fails so they document the gap while staying green: the moment a commit
  // makes one of these edits visible, its it.fails turns red and must flip to
  // a plain it with the exact expected report.

  it.fails('should report a key signature change', () => {
    // Given measure 1 rewritten into a new key in every track
    const base = song(bassBars(), guitarBars());
    const head = song(bassBars(), guitarBars());
    for (const track of head.tracks) {
      track.staves[0]!.bars[1]!.keySignature = 2 as Bar['keySignature'];
    }

    // Then the edit must at least be visible
    expect(report(diffScores(base, head))).not.toEqual([]);
  });

  it.fails('should report a capo added to one track', () => {
    // Given a capo on fret 2 of the guitar — Staff.capo, nothing below the
    // staff changes
    const base = song(bassBars(), guitarBars());
    const head = song(bassBars(), guitarBars());
    head.tracks[1]!.staves[0]!.capo = 2;

    expect(report(diffScores(base, head))).not.toEqual([]);
  });

  it.fails('should report a tempo change in the middle of the song', () => {
    // Given a tempo automation added at measure 2 — diffMeta only reads the
    // initial tempo, and the master-bar fingerprint ignores tempoAutomations
    const base = song(bassBars(), guitarBars());
    const head = song(bassBars(), guitarBars());
    const automation = new model.Automation();
    automation.type = model.AutomationType.Tempo;
    automation.value = 90;
    head.masterBars[2]!.tempoAutomations.push(automation);

    expect(report(diffScores(base, head))).not.toEqual([]);
  });

  it.fails('should report a renamed section', () => {
    // Given the section at measure 1 renamed — MasterBar.section
    const section = (text: string) => {
      const s = new model.Section();
      s.text = text;
      return s;
    };
    const base = song(bassBars(), guitarBars());
    const head = song(bassBars(), guitarBars());
    base.masterBars[1]!.section = section('Couplet');
    head.masterBars[1]!.section = section('Refrain');

    expect(report(diffScores(base, head))).not.toEqual([]);
  });
});
