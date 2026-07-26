import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect, Layer } from "effect";
import { GitLayer } from "../runtime/GitLayer";
import { AlphaTabLayer } from "../runtime/AlphaTabLayer";
import { FSLayer } from "../runtime/FSLayer";
import { showEffect } from "./show";
import type { Commit, Score, Track, Staff, Bar, Voice, Beat, Note, MasterBar } from "@gpt/gpt-core";

// ─── Mock Score factories ─────────────────────────────────────────────────────

function makeNote(string: number, fret: number): Note {
  return {
    string,
    fret,
    isDead: false,
    isHammerPullOrigin: false,
    bendType: 0,
    slideInType: 0,
    slideOutType: 0,
    vibrato: 0,
    isLetRing: false,
    isPalmMute: false,
    harmonicType: 0,
    trillValue: 0,
    accentuated: 0,
  } as unknown as Note;
}

function makeBeat(notes: Note[]): Beat {
  return {
    duration: 4,
    dots: 0,
    isRest: notes.length === 0,
    tupletNumerator: 1,
    tupletDenominator: 1,
    notes,
  } as unknown as Beat;
}

function makeVoice(beats: Beat[]): Voice {
  return { index: 0, beats } as unknown as Voice;
}

function makeBar(voices: Voice[]): Bar {
  return { voices } as unknown as Bar;
}

function makeStaff(bars: Bar[]): Staff {
  return { bars } as unknown as Staff;
}

function makeTrack(name: string, bars: Bar[]): Track {
  return { index: 0, name, staves: [makeStaff(bars)] } as unknown as Track;
}

function makeMasterBar(index: number): MasterBar {
  return { index, timeSignatureNumerator: 4, timeSignatureDenominator: 4 } as unknown as MasterBar;
}

function makeScore(tracks: Track[], masterBarCount: number, overrides: Partial<Score> = {}): Score {
  const masterBars = Array.from({ length: masterBarCount }, (_, i) => makeMasterBar(i));
  return {
    title: "Test Song",
    artist: "Artist",
    tempo: 120,
    tracks,
    masterBars,
    ...overrides,
  } as unknown as Score;
}

function simpleBar(fret: number): Bar {
  return makeBar([makeVoice([makeBeat([makeNote(1, fret)])])]);
}

// ─── Commit factory ───────────────────────────────────────────────────────────

function makeCommit(overrides: Partial<Commit> = {}): Commit {
  return {
    hash: "a".repeat(40),
    shortHash: "aaaaaaa",
    message: "Initial commit",
    author: { name: "Alice", email: "alice@example.com", timestamp: 1745280000 },
    parentHashes: [],
    ...overrides,
  };
}

// ─── Layer factories ──────────────────────────────────────────────────────────

const notImplemented = () => Effect.die("not implemented in test");

function makeGitLayer(overrides: Partial<GitLayer["Type"]>): Layer.Layer<GitLayer> {
  return Layer.succeed(GitLayer, {
    init: notImplemented,
    add: notImplemented,
    commit: notImplemented,
    log: () => Effect.succeed([]),
    resolveRef: () => Effect.fail(new Error("no HEAD")),
    readBlob: notImplemented,
    listBranches: notImplemented,
    currentBranch: () => Effect.succeed("main"),
    checkout: notImplemented,
    branch: notImplemented,
    listFiles: () => Effect.succeed([]),
    statusMatrix: () => Effect.succeed([]),
    readCommit: notImplemented,
    ...overrides,
  } as GitLayer["Type"]);
}

function makeAtLayer(overrides: Partial<AlphaTabLayer["Type"]>): Layer.Layer<AlphaTabLayer> {
  return Layer.succeed(AlphaTabLayer, {
    parse: () => Effect.succeed(makeScore([], 0)),
    ...overrides,
  } as AlphaTabLayer["Type"]);
}

const writtenFiles: Array<{ dest: string; bytes: Uint8Array }> = [];

