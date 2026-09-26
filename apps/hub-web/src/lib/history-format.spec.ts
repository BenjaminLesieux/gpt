import { describe, expect, it } from 'vitest';
import type { Version, VersionScope } from './api';
import { ago, entries, initials, scopeText, shortScopeText, since, time } from './history-format';

/**
 * The strings the screen actually shows. Every case here is one the design
 * writes out by name — an unnamed version, a tempo change that moved no bars,
 * a burst of eleven in one evening — and the copy rules are not decoration:
 * *version*, *branch*, *land*, never *commit*.
 */

const NOW = new Date('2026-09-19T23:50:00');

function v(at: string, id = at): Version {
  return {
    id,
    message: 'try the 7th in the bridge',
    authorEmail: 'ben.lesieux@gmail.com',
    at,
    parents: [],
    scope: null,
  };
}

function scope(over: Partial<VersionScope>): VersionScope {
  return { tracks: [], bars: 0, trackCount: 5, meta: false, ...over };
}

describe('grouping by day', () => {
  it('is relative while someone would still say it that way', () => {
    const versions = [
      v('2026-09-19T23:42:00'),
      v('2026-09-18T21:31:00'),
      v('2026-09-15T22:04:00'),
      v('2026-09-04T19:55:00'),
    ];

    expect(
      entries(versions, versions[0].id, NOW)
        .filter((entry) => entry.kind === 'day')
        .map((entry) => entry.label)
    ).toEqual(['Today', 'Yesterday', 'Tuesday', '4 September']);
  });

  it('puts one header above each day and none between rows of the same day', () => {
    const versions = [v('2026-09-19T23:42:00'), v('2026-09-19T21:20:00')];

    expect(entries(versions, versions[0].id, NOW).map((entry) => entry.kind)).toEqual([
      'day',
      'version',
      'version',
    ]);
  });
});

describe('a burst', () => {
  it('gets a session line naming the count and the hours it spanned', () => {
    const versions = [
      v('2026-09-19T23:00:00', 'a'),
      v('2026-09-19T22:30:00', 'b'),
      v('2026-09-19T22:00:00', 'c'),
      v('2026-09-19T21:30:00', 'd'),
      v('2026-09-19T21:00:00', 'e'),
    ];

    const session = entries(versions, 'a', NOW).find((entry) => entry.kind === 'session');

    expect(session?.label).toBe('Evening session · 5 versions between 9 pm and 11 pm');
  });

  it('is not drawn for an ordinary handful', () => {
    const versions = [v('2026-09-19T23:00:00', 'a'), v('2026-09-19T22:00:00', 'b')];

    expect(entries(versions, 'a', NOW).some((entry) => entry.kind === 'session')).toBe(false);
  });
});

describe('who made a version', () => {
  it('takes initials from the email, because there are no display names yet', () => {
    expect(initials('ben.lesieux@gmail.com')).toBe('BL');
    expect(initials('sam@example.com')).toBe('SA');
    expect(initials('iris-k@example.com')).toBe('IK');
  });
});

describe('what a version touched', () => {
  it('names the tracks while there are few enough to read', () => {
    expect(scopeText(scope({ tracks: [{ name: 'Guitar 1', bars: 12 }], bars: 12 }))).toBe(
      'Guitar 1 · 12 bars'
    );
    expect(
      scopeText(
        scope({
          tracks: [
            { name: 'Guitar 1', bars: 4 },
            { name: 'Bass', bars: 2 },
          ],
          bars: 6,
        })
      )
    ).toBe('Guitar 1, Bass · 6 bars');
  });

  it('counts them once there are too many to name', () => {
    expect(
      scopeText(
        scope({
          tracks: [
            { name: 'Guitar 1', bars: 40 },
            { name: 'Guitar 2', bars: 30 },
            { name: 'Bass', bars: 16 },
            { name: 'Drums', bars: 10 },
          ],
          bars: 96,
        })
      )
    ).toBe('4 tracks · 96 bars');
  });

  it('says one bar, not 1 bars', () => {
    expect(scopeText(scope({ tracks: [{ name: 'Guitar 1', bars: 1 }], bars: 1 }))).toBe(
      'Guitar 1 · 1 bar'
    );
  });

  it('still reports a tempo change, which touches the song and no bars', () => {
    expect(scopeText(scope({ tracks: [], bars: 0, trackCount: 5, meta: true }))).toBe(
      '5 tracks · 0 bars'
    );
  });

  it('says nothing at all when the hub could not read the file', () => {
    expect(scopeText(null)).toBe('');
    expect(shortScopeText(null)).toBe('');
  });
});

describe('how long ago', () => {
  it('is the narrow layout, where absolute times are the first thing to go', () => {
    expect(ago('2026-09-19T23:30:00', NOW)).toBe('20m');
    expect(ago('2026-09-19T21:50:00', NOW)).toBe('2h');
    expect(ago('2026-09-17T23:50:00', NOW)).toBe('2d');
  });
});

describe('language', () => {
  /**
   * These strings sit inside sentences, so they follow the interface's
   * language (English here) rather than the machine's locale. Left to the
   * browser, a French machine put `Vendredi` between `Today` and `Yesterday`.
   */
  it('is English whatever the machine is set to', () => {
    const versions = [v('2026-09-11T23:42:00')];
    const day = entries(versions, versions[0].id, NOW).find((entry) => entry.kind === 'day');

    expect(day?.label).toBe('11 September');
    expect(time('2026-09-11T23:42:00')).toBe('11:42 pm');
  });

  it('says just now rather than 0m in prose', () => {
    expect(since('2026-09-19T23:49:50', NOW.getTime())).toBe('just now');
    expect(ago('2026-09-19T23:49:50', NOW)).toBe('0m');
  });
});
