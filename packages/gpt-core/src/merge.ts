import type { Score, Bar, Beat, Note, MasterBar, Voice } from "./types/score";
import type {
  MergeResult,
  MergeCell,
  Conflicted,
  ScoreMetaMerge,
  MasterBarMerge,
  MasterBarFieldsMerge,
  TrackMerge,
  BarMerge,
  BarMergeStatus,
  VoiceMerge,
  BeatMerge,
  BeatFieldsMerge,
  NoteMerge,
  NoteFieldsMerge,
  StructuralNoteConflict,
  StructuralBeatConflict,
  ConflictLocation,
} from "./types/merge";
import { barFingerprint } from "./fingerprint";

// ─── Core cell ────────────────────────────────────────────────────────────────
//
// The 3-way merge rule for any scalar field:
//   • ours == theirs              → take ours (same on both sides)
//   • base == ours, base != theirs → take theirs (only they changed)
//   • base == theirs, base != ours → take ours  (only we changed)
//   • all three differ            → conflict

function cell<T>(base: T, ours: T, theirs: T): MergeCell<T> {
  if (ours === theirs)  return { status: "resolved", value: ours };
  if (base === ours)    return { status: "resolved", value: theirs };
  if (base === theirs)  return { status: "resolved", value: ours };
  return { status: "conflict", base, ours, theirs };
}

function isConflict<T>(c: MergeCell<T>): c is Conflicted<T> {
  return c.status === "conflict";
}

function anyConflict(fields: Record<string, MergeCell<unknown>>): boolean {
  return Object.values(fields).some(isConflict);
}

// ─── Score meta ───────────────────────────────────────────────────────────────

function mergeMeta(base: Score, ours: Score, theirs: Score): ScoreMetaMerge {
  const fields = {
    title:  cell(base.title  ?? "", ours.title  ?? "", theirs.title  ?? ""),
    artist: cell(base.artist ?? "", ours.artist ?? "", theirs.artist ?? ""),
    album:  cell(base.album  ?? "", ours.album  ?? "", theirs.album  ?? ""),
    tempo:  cell(base.tempo  ?? 120, ours.tempo ?? 120, theirs.tempo ?? 120),
  };
  return { ...fields, hasConflict: anyConflict(fields as Record<string, MergeCell<unknown>>) };
}

// ─── MasterBars ───────────────────────────────────────────────────────────────

function mergeMasterBar(
  base: MasterBar | undefined,
  ours: MasterBar | undefined,
  theirs: MasterBar | undefined,
  index: number,
): MasterBarMerge {
  // Safe fallbacks so newly-added bars still produce sensible field values.
  const B = { tsNum: 4, tsDen: 4, tsCommon: false, freeTime: false, anacrusis: false, feel: 0, double: false, repStart: false, repCount: 0, altEnd: 0 };
  const bv = base   ? { tsNum: base.timeSignatureNumerator,   tsDen: base.timeSignatureDenominator,   tsCommon: base.timeSignatureCommon,   freeTime: base.isFreeTime,   anacrusis: base.isAnacrusis,   feel: base.tripletFeel,   double: base.isDoubleBar,   repStart: base.isRepeatStart,   repCount: base.repeatCount,   altEnd: base.alternateEndings   } : B;
  const ov = ours   ? { tsNum: ours.timeSignatureNumerator,   tsDen: ours.timeSignatureDenominator,   tsCommon: ours.timeSignatureCommon,   freeTime: ours.isFreeTime,   anacrusis: ours.isAnacrusis,   feel: ours.tripletFeel,   double: ours.isDoubleBar,   repStart: ours.isRepeatStart,   repCount: ours.repeatCount,   altEnd: ours.alternateEndings   } : B;
  const tv = theirs ? { tsNum: theirs.timeSignatureNumerator, tsDen: theirs.timeSignatureDenominator, tsCommon: theirs.timeSignatureCommon, freeTime: theirs.isFreeTime, anacrusis: theirs.isAnacrusis, feel: theirs.tripletFeel, double: theirs.isDoubleBar, repStart: theirs.isRepeatStart, repCount: theirs.repeatCount, altEnd: theirs.alternateEndings } : B;

  const fields: MasterBarFieldsMerge = {
    timeSignatureNumerator:   cell(bv.tsNum,    ov.tsNum,    tv.tsNum),
    timeSignatureDenominator: cell(bv.tsDen,    ov.tsDen,    tv.tsDen),
    timeSignatureCommon:      cell(bv.tsCommon, ov.tsCommon, tv.tsCommon),
    isFreeTime:               cell(bv.freeTime, ov.freeTime, tv.freeTime),
    tripletFeel:              cell(bv.feel,     ov.feel,     tv.feel),
    isAnacrusis:              cell(bv.anacrusis,ov.anacrusis,tv.anacrusis),
    isDoubleBar:              cell(bv.double,   ov.double,   tv.double),
    isRepeatStart:            cell(bv.repStart, ov.repStart, tv.repStart),
    repeatCount:              cell(bv.repCount, ov.repCount, tv.repCount),
    alternateEndings:         cell(bv.altEnd,   ov.altEnd,   tv.altEnd),
  };

  return { index, fields, hasConflict: anyConflict(fields as unknown as Record<string, MergeCell<unknown>>) };
}

