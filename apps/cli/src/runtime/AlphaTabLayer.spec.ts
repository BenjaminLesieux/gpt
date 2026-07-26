import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AlphaTabLayer } from "./AlphaTabLayer";

const fixturePath = join(import.meta.dirname, "../__fixtures__/sample.gp");

describe("AlphaTabLayer", () => {
  it("should parse a .gp file and return a Score with tracks when given valid bytes", async () => {
    // Given
    const bytes = new Uint8Array(readFileSync(fixturePath));

    // When
    const score = await Effect.runPromise(
      Effect.gen(function* () {
        const at = yield* AlphaTabLayer;
        return yield* at.parse(bytes);
      }).pipe(Effect.provide(AlphaTabLayer.Live))
    );

    // Then
    expect(score.tracks.length).toBeGreaterThan(0);
  });

});
