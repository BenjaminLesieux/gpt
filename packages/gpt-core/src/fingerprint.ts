import type { Bar, Beat, Note, MasterBar, BendPoint } from "./types/score";

// ── MasterBar ─────────────────────────────────────────────────────────────────

export function masterBarFingerprint(mb: MasterBar): string {
  return JSON.stringify({
    tsNum:       mb.timeSignatureNumerator,
    tsDen:       mb.timeSignatureDenominator,
    tsCommon:    mb.timeSignatureCommon,
    freeTime:    mb.isFreeTime,
    anacrusis:   mb.isAnacrusis,
    tripletFeel: mb.tripletFeel,
    isRepeat:    mb.isRepeatStart,
    repeatCount: mb.repeatCount,
    altEndings:  mb.alternateEndings,
    doubleBar:   mb.isDoubleBar,
  });
}

// ── Bar ───────────────────────────────────────────────────────────────────────

export function barFingerprint(bar: Bar): string {
  return JSON.stringify(
    bar.voices.map((voice) => ({
      beats: voice.beats.map((beat) => beatSnapshot(beat)),
    })),
  );
}

// ── Beat ──────────────────────────────────────────────────────────────────────

function beatSnapshot(beat: Beat) {
  return {
    duration:          beat.duration,
    dots:              beat.dots,
    isRest:            beat.isRest,
    tupletNumerator:   beat.tupletNumerator,
    tupletDenominator: beat.tupletDenominator,
    fade:              beat.fade,
    pop:               beat.pop,
    slap:              beat.slap,
    tap:               beat.tap,
    brushType:         beat.brushType,
    brushDuration:     beat.brushDuration,
    ottava:            beat.ottava,
    text:              beat.text,
    isLetRing:         beat.isLetRing,
    isPalmMute:        beat.isPalmMute,
    isLegatoOrigin:    beat.isLegatoOrigin,
    dynamics:          beat.dynamics,
    crescendo:         beat.crescendo,
    graceType:         beat.graceType,
    pickStroke:        beat.pickStroke,
    vibrato:           beat.vibrato,
    chordId:           beat.chordId,
    lyrics:            beat.lyrics,
    whammyBarType:     beat.whammyBarType,
    whammyBarPoints:   bendPoints(beat.whammyBarPoints),
    notes: [...beat.notes].sort(compareNotes).map((note) => noteSnapshot(note)),
  };
}

// Notes within a beat are unordered in the model, so the fingerprint sorts them
// into a canonical order. `string` alone is not enough: percussion notes all
// report string === -1, and sorting on a constant leaves them in whatever order
// the file happened to list them, which would make a re-ordered drum chord look
// like a change. Fall through to the fields that actually distinguish them.
function compareNotes(a: Note, b: Note): number {
  return (
    num(a.string) - num(b.string) ||
    num(a.percussionArticulation) - num(b.percussionArticulation) ||
    num(a.octave) - num(b.octave) ||
    num(a.tone) - num(b.tone) ||
    num(a.fret) - num(b.fret)
  );
}

function num(value: number | undefined): number {
  return typeof value === "number" && !Number.isNaN(value) ? value : -1;
}

// ── Note ──────────────────────────────────────────────────────────────────────

/**
 * The single source of truth for "did this note change". Exposed so the diff's
 * changed-field categorization can defer to it rather than maintaining a second,
 * drifting list of fields.
 */
export function noteFingerprint(note: Note): string {
  return JSON.stringify(noteSnapshot(note));
}

function noteSnapshot(note: Note) {
  return {
    string:             note.string,
    fret:               note.fret,
    // Percussion carries no string or fret — the articulation *is* the pitch.
    percussion:         note.percussionArticulation,
    // Instruments written without a fretboard (piano, vocals) leave string and
    // fret at -1 and carry pitch here, so omitting these hides every edit.
    octave:             note.octave,
    tone:               note.tone,
    isDead:             note.isDead,
    isHammerPullOrigin: note.isHammerPullOrigin,
    bendType:           note.bendType,
    bendStyle:          note.bendStyle,
    isContinuedBend:    note.isContinuedBend,
    harmonicType:       note.harmonicType,
    harmonicValue:      note.harmonicValue,
    slideInType:        note.slideInType,
    slideOutType:       note.slideOutType,
    vibrato:            note.vibrato,
    isLetRing:          note.isLetRing,
    isPalmMute:         note.isPalmMute,
    isGhost:            note.isGhost,
    isStaccato:         note.isStaccato,
    isLeftHandTapped:   note.isLeftHandTapped,
    accentuated:        note.accentuated,
    dynamics:           note.dynamics,
    trillValue:         note.trillValue,
    trillSpeed:         note.trillSpeed,
    leftHandFinger:     note.leftHandFinger,
    rightHandFinger:    note.rightHandFinger,
    durationPercent:    note.durationPercent,
    // bendType alone says "there is a bend"; the points say what shape it is.
    bendPoints:         bendPoints(note.bendPoints),
    isTieDestination:   note.isTieDestination,
    isSlurDestination:  note.isSlurDestination,
  };
}

// ── Bend / whammy curves ──────────────────────────────────────────────────────
//
// BendPoint instances carry back-references we must not serialize, so reduce
// each curve to its offset/value pairs.

function bendPoints(points: BendPoint[] | null | undefined) {
  return points?.map((p) => [p.offset, p.value]) ?? null;
}