// ─── Notes ────────────────────────────────────────────────────────────────────

function resolvedNoteFields(n: Note): NoteFieldsMerge {
  const r = <T>(v: T): MergeCell<T> => ({ status: "resolved", value: v });
  return {
    fret:               r(n.fret),
    isDead:             r(n.isDead),
    isGhost:            r(n.isGhost),
    isStaccato:         r(n.isStaccato),
    isHammerPullOrigin: r(n.isHammerPullOrigin),
    isLeftHandTapped:   r(n.isLeftHandTapped),
    bendType:           r(n.bendType),
    bendStyle:          r(n.bendStyle),
    isContinuedBend:    r(n.isContinuedBend),
    harmonicType:       r(n.harmonicType),
    harmonicValue:      r(n.harmonicValue),
    slideInType:        r(n.slideInType),
    slideOutType:       r(n.slideOutType),
    vibrato:            r(n.vibrato),
    isLetRing:          r(n.isLetRing),
    isPalmMute:         r(n.isPalmMute),
    accentuated:        r(n.accentuated),
    dynamics:           r(n.dynamics),
    trillValue:         r(n.trillValue),
    trillSpeed:         r(n.trillSpeed),
    leftHandFinger:     r(n.leftHandFinger),
    rightHandFinger:    r(n.rightHandFinger),
    durationPercent:    r(n.durationPercent),
  };
}

function mergeNoteFields(base: Note, ours: Note, theirs: Note): NoteFieldsMerge {
  return {
    fret:               cell(base.fret,               ours.fret,               theirs.fret),
    isDead:             cell(base.isDead,              ours.isDead,             theirs.isDead),
    isGhost:            cell(base.isGhost,             ours.isGhost,            theirs.isGhost),
    isStaccato:         cell(base.isStaccato,          ours.isStaccato,         theirs.isStaccato),
    isHammerPullOrigin: cell(base.isHammerPullOrigin,  ours.isHammerPullOrigin, theirs.isHammerPullOrigin),
    isLeftHandTapped:   cell(base.isLeftHandTapped,    ours.isLeftHandTapped,   theirs.isLeftHandTapped),
    bendType:           cell(base.bendType,            ours.bendType,           theirs.bendType),
    bendStyle:          cell(base.bendStyle,           ours.bendStyle,          theirs.bendStyle),
    isContinuedBend:    cell(base.isContinuedBend,     ours.isContinuedBend,    theirs.isContinuedBend),
    harmonicType:       cell(base.harmonicType,        ours.harmonicType,       theirs.harmonicType),
    harmonicValue:      cell(base.harmonicValue,       ours.harmonicValue,      theirs.harmonicValue),
    slideInType:        cell(base.slideInType,         ours.slideInType,        theirs.slideInType),
    slideOutType:       cell(base.slideOutType,        ours.slideOutType,       theirs.slideOutType),
    vibrato:            cell(base.vibrato,             ours.vibrato,            theirs.vibrato),
    isLetRing:          cell(base.isLetRing,           ours.isLetRing,          theirs.isLetRing),
    isPalmMute:         cell(base.isPalmMute,          ours.isPalmMute,         theirs.isPalmMute),
    accentuated:        cell(base.accentuated,         ours.accentuated,        theirs.accentuated),
    dynamics:           cell(base.dynamics,            ours.dynamics,           theirs.dynamics),
    trillValue:         cell(base.trillValue,          ours.trillValue,         theirs.trillValue),
    trillSpeed:         cell(base.trillSpeed,          ours.trillSpeed,         theirs.trillSpeed),
    leftHandFinger:     cell(base.leftHandFinger,      ours.leftHandFinger,     theirs.leftHandFinger),
    rightHandFinger:    cell(base.rightHandFinger,     ours.rightHandFinger,    theirs.rightHandFinger),
    durationPercent:    cell(base.durationPercent,     ours.durationPercent,    theirs.durationPercent),
  };
}

