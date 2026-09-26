import { describe, expect, it } from 'vitest';
import {
  entries,
  initials,
  scopeText,
  shortScopeText,
  type HistoryVersion,
  type Session,
  type VersionScope,
} from './history-format';

/**
 * The strings the screen actually shows. Every case here is one the design
 * writes out by name — an unnamed version, a tempo change that moved no bars,
 * a burst of eleven in one evening — and the copy rules are not decoration:
 * *version*, *branch*, *land*, never *commit*.
 */

const NOW = new Date('2026-09-19T23:50:00');

function v(at: string, id = at): HistoryVersion {
  return {
    id,
    message: 'try the 7th in the bridge',
    authorEmail: 'ben.lesieux@gmail.com',
    at,
    parents: [],
    scope: null,
  };
}

const session = ({ part, count, from, to }: Session) =>
  `${part[0].toUpperCase()}${part.slice(1)} session · ${count} versions between ${from} and ${to}`;

const words = {
  bars: (count: number) => `${count} ${count === 1 ? 'bar' : 'bars'}`,
  tracks: (count: number) => `${count} ${count === 1 ? 'track' : 'tracks'}`,
};

function scope(over: Partial<VersionScope>): VersionScope {
  return { tracks: [], bars: 0, trackCount: 5, meta: false, ...over };
}

describe('grouping by day', () => {
  it('puts one header above each day and none between rows of the same day', () => {
    const versions = [v('2026-09-19T23:42:00'), v('2026-09-19T21:20:00')];

    const kinds = entries(versions, versions[0].id, 'en', session, NOW).map((entry) => entry.kind);

    expect(kinds).toEqual(['day', 'version', 'version']);
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

    const line = entries(versions, 'a', 'en', session, NOW).find(
      (entry) => entry.kind === 'session'
    );

    expect(line?.label).toBe('Evening session · 5 versions between 9 pm and 11 pm');
  });

  it('is not drawn for an ordinary handful', () => {
    const versions = [v('2026-09-19T23:00:00', 'a'), v('2026-09-19T22:00:00', 'b')];

    const kinds = entries(versions, 'a', 'en', session, NOW).map((entry) => entry.kind);

    expect(kinds).not.toContain('session');
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
    expect(scopeText(scope({ tracks: [{ name: 'Guitar 1', bars: 12 }], bars: 12 }), words)).toBe(
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
        }),
        words
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
        }),
        words
      )
    ).toBe('4 tracks · 96 bars');
  });

  it('says one bar, not 1 bars', () => {
    expect(scopeText(scope({ tracks: [{ name: 'Guitar 1', bars: 1 }], bars: 1 }), words)).toBe(
      'Guitar 1 · 1 bar'
    );
  });

  it('still reports a tempo change, which touches the song and no bars', () => {
    expect(scopeText(scope({ tracks: [], bars: 0, trackCount: 5, meta: true }), words)).toBe(
      '5 tracks · 0 bars'
    );
  });

  it('says nothing at all when the hub could not read the file', () => {
    expect(scopeText(null, words)).toBe('');
    expect(shortScopeText(null, words)).toBe('');
  });
});
