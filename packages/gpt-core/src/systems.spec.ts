import { describe, it, expect } from 'vitest';
import { alignedSystems } from './systems';
import type { MeasureDiff } from './types/diff';

// A measure sequence spelled as a string, one character per measure:
//   = equal   ~ changed   + added (head only)   - removed (base only)
function measures(spec: string): MeasureDiff[] {
  const out: MeasureDiff[] = [];
  let b = 0;
  let h = 0;
  for (const c of spec) {
    switch (c) {
      case '=':
        out.push({ type: 'equal', baseIndex: b++, headIndex: h++ });
        break;
      case '~':
        out.push({
          type: 'changed',
          baseIndex: b++,
          headIndex: h++,
          masterBarChanged: false,
          changedTracks: [],
        });
        break;
      case '+':
        out.push({ type: 'added', baseIndex: null, headIndex: h++ });
        break;
      case '-':
        out.push({ type: 'removed', baseIndex: b++, headIndex: null });
        break;
    }
  }
  return out;
}

/** What each pane's rows sum to — the bar count the pane actually has. */
function totals(spec: string) {
  return {
    base: [...spec].filter((c) => c === '=' || c === '~' || c === '-').length,
    head: [...spec].filter((c) => c === '=' || c === '~' || c === '+').length,
  };
}

describe('alignedSystems', () => {
  describe('when nothing was inserted or deleted', () => {
    it('should give both panes the same rows', () => {
      // Given twelve measures, all of them paired
      const spec = '============';

      // When the row plan is built four to a row
      const systems = alignedSystems(measures(spec), 4);

      // Then the panes break in the same three places
      expect(systems.base).toEqual([4, 4, 4]);
      expect(systems.head).toEqual([4, 4, 4]);
    });
  });

  describe('when a measure is inserted', () => {
    it('should widen the head row rather than push the panes out of step', () => {
      // Given a measure inserted in the second row
      const spec = '=====+======';

      const systems = alignedSystems(measures(spec), 4);

      // Then both panes still have the same number of rows…
      expect(systems.head.length).toBe(systems.base.length);
      // …and the row carrying the insertion is a bar short on the base side,
      // which is where the reader sees the measure head gained.
      expect(systems.base).toEqual([4, 3, 4]);
      expect(systems.head).toEqual([4, 4, 4]);
    });
  });

  describe('when a measure is deleted', () => {
    it('should narrow the base row and leave the rows facing each other', () => {
      const spec = '=====-======';

      const systems = alignedSystems(measures(spec), 4);

      expect(systems.base).toEqual([4, 4, 4]);
      expect(systems.head).toEqual([4, 3, 4]);
    });
  });

  describe('when a whole row is inserted', () => {
    it('should keep the run in one row instead of leaving the base pane a blank one', () => {
      // Given six consecutive measures head has and base does not
      const spec = '====++++++====';

      const systems = alignedSystems(measures(spec), 4);

      // Then no row is empty on either side — an empty row is not a row, and
      // dropping it would offset every later row.
      expect(systems.base.every((n) => n > 0)).toBe(true);
      expect(systems.head.every((n) => n > 0)).toBe(true);
      expect(systems.base.length).toBe(systems.head.length);
    });
  });

  describe('for any edit', () => {
    it.each([
      '',
      '=',
      '====',
      '=====',
      '~~~~~~~',
      '=+=-=+=-=',
      '++++====',
      '====----====',
      '=-=-=-=-=-=-=+',
      '===========+',
      '===========-',
    ])('should account for every bar exactly once (%s)', (spec) => {
      const systems = alignedSystems(measures(spec), 4);
      const expected = totals(spec);

      // Every row is a row on both sides…
      expect(systems.base.length).toBe(systems.head.length);
      // …and the plan spends exactly the bars each pane has.
      expect(sum(systems.base)).toBe(expected.base);
      expect(sum(systems.head)).toBe(expected.head);
      expect(systems.base.every((n) => n > 0)).toBe(true);
      expect(systems.head.every((n) => n > 0)).toBe(true);
    });
  });

  describe('when one side has no bars at all', () => {
    it('should leave both panes to lay themselves out', () => {
      // Given a score compared against nothing — there is no row to align to
      const systems = alignedSystems(measures('++++'), 4);

      expect(systems).toEqual({ base: [], head: [] });
    });
  });
});

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
