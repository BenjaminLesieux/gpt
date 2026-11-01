import type { BranchDetail, Conflict } from './api';

/**
 * Tracks that two or more branches in flight both touch. `track: null` is the
 * score's own settings — tempo, title, time signature. Branches whose scope
 * could not be read are left out, so an empty answer only means *disjoint*
 * when every scope was read.
 */
export function sharedTracks(
  branches: BranchDetail[]
): { track: string | null; branches: string[] }[] {
  const on = new Map<string | null, string[]>();
  for (const branch of branches) {
    if (branch.ahead === 0 || !branch.scope) continue;
    const touched = branch.scope.tracks.map((track): string | null => track.name);
    if (branch.scope.meta) touched.push(null);
    for (const track of touched) on.set(track, [...(on.get(track) ?? []), branch.name]);
  }
  return [...on]
    .filter(([, names]) => names.length > 1)
    .map(([track, names]) => ({ track, branches: names }));
}

/** *bar 19, Guitar 1* — or the merge's own words when it is not a bar. */
export function conflictPlace(
  conflict: Conflict,
  words: { bar: (bar: number) => string; everyTrack: string }
): string {
  if (conflict.bar === null) return conflict.description;
  return `${words.bar(conflict.bar)}, ${conflict.track ?? words.everyTrack}`;
}

/** How many bars need someone, counting a bar once however many tracks it spans. */
export function conflictBars(conflicts: Conflict[]): number {
  return new Set(conflicts.flatMap((conflict) => (conflict.bar === null ? [] : [conflict.bar])))
    .size;
}
