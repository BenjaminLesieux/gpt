import { hash, verify } from '@node-rs/argon2';

/**
 * OWASP's argon2id baseline — 19 MiB, two passes, one lane. They are also
 * this package's defaults, but a password parameter that moves when a
 * dependency bumps is not a parameter, it is a surprise.
 *
 * `algorithm` is absent on purpose: it is a `const enum` in an ambient
 * declaration, which `isolatedModules` forbids importing. Argon2id is the
 * package default and `hashes-are-argon2id` in the spec is what holds it.
 */
const PARAMETERS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, PARAMETERS);
}

/**
 * The parameters come out of the stored PHC string, not from here, so a hash
 * written under older settings still verifies after the settings move.
 */
export async function verifyPassword(
  storedHash: string,
  password: string
): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    // A hash argon2 cannot parse is a corrupt row, not a match.
    return false;
  }
}

let decoyHash: Promise<string> | undefined;

/**
 * Login for an address with no account still has to cost an argon2 verify.
 * Skipping it makes response time an account-enumeration oracle, which is
 * the one thing an unauthenticated caller could otherwise learn.
 */
export async function spendVerificationBudget(password: string): Promise<void> {
  decoyHash ??= hashPassword('decoy — never a real password');
  await verifyPassword(await decoyHash, password);
}