function mergeNote(base: Note, ours: Note, theirs: Note): NoteMerge {
  const fields = mergeNoteFields(base, ours, theirs);
  return { string: ours.string, fields, hasConflict: anyConflict(fields as unknown as Record<string, MergeCell<unknown>>) };
}

// When a field exists on both sides but has no common ancestor (both sides
// independently added the note), we compare field by field: matching values
// auto-resolve; diverging values become a conflict with ours as the reference base.
function newField<T>(ours: T, theirs: T): MergeCell<T> {
  if (ours === theirs) return { status: "resolved", value: ours };
  // No true ancestor — ours appears as "base" so the UI can show all three.
  return { status: "conflict", base: ours, ours, theirs };
}

function mergeNoteAddedByBoth(str: number, ours: Note, theirs: Note): NoteMerge {
  const fields: NoteFieldsMerge = {
    fret:               newField(ours.fret,               theirs.fret),
    isDead:             newField(ours.isDead,              theirs.isDead),
    isGhost:            newField(ours.isGhost,             theirs.isGhost),
    isStaccato:         newField(ours.isStaccato,          theirs.isStaccato),
    isHammerPullOrigin: newField(ours.isHammerPullOrigin,  theirs.isHammerPullOrigin),
    isLeftHandTapped:   newField(ours.isLeftHandTapped,    theirs.isLeftHandTapped),
    bendType:           newField(ours.bendType,            theirs.bendType),
    bendStyle:          newField(ours.bendStyle,           theirs.bendStyle),
    isContinuedBend:    newField(ours.isContinuedBend,     theirs.isContinuedBend),
    harmonicType:       newField(ours.harmonicType,        theirs.harmonicType),
    harmonicValue:      newField(ours.harmonicValue,       theirs.harmonicValue),
    slideInType:        newField(ours.slideInType,         theirs.slideInType),
    slideOutType:       newField(ours.slideOutType,        theirs.slideOutType),
    vibrato:            newField(ours.vibrato,             theirs.vibrato),
    isLetRing:          newField(ours.isLetRing,           theirs.isLetRing),
    isPalmMute:         newField(ours.isPalmMute,          theirs.isPalmMute),
    accentuated:        newField(ours.accentuated,         theirs.accentuated),
    dynamics:           newField(ours.dynamics,            theirs.dynamics),
    trillValue:         newField(ours.trillValue,          theirs.trillValue),
    trillSpeed:         newField(ours.trillSpeed,          theirs.trillSpeed),
    leftHandFinger:     newField(ours.leftHandFinger,      theirs.leftHandFinger),
    rightHandFinger:    newField(ours.rightHandFinger,     theirs.rightHandFinger),
    durationPercent:    newField(ours.durationPercent,     theirs.durationPercent),
  };
  return { string: str, fields, hasConflict: anyConflict(fields as unknown as Record<string, MergeCell<unknown>>) };
}

// ─── Beats ────────────────────────────────────────────────────────────────────

function resolvedBeatFields(b: Beat): BeatFieldsMerge {
  const r = <T>(v: T): MergeCell<T> => ({ status: "resolved", value: v });
  return {
    duration:          r(b.duration),
    dots:              r(b.dots),
    tupletNumerator:   r(b.tupletNumerator),
    tupletDenominator: r(b.tupletDenominator),
    isLetRing:         r(b.isLetRing),
    isPalmMute:        r(b.isPalmMute),
    isLegatoOrigin:    r(b.isLegatoOrigin),
    fade:              r(b.fade),
    ottava:            r(b.ottava),
    pop:               r(b.pop),
    slap:              r(b.slap),
    tap:               r(b.tap),
    brushType:         r(b.brushType),
    brushDuration:     r(b.brushDuration),
    text:              r(b.text),
  };
}

