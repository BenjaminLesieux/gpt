import { randomBytes } from 'node:crypto';

/** RFC 4648 base32, lowercased. No padding, no case, no `0`/`1`/`8`/`9`. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

const ID_BYTES = 16;

/**
 * Row ids are also path segments in a clone URL, so they are the one thing
 * here that gets pasted into chat, written into a `.git/config` and read out
 * loud. Base32 keeps an email address and a song title out of all three, and
 * keeps the id inside the charset the git route will accept into a path.
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
