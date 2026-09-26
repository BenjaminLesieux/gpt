import { importer } from '@coderline/alphatab';
import { changeCounts, diffScores } from '@gpt/gpt-core';
import type { Score } from '@gpt/gpt-core';
import { and, eq, inArray } from 'drizzle-orm';
import type { HubDatabase } from '../db/client';
import { versionScopes } from '../db/schema';
import { readVersionScore } from '../git/history';

/**
 * What a version touched, derived rather than declared.
 *
 * The musician types a message and nothing else. *Bass, 12 bars* is read off
 * the file by diffing against the parent, which is the only reason the screen
 * can show it next to every row without it ever going stale or lying — nobody
 * can forget to update it, because nobody writes it.
 *
 * It costs a parse per version, so it is cached by commit sha. A sha names
 * exactly one tree forever, which makes the cache permanently valid and the
 * invalidation question not one we have.
 */

export interface VersionScope {
  /** Only tracks whose bars actually changed, in the score's own order. */
  tracks: { name: string; bars: number }[];
  /** Sum across `tracks`. The design's *· 12 bars*. */
  bars: number;
  /** How many tracks the score has, for the *5 tracks · 0 bars* form. */
  trackCount: number;
  /**
   * Something outside the bars changed — tempo, title, a time signature.
   * Without this a tempo change reads as an empty version rather than as one
   * that touched the whole song.
   */
  meta: boolean;
}

/**
 * Scopes for a page of versions, cached ones served and the rest derived.
 *
 * Takes the page rather than one commit because the parent of row *n* is
 * usually row *n+1*: walking the page lets one parse answer for two diffs,
 * which halves the work on the first load of a history and is the difference
 * between a second and two.
 *
 * A version whose file will not parse is absent from the map rather than
 * present as zero. The row still lists; it just has nothing to say about what
 * it touched, which is honest and is what an older Guitar Pro format or a
 * score the importer has not learned yet actually means.
 */
export async function scopesFor(
  db: HubDatabase,
  gitRoot: string,
  ownerId: string,
  scoreId: string,
  versions: { id: string; parents: string[] }[]
): Promise<Map<string, VersionScope>> {
  const scopes = readCached(db, scoreId, versions);

  const missing = versions.filter((version) => !scopes.has(version.id));
  if (missing.length === 0) return scopes;

  const load = parser(gitRoot, ownerId, scoreId);

  for (const version of missing) {
    const head = await load(version.id);
    if (!head) continue;

    // No parent is the first version: everything in it arrived at once, so
    // there is nothing to diff against and every track is touched.
    const base = version.parents[0] ? await load(version.parents[0]) : null;
    const scope = base ? against(base, head) : whole(head);

    scopes.set(version.id, scope);
    cache(db, scoreId, version.id, scope);
  }

  return scopes;
}

/**
 * What each branch touches, relative to where it left the main line.
 *
 * Not a fold over the per-version scopes, and not cacheable the way they are.
 * A version's scope is keyed by its own sha and true forever; a branch's is a
 * diff over a *range*, and both of its ends move — the base every time main
 * advances, the tip every time somebody pushes. There is nothing stable to key
 * on, so this parses on every read and is why it takes a list rather than one
 * branch: six branches off the same base cost one parse of the base, not six.
 *
 * Folding the per-version rows would be cheaper and wrong. Three versions that
 * each edit bar 12 are one touched bar, not three, and a version that puts
 * back what the one before it changed is nothing at all.
 *
 * Serialised on purpose — see ADR 0008. Parsing holds whole score models in
 * memory, so a score with eight branches walks them one at a time rather than
 * holding nine models at once.
 */
