import { describe, expect, it } from 'vitest';
import { newId } from './ids';

describe('newId', () => {
  it('should produce a lowercase base32 string when called', () => {
    // Given / When
    const id = newId();

    // Then — this is the charset the git route will accept into a
    // filesystem path, and nothing outside it can reach one.
    expect(id).toMatch(/^[a-z2-7]+$/);
  });

  it('should be short enough to read back over the phone', () => {
    // Given / When
    const id = newId();

    // Then — two of these plus a host make up the clone url a musician
    // pastes, so length is a usability constraint rather than a limit.
    expect(id.length).toBeLessThanOrEqual(32);
  });

  it('should not collide across a run of ids', () => {
    // Given / When
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));

    // Then
    expect(ids.size).toBe(1000);
  });
});
