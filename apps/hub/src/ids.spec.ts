import { describe, expect, it } from 'vitest';
import { newId } from './ids';

describe('newId', () => {
  it('should produce a lowercase base32 string when called', () => {
    // Given / When
    const id = newId();

    // Then — Forgejo usernames are AlphaDashDot with a reserved-word list;
    // this charset stays inside it whatever prefix gets bolted on.
    expect(id).toMatch(/^[a-z2-7]+$/);
  });

  it('should stay well under the Forgejo username cap when prefixed', () => {
    // Given / When
    const username = `gp${newId()}`;

    // Then — MaxSize(40) on the Forgejo side.
    expect(username.length).toBeLessThanOrEqual(40);
  });

  it('should not collide across a run of ids', () => {
    // Given / When
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));

    // Then
    expect(ids.size).toBe(1000);
  });
});
