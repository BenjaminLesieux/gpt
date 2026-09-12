/**
 * TypeScript port of `normalize_gp` from the companion's Rust host
 * (`apps/companion/src-tauri/src/normalize.rs`). Both must produce the same
 * bytes for the same input, or a score imported here and then saved in Guitar
 * Pro would record a version for a change no musician made.
 * `packages/gpt-core/src/__fixtures__/sample.normalized.gp` is the golden both
 * suites assert against. See `docs/normalize-gp.md` for why any of this exists.
 */

import { inflateRawSync } from 'node:zlib';

const LOCAL_HEADER_SIG = 0x0403_4b50; // PK\x03\x04
const CENTRAL_HEADER_SIG = 0x0201_4b50; // PK\x01\x02
const EOCD_SIG = 0x0605_4b50; // PK\x05\x06

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;

const STORED = 0;
const DEFLATED = 8;

const ENCRYPTED_FLAG = 1 << 0;
const UTF8_FLAG = 1 << 11;

/**
 * The fields the Rust `zip` crate derives rather than takes as options. A
 * stored file needs PKZIP 1.0; a directory entry needs 2.0 because it carries a
 * unix mode. `version made by` is that same number tagged with the Unix host,
 * and the external attributes are the unix mode in the high half — the crate
 * ORs `S_IFREG`/`S_IFDIR` onto the 0o644 the normalizer asks for.
 */
const VERSION_STORED = 10;
const VERSION_DIRECTORY = 20;
const HOST_UNIX = 3;
const MODE_FILE = 0o100_644;
const MODE_DIRECTORY = 0o040_644;

interface Entry {
  /** Raw, so sorting and writing both use the bytes the archive carried. */
  name: Uint8Array;
  /** Null marks a directory entry, which has no payload and no checksum. */
  payload: Uint8Array | null;
  crc: number;
}

/**
 * Non-zip input (legacy binary `.gp5`) and unparseable input pass through:
 * normalization is an optimisation, never a reason to lose a save. A caller
 * that needs to know whether it happened should compare the bytes it got back.
 */
export function normalizeGp(bytes: Uint8Array): Uint8Array {
  if (!isZip(bytes)) return bytes;

  try {
    return rebuild(bytes);
  } catch {
    return bytes;
  }
}

function rebuild(bytes: Uint8Array): Uint8Array {
  const entries = readEntries(bytes);
  entries.sort((left, right) => compareNames(left.name, right.name));
  return assemble(entries);
}

function isZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const signature = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  // An archive with no entries at all is nothing but its EOCD record.
  return signature === LOCAL_HEADER_SIG || signature === EOCD_SIG;
}

function readEntries(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocd = findEocd(bytes);
  if (eocd === null) throw new Error('no end-of-central-directory record');

  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cursor === 0xffff_ffff) {
    throw new Error('zip64 archive');
  }

  const entries: Entry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (cursor + CENTRAL_HEADER_SIZE > bytes.length || view.getUint32(cursor, true) !== CENTRAL_HEADER_SIG) {
      throw new Error('central directory is truncated');
    }

    const flags = view.getUint16(cursor + 8, true);
    if (flags & ENCRYPTED_FLAG) throw new Error('encrypted entry');

    const nameLength = view.getUint16(cursor + 28, true);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength);

    if (isDirectoryName(name)) {
      entries.push({ name, payload: null, crc: 0 });
    } else {
      const crc = view.getUint32(cursor + 16, true);
      // Sizes come from the central directory, not the local header: an entry
      // written with a data descriptor carries zeroes there.
      const payload = readPayload(bytes, view, {
        localOffset: view.getUint32(cursor + 42, true),
        method: view.getUint16(cursor + 10, true),
        compressedSize: view.getUint32(cursor + 20, true),
        uncompressedSize: view.getUint32(cursor + 24, true),
      });
      if (crc32(payload) !== crc) throw new Error('checksum mismatch');
      entries.push({ name, payload, crc });
    }

    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    cursor += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
  }

  return entries;
}

interface PayloadLocation {
  localOffset: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
}

