// Type aliases for AlphaTab model classes.
// We use `model.X` directly as type aliases because destructuring from a
// namespace loses the class type form — only `model.Score` (not a destructured
// const) is usable as an instance-type annotation without TS2749 errors.
//
// Full hierarchy: Score → (MasterBar[] + Track[]) → Staff[] → Bar[] → Voice[] → Beat[] → Note[]

import type { model } from "@coderline/alphatab";
export type { Settings } from "@coderline/alphatab";

export type Score = model.Score;
export type Track = model.Track;
export type Staff = model.Staff;
export type Bar = model.Bar;
export type Voice = model.Voice;
export type Beat = model.Beat;
export type Note = model.Note;
export type MasterBar = model.MasterBar;
export type BendPoint = model.BendPoint;
export type PlaybackInformation = model.PlaybackInformation;
