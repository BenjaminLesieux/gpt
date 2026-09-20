import type { Version } from './api';

/**
 * Turning a list of versions and their parents into the drawing beside them.
 *
 * The rule the design is built on: **order by topology, express time as
 * grouping**. The server already returns the versions topologically, so this
 * only has to answer which vertical line each row sits on and where the lines
 * start, stop and join. Nothing here knows about dates.
 *
 * It is a single pass, newest to oldest, over a handful of lanes:
 *
 * - lane 0 is the main line and is seeded with its tip, so it can never be
 *   taken by a branch that happens to be newer;
 * - a version joins the lane that was waiting for it, or opens a new one;
 * - a lane that was waiting for a version some *lower* lane took instead is a
 *   branch meeting the version it grew from — that is a `base`;
 * - a version with two parents opens a lane for the second one — that is a
 *   `knot`, and it is where a branch landed.
 */

/** A lane's vertical, in the row's 40px box. */
export type Line = 'none' | 'full' | 'tip' | 'base' | 'knot';

/** Lane 0 has its own two ends, because it is the line the page is about. */
export type MainLine = 'none' | 'full' | 'top' | 'bottom';

export type Node = 'none' | 'main' | 'sel' | 'head' | 'knot' | 'l2' | 'l3';

export interface Gutter {
  main: MainLine;
  l2: Line;
  l3: Line;
  node: Node;
}

export interface Row {
  version: Version;
  /** 0 is the main line. Unclamped — the gutter decides what it can draw. */
  lane: number;
  gutter: Gutter;
}

/**
 * Three lanes is the ceiling the design sets, and the gutter has the width
 * budget for exactly that. A fourth branch is meant to fold into a labelled
 * group row rather than squeeze a fourth vertical in.
 *
 * ponytail: lanes past the third are drawn in the third's position rather
 * than folded. Nothing can produce one yet — the companion only ever pushes
 * `main` — so the fold is worth building when branching is, not before.
 */
export const LANES = 3;

interface Lane {
  /** The version this lane is waiting for, or null when it has ended. */
  expect: string | null;
  /** False until a version has actually been drawn on it. */
  drawn: boolean;
}

export function layOut(versions: Version[], head: string | null): Row[] {
  if (versions.length === 0) return [];

  // Seeded rather than allocated on first sight: a branch whose newest
  // version is more recent than the main line's comes first in the list, and
  // without this it would take lane 0 and the whole page would be drawn
  // around the wrong line.
  const lanes: (Lane | null)[] = [{ expect: head ?? versions[0].id, drawn: false }];

  return versions.map((version) => {
    let lane = lanes.findIndex((entry) => entry?.expect === version.id);
    if (lane === -1) {
      lane = free(lanes);
      lanes[lane] = { expect: version.id, drawn: false };
    }

    const first = !lanes[lane]?.drawn;

    // Read before anything moves: a lane still waiting for this version that
    // is not the one drawing it is a branch arriving at the version it grew
    // from. After the next statement that fact is gone.
    const bases = lanes
      .map((entry, index) => (index !== lane && entry?.expect === version.id ? index : -1))
      .filter((index) => index >= 0);
    for (const index of bases) lanes[index] = null;

    const active = lanes.map((entry) => entry !== null);
    // The main line begins at its own newest version. Branch rows sitting
    // above it must leave lane 0 blank, or the line stops mid-row at the head
    // and reappears above it out of nothing.
    const mainStarted = lanes[0]?.drawn === true || lane === 0;

    const [firstParent, ...merged] = version.parents;
    lanes[lane] = firstParent ? { expect: firstParent, drawn: true } : null;

    // A second parent is a branch that landed here. It gets a lane of its
    // own, which the rows below fill in and a `base` eventually closes.
    const knots: number[] = [];
    for (const parent of merged) {
      let index = lanes.findIndex((entry) => entry?.expect === parent);
      if (index === -1) {
        index = free(lanes);
        lanes[index] = { expect: parent, drawn: false };
        knots.push(index);
      }
    }

    const line = (index: number): Line => {
      if (index === lane) return first ? 'tip' : 'full';
      if (bases.includes(index)) return 'base';
      if (knots.includes(index)) return 'knot';
      // Drawn through only when the lane exists on both sides of this row.
      return active[index] && lanes[index] ? 'full' : 'none';
    };

    return {
      version,
      lane,
      gutter: {
        main:
          lane === 0
            ? mainLine(first, Boolean(firstParent))
            : through(mainStarted, active[0], lanes[0]),
        l2: line(1),
        l3: line(2),
        node: node(version, lane, head),
      },
    };
  });
}

/**
 * The main line's two ends belong to its own versions: `bottom` on the newest,
 * which has nothing above it, and `top` on the first version ever pushed,
 * which has nothing below.
 */
function mainLine(first: boolean, hasParent: boolean): MainLine {
  if (first && !hasParent) return 'none';
  if (first) return 'bottom';
  return hasParent ? 'full' : 'top';
}

/** The main line seen from a row that is not on it: drawn or not, no ends. */
function through(started: boolean, before: boolean, after: Lane | null | undefined): MainLine {
  return started && before && after ? 'full' : 'none';
}

function node(version: Version, lane: number, head: string | null): Node {
  if (version.id === head) return 'head';
  // Two parents is a landing, wherever it sits. The knot is the only node
  // shape that says a branch ended rather than a version happened.
  if (version.parents.length > 1) return 'knot';
  if (lane === 0) return 'main';
  return lane === 1 ? 'l2' : 'l3';
}

/** The lowest lane nothing is using, appending one when they are all busy. */
function free(lanes: (Lane | null)[]): number {
  const index = lanes.findIndex((entry) => entry === null);
  return index === -1 ? lanes.length : index;
}