export async function branchScopes(
  gitRoot: string,
  ownerId: string,
  scoreId: string,
  branches: { name: string; base: string | null; tip: string }[]
): Promise<Map<string, VersionScope>> {
  const scopes = new Map<string, VersionScope>();
  if (branches.length === 0) return scopes;

  const load = parser(gitRoot, ownerId, scoreId);

  for (const branch of branches) {
    const tip = await load(branch.tip);
    // No scope rather than an empty one, exactly as a version gets: a tip the
    // importer cannot read has nothing to say about what it touched, and a
    // zero would be the claim that it touched nothing.
    if (!tip) continue;

    // A branch sharing no history with main is the whole of its own tip, the
    // same reading the first version gets.
    const base = branch.base ? await load(branch.base) : null;
    scopes.set(branch.name, base ? against(base, tip) : whole(tip));
  }

  return scopes;
}

/**
 * A parse, memoised by commit, for the length of one read.
 *
 * Both callers diff commits against other commits, and in both the same
 * commit turns up on two sides — a version's parent is usually the next row
 * down, and every branch off main shares one merge-base. Parsing is the
 * expensive half by a wide margin, so it happens once per commit.
 */
function parser(
  gitRoot: string,
  ownerId: string,
  scoreId: string
): (commit: string) => Promise<Score | null> {
  const parsed = new Map<string, Score | null>();

  return async (commit: string) => {
    if (!parsed.has(commit)) {
      const bytes = await readVersionScore(gitRoot, ownerId, scoreId, commit);
      parsed.set(commit, bytes ? parse(bytes) : null);
    }
    return parsed.get(commit) ?? null;
  };
}

function parse(bytes: Buffer): Score | null {
  try {
    return importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(bytes));
  } catch {
    // An unreadable blob is a row without a scope, never a failed history.
    return null;
  }
}

function against(base: Score, head: Score): VersionScope {
  const diff = diffScores(base, head);

  const tracks = diff.tracks
    .map((pairing) => ({
      name: pairing.trackName,
      bars: changeCounts(diff, pairing.trackIndex).total,
    }))
    .filter((track) => track.bars > 0);

  return {
    tracks,
    bars: tracks.reduce((sum, track) => sum + track.bars, 0),
    trackCount: head.tracks.length,
    // `summary` is prose and `measures` only covers bars, so the meta diff is
    // the one that answers "did anything else move".
    meta: Object.keys(diff.meta).length > 0,
  };
}

/** The first version: every track, every bar, nothing to compare against. */
function whole(head: Score): VersionScope {
  const tracks = head.tracks.map((track) => ({
    name: track.name,
    bars: track.staves[0]?.bars.length ?? 0,
  }));

  return {
    tracks: tracks.filter((track) => track.bars > 0),
    bars: tracks.reduce((sum, track) => sum + track.bars, 0),
    trackCount: head.tracks.length,
    meta: true,
  };
}

function readCached(
  db: HubDatabase,
  scoreId: string,
  versions: { id: string }[]
): Map<string, VersionScope> {
  if (versions.length === 0) return new Map();

  const rows = db
    .select()
    .from(versionScopes)
    .where(
      and(
        eq(versionScopes.scoreId, scoreId),
        inArray(
          versionScopes.commit,
          versions.map((version) => version.id)
        )
      )
    )
    .all();

  return new Map(
    rows.map((row) => [
      row.commit,
      {
        tracks: JSON.parse(row.tracks) as VersionScope['tracks'],
        bars: row.bars,
        trackCount: row.trackCount,
        meta: row.meta,
      },
    ])
  );
}

function cache(db: HubDatabase, scoreId: string, commit: string, scope: VersionScope): void {
  db.insert(versionScopes)
    .values({
      scoreId,
      commit,
      tracks: JSON.stringify(scope.tracks),
      bars: scope.bars,
      trackCount: scope.trackCount,
      meta: scope.meta,
      computedAt: new Date(),
    })
    // Two readers of the same history race here and both derive the same
    // answer, because a sha names one tree. The second write is redundant
    // rather than wrong, so it is dropped instead of raising.
    .onConflictDoNothing()
    .run();
}
