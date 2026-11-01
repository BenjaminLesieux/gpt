import { exporter } from '@coderline/alphatab';
import { applyMerge, mergeScores } from '@gpt/gpt-core';
import type { MergeResult } from '@gpt/gpt-core';
import { and, eq } from 'drizzle-orm';
import type { HubDatabase } from '../db/client';
import { branchLandings } from '../db/schema';
import type { BranchLanding } from '../db/schema';
import { readBranchAgainstMain } from '../git/history';
import type { BranchAgainstMain } from '../git/history';
import { writeLanding } from '../git/versions';
import { parse, parser } from './scope';

/**
 * Landing a branch on main: the one deliberate act. A clean merge lands with
 * nobody reviewing it; anything else is reported and nothing is written. See
 * ADR 0008 and issue #19.
 */

export interface Conflict {
  /** 1-based. Null for something that is not a bar — tempo, title. */
  bar: number | null;
  /** Null for every track: a master-bar change, or meta. */
  track: string | null;
  description: string;
}

/** The last report kept for a branch, as `GET /branches` serves it. */
export type Landing =
  | {
      status: 'conflicts';
      cleanBars: number;
      conflicts: Conflict[];
      tip: string;
    }
  | { status: 'waiting'; tip: string }
  | { status: 'unreadable'; tip: string };

export type LandOutcome =
  | { status: 'landed'; commit: string; dryRun: false }
  | { status: 'clean'; dryRun: true }
  | { status: 'waiting' }
  | { status: 'conflicts'; cleanBars: number; conflicts: Conflict[] }
  | { status: 'unreadable' }
  | { status: 'up_to_date' }
  | { status: 'main_moved' }
  | { status: 'no_such_branch' };

