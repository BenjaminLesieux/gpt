import type { Bar, Beat, BendPoint, Note, Score, Track } from './types/score';
import type {
  BarChangedField,
  BarDiff,
  MetaDiff,
  ScoreDiff,
  TrackDiff,
} from './types/diff';
import {
  barFingerprint,
  masterBarFingerprint,
  noteFingerprint,
} from './fingerprint';

export function diffScores(base: Score, head: Score): ScoreDiff {
  const meta = diffMeta(base, head);
  const tracks = diffTracks(base, head);
  const summary = buildSummary(tracks);
  return { base, head, meta, tracks, summary };
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

function diffMeta(base: Score, head: Score): MetaDiff {
  const meta: MetaDiff = {};
  if (base.title !== head.title) meta.title = [base.title, head.title];
  if (base.artist !== head.artist) meta.artist = [base.artist, head.artist];
  if (base.album !== head.album) meta.album = [base.album, head.album];
  if (base.tempo !== head.tempo) meta.tempo = [base.tempo, head.tempo];

  const masterBarChanges: number[] = [];
  const count = Math.max(base.masterBars.length, head.masterBars.length);
  for (let i = 0; i < count; i++) {
    const bMb = base.masterBars[i];
    const hMb = head.masterBars[i];
    if (
      !bMb ||
      !hMb ||
      masterBarFingerprint(bMb) !== masterBarFingerprint(hMb)
    ) {
      masterBarChanges.push(i);
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

type TrackPair = [Track | null, Track | null];

function trackIdentity(track: Track): string {
  return JSON.stringify([
    track.name,
    track.playbackInfo?.primaryChannel ?? -1,
    track.playbackInfo?.program ?? -1,
    track.staves.map((s) => s.stringTuning?.tunings ?? []),
  ]);
}

function pairTracks(baseTracks: Track[], headTracks: Track[]): TrackPair[] {
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
  const pairs: TrackPair[] = baseTracks.map((track, b) => {
    const h = matchOf.get(b);
    return [track, h === undefined ? null : headTracks[h]!];
  });
  for (const h of [...unmatchedHead].sort((a, b) => a - b)) {
    pairs.push([null, headTracks[h]!]);
  }
  return pairs;
}

// ─── Bar alignment ────────────────────────────────────────────────────────────
//
// Pairing bars by position makes a single inserted measure report every later
// measure as changed. Instead we align on content: identical bars anchor via an
// LCS over their fingerprints, and the runs between anchors are paired off
// positionally so an edited-in-place bar reads as "changed" rather than as a
// removal plus an addition.
//
// A pair is [baseIndex, headIndex]; null on either side means the bar exists in
// only one score. Pairs come back in reading order.

type BarPair = [number | null, number | null];

/** A pair the LCS matched outright — both sides always present. */
type Anchor = [number, number];

// Guard on the LCS tables (two of them, four bytes a cell) so a pathologically
// long score can't blow up memory. Beyond this the middle section falls back to
// positional pairing — degraded, never wrong.
const MAX_LCS_CELLS = 4_000_000;

function alignBars(baseBars: Bar[], headBars: Bar[]): BarPair[] {
  const base = baseBars.map(barFingerprint);
  const head = headBars.map(barFingerprint);

  // Real edits touch a handful of measures, so trimming the untouched head and
  // tail usually shrinks the LCS to a tiny window — and makes the common
  // "nothing changed" case linear.
  let lo = 0;
  while (lo < base.length && lo < head.length && base[lo] === head[lo]) lo++;

  let tail = 0;
  while (
    tail < base.length - lo &&
    tail < head.length - lo &&
    base[base.length - 1 - tail] === head[head.length - 1 - tail]
  ) {
    tail++;
  }

  const pairs: BarPair[] = [];
  for (let i = 0; i < lo; i++) pairs.push([i, i]);
  pairs.push(
    ...alignMiddle(base, head, lo, base.length - tail, head.length - tail),
  );
  for (let k = tail - 1; k >= 0; k--) {
    pairs.push([base.length - 1 - k, head.length - 1 - k]);
  }
  return pairs;
}

function alignMiddle(
  base: string[],
  head: string[],
  lo: number,
  baseEnd: number,
  headEnd: number,
): BarPair[] {
  const n = baseEnd - lo;
  const m = headEnd - lo;
  if (n <= 0 && m <= 0) return [];

  const pairs: BarPair[] = [];
  if (n <= 0) {
    for (let h = lo; h < headEnd; h++) pairs.push([null, h]);
    return pairs;
  }
  if (m <= 0) {
    for (let b = lo; b < baseEnd; b++) pairs.push([b, null]);
    return pairs;
  }

  const anchors =
    n * m <= MAX_LCS_CELLS ? lcsAnchors(base, head, lo, baseEnd, headEnd) : [];

  // Walk the anchors, filling each gap between them positionally. The trailing
  // sentinel closes the gap after the last anchor.
  const sentinel: Anchor = [baseEnd, headEnd];
  let b = lo;
  let h = lo;
  for (const [anchorB, anchorH] of [...anchors, sentinel]) {
    const gapB = anchorB - b;
    const gapH = anchorH - h;
    const paired = Math.min(gapB, gapH);
    for (let k = 0; k < paired; k++) pairs.push([b + k, h + k]);
    for (let k = paired; k < gapB; k++) pairs.push([b + k, null]);
    for (let k = paired; k < gapH; k++) pairs.push([null, h + k]);

    if (anchorB < baseEnd) pairs.push([anchorB, anchorH]);
    b = anchorB + 1;
    h = anchorH + 1;
  }
  return pairs;
}

/**
 * Longest common subsequence of bar fingerprints, as [baseIndex, headIndex] pairs.
 *
 * Music repeats itself, so a track routinely offers dozens of ways to match the
 * same number of bars — a riff played in bar 12 is byte-identical to the one in
 * bar 92. Length alone does not choose between them, and the arbitrary winner is
 * often one that pairs a bar with a far-away twin, which then reads as a long
 * deletion plus a long insertion instead of an edit in place. So the table
 * carries a second number: among the alignments of maximal length, prefer the
 * one whose matches sit closest to the diagonal.
 */
function lcsAnchors(
  base: string[],
  head: string[],
  lo: number,
  baseEnd: number,
  headEnd: number,
): Anchor[] {
  const n = baseEnd - lo;
  const m = headEnd - lo;

  // len[i][j] = LCS length of base[lo+i..] and head[lo+j..]
  // drift[i][j] = smallest total |i-j| over the matches of any such alignment
  const len: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  );
  const drift: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const matches = base[lo + i] === head[lo + j];
      // Taking a match never shortens the LCS, but it can drag the alignment off
      // the diagonal, so it competes with the two skips rather than short-
      // circuiting them.
      let bestLen = len[i + 1]![j]!;
      let bestDrift = drift[i + 1]![j]!;

      const skipHeadLen = len[i]![j + 1]!;
      const skipHeadDrift = drift[i]![j + 1]!;
      if (better(skipHeadLen, skipHeadDrift, bestLen, bestDrift)) {
        bestLen = skipHeadLen;
        bestDrift = skipHeadDrift;
      }

      if (matches) {
        const matchLen = len[i + 1]![j + 1]! + 1;
        const matchDrift = drift[i + 1]![j + 1]! + Math.abs(i - j);
        if (better(matchLen, matchDrift, bestLen, bestDrift)) {
          bestLen = matchLen;
          bestDrift = matchDrift;
        }
      }

      len[i]![j] = bestLen;
      drift[i]![j] = bestDrift;
    }
  }

  // Replay the same choice forwards, collecting the matches it takes.
  const anchors: Anchor[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (
      base[lo + i] === head[lo + j] &&
      len[i]![j] === len[i + 1]![j + 1]! + 1 &&
      drift[i]![j] === drift[i + 1]![j + 1]! + Math.abs(i - j)
    ) {
      anchors.push([lo + i, lo + j]);
      i++;
      j++;
    } else if (
      better(
        len[i + 1]![j]!,
        drift[i + 1]![j]!,
        len[i]![j + 1]!,
        drift[i]![j + 1]!,
      )
    ) {
      i++;
    } else {
      j++;
    }
  }
  return anchors;
}

/** Longer wins; equal length is settled by staying nearer the diagonal. */
function better(
  len: number,
  drift: number,
  bestLen: number,
  bestDrift: number,
): boolean {
  return len > bestLen || (len === bestLen && drift < bestDrift);
}

// ─── Tracks ───────────────────────────────────────────────────────────────────

function diffTracks(base: Score, head: Score): TrackDiff[] {
  const results: TrackDiff[] = [];

  for (const [t, [baseTrack, headTrack]] of pairTracks(
    base.tracks,
    head.tracks,
  ).entries()) {
    const trackName = headTrack?.name ?? baseTrack?.name ?? `Track ${t + 1}`;

    const baseBars = baseTrack?.staves[0]?.bars ?? [];
    const headBars = headTrack?.staves[0]?.bars ?? [];
    const bars: BarDiff[] = [];

    for (const [baseIndex, headIndex] of alignBars(baseBars, headBars)) {
      const baseBar = baseIndex === null ? null : baseBars[baseIndex]!;
      const headBar = headIndex === null ? null : headBars[headIndex]!;
      const masterBarIndex = headIndex ?? baseIndex ?? 0;

      if (!baseBar && headBar) {
        bars.push({
          type: 'added',
          masterBarIndex,
          baseIndex: null,
          headIndex: headIndex!,
          bar: headBar,
        });
      } else if (baseBar && !headBar) {
        bars.push({
          type: 'removed',
          masterBarIndex,
          baseIndex: baseIndex!,
          headIndex: null,
          bar: baseBar,
        });
      } else if (baseBar && headBar) {
        const changed = barFingerprint(baseBar) !== barFingerprint(headBar);
        if (changed) {
          bars.push({
            type: 'changed',
            masterBarIndex,
            baseIndex,
            headIndex,
            base: baseBar,
            head: headBar,
            changedFields: categorizeBarChanges(baseBar, headBar),
          });
        } else {
          bars.push({ type: 'equal', masterBarIndex, baseIndex, headIndex });
        }
      }
    }

    results.push({ trackIndex: t, trackName, bars });
  }

  return results;
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

function beatRhythmChanged(base: Beat, head: Beat): boolean {
  return (
    base.duration !== head.duration ||
    base.dots !== head.dots ||
    base.tupletNumerator !== head.tupletNumerator ||
    base.tupletDenominator !== head.tupletDenominator ||
    base.isRest !== head.isRest
  );
}

function beatArticulationChanged(base: Beat, head: Beat): boolean {
  return (
    base.graceType !== head.graceType ||
    base.pickStroke !== head.pickStroke ||
    base.vibrato !== head.vibrato ||
    base.whammyBarType !== head.whammyBarType ||
    !samePoints(base.whammyBarPoints, head.whammyBarPoints) ||
    base.brushType !== head.brushType ||
    base.brushDuration !== head.brushDuration ||
    base.slap !== head.slap ||
    base.pop !== head.pop ||
    base.tap !== head.tap ||
    base.fade !== head.fade ||
    base.ottava !== head.ottava ||
    base.isLetRing !== head.isLetRing ||
    base.isPalmMute !== head.isPalmMute ||
    base.isLegatoOrigin !== head.isLegatoOrigin
  );
}

function beatDynamicsChanged(base: Beat, head: Beat): boolean {
  // Rests carry an inherited dynamic that is never heard, and the fingerprint
  // that decided this bar changed already ignores it — so must this, or a bar
  // gets a dynamics chip that nothing in it explains.
  const dynamics =
    base.isRest && head.isRest ? false : base.dynamics !== head.dynamics;
  return dynamics || base.crescendo !== head.crescendo;
}

function samePoints(
  base: BendPoint[] | null,
  head: BendPoint[] | null,
): boolean {
  if (!base || !head) return !base === !head;
  return (
    base.length === head.length &&
    base.every(
      (p, i) => p.offset === head[i]!.offset && p.value === head[i]!.value,
    )
  );
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
    if (articulationChanged(bNote, hNote)) forThisNote.add('articulation');
    if (dynamicsChanged(bNote, hNote)) forThisNote.add('dynamics');

    // Defer to the fingerprint for anything the explicit checks don't cover
    // (fingerings, tie/slur links, …) so a changed note is never unexplained.
    if (
      forThisNote.size === 0 &&
      noteFingerprint(bNote) !== noteFingerprint(hNote)
    ) {
      forThisNote.add('notes');
    }
    for (const f of forThisNote) fields.add(f);
  }

  return [...fields];
}

// Pitch lives in string/fret on a fretboard, in percussionArticulation on a kit,
// and in octave/tone on everything else.
function pitchChanged(base: Note, head: Note): boolean {
  return (
    base.fret !== head.fret ||
    base.octave !== head.octave ||
    base.tone !== head.tone ||
    base.percussionArticulation !== head.percussionArticulation
  );
}

// What makes two notes "the same note" across base and head. On a fretted
// instrument that is the string it sits on. Percussion notes all report
// string === -1, so keying on string alone collapses an entire drum chord into
// a single map entry and hides every hit but the last; the articulation is what
// identifies them.
function noteKey(note: Note): string {
  return `${note.string}:${note.percussionArticulation ?? -1}`;
}

function articulationChanged(base: Note, head: Note): boolean {
  return (
    base.isDead !== head.isDead ||
    base.isGhost !== head.isGhost ||
    base.isStaccato !== head.isStaccato ||
    base.isHammerPullOrigin !== head.isHammerPullOrigin ||
    base.isLeftHandTapped !== head.isLeftHandTapped ||
    base.isContinuedBend !== head.isContinuedBend ||
    base.bendType !== head.bendType ||
    base.bendStyle !== head.bendStyle ||
    base.harmonicType !== head.harmonicType ||
    base.harmonicValue !== head.harmonicValue ||
    base.slideInType !== head.slideInType ||
    base.slideOutType !== head.slideOutType ||
    base.vibrato !== head.vibrato ||
    base.isLetRing !== head.isLetRing ||
    base.isPalmMute !== head.isPalmMute ||
    base.trillValue !== head.trillValue ||
    base.trillSpeed !== head.trillSpeed ||
    !samePoints(base.bendPoints, head.bendPoints)
  );
}

function dynamicsChanged(base: Note, head: Note): boolean {
  return (
    base.accentuated !== head.accentuated || base.dynamics !== head.dynamics
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function buildSummary(tracks: TrackDiff[]): string {
  const parts: string[] = [];

  for (const track of tracks) {
    const added = track.bars.filter((b) => b.type === 'added').length;
    const removed = track.bars.filter((b) => b.type === 'removed').length;
    const changed = track.bars.filter((b) => b.type === 'changed').length;

    if (added || removed || changed) {
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
