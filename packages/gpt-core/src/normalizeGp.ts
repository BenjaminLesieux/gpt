import { unzipSync, zipSync, type Zippable } from "fflate";

// ── normalizeGp ────────────────────────────────────────────────────────────
//
// Canonicalises a Guitar Pro 7/8 file (`.gp`/`.gpx`, a zip container) so that
// two saves with identical musical content produce byte-identical output —
// which lets git stop reporting "phantom" changes.
//
// The dominant noise source is the per-entry modification date stamped into
// every zip header on each save (the "editing date" the user sees). We rebuild
// the archive deterministically — sorted entries, stored (uncompressed) so
// there's no deflate-implementation variance, fixed metadata — and then scrub
// the DOS timestamp fields outright so the bytes are stable across machines and
// timezones, not just on a single computer.
//
// Crucially this is byte-surgical on the *container*: every entry's payload
// (including the musical `Content/score.gpif` XML) is preserved exactly, so
// Guitar Pro still reopens the file losslessly. The only optional content edit
// is blanking explicitly-listed volatile XML elements (see options), which is
// off by default.

export interface NormalizeGpOptions {
  /**
   * Names of XML elements whose text content is volatile (e.g. a save/editing
   * timestamp GP rewrites every save). Their inner content is blanked in text
   * entries before re-zipping. Empty by default — the zip header timestamp is
   * the usual culprit and is handled unconditionally.
   */
  volatileElements?: string[];
}

// 1980-01-01: the earliest instant the DOS date format can encode. The exact
// value is irrelevant because scrubZipTimestamps() zeroes these fields anyway;
// we set it only so fflate never emits an out-of-range date mid-build.
const FIXED_MTIME = new Date(Date.UTC(1980, 0, 1));

const ZIP_LOCAL_SIG = 0x04034b50; // PK\x03\x04
const ZIP_EMPTY_SIG = 0x06054b50; // PK\x05\x06 (empty archive: EOCD only)

export function normalizeGp(bytes: Uint8Array, options: NormalizeGpOptions = {}): Uint8Array {
  if (!isZip(bytes)) return bytes; // legacy binary .gp5/.gpx6 etc. — pass through untouched

  const entries = unzipSync(bytes);
  const volatile = options.volatileElements ?? [];

  // Deterministic entry order: sort by name so archive layout never depends on
  // the order GP happened to write them.
  const out: Zippable = {};
  for (const name of Object.keys(entries).sort()) {
    const raw = entries[name];
    const data =
      volatile.length > 0 && isTextEntry(name)
        ? blankVolatileElements(raw, volatile)
        : raw;
    // level: 0 → stored (no compression), so output never depends on a deflate
    // implementation. os: 0 → MS-DOS, identical on every platform.
    out[name] = [data, { level: 0, mtime: FIXED_MTIME, os: 0 }];
  }

  const rezipped = zipSync(out, { level: 0, mtime: FIXED_MTIME, os: 0 });
  scrubZipTimestamps(rezipped);
  return rezipped;
}

// ── Zip detection ────────────────────────────────────────────────────────────

function isZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const sig =
    bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  return sig === ZIP_LOCAL_SIG || sig === ZIP_EMPTY_SIG;
}

function isTextEntry(name: string): boolean {
  return /\.(gpif|json|xml)$/i.test(name) || name.endsWith("VERSION");
}

// ── Volatile XML element blanking ─────────────────────────────────────────────

function blankVolatileElements(
  data: Uint8Array<ArrayBufferLike>,
  elements: string[],
): Uint8Array<ArrayBuffer> {
  let text = new TextDecoder().decode(data);
  for (const el of elements) {
    const tag = escapeRegExp(el);
    const re = new RegExp(`(<${tag}(?:\\s[^>]*)?>)([\\s\\S]*?)(</${tag}>)`, "g");
    text = text.replace(re, "$1$3");
  }
  // Wrap in a fresh Uint8Array so the result is Uint8Array<ArrayBuffer> — Node's
  // TextEncoder is typed as ArrayBufferLike, which doesn't unify with fflate's
  // ArrayBuffer-backed entry type under TS 5.7's generic typed arrays.
  return new Uint8Array(new TextEncoder().encode(text));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Timestamp scrubbing ───────────────────────────────────────────────────────
//
// Walks the central directory and zeroes the 2-byte DOS time + 2-byte DOS date
// in every central-directory record and its matching local file header. This is
// what makes the output deterministic regardless of the writer's local timezone
// (most zip writers, fflate included, encode these fields from *local* time).

function scrubZipTimestamps(buf: Uint8Array): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const eocd = findEocd(buf);
  if (eocd < 0) return;

  const entryCount = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true); // offset of first central-directory record

  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > buf.length || view.getUint32(p, true) !== 0x02014b50) return;

    // Central-directory record: time @ +12, date @ +14; local header offset @ +42.
    view.setUint16(p + 12, 0, true);
    view.setUint16(p + 14, 0, true);

    const localOffset = view.getUint32(p + 42, true);
    if (localOffset + 14 <= buf.length && view.getUint32(localOffset, true) === ZIP_LOCAL_SIG) {
      // Local file header: time @ +10, date @ +12.
      view.setUint16(localOffset + 10, 0, true);
      view.setUint16(localOffset + 12, 0, true);
    }

    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    p += 46 + nameLen + extraLen + commentLen;
  }
}

// Locate the End Of Central Directory record by scanning backwards for its
// signature (it lives in the last 22 bytes + optional comment).
function findEocd(buf: Uint8Array): number {
  for (let p = buf.length - 22; p >= 0; p--) {
    if (
      buf[p] === 0x50 &&
      buf[p + 1] === 0x4b &&
      buf[p + 2] === 0x05 &&
      buf[p + 3] === 0x06
    ) {
      return p;
    }
  }
  return -1;
}