export interface LandRequest {
  db: HubDatabase;
  gitRoot: string;
  bandId: string;
  scoreId: string;
  branch: string;
  /** Lands a clean branch even though it asks the band first. */
  override: boolean;
  /** `MERGE_WRITES`. Off, a clean landing is computed in full and not written. */
  writes: boolean;
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Serialised per score: a merge holds three parsed scores in memory, and two
 * at once on the same song can only end in one refusal anyway.
 *
 * ponytail: in-process queue, so it serialises within one hub process only.
 * `update-ref`'s expected old value still makes a second process safe, just
 * not cheap; a lock row is the upgrade if the hub ever runs twice.
 */
export function land(request: LandRequest): Promise<LandOutcome> {
  const next = (queues.get(request.scoreId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => attempt(request));

  queues.set(request.scoreId, next);
  const done = () => {
    if (queues.get(request.scoreId) === next) queues.delete(request.scoreId);
  };
  next.then(done, done);

  return next;
}

async function attempt(request: LandRequest): Promise<LandOutcome> {
  const { db, gitRoot, bandId, scoreId, branch } = request;

  const point = await readBranchAgainstMain(gitRoot, bandId, scoreId, branch);
  if (!point) return { status: 'no_such_branch' };

  if (point.ahead === 0) {
    record(db, scoreId, branch, null);
    return { status: 'up_to_date' };
  }

  // Main behind the branch is a fast-forward: the tip's own bytes become main
  // and there is nothing to merge.
  let merged: Uint8Array | null = null;
  if (point.main && point.base !== point.main) {
    const outcome = await merge(request, point);

    if (outcome.status === 'conflicts' || outcome.status === 'unreadable') {
      record(db, scoreId, branch, { ...outcome, tip: point.tip });
      return outcome;
    }
    merged = outcome.bytes;
  }

  if (readRow(db, scoreId, branch)?.askFirst && !request.override) {
    record(db, scoreId, branch, { status: 'waiting', tip: point.tip });
    return { status: 'waiting' };
  }

  record(db, scoreId, branch, null);
  if (!request.writes) return { status: 'clean', dryRun: true };

  const written = await writeLanding(gitRoot, bandId, scoreId, {
    from: point.main,
    tip: point.tip,
    merged,
    message: `${branch} landed`,
  });
  if (written.status === 'main_moved') return written;

  return { status: 'landed', commit: written.commit, dryRun: false };
}

type Merged =
  | { status: 'clean'; bytes: Uint8Array }
  | { status: 'conflicts'; cleanBars: number; conflicts: Conflict[] }
  | { status: 'unreadable' };

async function merge(
  request: LandRequest,
  point: BranchAgainstMain,
): Promise<Merged> {
  if (!point.base || !point.main) {
    return {
      status: 'conflicts',
      cleanBars: 0,
      conflicts: [
        {
          bar: null,
          track: null,
          description: 'This branch shares no history with main.',
        },
      ],
    };
  }

  const load = parser(request.gitRoot, request.bandId, request.scoreId);
  const base = await load(point.base);
  const ours = await load(point.main);
  const theirs = await load(point.tip);
  if (!base || !ours || !theirs) return { status: 'unreadable' };

  const result = mergeScores(base, ours, theirs);
  const conflicts = conflictsOf(result);
  if (conflicts.length > 0) {
    return { status: 'conflicts', cleanBars: cleanBars(result), conflicts };
  }

  applyMerge(ours, theirs, result);
  const bytes = new exporter.Gp7Exporter().export(ours, null);

  // The bytes about to become the song. One that will not read back is a bug
  // in the export, and finding it here costs a 500 instead of the score.
  if (!parse(bytes))
    throw new Error('A merged score did not read back after export.');

  return { status: 'clean', bytes };
}

const IN_TRACK = /^track\[(\d+)\]\.bar\[(\d+)\]/;
const IN_MASTER_BAR = /^masterBar\[(\d+)\]/;

/** Deduplicated per (bar, track), sorted by bar then track order. */
function conflictsOf(result: MergeResult): Conflict[] {
  const found = new Map<
    string,
    { bar: number | null; track: number; description: string }
  >();
  const add = (bar: number | null, track: number, description: string) => {
    const key = `${bar}:${track}`;
    if (!found.has(key)) found.set(key, { bar, track, description });
  };

  for (const conflict of result.conflicts) {
    const inTrack = IN_TRACK.exec(conflict.path);
    const inMasterBar = IN_MASTER_BAR.exec(conflict.path);
    if (inTrack)
      add(Number(inTrack[2]) + 1, Number(inTrack[1]), conflict.description);
    else if (inMasterBar)
      add(Number(inMasterBar[1]) + 1, -1, conflict.description);
    else add(null, -1, conflict.description);
  }

  // Both sides changed the bar and the engine resolved it voice by voice, but
  // `applyMerge` keeps ours whole for such a bar: landing it would silently
  // drop the branch's half.
  for (const track of result.tracks) {
    for (const bar of track.bars) {
      if (bar.status === 'conflict' && !bar.hasConflict) {
        add(
          bar.masterBarIndex + 1,
          track.trackIndex,
          `${track.trackName} measure ${bar.masterBarIndex + 1}: both sides changed this bar`,
        );
      }
    }
  }

  return [...found.values()]
    .sort((a, b) => (a.bar ?? 0) - (b.bar ?? 0) || a.track - b.track)
    .map(({ bar, track, description }) => ({
      bar,
      track: track >= 0 ? (result.tracks[track]?.trackName ?? null) : null,
      description,
    }));
}

/** Track bars the branch changed that merge without a decision. */
function cleanBars(result: MergeResult): number {
  return result.tracks
    .flatMap((track) => track.bars)
    .filter(
      (bar) =>
        bar.status === 'theirs-only' ||
        (bar.status === 'auto-resolved' && bar.resolvedFrom !== 'ours'),
    ).length;
}

export function setAskFirst(
  db: HubDatabase,
  scoreId: string,
  branch: string,
  askFirst: boolean,
): void {
  db.insert(branchLandings)
    .values({ scoreId, branch, askFirst, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [branchLandings.scoreId, branchLandings.branch],
      set: { askFirst, updatedAt: new Date() },
    })
    .run();
}

/** Every branch's `askFirst` and last report, by branch name. */
export function landingsFor(
  db: HubDatabase,
  scoreId: string,
): Map<string, { askFirst: boolean; landing: Landing | null }> {
  const rows = db
    .select()
    .from(branchLandings)
    .where(eq(branchLandings.scoreId, scoreId))
    .all();
  return new Map(
    rows.map((row) => [
      row.branch,
      { askFirst: row.askFirst, landing: landingOf(row) },
    ]),
  );
}

function landingOf(row: BranchLanding): Landing | null {
  if (!row.status || !row.tip) return null;
  if (row.status === 'conflicts') {
    return {
      status: 'conflicts',
      cleanBars: row.cleanBars ?? 0,
      conflicts: JSON.parse(row.conflicts ?? '[]') as Conflict[],
      tip: row.tip,
    };
  }
  return { status: row.status, tip: row.tip };
}

function readRow(
  db: HubDatabase,
  scoreId: string,
  branch: string,
): BranchLanding | undefined {
  return db
    .select()
    .from(branchLandings)
    .where(
      and(
        eq(branchLandings.scoreId, scoreId),
        eq(branchLandings.branch, branch),
      ),
    )
    .get();
}

/** Null clears the report and leaves `askFirst` alone. */
function record(
  db: HubDatabase,
  scoreId: string,
  branch: string,
  landing: Landing | null,
): void {
  const report = {
    status: landing?.status ?? null,
    tip: landing?.tip ?? null,
    conflicts:
      landing?.status === 'conflicts'
        ? JSON.stringify(landing.conflicts)
        : null,
    cleanBars: landing?.status === 'conflicts' ? landing.cleanBars : null,
    updatedAt: new Date(),
  };

  db.insert(branchLandings)
    .values({ scoreId, branch, ...report })
    .onConflictDoUpdate({
      target: [branchLandings.scoreId, branchLandings.branch],
      set: report,
    })
    .run();
}
