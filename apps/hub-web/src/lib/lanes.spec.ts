import { describe, expect, it } from 'vitest';
import type { Version } from './api';
import { layOut } from './lanes';

/**
 * The drawing, checked as data.
 *
 * Every case here is a history shape a band actually produces, and the
 * assertions are the gutter states the design names: `bottom` and `top` for
 * the main line's two ends, `tip` where a branch's newest version sits,
 * `base` where it grew from, `knot` where it landed.
 */

let next = 0;

/** A version, in the shape the hub returns one. Ids are readable on purpose. */
function v(id: string, ...parents: string[]): Version {
  next += 1;
  return {
    id,
    message: id,
    authorEmail: 'ben.lesieux@gmail.com',
    at: new Date(Date.UTC(2026, 8, 19, 20, next)).toISOString(),
    parents,
    scope: null,
  };
}

/** The gutter of every row, as `main/l2/l3/node`, for compact assertions. */
function drawing(versions: Version[], head: string | null): string[] {
  return layOut(versions, head).map(
    ({ gutter }) => `${gutter.main}/${gutter.l2}/${gutter.l3}/${gutter.node}`
  );
}

describe('one straight line, which is most scores', () => {
  it('draws the main line with its two ends and nothing else', () => {
    const versions = [v('c', 'b'), v('b', 'a'), v('a')];

    expect(drawing(versions, 'c')).toEqual([
      'bottom/none/none/head',
      'full/none/none/main',
      'top/none/none/main',
    ]);
  });

  it('puts every version on lane 0', () => {
    const versions = [v('c', 'b'), v('b', 'a'), v('a')];

    expect(layOut(versions, 'c').map((row) => row.lane)).toEqual([0, 0, 0]);
  });

  it('is a single node with no line when there is only one version', () => {
    expect(drawing([v('a')], 'a')).toEqual(['none/none/none/head']);
  });
});

describe('a branch in flight', () => {
  /**
   *   b2   ← branch tip, newer than main's head
   *   b1
   *   m2   ← head, and where the branch grew from
   *   m1
   */
  const versions = [v('b2', 'b1'), v('b1', 'm2'), v('m2', 'm1'), v('m1')];

  it('opens a second lane at the branch tip and closes it where it grew from', () => {
    // The two branch rows leave lane 0 blank: the main line has not started
    // yet at that height, and drawing it there would be a line coming from
    // nowhere into the head.
    expect(drawing(versions, 'm2')).toEqual([
      'none/tip/none/l2',
      'none/full/none/l2',
      'bottom/base/none/head',
      'top/none/none/main',
    ]);
  });

  it('keeps the main line on lane 0 even though the branch is newer', () => {
    // Without seeding lane 0 with the head, `b2` arrives first and takes it —
    // and the page is then drawn around the wrong line.
    expect(layOut(versions, 'm2').map((row) => row.lane)).toEqual([1, 1, 0, 0]);
  });
});

describe('a branch that landed', () => {
  /**
   *   m3        ← head
   *   merge     ← two parents: m2 and b1
   *   b1
   *   m2        ← where the branch grew from
   *   m1
   */
  const versions = [
    v('m3', 'merge'),
    v('merge', 'm2', 'b1'),
    v('b1', 'm2'),
    v('m2', 'm1'),
    v('m1'),
  ];

  it('draws a knot where it landed and a base where it grew from', () => {
    expect(drawing(versions, 'm3')).toEqual([
      'bottom/none/none/head',
      'full/knot/none/knot',
      'full/tip/none/l2',
      'full/base/none/main',
      'top/none/none/main',
    ]);
  });
});

describe('two branches in flight', () => {
  /**
   *   d1   ← drums branch
   *   s1   ← bass branch
   *   m2   ← head, both grew from it
   *   m1
   */
  const versions = [v('d1', 'm2'), v('s1', 'm2'), v('m2', 'm1'), v('m1')];

  it('uses a lane each and closes both at the version they share', () => {
    expect(drawing(versions, 'm2')).toEqual([
      'none/tip/none/l2',
      'none/full/tip/l3',
      'bottom/base/base/head',
      'top/none/none/main',
    ]);
  });
});

describe('a page that stops before the history does', () => {
  it('leaves the main line running off the bottom rather than ending it', () => {
    // The last row of a page is not the first version ever pushed: its parent
    // is simply not loaded yet, and drawing `top` there would claim the
    // history ends here.
    const versions = [v('c', 'b'), v('b', 'a')];

    expect(drawing(versions, 'c')).toEqual(['bottom/none/none/head', 'full/none/none/main']);
  });
});

describe('an empty history', () => {
  it('draws nothing', () => {
    expect(layOut([], null)).toEqual([]);
  });
});
