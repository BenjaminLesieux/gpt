// Diff test fixtures built from real alphaTab model instances.
//
// The previous fixtures were plain objects cast to alphaTab types. They never
// ran Score.finish(), so computed state (Beat.displayStart, tie resolution)
// was absent, and every field a test forgot to mention compared
// undefined === undefined — silently equal. Real instances carry the model's
// real defaults, and finish() enforces what a parsed file enforces: a tie
// without an origin does not survive, displayStart exists, and impossible
// states cannot be built.

import { model, Settings } from '@coderline/alphatab';
import type {
  Bar,
  Beat,
  BendPoint,
  MasterBar,
  Note,
  Score,
  Track,
  Voice,
} from '../types/score';

export function makeNote(
  string: number,
  fret: number,
  overrides: Partial<Note> = {},
): Note {
  const note = new model.Note();
  note.string = string;
  note.fret = fret;
  return Object.assign(note, overrides);
}

export function makeBendPoints(
  points: readonly (readonly [offset: number, value: number])[],
): BendPoint[] {
  return points.map(([offset, value]) => new model.BendPoint(offset, value));
}

export function makeBeat(notes: Note[], overrides: Partial<Beat> = {}): Beat {
  const beat = new model.Beat();
  for (const note of notes) beat.addNote(note);
  return Object.assign(beat, overrides);
}

export function makeVoice(beats: Beat[]): Voice {
  const voice = new model.Voice();
  for (const beat of beats) voice.addBeat(beat);
  return voice;
}

export function makeBar(voices: Voice[]): Bar {
  const bar = new model.Bar();
  for (const voice of voices) bar.addVoice(voice);
  return bar;
}

export function makeMasterBar(overrides: Partial<MasterBar> = {}): MasterBar {
  return Object.assign(new model.MasterBar(), overrides);
}

export interface TrackOptions {
  percussion?: boolean;
  playbackInfo?: { primaryChannel?: number; program?: number };
}

export function makeTrack(
  name: string,
  bars: Bar[],
  options: TrackOptions = {},
): Track {
  const track = new model.Track();
  track.name = name;
  track.playbackInfo.primaryChannel = options.playbackInfo?.primaryChannel ?? 0;
  track.playbackInfo.program = options.playbackInfo?.program ?? 24;

  const staff = new model.Staff();
  if (options.percussion) {
    staff.isPercussion = true;
  } else {
    const standard = model.Tuning.getDefaultTuningFor(6)!;
    staff.stringTuning.tunings = [...standard.tunings];
  }
  for (const bar of bars) staff.addBar(bar);
  track.addStaff(staff);
  return track;
}

export interface ScoreOptions {
  title?: string;
  artist?: string;
  album?: string;
  /** Initial tempo — stored where the real model stores it, as a tempo automation on the first master bar. */
  tempo?: number;
}

export function makeScore(
  tracks: Track[],
  masterBarCount: number,
  options: ScoreOptions = {},
): Score {
  const score = new model.Score();
  score.title = options.title ?? 'Test Song';
  score.artist = options.artist ?? 'Artist';
  if (options.album !== undefined) score.album = options.album;

  for (let i = 0; i < masterBarCount; i++) {
    score.addMasterBar(makeMasterBar());
  }

  if (options.tempo !== undefined) {
    if (score.masterBars.length === 0) {
      throw new Error('a tempo needs at least one master bar to live on');
    }
    const automation = new model.Automation();
    automation.type = model.AutomationType.Tempo;
    automation.value = options.tempo;
    score.masterBars[0]!.tempoAutomations.push(automation);
  }

  for (const track of tracks) {
    padStaves(track, masterBarCount);
    score.addTrack(track);
  }

  score.finish(new Settings());
  return score;
}

// Every staff of a parsed score has exactly masterBars.length bars — alphaTab's
// importer pipeline (ModelUtils.consolidate) guarantees it. Replicate the same
// padding so built scores keep the invariant the diff relies on.
function padStaves(track: Track, masterBarCount: number): void {
  for (const staff of track.staves) {
    if (staff.bars.length > masterBarCount) {
      throw new Error(
        `track "${track.name}" has ${staff.bars.length} bars but the score has ${masterBarCount} master bars`,
      );
    }
    while (staff.bars.length < masterBarCount) {
      const bar = new model.Bar();
      staff.addBar(bar);
      const voice = new model.Voice();
      bar.addVoice(voice);
      const emptyBeat = new model.Beat();
      emptyBeat.isEmpty = true;
      voice.addBeat(emptyBeat);
    }
  }
}
