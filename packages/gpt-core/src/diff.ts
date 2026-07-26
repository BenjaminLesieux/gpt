import type { Bar, Beat, Note, Score } from './types/score';
import type {
  BarChangedField,
  BarDiff,
  MetaDiff,
  ScoreDiff,
  TrackDiff,
} from './types/diff';
import { barFingerprint, masterBarFingerprint } from './fingerprint';

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

// ─── Tracks ───────────────────────────────────────────────────────────────────

function diffTracks(base: Score, head: Score): TrackDiff[] {
  const trackCount = Math.max(base.tracks.length, head.tracks.length);
  const results: TrackDiff[] = [];

  for (let t = 0; t < trackCount; t++) {
    const baseTrack = base.tracks[t];
    const headTrack = head.tracks[t];
    const trackName = headTrack?.name ?? baseTrack?.name ?? `Track ${t + 1}`;

    const masterBarCount = Math.max(
      base.masterBars.length,
      head.masterBars.length,
    );
    const bars: BarDiff[] = [];

    for (let mbIndex = 0; mbIndex < masterBarCount; mbIndex++) {
      const baseBar = baseTrack?.staves[0]?.bars[mbIndex] ?? null;
      const headBar = headTrack?.staves[0]?.bars[mbIndex] ?? null;

      if (!baseBar && headBar) {
        bars.push({ type: 'added', masterBarIndex: mbIndex, bar: headBar });
      } else if (baseBar && !headBar) {
        bars.push({ type: 'removed', masterBarIndex: mbIndex, bar: baseBar });
      } else if (baseBar && headBar) {
        const changed = barFingerprint(baseBar) !== barFingerprint(headBar);
        if (changed) {
          bars.push({
            type: 'changed',
            masterBarIndex: mbIndex,
            base: baseBar,
            head: headBar,
            changedFields: categorizeBarChanges(baseBar, headBar),
          });
        } else {
          bars.push({ type: 'equal', masterBarIndex: mbIndex });
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

      const noteChanges = categorizeNoteChanges(bBeat, hBeat);
      for (const f of noteChanges) fields.add(f);
    }
  }

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

function categorizeNoteChanges(base: Beat, head: Beat): BarChangedField[] {
  const fields = new Set<BarChangedField>();

  const baseByStr = new Map(base.notes.map((n) => [n.string, n]));
  const headByStr = new Map(head.notes.map((n) => [n.string, n]));
  const allStrs = new Set([...baseByStr.keys(), ...headByStr.keys()]);

  for (const str of allStrs) {
    const bNote = baseByStr.get(str) ?? null;
    const hNote = headByStr.get(str) ?? null;

    if (!bNote || !hNote) {
      fields.add('notes');
      continue;
    }

    if (bNote.fret !== hNote.fret) fields.add('notes');
    if (articulationChanged(bNote, hNote)) fields.add('articulation');
    if (dynamicsChanged(bNote, hNote)) fields.add('dynamics');
  }

  return [...fields];
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
    base.trillSpeed !== head.trillSpeed
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