function mergeBeatFields(base: Beat, ours: Beat, theirs: Beat): BeatFieldsMerge {
  return {
    duration:          cell(base.duration,          ours.duration,          theirs.duration),
    dots:              cell(base.dots,               ours.dots,              theirs.dots),
    tupletNumerator:   cell(base.tupletNumerator,    ours.tupletNumerator,   theirs.tupletNumerator),
    tupletDenominator: cell(base.tupletDenominator,  ours.tupletDenominator, theirs.tupletDenominator),
    isLetRing:         cell(base.isLetRing,          ours.isLetRing,         theirs.isLetRing),
    isPalmMute:        cell(base.isPalmMute,         ours.isPalmMute,        theirs.isPalmMute),
    isLegatoOrigin:    cell(base.isLegatoOrigin,     ours.isLegatoOrigin,    theirs.isLegatoOrigin),
    fade:              cell(base.fade,               ours.fade,              theirs.fade),
    ottava:            cell(base.ottava,             ours.ottava,            theirs.ottava),
    pop:               cell(base.pop,                ours.pop,               theirs.pop),
    slap:              cell(base.slap,               ours.slap,              theirs.slap),
    tap:               cell(base.tap,                ours.tap,               theirs.tap),
    brushType:         cell(base.brushType,          ours.brushType,         theirs.brushType),
    brushDuration:     cell(base.brushDuration,      ours.brushDuration,     theirs.brushDuration),
    text:              cell(base.text,               ours.text,              theirs.text),
  };
}

function mergeBeat(
  baseBeat: Beat,
  oursBeat: Beat,
  theirsBeat: Beat,
  index: number,
): BeatMerge {
  const fields = mergeBeatFields(baseBeat, oursBeat, theirsBeat);

  const baseByStr  = new Map(baseBeat.notes.map((n) => [n.string, n]));
  const oursByStr  = new Map(oursBeat.notes.map((n) => [n.string, n]));
  const theirsByStr = new Map(theirsBeat.notes.map((n) => [n.string, n]));
  const allStrs = new Set([...baseByStr.keys(), ...oursByStr.keys(), ...theirsByStr.keys()]);

  const notes: NoteMerge[] = [];
  const structuralNoteConflicts: StructuralNoteConflict[] = [];

  for (const str of allStrs) {
    const bNote = baseByStr.get(str)   ?? null;
    const oNote = oursByStr.get(str)   ?? null;
    const tNote = theirsByStr.get(str) ?? null;

    if (bNote && oNote && tNote) {
      // Full 3-way field merge.
      notes.push(mergeNote(bNote, oNote, tNote));
    } else if (!bNote && oNote && tNote) {
      // Both sides added a note on this string — compare field by field.
      notes.push(mergeNoteAddedByBoth(str, oNote, tNote));
    } else if (!bNote && oNote && !tNote) {
      // Ours added it, theirs didn't — take ours.
      notes.push({ string: str, fields: resolvedNoteFields(oNote), hasConflict: false });
    } else if (!bNote && !oNote && tNote) {
      // Theirs added it, ours didn't — take theirs.
      notes.push({ string: str, fields: resolvedNoteFields(tNote), hasConflict: false });
    } else if (bNote && oNote && !tNote) {
      // Theirs removed it; note is gone in the merge (auto-resolved: remove).
      // No NoteMerge pushed — the note will be absent in the output.
    } else if (bNote && !oNote && tNote) {
      // Ours removed it; note is gone in the merge (auto-resolved: remove).
      // No NoteMerge pushed — the note will be absent in the output.
    } else if (bNote && !oNote && !tNote) {
      // Both removed it — note is gone (auto-resolved).
    }
    // !bNote && !oNote && !tNote → impossible (str is in allStrs)
  }

  // Structural conflicts: notes where one side says "remove" and the other says "keep differently".
  // Only the ours-removes-but-theirs-changes and vice versa cases need surfacing.
  // (These are already captured above by the absence from the notes array, but we flag them
  //  explicitly so the UI can show them as structural conflicts.)
  for (const str of allStrs) {
    const bNote = baseByStr.get(str)   ?? null;
    const oNote = oursByStr.get(str)   ?? null;
    const tNote = theirsByStr.get(str) ?? null;

    if (bNote && oNote && !tNote) {
      structuralNoteConflicts.push({ string: str, kind: "removed-theirs" });
    } else if (bNote && !oNote && tNote) {
      structuralNoteConflicts.push({ string: str, kind: "removed-ours" });
    }
    // Pure additions (no base) are handled in notes[] above as field conflicts if they differ.
  }

  const hasConflict =
    anyConflict(fields as unknown as Record<string, MergeCell<unknown>>) ||
    notes.some((n) => n.hasConflict) ||
    structuralNoteConflicts.length > 0;

  return { index, fields, notes, structuralNoteConflicts, hasConflict };
}

