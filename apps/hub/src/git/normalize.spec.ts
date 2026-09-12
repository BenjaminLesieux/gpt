import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { normalizeGp } from './normalize';

const SCORE = Buffer.from('<GPIF><Score><Title>Riff</Title></Score></GPIF>');
const VERSION = Buffer.from('7.0');

const FIXTURES = path.join(import.meta.dirname, '../../../../packages/gpt-core/src/__fixtures__');

/**
 * A zip whose entries carry the given order, timestamp and compression — i.e.
 * all the things two Guitar Pro saves of the same score differ by. Mirrors
 * `zip_with` in the Rust suite.
 */
function zipWith(
  entries: [name: string, data: Buffer][],
  when: { date: number; time: number },
  method: 0 | 8
): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const rawName = Buffer.from(name);
    const payload = method === 8 ? deflateRawSync(data) : data;

    const local = Buffer.alloc(30 + rawName.length);
    local.writeUInt32LE(0x0403_4b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(when.time, 10);
    local.writeUInt16LE(when.date, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(rawName.length, 26);
    rawName.copy(local, 30);

    const central = Buffer.alloc(46 + rawName.length);
    central.writeUInt32LE(0x0201_4b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(when.time, 12);
    central.writeUInt16LE(when.date, 14);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(rawName.length, 28);
    central.writeUInt32LE(0x81a4_0000, 38);
    central.writeUInt32LE(offset, 42);
    rawName.copy(central, 46);

    locals.push(local, payload);
    centrals.push(central);
    offset += local.length + payload.length;
  }

  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x0605_4b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, eocd]);
}

function dosStamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): { date: number; time: number } {
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hour << 11) | (minute << 5) | (second >> 1),
  };
}

/** Name and payload of every entry, so a payload can be compared across a rebuild. */
function entriesOf(bytes: Uint8Array): [name: string, data: string][] {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = view.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = view.readUInt16LE(eocd + 10);

  const entries: [string, string][] = [];
  let cursor = view.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    const nameLength = view.readUInt16LE(cursor + 28);
    const name = view.subarray(cursor + 46, cursor + 46 + nameLength).toString();
    const method = view.readUInt16LE(cursor + 10);
    const compressed = view.readUInt32LE(cursor + 20);
    const local = view.readUInt32LE(cursor + 42);
    const start = local + 30 + view.readUInt16LE(local + 26) + view.readUInt16LE(local + 28);
    const stored = view.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(stored) : stored;
    entries.push([name, data.toString('base64')]);
    cursor += 46 + nameLength + view.readUInt16LE(cursor + 30) + view.readUInt16LE(cursor + 32);
  }
  return entries;
}

