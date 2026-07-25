import type { Bar, Beat, Note, MasterBar } from "./types/score";

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
    notes: [...beat.notes]
      .sort((a, b) => a.string - b.string)
      .map((note) => noteSnapshot(note)),
  };
}

// ── Note ──────────────────────────────────────────────────────────────────────

function noteSnapshot(note: Note) {
  return {
    string:             note.string,
    fret:               note.fret,
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
  };
}
