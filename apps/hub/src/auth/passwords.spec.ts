import { describe, expect, it } from 'vitest';
import { hashPassword, spendVerificationBudget, verifyPassword } from './passwords';

describe('password hashing', () => {
  it('should produce an argon2id hash when it hashes a password', async () => {
    // Given / When
    const stored = await hashPassword('correct horse battery staple');

    // Then — the variant is a security decision, and the PHC string is the
    // only place it is actually recorded.
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(stored).toContain('m=19456,t=2,p=1');
  });

  it('should not store the password when it hashes it', async () => {
    // Given / When
    const stored = await hashPassword('correct horse battery staple');

    // Then
    expect(stored).not.toContain('correct horse battery staple');
  });

  it('should produce a different hash each time when given the same password', async () => {
    // Given / When
    const [first, second] = await Promise.all([
      hashPassword('correct horse battery staple'),
      hashPassword('correct horse battery staple'),
    ]);

    // Then — a shared salt would make equal hashes mean equal passwords.
    expect(first).not.toBe(second);
  });

  it('should accept the password when it matches the stored hash', async () => {
    // Given
    const stored = await hashPassword('correct horse battery staple');

    // When / Then
    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true);
  });

  it('should reject the password when it does not match', async () => {
    // Given
    const stored = await hashPassword('correct horse battery staple');

    // When / Then
    expect(await verifyPassword(stored, 'Correct horse battery staple')).toBe(false);
  });

  it('should return false rather than throw when the stored hash is corrupt', async () => {
    // Given a row that is not a PHC string at all
    // When / Then
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });

  it('should complete without throwing when spending the decoy budget', async () => {
    // Given / When / Then — the point is that login can call it on an unknown
    // address and be indistinguishable from a real verify.
    await expect(spendVerificationBudget('anything')).resolves.toBeUndefined();
  });
});