function makeFsLayer(overrides: Partial<FSLayer["Type"]> = {}): Layer.Layer<FSLayer> {
  return Layer.succeed(FSLayer, {
    readFile: notImplemented,
    writeFile: (dest, bytes) => {
      writtenFiles.push({ dest, bytes });
      return Effect.succeed(undefined);
    },
    exists: () => Effect.succeed(false),
    mkdir: () => Effect.succeed(undefined),
    resolve: (...parts) => parts.join("/"),
    ...overrides,
  } as FSLayer["Type"]);
}

function runShow(
  gitOverrides: Partial<GitLayer["Type"]>,
  atOverrides: Partial<AlphaTabLayer["Type"]> = {},
  options: { hash?: string; export?: string; json?: boolean; dir?: string } = {},
) {
  return Effect.runPromise(
    showEffect({ hash: "a".repeat(40), dir: "/repo", ...options }).pipe(
      Effect.provide(makeGitLayer(gitOverrides)),
      Effect.provide(makeAtLayer(atOverrides)),
      Effect.provide(makeFsLayer()),
    ),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("showEffect", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    writtenFiles.length = 0;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function capturedOutput(): string {
    return stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
  }

  const FULL_HASH = "a".repeat(40);
  const PARENT_HASH = "b".repeat(40);

  // ─── Commit metadata ───────────────────────────────────────────────────────

  it("should print the commit hash, author, date, and message", async () => {
    const commit = makeCommit({ hash: FULL_HASH, message: "My song update" });

    await runShow({
      readCommit: () => Effect.succeed(commit),
      listFiles: () => Effect.succeed([]),
    });

    const output = capturedOutput();
    expect(output).toContain(FULL_HASH);
    expect(output).toContain("Alice");
    expect(output).toContain("alice@example.com");
    expect(output).toContain("My song update");
  });

  // ─── Initial commit (no parent) ───────────────────────────────────────────

  it("should mark all .gp files as 'new file' when there is no parent commit", async () => {
    const commit = makeCommit({ hash: FULL_HASH, parentHashes: [] });

    await runShow({
      readCommit: () => Effect.succeed(commit),
      listFiles: () => Effect.succeed(["song.gp"]),
      readBlob: () => Effect.succeed(new Uint8Array([1])),
    });

    const output = capturedOutput();
    expect(output).toContain("song.gp");
    expect(output).toContain("new file");
  });

  it("should show 'initial commit' label when there is no parent", async () => {
    const commit = makeCommit({ hash: FULL_HASH, parentHashes: [] });

    await runShow({
      readCommit: () => Effect.succeed(commit),
      listFiles: () => Effect.succeed(["song.gp"]),
      readBlob: () => Effect.succeed(new Uint8Array([1])),
    });

    expect(capturedOutput()).toContain("initial commit");
  });

  // ─── Commit with parent ───────────────────────────────────────────────────

  it("should show diff summary vs parent for a modified file", async () => {
    const commit = makeCommit({ hash: FULL_HASH, parentHashes: [PARENT_HASH] });

    const parentBytes = new Uint8Array([1]);
    const headBytes = new Uint8Array([2]);

    const baseScore = makeScore([makeTrack("Guitar", [simpleBar(5)])], 1);
    const headScore = makeScore([makeTrack("Guitar", [simpleBar(5), simpleBar(7)])], 2);

    await runShow(
      {
        readCommit: () => Effect.succeed(commit),
        listFiles: (_, ref) =>
          Effect.succeed(ref === FULL_HASH || ref === PARENT_HASH ? ["song.gp"] : []),
        readBlob: (_, oid) =>
          Effect.succeed(oid === FULL_HASH ? headBytes : parentBytes),
      },
      {
        parse: (bytes) => Effect.succeed(bytes === parentBytes ? baseScore : headScore),
      },
    );

    const output = capturedOutput();
    expect(output).toContain("song.gp");
    expect(output).toContain("Guitar");
    expect(output).toContain("1 added");
  });

  it("should show parent hash in the changes label", async () => {
    const commit = makeCommit({ hash: FULL_HASH, parentHashes: [PARENT_HASH] });

    await runShow({
      readCommit: () => Effect.succeed(commit),
      // File present in both commit and parent so the changes section is printed
      listFiles: () => Effect.succeed(["song.gp"]),
      readBlob: () => Effect.succeed(new Uint8Array([1])),
    });

    expect(capturedOutput()).toContain(PARENT_HASH.slice(0, 7));
  });

  it("should label a file as 'new file' when it is absent from the parent", async () => {
    const commit = makeCommit({ hash: FULL_HASH, parentHashes: [PARENT_HASH] });

    await runShow({
      readCommit: () => Effect.succeed(commit),
      listFiles: (_, ref) =>
        Effect.succeed(ref === FULL_HASH ? ["song.gp"] : []),
      readBlob: () => Effect.succeed(new Uint8Array([1])),
    });

    const output = capturedOutput();
    expect(output).toContain("song.gp");
    expect(output).toContain("new file");
  });

  it("should label a file as 'deleted' when it is absent in the commit but present in parent", async () => {
    const commit = makeCommit({ hash: FULL_HASH, parentHashes: [PARENT_HASH] });

    await runShow({
      readCommit: () => Effect.succeed(commit),
      listFiles: (_, ref) =>
        Effect.succeed(ref === PARENT_HASH ? ["song.gp"] : []),
      readBlob: () => Effect.succeed(new Uint8Array([1])),
    });

    const output = capturedOutput();
    expect(output).toContain("song.gp");
    expect(output).toContain("deleted");
  });

  it("should show '(no changes)' when both scores are identical", async () => {
    const commit = makeCommit({ hash: FULL_HASH, parentHashes: [PARENT_HASH] });
    const score = makeScore([makeTrack("Guitar", [simpleBar(5)])], 1);
    const bytes = new Uint8Array([1]);

    await runShow(
      {
        readCommit: () => Effect.succeed(commit),
        listFiles: () => Effect.succeed(["song.gp"]),
        readBlob: () => Effect.succeed(bytes),
      },
      { parse: () => Effect.succeed(score) },
    );

    expect(capturedOutput()).toContain("(no changes)");
  });

  // ─── Short hash expansion ─────────────────────────────────────────────────

  it("should expand a short hash by walking the log", async () => {
    const commit = makeCommit({ hash: FULL_HASH, message: "Short hash test" });

    await runShow(
      {
        log: () => Effect.succeed([commit]),
        readCommit: (_, oid) =>
          oid === FULL_HASH ? Effect.succeed(commit) : Effect.fail(new Error("bad oid")),
        listFiles: () => Effect.succeed([]),
      },
      {},
      { hash: "aaaaaaa" }, // 7-char short hash
    );

    expect(capturedOutput()).toContain("Short hash test");
  });

  it("should fail with a clear error when the short hash matches no commit", async () => {
    await expect(
      runShow(
        { log: () => Effect.succeed([]) },
        {},
        { hash: "0000000" },
      ),
    ).rejects.toThrow("No commit found matching '0000000'");
  });

  // ─── JSON output ─────────────────────────────────────────────────────────

  it("should output valid JSON with ok=true when --json is passed", async () => {
    const commit = makeCommit({ hash: FULL_HASH, parentHashes: [PARENT_HASH] });

    await runShow(
      {
        readCommit: () => Effect.succeed(commit),
        listFiles: (_, ref) =>
          Effect.succeed(ref === FULL_HASH ? ["song.gp"] : []),
        readBlob: () => Effect.succeed(new Uint8Array([1])),
      },
      {},
      { json: true },
    );

    const parsed = JSON.parse(capturedOutput());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.commit.hash).toBe(FULL_HASH);
    expect(parsed.data.commit.message).toBe("Initial commit");
    expect(parsed.data.files).toHaveLength(1);
    expect(parsed.data.files[0].file).toBe("song.gp");
    expect(parsed.data.files[0].summary).toBe("new file");
  });

  it("should include diff summary in JSON for modified files vs parent", async () => {
    const commit = makeCommit({ hash: FULL_HASH, parentHashes: [PARENT_HASH] });
    const parentBytes = new Uint8Array([1]);
    const headBytes = new Uint8Array([2]);
    const baseScore = makeScore([makeTrack("Guitar", [simpleBar(5)])], 1);
    const headScore = makeScore([makeTrack("Guitar", [simpleBar(7)])], 1);

    await runShow(
      {
        readCommit: () => Effect.succeed(commit),
        listFiles: () => Effect.succeed(["song.gp"]),
        readBlob: (_, oid) =>
          Effect.succeed(oid === FULL_HASH ? headBytes : parentBytes),
      },
      { parse: (bytes) => Effect.succeed(bytes === parentBytes ? baseScore : headScore) },
      { json: true },
    );

    const parsed = JSON.parse(capturedOutput());
    expect(parsed.data.files[0].summary).toContain("Guitar");
    expect(parsed.data.files[0].summary).toContain("1 changed");
  });

  // ─── Export ───────────────────────────────────────────────────────────────

  it("should write the blob to the export path when --export is passed (single file)", async () => {
    const commit = makeCommit({ hash: FULL_HASH, parentHashes: [] });
    const fileBytes = new Uint8Array([10, 20, 30]);

    await Effect.runPromise(
      showEffect({ hash: FULL_HASH, dir: "/repo", export: "/tmp/out.gp" }).pipe(
        Effect.provide(
          makeGitLayer({
            readCommit: () => Effect.succeed(commit),
            listFiles: () => Effect.succeed(["song.gp"]),
            readBlob: () => Effect.succeed(fileBytes),
          }),
        ),
        Effect.provide(makeAtLayer({})),
        Effect.provide(makeFsLayer()),
      ),
    );

    expect(writtenFiles).toHaveLength(1);
    expect(writtenFiles[0]!.dest).toBe("/tmp/out.gp");
    expect(writtenFiles[0]!.bytes).toEqual(fileBytes);
  });

  it("should write each file under the export path when multiple .gp files exist", async () => {
    const commit = makeCommit({ hash: FULL_HASH, parentHashes: [] });
    const bytesA = new Uint8Array([1]);
    const bytesB = new Uint8Array([2]);

    await Effect.runPromise(
      showEffect({ hash: FULL_HASH, dir: "/repo", export: "/tmp/export" }).pipe(
        Effect.provide(
          makeGitLayer({
            readCommit: () => Effect.succeed(commit),
            listFiles: () => Effect.succeed(["song.gp", "bass.gp"]),
            readBlob: (_, __, file) =>
              Effect.succeed(file === "song.gp" ? bytesA : bytesB),
          }),
        ),
        Effect.provide(makeAtLayer({})),
        Effect.provide(makeFsLayer()),
      ),
    );

    expect(writtenFiles).toHaveLength(2);
    expect(writtenFiles[0]!.dest).toBe("/tmp/export/song.gp");
    expect(writtenFiles[1]!.dest).toBe("/tmp/export/bass.gp");
  });

  it("should print the export destination path to stdout", async () => {
    const commit = makeCommit({ hash: FULL_HASH, parentHashes: [] });

    await Effect.runPromise(
      showEffect({ hash: FULL_HASH, dir: "/repo", export: "/tmp/out.gp" }).pipe(
        Effect.provide(
          makeGitLayer({
            readCommit: () => Effect.succeed(commit),
            listFiles: () => Effect.succeed(["song.gp"]),
            readBlob: () => Effect.succeed(new Uint8Array([1])),
          }),
        ),
        Effect.provide(makeAtLayer({})),
        Effect.provide(makeFsLayer()),
      ),
    );

    expect(capturedOutput()).toContain("/tmp/out.gp");
  });
});
