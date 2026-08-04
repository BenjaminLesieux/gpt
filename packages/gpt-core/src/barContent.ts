// What changed *inside* a measure.
//
// The measure alignment (diff.ts) answers "which measures changed". This answers
// "where in the measure", down to the individual note head, so a side-by-side
// view can paint the one note that moved rather than tinting sixteen that did
// not. The two run on the same fingerprints and the same alignment, so they can
// never disagree about whether something changed — only about how precisely to
// say it.

import type { Bar, Beat } from './types/score';
import type { BarContentMark, ContentMarks, ScoreDiff } from './types/diff';
import { alignIndexes } from './align';
import { beatFingerprint, isSilentVoice } from './fingerprint';
import { beatFieldsChanged, noteChanged, noteKey } from './compare';

/**
 * Where inside its measures the edit landed, for one track or — with a null
 * trackIndex — every track. Base marks are what the edit removed, head marks
 * what it added; a note that merely changed value is both.
 */
export function changedContent(
  diff: ScoreDiff,
  trackIndex: number | null,
): ContentMarks {
  const marks: ContentMarks = { base: [], head: [] };

  for (const measure of diff.measures) {
    // An added or removed measure is a whole-measure fact — there is no base
    // bar to compare against, and highlighting every note in it says nothing
    // the filled measure doesn't already say.
    if (measure.type !== 'changed') continue;

    for (const change of measure.changedTracks) {
      if (trackIndex !== null && change.trackIndex !== trackIndex) continue;
      const pairing = diff.tracks[change.trackIndex];
      if (!pairing || pairing.baseTrack === null || pairing.headTrack === null) {
        continue;
      }

      // The alignment compares the first staff, so that is the staff a mark
      // lands on — a grand staff's second staff is not diffed today.
      const baseBar =
        diff.base.tracks[pairing.baseTrack]?.staves[0]?.bars[measure.baseIndex];
      const headBar =
        diff.head.tracks[pairing.headTrack]?.staves[0]?.bars[measure.headIndex];
      if (!baseBar || !headBar) continue;

      const inBar = barContent(baseBar, headBar);
      for (const mark of inBar.base) {
        marks.base.push({
          masterBarIndex: measure.baseIndex,
          trackIndex: pairing.baseTrack,
          staffIndex: 0,
          ...mark,
        });
      }
      for (const mark of inBar.head) {
        marks.head.push({
          masterBarIndex: measure.headIndex,
          trackIndex: pairing.headTrack,
          staffIndex: 0,
          ...mark,
        });
      }
    }
  }

  return marks;
}

/**
 * The beats and notes that differ between two bars, positioned in each bar's
 * own coordinates.
 */
export function barContent(
  base: Bar,
  head: Bar,
): ContentMarks<BarContentMark> {
  const marks: ContentMarks<BarContentMark> = { base: [], head: [] };

  const voiceCount = Math.max(base.voices.length, head.voices.length);
  for (let voiceIndex = 0; voiceIndex < voiceCount; voiceIndex++) {
    const baseVoice = base.voices[voiceIndex];
    const headVoice = head.voices[voiceIndex];

    // Guitar Pro re-spells untouched silence on every save — a whole rest
    // becomes a quarter plus a dotted half. The fingerprint already treats all
    // silence as one thing; marking the re-spelling would light up rests in
    // bars nobody edited.
    if (
      (!baseVoice || isSilentVoice(baseVoice)) &&
      (!headVoice || isSilentVoice(headVoice))
    ) {
      continue;
    }

    const baseBeats = baseVoice?.beats ?? [];
    const headBeats = headVoice?.beats ?? [];
    const baseFp = baseBeats.map(beatFingerprint);
    const headFp = headBeats.map(beatFingerprint);

    // Beats are aligned, not zipped: inserting a sixteenth at the top of a bar
    // shifts every later beat by one, and pairing by position would report the
    // whole bar as rewritten.
    for (const [b, h] of alignIndexes(baseFp, headFp)) {
      if (h === null) {
        marks.base.push({ voiceIndex, beatIndex: b!, noteIndex: null });
        continue;
      }
      if (b === null) {
        marks.head.push({ voiceIndex, beatIndex: h, noteIndex: null });
        continue;
      }
      if (baseFp[b] === headFp[h]) continue;

      const baseBeat = baseBeats[b]!;
      const headBeat = headBeats[h]!;

      // A beat carries things no single note owns — its duration, a palm mute,
      // the text above it. Those belong to the beat as a whole; anything else
      // is narrowed to the notes that actually differ.
      if (beatFieldsChanged(baseBeat, headBeat)) {
        marks.base.push({ voiceIndex, beatIndex: b, noteIndex: null });
        marks.head.push({ voiceIndex, beatIndex: h, noteIndex: null });
      }

      markNotes(baseBeat, headBeat, voiceIndex, b, h, marks);
    }
  }

  return marks;
}

function markNotes(
  baseBeat: Beat,
  headBeat: Beat,
  voiceIndex: number,
  baseIndex: number,
  headIndex: number,
  marks: ContentMarks<BarContentMark>,
): void {
  const baseNotes = indexNotes(baseBeat);
  const headNotes = indexNotes(headBeat);

  for (const [key, [note, noteIndex]] of baseNotes) {
    const twin = headNotes.get(key);
    if (!twin || noteChanged(note, twin[0])) {
      marks.base.push({ voiceIndex, beatIndex: baseIndex, noteIndex });
    }
  }
  for (const [key, [note, noteIndex]] of headNotes) {
    const twin = baseNotes.get(key);
    if (!twin || noteChanged(twin[0], note)) {
      marks.head.push({ voiceIndex, beatIndex: headIndex, noteIndex });
    }
  }
}

/** Notes by identity, carrying the position a renderer addresses them by. */
function indexNotes(beat: Beat) {
  return new Map(
    beat.notes.map((note, index) => [noteKey(note), [note, index] as const]),
  );
}