describe('normalizeGp', () => {
  it('should produce identical bytes for two saves of the same content when they differ in entry order, timestamp and compression', () => {
    // Given the same music saved twice
    const monday = zipWith(
      [
        ['Content/score.gpif', SCORE],
        ['VERSION', VERSION],
      ],
      dosStamp(2026, 3, 2, 9, 30, 0),
      8
    );
    // Saved later, entries written in the other order and stored rather than deflated
    const friday = zipWith(
      [
        ['VERSION', VERSION],
        ['Content/score.gpif', SCORE],
      ],
      dosStamp(2026, 3, 6, 18, 4, 12),
      0
    );
    expect(Buffer.from(monday).equals(friday)).toBe(false);

    // When both are normalized
    // Then nothing a musician would care about differed, so neither do the bytes
    expect(Buffer.from(normalizeGp(monday)).equals(normalizeGp(friday))).toBe(true);
  });

  it('should produce different bytes when the content really changed', () => {
    // Given two scores with different titles
    const stamp = dosStamp(1980, 1, 1, 0, 0, 0);
    const before = zipWith([['Content/score.gpif', SCORE]], stamp, 8);
    const after = zipWith(
      [['Content/score.gpif', Buffer.from('<GPIF><Score><Title>Riff II</Title></Score></GPIF>')]],
      stamp,
      8
    );

    // When normalized
    // Then the change survives
    expect(Buffer.from(normalizeGp(before)).equals(normalizeGp(after))).toBe(false);
  });

  it('should be idempotent and preserve every payload when normalizing an archive', () => {
    // Given a deflated archive
    const original = zipWith(
      [
        ['Content/score.gpif', SCORE],
        ['VERSION', VERSION],
      ],
      dosStamp(2026, 3, 2, 9, 30, 0),
      8
    );

    // When normalized once, then again
    const once = normalizeGp(original);

    // Then the second pass changes nothing and the payloads are intact
    expect(Buffer.from(normalizeGp(once)).equals(once)).toBe(true);
    expect(entriesOf(once)).toEqual([
      ['Content/score.gpif', SCORE.toString('base64')],
      ['VERSION', VERSION.toString('base64')],
    ]);
  });

  it('should zero the DOS timestamp fields when the input carries a save time', () => {
    // Given an archive stamped with a real date
    const stamped = zipWith([['Content/score.gpif', SCORE]], dosStamp(2026, 3, 2, 9, 30, 0), 8);

    // When normalized
    const normalized = Buffer.from(normalizeGp(stamped));

    // Then both headers read as the zero DOS timestamp
    expect(normalized.readUInt16LE(10)).toBe(0);
    expect(normalized.readUInt16LE(12)).toBe(0);
    const central = normalized.readUInt32LE(normalized.length - 22 + 16);
    expect(normalized.readUInt16LE(central + 12)).toBe(0);
    expect(normalized.readUInt16LE(central + 14)).toBe(0);
  });

  it('should pass non-zip input through untouched', () => {
    // Given a legacy binary .gp5, which starts with a pascal-string version block
    const legacy = Buffer.from('\x18FICHIER GUITAR PRO v5.10\x00\x00', 'latin1');

    // When / Then
    expect(Buffer.from(normalizeGp(legacy)).equals(legacy)).toBe(true);
  });

  it('should pass empty input through untouched', () => {
    // Given / When / Then
    expect(normalizeGp(new Uint8Array())).toHaveLength(0);
  });

  it('should pass an unreadable zip through untouched when its directory will not parse', () => {
    // Given a file caught mid-write: the local header is there, the rest is not
    const truncated = zipWith([['Content/score.gpif', SCORE]], dosStamp(2026, 3, 2, 9, 30, 0), 8).slice(0, 40);

    // When / Then — storing raw beats losing the save
    expect(Buffer.from(normalizeGp(truncated)).equals(truncated)).toBe(true);
  });

  it('should match the Rust normalizer byte for byte when given the shared sample fixture', () => {
    // Given the sample .gp and the golden bytes `normalize_gp` produced from it
    const sample = readFileSync(path.join(FIXTURES, 'sample.gp'));
    const golden = readFileSync(path.join(FIXTURES, 'sample.normalized.gp'));

    // When normalized here
    // Then the two implementations agree exactly — this is the gate that keeps
    // an import on the hub and a save in companion from disagreeing.
    expect(Buffer.from(normalizeGp(sample)).equals(golden)).toBe(true);
  });

  it('should match the Rust normalizer on an archive whose entries need reordering', () => {
    // Given a golden built from entries written out of order, in both
    // compression methods, including a directory and two names whose order
    // depends on how they are compared: U+FF21 encodes to EF BC A1 and
    // U+10000 to F0 90 80 80, so raw UTF-8 bytes sort the first one lower
    // while UTF-16 code units sort it higher.
    const unsorted = readFileSync(path.join(FIXTURES, 'unsorted.zip'));
    const golden = readFileSync(path.join(FIXTURES, 'unsorted.normalized.zip'));

    // When / Then — sample.gp arrives already sorted and all-ASCII, so
    // without this a port that never sorted, or that sorted decoded strings
    // rather than name bytes, would pass the gate.
    expect(Buffer.from(normalizeGp(unsorted)).equals(golden)).toBe(true);
  });

  it('should round-trip every entry of the sample fixture byte for byte', () => {
    // Given the sample .gp
    const sample = readFileSync(path.join(FIXTURES, 'sample.gp'));

    // When normalized
    const normalized = normalizeGp(sample);

    // Then every payload survives, in name order
    expect(entriesOf(normalized)).toEqual(entriesOf(sample).sort(([left], [right]) => (left < right ? -1 : 1)));
  });
});
