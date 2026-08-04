import type { Bar, Beat, Score, Track } from './types/score';
import type {
  BarChangedField,
  BarDiff,
  ChangeCounts,
  ChangedBar,
  MeasureDiff,
  MetaDiff,
  ScoreDiff,
  TrackBarChange,
  TrackPairing,
} from './types/diff';
import { barFingerprint, masterBarFingerprint } from './fingerprint';
import { alignIndexes } from './align';
import {
  beatArticulationChanged,
  beatDynamicsChanged,
  beatRhythmChanged,
  noteArticulationChanged,
  noteChanged,
  noteDynamicsChanged,
  noteKey,
  pitchChanged,
} from './compare';

export function diffScores(base: Score, head: Score): ScoreDiff {
  const tracks = pairTracks(base.tracks, head.tracks);
  const measures = alignMeasures(base, head, tracks);
  const meta = diffMeta(base, head, measures);
  const diff: ScoreDiff = { base, head, meta, tracks, measures, summary: '' };
  diff.summary = buildSummary(diff);
  return diff;
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

function diffMeta(base: Score, head: Score, measures: MeasureDiff[]): MetaDiff {
  const meta: MetaDiff = {};
  if (base.title !== head.title) meta.title = [base.title, head.title];
  if (base.artist !== head.artist) meta.artist = [base.artist, head.artist];
  if (base.album !== head.album) meta.album = [base.album, head.album];
  if (base.tempo !== head.tempo) meta.tempo = [base.tempo, head.tempo];

  // Master bars are compared through the alignment: an inserted measure is an
  // added bar in every track, not a change to every master bar after it.
  const masterBarChanges: number[] = [];
  for (const measure of measures) {
    if (measure.type === 'changed' && measure.masterBarChanged) {
      masterBarChanges.push(measure.headIndex);
    }
  }
  if (masterBarChanges.length > 0) meta.masterBarChanges = masterBarChanges;

  return meta;
}

// ─── Track pairing ────────────────────────────────────────────────────────────
//
// Guitar Pro lets you drag tracks around, so array position is not identity —
// pairing on it alone reports every bar of a moved track as changed. Pair on a
// stable key first (name + instrument + tuning), then fall back to position for
// whatever is left, so a renamed track still lines up with its old self.

function trackIdentity(track: Track): string {
  return JSON.stringify([
    track.name,
    track.playbackInfo?.primaryChannel ?? -1,
    track.playbackInfo?.program ?? -1,
    track.staves.map((s) => s.stringTuning?.tunings ?? []),
  ]);
}

function pairTracks(baseTracks: Track[], headTracks: Track[]): TrackPairing[] {
  const unmatchedHead = new Set(headTracks.keys());

  // Pass 1: exact identity match. Duplicate keys (two identically-configured
  // tracks) consume head candidates in order, which keeps the pairing stable.
  const headByIdentity = new Map<string, number[]>();
  for (const [h, track] of headTracks.entries()) {
    const key = trackIdentity(track);
    const bucket = headByIdentity.get(key);
    if (bucket) bucket.push(h);
    else headByIdentity.set(key, [h]);
  }

  const matchOf = new Map<number, number>(); // base index → head index
  for (const [b, track] of baseTracks.entries()) {
    const bucket = headByIdentity.get(trackIdentity(track));
    const h = bucket?.shift();
    if (h !== undefined) {
      matchOf.set(b, h);
      unmatchedHead.delete(h);
    }
  }

  // Pass 2: positional fallback for base tracks that found no identity twin.
  const leftoverHead = [...unmatchedHead].sort((a, b) => a - b);
  for (const b of baseTracks.keys()) {
    if (matchOf.has(b)) continue;
    const h = leftoverHead.shift();
    if (h === undefined) break;
    matchOf.set(b, h);
    unmatchedHead.delete(h);
  }

  // Emit in base order, then any head tracks nothing claimed (added tracks).
  const pairings: TrackPairing[] = [];
  for (const [b, track] of baseTracks.entries()) {
    const h = matchOf.get(b);
    pairings.push({
      trackIndex: pairings.length,
      trackName: h === undefined ? track.name : headTracks[h]!.name,
      baseTrack: b,
      headTrack: h ?? null,
    });
  }
  for (const h of [...unmatchedHead].sort((a, b) => a - b)) {
    pairings.push({
      trackIndex: pairings.length,
      trackName: headTracks[h]!.name,
      baseTrack: null,
      headTrack: h,
    });
  }
  return pairings;
}

// ─── Measure alignment ────────────────────────────────────────────────────────
//
// Aligning measures by position makes a single inserted measure report every
// later measure as changed; aligning each track separately lets two tracks give
// contradictory answers to "where was the measure inserted" (ADR 0002). So the
// alignment runs once for the whole score, over a measure fingerprint — the
// master bar plus every paired track's bar at that slot: identical measures
// anchor via an LCS, and the runs between anchors are paired off positionally
// so a measure edited in place reads as "changed" rather than as a removal
// plus an addition.

interface MeasureFingerprints {
  /** Combined per-measure fingerprint the alignment runs on. */
  measures: string[];
  masterBars: string[];
  /** One row per paired track, one entry per measure. */
  trackBars: string[][];
}

function fingerprintMeasures(
  score: Score,
  trackIndexes: number[],
): MeasureFingerprints {
  const masterBars = score.masterBars.map(masterBarFingerprint);
  const trackBars = trackIndexes.map((t) =>
    (score.tracks[t]!.staves[0]?.bars ?? []).map(barFingerprint),
  );
  const measures = masterBars.map((mb, i) =>
    JSON.stringify([mb, trackBars.map((fps) => fps[i] ?? '')]),
  );
  return { measures, masterBars, trackBars };
}

function alignMeasures(
  base: Score,
  head: Score,
  tracks: TrackPairing[],
): MeasureDiff[] {
  // Only tracks present on both sides can vote on the alignment; an added or
  // removed track has nothing to align against.
  const paired = tracks.filter(
    (t) => t.baseTrack !== null && t.headTrack !== null,
  );
  const baseFp = fingerprintMeasures(
    base,
    paired.map((t) => t.baseTrack!),
  );
  const headFp = fingerprintMeasures(
    head,
    paired.map((t) => t.headTrack!),
  );

  const measures: MeasureDiff[] = [];
  for (const [b, h] of alignIndexes(baseFp.measures, headFp.measures)) {
    if (b === null) {
      measures.push({ type: 'added', baseIndex: null, headIndex: h! });
      continue;
    }
    if (h === null) {
      measures.push({ type: 'removed', baseIndex: b, headIndex: null });
      continue;
    }
    if (baseFp.measures[b] === headFp.measures[h]) {
      measures.push({ type: 'equal', baseIndex: b, headIndex: h });
      continue;
    }

    // The measure changed; attribution is per track.
    const changedTracks: TrackBarChange[] = [];
    for (const [k, pairing] of paired.entries()) {
      if (baseFp.trackBars[k]![b] === headFp.trackBars[k]![h]) continue;
      const baseBar = base.tracks[pairing.baseTrack!]!.staves[0]!.bars[b]!;
      const headBar = head.tracks[pairing.headTrack!]!.staves[0]!.bars[h]!;
      changedTracks.push({
        trackIndex: pairing.trackIndex,
        changedFields: categorizeBarChanges(baseBar, headBar),
      });
    }
    measures.push({
      type: 'changed',
      baseIndex: b,
      headIndex: h,
      masterBarChanged: baseFp.masterBars[b] !== headFp.masterBars[h],
      changedTracks,
    });
  }
  return measures;
}

// ─── Per-track projection ─────────────────────────────────────────────────────
//
// The measure alignment is canonical; a track's BarDiff[] is derived from it on
// demand. A paired track reads its verdict off each measure; a track that only
// one score has is entirely added or removed, measure by measure.

export function barsForTrack(diff: ScoreDiff, trackIndex: number): BarDiff[] {
  const pairing = diff.tracks[trackIndex];
  if (!pairing) return [];

  const baseBars =
    pairing.baseTrack === null
      ? null
      : (diff.base.tracks[pairing.baseTrack]!.staves[0]?.bars ?? []);
  const headBars =
    pairing.headTrack === null
      ? null
      : (diff.head.tracks[pairing.headTrack]!.staves[0]?.bars ?? []);

  const bars: BarDiff[] = [];
  for (const measure of diff.measures) {
    if (baseBars === null) {
      if (measure.headIndex !== null) {
        bars.push(addedBar(measure.headIndex, headBars![measure.headIndex]!));
      }
      continue;
    }
    if (headBars === null) {
      if (measure.baseIndex !== null) {
        bars.push(removedBar(measure.baseIndex, baseBars[measure.baseIndex]!));
      }
      continue;
    }

    switch (measure.type) {
      case 'added':
        bars.push(addedBar(measure.headIndex, headBars[measure.headIndex]!));
        break;
      case 'removed':
        bars.push(removedBar(measure.baseIndex, baseBars[measure.baseIndex]!));
        break;
      case 'equal':
        bars.push(equalBar(measure.baseIndex, measure.headIndex));
        break;
      case 'changed': {
        const change = measure.changedTracks.find(
          (t) => t.trackIndex === trackIndex,
        );
        // Attribution is per track: a measure can change without this track's
        // bar changing — another track did, or a master-bar field.
        if (!change) {
          bars.push(equalBar(measure.baseIndex, measure.headIndex));
          break;
        }
        bars.push({
          type: 'changed',
          masterBarIndex: measure.headIndex,
          baseIndex: measure.baseIndex,
          headIndex: measure.headIndex,
          base: baseBars[measure.baseIndex]!,
          head: headBars[measure.headIndex]!,
          changedFields: change.changedFields,
        });
        break;
      }
    }
  }
  return bars;
}

/**
 * Where the changes sit, for one track or — with a null trackIndex — for the
 * whole score, where a measure counts as changed when any track's bar or the
 * master bar did.
 */
export function changedBars(diff: ScoreDiff, trackIndex: number | null): ChangedBar[] {
  if (trackIndex !== null) {
    const changes: ChangedBar[] = [];
    for (const bar of barsForTrack(diff, trackIndex)) {
      if (bar.type === 'equal') continue;
      const { type, masterBarIndex, baseIndex, headIndex } = bar;
      changes.push({ type, masterBarIndex, baseIndex, headIndex });
    }
    return changes;
  }

  const changes: ChangedBar[] = [];
  for (const measure of diff.measures) {
    if (measure.type === 'equal') continue;
    changes.push({
      type: measure.type,
      masterBarIndex: measure.headIndex ?? measure.baseIndex,
      baseIndex: measure.baseIndex,
      headIndex: measure.headIndex,
    });
  }
  return changes;
}

/** How many bars were gained, lost, or rewritten — the tally a track picker chips. */
export function changeCounts(diff: ScoreDiff, trackIndex: number | null): ChangeCounts {
  const counts: ChangeCounts = { changed: 0, added: 0, removed: 0, total: 0 };
  for (const change of changedBars(diff, trackIndex)) {
    counts[change.type] += 1;
    counts.total += 1;
  }
  return counts;
}

function addedBar(headIndex: number, bar: Bar): BarDiff {
  return {
    type: 'added',
    masterBarIndex: headIndex,
    baseIndex: null,
    headIndex,
    bar,
  };
}

function removedBar(baseIndex: number, bar: Bar): BarDiff {
  return {
    type: 'removed',
    masterBarIndex: baseIndex,
    baseIndex,
    headIndex: null,
    bar,
  };
}

function equalBar(baseIndex: number, headIndex: number): BarDiff {
  return { type: 'equal', masterBarIndex: headIndex, baseIndex, headIndex };
}

// ─── Changed-field categorization ─────────────────────────────────────────────
//
// Given two bars that are known to differ (fingerprints don't match), determine
// which musical dimensions changed. Used for the CLI summary and chip breakdown.

function categorizeBarChanges(base: Bar, head: Bar): BarChangedField[] {
  const fields = new Set<BarChangedField>();

  const voiceCount = Math.max(base.voices.length, head.voices.length);
  for (let vi = 0; vi < voiceCount; vi++) {
    const baseVoice = base.voices[vi];
    const headVoice = head.voices[vi];
    const baseBeats = baseVoice?.beats ?? [];
    const headBeats = headVoice?.beats ?? [];

    if (baseBeats.length !== headBeats.length) {
      fields.add('beats');
    }

    const beatCount = Math.max(baseBeats.length, headBeats.length);
    for (let bi = 0; bi < beatCount; bi++) {
      const bBeat = baseBeats[bi];
      const hBeat = headBeats[bi];

      if (!bBeat || !hBeat) {
        fields.add('beats');
        continue;
      }

      if (beatRhythmChanged(bBeat, hBeat)) fields.add('beats');
      if (beatArticulationChanged(bBeat, hBeat)) fields.add('articulation');
      if (beatDynamicsChanged(bBeat, hBeat)) fields.add('dynamics');

      const noteChanges = categorizeNoteChanges(bBeat, hBeat);
      for (const f of noteChanges) fields.add(f);
    }
  }

  // The bar's fingerprint is what decided this bar changed at all, so it is the
  // authority. If every check above came up empty the edit was to something with
  // no chip of its own (bar text, a chord label, lyrics) — attribute it to the
  // beat rather than return an empty list, which the UI renders as a highlighted
  // bar with nothing explaining it.
  if (fields.size === 0) fields.add('beats');

  return [...fields];
}

function categorizeNoteChanges(base: Beat, head: Beat): BarChangedField[] {
  const fields = new Set<BarChangedField>();

  const baseByKey = new Map(base.notes.map((n) => [noteKey(n), n]));
  const headByKey = new Map(head.notes.map((n) => [noteKey(n), n]));
  const allKeys = new Set([...baseByKey.keys(), ...headByKey.keys()]);

  for (const key of allKeys) {
    const bNote = baseByKey.get(key) ?? null;
    const hNote = headByKey.get(key) ?? null;

    if (!bNote || !hNote) {
      fields.add('notes');
      continue;
    }

    const forThisNote = new Set<BarChangedField>();
    if (pitchChanged(bNote, hNote)) forThisNote.add('notes');
    if (noteArticulationChanged(bNote, hNote)) forThisNote.add('articulation');
    if (noteDynamicsChanged(bNote, hNote)) forThisNote.add('dynamics');

    // Defer to the fingerprint for anything the explicit checks don't cover
    // (fingerings, tie/slur links, …) so a changed note is never unexplained.
    if (forThisNote.size === 0 && noteChanged(bNote, hNote)) {
      forThisNote.add('notes');
    }
    for (const f of forThisNote) fields.add(f);
  }

  return [...fields];
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function buildSummary(diff: ScoreDiff): string {
  const parts: string[] = [];

  for (const track of diff.tracks) {
    const { changed, added, removed, total } = changeCounts(diff, track.trackIndex);

    if (total) {
      const details = [
        changed ? `${changed} changed` : '',
        added ? `${added} added` : '',
        removed ? `${removed} removed` : '',
      ]
        .filter(Boolean)
        .join(', ');
      parts.push(`${track.trackName}: ${details}`);
    }
  }

  return parts.length ? parts.join(' · ') : 'No changes';
}
