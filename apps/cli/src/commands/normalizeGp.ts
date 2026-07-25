import { Effect } from "effect";
import { normalizeGp } from "@gpt/gpt-core";

interface NormalizeGpCliOptions {
  /** XML element names to blank (e.g. an embedded editing date). */
  volatileElements?: string[];
}

// Reads the entire binary stdin stream — git pipes the file content here when
// invoking a `clean`/`smudge` filter.
function readStdin(): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    process.stdin.on("error", reject);
  });
}

// ── normalize-gp ──────────────────────────────────────────────────────────────
//
// A git clean-filter entry point: reads a .gp file from stdin, canonicalises the
// zip container (stripping the per-save editing-date noise), and writes the
// normalized bytes to stdout. Non-zip input is passed through unchanged, so it's
// safe to point `*.gp` at this filter regardless of format.

export const normalizeGpCommand = (options: NormalizeGpCliOptions = {}) =>
  Effect.gen(function* () {
    const input = yield* Effect.tryPromise({
      try: () => readStdin(),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    });

    const output = normalizeGp(input, { volatileElements: options.volatileElements });

    yield* Effect.async<void, Error>((resume) => {
      process.stdout.write(Buffer.from(output), (err) =>
        resume(err ? Effect.fail(err) : Effect.void),
      );
    });
  });