// ─── Voices ───────────────────────────────────────────────────────────────────

function mergeVoice(
  baseVoice: Voice | undefined,
  oursVoice: Voice | undefined,
  theirsVoice: Voice | undefined,
  index: number,
): VoiceMerge {
  const baseBeats  = baseVoice?.beats  ?? [];
  const oursBeats  = oursVoice?.beats  ?? [];
  const theirsBeats = theirsVoice?.beats ?? [];

  // Determine which sides actually changed from base.
  const oursBeatsKey   = JSON.stringify(oursBeats.map((b) => ({ d: b.duration, n: b.notes.length })));
  const baseBeatsKey   = JSON.stringify(baseBeats.map((b) => ({ d: b.duration, n: b.notes.length })));
  const theirsBeatsKey = JSON.stringify(theirsBeats.map((b) => ({ d: b.duration, n: b.notes.length })));

  const oursChanged   = oursBeatsKey !== baseBeatsKey;
  const theirsChanged = theirsBeatsKey !== baseBeatsKey;
  const bothChanged   = oursChanged && theirsChanged;

  // When both sides changed AND they produced different beat counts, positional
  // note-level merging is impossible. Surface as a structural beat conflict.
  if (bothChanged && oursBeats.length !== theirsBeats.length) {
    const conflict: StructuralBeatConflict = {
      baseCount:   baseBeats.length,
      oursCount:   oursBeats.length,
      theirsCount: theirsBeats.length,
    };
    return { index, beats: [], structuralBeatConflict: conflict, hasConflict: true };
  }

  // Positional merge: zip all three beat arrays at the same index.
  const beatCount = Math.max(baseBeats.length, oursBeats.length, theirsBeats.length);
  const beats: BeatMerge[] = [];

  for (let i = 0; i < beatCount; i++) {
    const bBeat = baseBeats[i];
    const oBeat = oursBeats[i];
    const tBeat = theirsBeats[i];

    if (bBeat && oBeat && tBeat) {
      beats.push(mergeBeat(bBeat, oBeat, tBeat, i));
    } else if (oBeat && !tBeat) {
      // Ours added a beat beyond the base/theirs length — take ours.
      beats.push({ index: i, fields: resolvedBeatFields(oBeat), notes: oBeat.notes.map((n) => ({ string: n.string, fields: resolvedNoteFields(n), hasConflict: false })), structuralNoteConflicts: [], hasConflict: false });
    } else if (!oBeat && tBeat) {
      // Theirs added a beat — take theirs.
      beats.push({ index: i, fields: resolvedBeatFields(tBeat), notes: tBeat.notes.map((n) => ({ string: n.string, fields: resolvedNoteFields(n), hasConflict: false })), structuralNoteConflicts: [], hasConflict: false });
    }
    // Both absent (padding past the end) → skip.
  }

  const hasConflict = beats.some((b) => b.hasConflict);
  return { index, beats, structuralBeatConflict: null, hasConflict };
}

// ─── Bars ─────────────────────────────────────────────────────────────────────

