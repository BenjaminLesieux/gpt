import { describe, expect, it } from 'vitest';
import type { BranchDetail } from './api';
import { conflictBars, conflictPlace, sharedTracks } from './branches';

function branch(name: string, tracks: string[] | null, extra: Partial<BranchDetail> = {}) {
  return {
    name,
    tip: 'a'.repeat(40),
    ahead: 2,
    at: '2026-10-08T20:00:00Z',
    pushedBy: null,
    askFirst: false,
    landing: null,
    scope: tracks && {
      tracks: tracks.map((track) => ({ name: track, bars: 4 })),
      bars: 4,
      trackCount: 5,
      meta: false,
    },
    ...extra,
  } satisfies BranchDetail;
}

describe('sharedTracks', () => {
  it('finds nothing between branches on different tracks', () => {
    expect(sharedTracks([branch('Bass line', ['Bass']), branch('Drum parts', ['Drums'])])).toEqual(
      []
    );
  });

  it('names the track and every branch on it', () => {
    expect(
      sharedTracks([
        branch('New chorus', ['Guitar 1', 'Bass']),
        branch('Solo', ['Guitar 1']),
        branch('Drum parts', ['Drums']),
      ])
    ).toEqual([{ track: 'Guitar 1', branches: ['New chorus', 'Solo'] }]);
  });

  it('counts two tempo changes as an overlap on every track', () => {
    const tempo = (name: string) => {
      const b = branch(name, []);
      return { ...b, scope: { ...b.scope!, meta: true } };
    };
    expect(sharedTracks([tempo('Faster'), tempo('Slower')])).toEqual([
      { track: null, branches: ['Faster', 'Slower'] },
    ]);
  });

  it('leaves out a branch with nothing on it and one it could not read', () => {
    expect(
      sharedTracks([
        branch('Bass line', ['Bass']),
        branch('Started', ['Bass'], { ahead: 0 }),
        branch('Unreadable', null),
      ])
    ).toEqual([]);
  });
});

describe('conflictPlace', () => {
  const words = { bar: (bar: number) => `bar ${bar}`, everyTrack: 'all tracks' };

  it('says the bar and the track', () => {
    expect(conflictPlace({ bar: 19, track: 'Guitar 1', description: 'x' }, words)).toBe(
      'bar 19, Guitar 1'
    );
  });

  it('says every track when the change is the whole bar', () => {
    expect(conflictPlace({ bar: 7, track: null, description: 'x' }, words)).toBe(
      'bar 7, all tracks'
    );
  });

  it('falls back to the description when it is not a bar', () => {
    expect(conflictPlace({ bar: null, track: null, description: 'Tempo' }, words)).toBe('Tempo');
  });
});

describe('conflictBars', () => {
  it('counts a bar once across tracks and ignores what is not a bar', () => {
    expect(
      conflictBars([
        { bar: 19, track: 'Guitar 1', description: '' },
        { bar: 19, track: 'Bass', description: '' },
        { bar: 22, track: 'Bass', description: '' },
        { bar: null, track: null, description: 'Tempo' },
      ])
    ).toBe(2);
  });
});