function readPayload(bytes: Uint8Array, view: DataView, at: PayloadLocation): Uint8Array {
  const { localOffset, method, compressedSize, uncompressedSize } = at;

  if (localOffset + LOCAL_HEADER_SIZE > bytes.length || view.getUint32(localOffset, true) !== LOCAL_HEADER_SIG) {
    throw new Error('local header is missing');
  }

  const start =
    localOffset +
    LOCAL_HEADER_SIZE +
    view.getUint16(localOffset + 26, true) +
    view.getUint16(localOffset + 28, true);
  const end = start + compressedSize;
  if (end > bytes.length) throw new Error('entry data is truncated');

  const raw = bytes.subarray(start, end);
  if (method === STORED) {
    if (raw.length !== uncompressedSize) throw new Error('stored entry has two sizes');
    return raw;
  }
  if (method !== DEFLATED) throw new Error(`unsupported compression method ${method}`);

  const inflated = inflateRawSync(raw);
  if (inflated.length !== uncompressedSize) throw new Error('inflated entry has the wrong size');
  return inflated;
}

function assemble(entries: Entry[]): Uint8Array {
  const payloadBytes = entries.reduce((total, entry) => total + (entry.payload?.length ?? 0), 0);
  const nameBytes = entries.reduce((total, entry) => total + entry.name.length, 0);
  const out = new Uint8Array(
    entries.length * (LOCAL_HEADER_SIZE + CENTRAL_HEADER_SIZE) + nameBytes * 2 + payloadBytes + EOCD_SIZE
  );
  const view = new DataView(out.buffer);

  let at = 0;
  const localOffsets: number[] = [];

  for (const entry of entries) {
    localOffsets.push(at);
    const size = entry.payload?.length ?? 0;

    view.setUint32(at, LOCAL_HEADER_SIG, true);
    view.setUint16(at + 4, versionNeeded(entry), true);
    view.setUint16(at + 6, flagsFor(entry), true);
    view.setUint16(at + 8, STORED, true);
    // Time @ +10 and date @ +12 stay zero: zip writers encode them from local
    // time, so the same content normalized in two timezones would differ.
    view.setUint32(at + 14, entry.crc, true);
    view.setUint32(at + 18, size, true);
    view.setUint32(at + 22, size, true);
    view.setUint16(at + 26, entry.name.length, true);
    out.set(entry.name, at + LOCAL_HEADER_SIZE);
    at += LOCAL_HEADER_SIZE + entry.name.length;

    if (entry.payload) {
      out.set(entry.payload, at);
      at += size;
    }
  }

  const centralStart = at;

  entries.forEach((entry, index) => {
    const version = versionNeeded(entry);
    const size = entry.payload?.length ?? 0;
    const mode = entry.payload === null ? MODE_DIRECTORY : MODE_FILE;

    view.setUint32(at, CENTRAL_HEADER_SIG, true);
    view.setUint16(at + 4, (HOST_UNIX << 8) | version, true);
    view.setUint16(at + 6, version, true);
    view.setUint16(at + 8, flagsFor(entry), true);
    view.setUint16(at + 10, STORED, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, size, true);
    view.setUint32(at + 24, size, true);
    view.setUint16(at + 28, entry.name.length, true);
    view.setUint32(at + 38, (mode << 16) >>> 0, true);
    view.setUint32(at + 42, localOffsets[index], true);
    out.set(entry.name, at + CENTRAL_HEADER_SIZE);
    at += CENTRAL_HEADER_SIZE + entry.name.length;
  });

  view.setUint32(at, EOCD_SIG, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - centralStart, true);
  view.setUint32(at + 16, centralStart, true);

  return out;
}

function versionNeeded(entry: Entry): number {
  return entry.payload === null ? VERSION_DIRECTORY : VERSION_STORED;
}

/** The UTF-8 bit is set only where it says something: ASCII needs no flag. */
function flagsFor(entry: Entry): number {
  return entry.name.every((byte) => byte < 0x80) ? 0 : UTF8_FLAG;
}

function isDirectoryName(name: Uint8Array): boolean {
  const last = name[name.length - 1];
  return last === 0x2f || last === 0x5c;
}

function compareNames(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

/** The EOCD sits in the last 22 bytes plus an optional trailing comment. */
function findEocd(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = bytes.length - EOCD_SIZE; at >= 0; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIG) return at;
  }
  return null;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}