function mergeBar(
  baseBar: Bar | null,
  oursBar: Bar | null,
  theirsBar: Bar | null,
  masterBarIndex: number,
): BarMerge {
  // ── Structural: only one side has the bar ────────────────────────────────
  if (!baseBar && oursBar && !theirsBar) {
    return { masterBarIndex, status: "ours-only", voices: [], hasConflict: false };
  }
  if (!baseBar && !oursBar && theirsBar) {
    return { masterBarIndex, status: "theirs-only", voices: [], hasConflict: false };
  }
  if (!oursBar && !theirsBar) {
    // Bar removed on both sides — gone.
    return { masterBarIndex, status: "equal", voices: [], hasConflict: false };
  }

  // ── Fingerprint comparison ────────────────────────────────────────────────
  const fp = (b: Bar | null) => (b ? barFingerprint(b) : "");
  const baseFp   = fp(baseBar);
  const oursFp   = fp(oursBar);
  const theirsFp = fp(theirsBar);

  if (oursFp === theirsFp) {
    // Both sides are identical (regardless of base) — no conflict.
    const status: BarMergeStatus = oursFp === baseFp ? "equal" : "auto-resolved";
    return { masterBarIndex, status, resolvedFrom: "both-same", voices: [], hasConflict: false };
  }
  if (baseFp === oursFp) {
    // Only theirs changed.
    return { masterBarIndex, status: "auto-resolved", resolvedFrom: "theirs", voices: [], hasConflict: false };
  }
  if (baseFp === theirsFp) {
    // Only ours changed.
    return { masterBarIndex, status: "auto-resolved", resolvedFrom: "ours", voices: [], hasConflict: false };
  }

  // ── Both sides changed differently → drill into voices ───────────────────
  const voiceCount = Math.max(
    oursBar?.voices.length ?? 0,
    theirsBar?.voices.length ?? 0,
    baseBar?.voices.length ?? 0,
  );
  const voices: VoiceMerge[] = [];
  for (let vi = 0; vi < voiceCount; vi++) {
    voices.push(
      mergeVoice(
        baseBar?.voices[vi],
        oursBar?.voices[vi],
        theirsBar?.voices[vi],
        vi,
      ),
    );
  }

  const hasConflict = voices.some((v) => v.hasConflict);
  return { masterBarIndex, status: "conflict", voices, hasConflict };
}

// ─── Tracks ───────────────────────────────────────────────────────────────────

function mergeTracks(base: Score, ours: Score, theirs: Score): TrackMerge[] {
  const trackCount = Math.max(base.tracks.length, ours.tracks.length, theirs.tracks.length);
  const masterBarCount = Math.max(base.masterBars.length, ours.masterBars.length, theirs.masterBars.length);

  const results: TrackMerge[] = [];

  for (let t = 0; t < trackCount; t++) {
    const baseTrack  = base.tracks[t];
    const oursTrack  = ours.tracks[t];
    const theirsTrack = theirs.tracks[t];
    const trackName  = oursTrack?.name ?? theirsTrack?.name ?? baseTrack?.name ?? `Track ${t + 1}`;

    const bars: BarMerge[] = [];
    for (let mbIdx = 0; mbIdx < masterBarCount; mbIdx++) {
      bars.push(
        mergeBar(
          baseTrack?.staves[0]?.bars[mbIdx]   ?? null,
          oursTrack?.staves[0]?.bars[mbIdx]   ?? null,
          theirsTrack?.staves[0]?.bars[mbIdx] ?? null,
          mbIdx,
        ),
      );
    }

    results.push({ trackIndex: t, trackName, bars, hasConflict: bars.some((b) => b.hasConflict) });
  }

  return results;
}

// ─── MasterBars ───────────────────────────────────────────────────────────────

function mergeMasterBars(base: Score, ours: Score, theirs: Score): MasterBarMerge[] {
  const count = Math.max(base.masterBars.length, ours.masterBars.length, theirs.masterBars.length);
  const results: MasterBarMerge[] = [];
  for (let i = 0; i < count; i++) {
    results.push(mergeMasterBar(base.masterBars[i], ours.masterBars[i], theirs.masterBars[i], i));
  }
  return results;
}

// ─── Conflict collection ──────────────────────────────────────────────────────

