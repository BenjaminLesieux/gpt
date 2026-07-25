import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unzipSync, zipSync, type Zippable, type Unzipped } from "fflate";
import { normalizeGp } from "./normalizeGp";

const here = dirname(fileURLToPath(import.meta.url));
const sample = new Uint8Array(readFileSync(join(here, "__fixtures__/sample.gp")));

// Re-zip the given entries while stamping a modification time on each — this is
// what Guitar Pro does on every save, and the source of the "phantom" diffs.
function rezipWithMtime(entries: Unzipped, mtime: Date): Uint8Array {
  const z: Zippable = {};
  for (const name of Object.keys(entries)) z[name] = [entries[name], { mtime }];
  return zipSync(z);
}

function rezipReversed(entries: Unzipped): Uint8Array {
  const z: Zippable = {};
  for (const name of Object.keys(entries).reverse()) z[name] = entries[name];
  return zipSync(z);
}

describe("normalizeGp", () => {
  it("passes non-zip input through unchanged", () => {
    const notAZip = new TextEncoder().encode("// a legacy binary .gp5, not a zip");
    expect(normalizeGp(notAZip)).toEqual(notAZip);
  });

  it("is idempotent — normalizing twice yields identical bytes", () => {
    const once = normalizeGp(sample);
    const twice = normalizeGp(once);
    expect(twice).toEqual(once);
  });

  it("preserves every entry's payload exactly (lossless container rewrite)", () => {
    const before = unzipSync(sample);
    const after = unzipSync(normalizeGp(sample));

    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const name of Object.keys(before)) {
      expect(after[name], `payload of ${name}`).toEqual(before[name]);
    }
  });

  it("erases save-time noise: two saves differing only in editing date normalize identically", () => {
    const entries = unzipSync(sample);
    const saveMonday = rezipWithMtime(entries, new Date(Date.UTC(2026, 0, 5)));
    const saveTuesday = rezipWithMtime(entries, new Date(Date.UTC(2026, 5, 19)));

    // Sanity: the raw saves really do differ byte-wise.
    expect(saveMonday).not.toEqual(saveTuesday);

    // After normalization they are identical → git sees no change.
    expect(normalizeGp(saveMonday)).toEqual(normalizeGp(saveTuesday));
  });

  it("is insensitive to entry ordering", () => {
    const entries = unzipSync(sample);
    const reversed = rezipReversed(entries);
    expect(normalizeGp(reversed)).toEqual(normalizeGp(sample));
  });

  it("zeroes the DOS timestamp fields in the output headers", () => {
    const entries = unzipSync(sample);
    const stamped = rezipWithMtime(entries, new Date(Date.UTC(2026, 5, 19)));
    const out = normalizeGp(stamped);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

    // First local file header: time @ +10, date @ +12.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(10, true)).toBe(0);
    expect(view.getUint16(12, true)).toBe(0);
  });

  it("leaves musical content untouched when no volatile elements are configured", () => {
    const before = new TextDecoder().decode(unzipSync(sample)["Content/score.gpif"]);
    const after = new TextDecoder().decode(
      unzipSync(normalizeGp(sample))["Content/score.gpif"],
    );
    expect(after).toBe(before);
  });

  it("blanks configured volatile XML elements without disturbing other content", () => {
    // Inject a fake editing-date element into the score XML, re-zip, then
    // normalize asking for that element to be treated as volatile.
    const entries = unzipSync(sample);
    const xml = new TextDecoder().decode(entries["Content/score.gpif"]);
    const withDate = xml.replace(
      "<Score>",
      "<Score><EditingDate>2026-06-19T12:00:00Z</EditingDate>",
    );
    entries["Content/score.gpif"] = new Uint8Array(new TextEncoder().encode(withDate));
    const dirty = zipSync(entries as Zippable);

    const normalized = normalizeGp(dirty, { volatileElements: ["EditingDate"] });
    const resultXml = new TextDecoder().decode(
      unzipSync(normalized)["Content/score.gpif"],
    );

    expect(resultXml).toContain("<EditingDate></EditingDate>");
    expect(resultXml).not.toContain("2026-06-19T12:00:00Z");
    // A note still present afterwards proves surrounding content is intact.
    expect(resultXml).toContain("<GPVersion>7</GPVersion>");
  });

  it("makes two saves with the same content but different editing dates converge", () => {
    const entries = unzipSync(sample);
    const xml = new TextDecoder().decode(entries["Content/score.gpif"]);

    const makeSave = (date: string, mtime: Date) => {
      const e = { ...entries };
      e["Content/score.gpif"] = new Uint8Array(
        new TextEncoder().encode(
          xml.replace("<Score>", `<Score><EditingDate>${date}</EditingDate>`),
        ),
      );
      return rezipWithMtime(e, mtime);
    };

    const v1 = makeSave("2026-06-18T09:00:00Z", new Date(Date.UTC(2026, 5, 18)));
    const v2 = makeSave("2026-06-19T17:30:00Z", new Date(Date.UTC(2026, 5, 19)));

    const opts = { volatileElements: ["EditingDate"] };
    expect(normalizeGp(v1, opts)).toEqual(normalizeGp(v2, opts));
  });
});
