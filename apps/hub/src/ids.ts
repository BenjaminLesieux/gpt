import { randomBytes } from 'node:crypto';

/** RFC 4648 base32, lowercased. No padding, no case, no `0`/`1`/`8`/`9`. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

const ID_BYTES = 16;

/**
 * Row ids are also the raw material for Forgejo usernames and repo names, and
 * both of those have a restricted charset, a length cap and a reserved-word
 * list. Base32 with a fixed prefix clears all three by construction, which is
 * what makes deriving a remote name from a local row safe to retry.
 */
export function newId(): string {
  return encodeBase32(randomBytes(ID_BYTES));
}

function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
  }

  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }

  return out;
}