function collectConflicts(
  meta: ScoreMetaMerge,
  masterBars: MasterBarMerge[],
  tracks: TrackMerge[],
): ConflictLocation[] {
  const locs: ConflictLocation[] = [];

  // Meta
  const metaEntries = [
    ["title",  meta.title]  as const,
    ["artist", meta.artist] as const,
    ["album",  meta.album]  as const,
    ["tempo",  meta.tempo]  as const,
  ];
  for (const [field, c] of metaEntries) {
    if (c.status === "conflict") {
      locs.push({ path: `meta.${field}`, kind: "field", description: `Score ${field}: "${String(c.ours)}" vs "${String(c.theirs)}"` });
    }
  }

  // MasterBars
  for (const mb of masterBars) {
    for (const [field, c] of Object.entries(mb.fields) as [string, MergeCell<unknown>][]) {
      if (c.status === "conflict") {
        locs.push({
          path: `masterBar[${mb.index}].${field}`,
          kind: "field",
          description: `Measure ${mb.index + 1} ${field}: ${String(c.ours)} vs ${String(c.theirs)}`,
        });
      }
    }
  }

  // Tracks → Bars → Voices → Beats → Notes
  for (const track of tracks) {
    const tp = `track[${track.trackIndex}]`;
    for (const bar of track.bars) {
      if (!bar.hasConflict) continue;
      const bp = `${tp}.bar[${bar.masterBarIndex}]`;
      for (const voice of bar.voices) {
        if (!voice.hasConflict) continue;
        const vp = `${bp}.voice[${voice.index}]`;
        if (voice.structuralBeatConflict) {
          locs.push({
            path: `${vp}.structuralBeats`,
            kind: "structural-beat",
            description: `${track.trackName} measure ${bar.masterBarIndex + 1} voice ${voice.index + 1}: beat count conflict (ours: ${voice.structuralBeatConflict.oursCount}, theirs: ${voice.structuralBeatConflict.theirsCount})`,
          });
          continue;
        }
        for (const beat of voice.beats) {
          if (!beat.hasConflict) continue;
          const bep = `${vp}.beat[${beat.index}]`;
          for (const [field, c] of Object.entries(beat.fields) as [string, MergeCell<unknown>][]) {
            if (c.status === "conflict") {
              locs.push({
                path: `${bep}.${field}`,
                kind: "field",
                description: `${track.trackName} measure ${bar.masterBarIndex + 1} beat ${beat.index + 1} ${field}: ${String(c.ours)} vs ${String(c.theirs)}`,
              });
            }
          }
          for (const sc of beat.structuralNoteConflicts) {
            locs.push({
              path: `${bep}.structuralNote[s=${sc.string}]`,
              kind: "structural-note",
              description: `${track.trackName} measure ${bar.masterBarIndex + 1} beat ${beat.index + 1}: note on string ${sc.string} ${sc.kind.replace("-", " ")}`,
            });
          }
          for (const note of beat.notes) {
            if (!note.hasConflict) continue;
            const np = `${bep}.note[s=${note.string}]`;
            for (const [field, c] of Object.entries(note.fields) as [string, MergeCell<unknown>][]) {
              if (c.status === "conflict") {
                locs.push({
                  path: `${np}.${field}`,
                  kind: "field",
                  description: `${track.trackName} measure ${bar.masterBarIndex + 1} note s${note.string} ${field}: ${String(c.ours)} vs ${String(c.theirs)}`,
                });
              }
            }
          }
        }
      }
    }
  }

  return locs;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * 3-way merge of three AlphaTab scores sharing a common ancestor (`base`).
 *
 * Resolution rules (applied at every granularity level — score meta, masterBar
 * fields, beat fields, note fields):
 *   - Only ours changed from base  → take ours  (auto)
 *   - Only theirs changed from base → take theirs (auto)
 *   - Both changed to the same value → take ours (auto, both-same)
 *   - All three differ               → conflict (user must resolve)
 *
 * The returned `MergeResult` is a plain data structure — no AlphaTab objects
 * are constructed. Pass it to `applyMerge()` (in the CLI layer) to produce
 * a concrete `Score` for writing to disk.
 */
export function mergeScores(base: Score, ours: Score, theirs: Score): MergeResult {
  const meta       = mergeMeta(base, ours, theirs);
  const masterBars = mergeMasterBars(base, ours, theirs);
  const tracks     = mergeTracks(base, ours, theirs);
  const conflicts  = collectConflicts(meta, masterBars, tracks);

  return {
    meta,
    masterBars,
    tracks,
    hasConflicts:  conflicts.length > 0,
    conflictCount: conflicts.length,
    conflicts,
  };
}
