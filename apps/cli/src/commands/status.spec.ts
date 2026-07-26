import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect, Layer } from "effect";
import { GitLayer } from "../runtime/GitLayer";
import { AlphaTabLayer } from "../runtime/AlphaTabLayer";
import { FSLayer } from "../runtime/FSLayer";
import { statusEffect } from "./status";
import type { Score, Track, Staff, Bar, Voice, Beat, Note, MasterBar } from "@gpt/gpt-core";

// ─── Mock Score factories (same shape as diff.spec.ts) ───────────────────────

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

// ─── Layer factories ──────────────────────────────────────────────────────────

const notImplemented = () => Effect.die("not implemented in test");

function makeGitLayer(overrides: Partial<GitLayer["Type"]>): Layer.Layer<GitLayer> {
  return Layer.succeed(GitLayer, {
    init: notImplemented,
    add: notImplemented,
    commit: notImplemented,
    log: notImplemented,
    resolveRef: () => Effect.fail(new Error("no HEAD")),
    readBlob: notImplemented,
    listBranches: notImplemented,
    currentBranch: () => Effect.succeed("main"),
    checkout: notImplemented,
    branch: notImplemented,
    listFiles: notImplemented,
    statusMatrix: () => Effect.succeed([]),
    ...overrides,
  } as GitLayer["Type"]);
}

function makeAtLayer(overrides: Partial<AlphaTabLayer["Type"]>): Layer.Layer<AlphaTabLayer> {
  return Layer.succeed(AlphaTabLayer, {
    parse: () => Effect.succeed(makeScore([], 0)),
    ...overrides,
  } as AlphaTabLayer["Type"]);
}

function makeFsLayer(overrides: Partial<FSLayer["Type"]>): Layer.Layer<FSLayer> {
  return Layer.succeed(FSLayer, {
    readFile: notImplemented,
    writeFile: notImplemented,
    exists: () => Effect.succeed(false),
    mkdir: notImplemented,
    resolve: (...parts) => parts.join("/"),
    ...overrides,
  } as FSLayer["Type"]);
}

function runStatus(
  gitOverrides: Partial<GitLayer["Type"]>,
  atOverrides: Partial<AlphaTabLayer["Type"]> = {},
  fsOverrides: Partial<FSLayer["Type"]> = {},
  options: { json?: boolean; dir?: string } = {},
) {
  return Effect.runPromise(
    statusEffect({ dir: "/repo", ...options }).pipe(
      Effect.provide(makeGitLayer(gitOverrides)),
      Effect.provide(makeAtLayer(atOverrides)),
      Effect.provide(makeFsLayer(fsOverrides)),
    ),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("statusCommand", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function capturedOutput(): string {
    return stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
  }

  // ─── Branch line ───────────────────────────────────────────────────────────

  it("should show the current branch name", async () => {
    await runStatus({ currentBranch: () => Effect.succeed("feature/my-song") });

    expect(capturedOutput()).toContain("feature/my-song");
  });

  // ─── Nothing to commit ────────────────────────────────────────────────────

  it("should report nothing to commit when the matrix is empty", async () => {
    await runStatus({ statusMatrix: () => Effect.succeed([]) });

    expect(capturedOutput()).toContain("Nothing to commit");
  });

  it("should report nothing to commit when all .gp files are unmodified", async () => {
    // [file, HEAD=1 present, workdir=1 same as HEAD, stage=1 same as HEAD]
    await runStatus({
      statusMatrix: () => Effect.succeed([["song.gp", 1, 1, 1]]),
    });

    expect(capturedOutput()).toContain("Nothing to commit");
  });

  // ─── Staged files ─────────────────────────────────────────────────────────

  it("should list a staged new file as 'added'", async () => {
    // [file, HEAD=0 absent, workdir=2 different, stage=2 same as workdir]
    await runStatus({
      statusMatrix: () => Effect.succeed([["newsong.gp", 0, 2, 2]]),
      resolveRef: () => Effect.succeed("abc123"),
    });

    const output = capturedOutput();
    expect(output).toContain("Changes staged for commit");
    expect(output).toContain("added");
    expect(output).toContain("newsong.gp");
  });

  it("should list a staged deleted file as 'deleted'", async () => {
    // [file, HEAD=1 present, workdir=0 absent, stage=0 absent from index]
    await runStatus({
      statusMatrix: () => Effect.succeed([["old.gp", 1, 0, 0]]),
      resolveRef: () => Effect.succeed("abc123"),
    });

    const output = capturedOutput();
    expect(output).toContain("Changes staged for commit");
    expect(output).toContain("deleted");
    expect(output).toContain("old.gp");
  });

  it("should list a staged modified file as 'modified' with diff summary", async () => {
    // [file, HEAD=1 present, workdir=2 different, stage=2 same as workdir]
    const baseScore = makeScore([makeTrack("Guitar", [simpleBar(5)])], 1);
    const headScore = makeScore([makeTrack("Guitar", [simpleBar(7), simpleBar(9)])], 2);

    const headBytes = new Uint8Array([1]);
    const workdirBytes = new Uint8Array([2]);

    await runStatus(
      {
        statusMatrix: () => Effect.succeed([["song.gp", 1, 2, 2]]),
        resolveRef: () => Effect.succeed("abc123"),
        readBlob: () => Effect.succeed(headBytes),
      },
      {
        parse: (bytes) =>
          Effect.succeed(
            bytes === headBytes ? baseScore : headScore,
          ),
      },
      {
        readFile: () => Effect.succeed(workdirBytes),
      },
    );

    const output = capturedOutput();
    expect(output).toContain("modified");
    expect(output).toContain("song.gp");
    expect(output).toContain("Guitar");
    expect(output).toContain("1 changed");
    expect(output).toContain("1 added");
  });

  it("should show staged modified file without summary when scores are identical", async () => {
    const score = makeScore([makeTrack("Guitar", [simpleBar(5)])], 1);
    const bytes = new Uint8Array([1]);

    await runStatus(
      {
        statusMatrix: () => Effect.succeed([["song.gp", 1, 2, 2]]),
        resolveRef: () => Effect.succeed("abc123"),
        readBlob: () => Effect.succeed(bytes),
      },
      { parse: () => Effect.succeed(score) },
      { readFile: () => Effect.succeed(bytes) },
    );

    const output = capturedOutput();
    expect(output).toContain("modified");
    expect(output).toContain("song.gp");
    // No diff summary since scores are identical
    expect(output).not.toContain("changed");
  });

  // ─── Unstaged files ───────────────────────────────────────────────────────

  it("should list an unstaged modified file", async () => {
    // [file, HEAD=1, workdir=2 different, stage=1 same as HEAD = not staged]
    await runStatus({
      statusMatrix: () => Effect.succeed([["song.gp", 1, 2, 1]]),
      resolveRef: () => Effect.succeed("abc123"),
    });

    const output = capturedOutput();
    expect(output).toContain("Changes not staged for commit");
    expect(output).toContain("modified");
    expect(output).toContain("song.gp");
  });

  it("should list an unstaged deleted file", async () => {
    // [file, HEAD=1, workdir=0 absent, stage=1 same as HEAD = deletion not staged]
    await runStatus({
      statusMatrix: () => Effect.succeed([["song.gp", 1, 0, 1]]),
      resolveRef: () => Effect.succeed("abc123"),
    });

    const output = capturedOutput();
    expect(output).toContain("Changes not staged for commit");
    expect(output).toContain("deleted");
    expect(output).toContain("song.gp");
  });

  // ─── Untracked files ──────────────────────────────────────────────────────

  it("should list an untracked file", async () => {
    // [file, HEAD=0 absent, workdir=2 different, stage=0 absent = untracked]
    await runStatus({
      statusMatrix: () => Effect.succeed([["new.gp", 0, 2, 0]]),
      resolveRef: () => Effect.succeed("abc123"),
    });

    const output = capturedOutput();
    expect(output).toContain("Untracked files");
    expect(output).toContain("new.gp");
  });

  // ─── Mixed state ─────────────────────────────────────────────────────────

  it("should show staged, unstaged, and untracked sections together", async () => {
    // staged modified, unstaged modified, untracked
    await runStatus(
      {
        statusMatrix: () =>
          Effect.succeed([
            ["staged.gp", 1, 2, 2],
            ["unstaged.gp", 1, 2, 1],
            ["new.gp", 0, 2, 0],
          ]),
        resolveRef: () => Effect.succeed("abc123"),
        readBlob: () => Effect.succeed(new Uint8Array([1])),
      },
      { parse: () => Effect.succeed(makeScore([], 0)) },
      { readFile: () => Effect.succeed(new Uint8Array([2])) },
    );

    const output = capturedOutput();
    expect(output).toContain("Changes staged for commit");
    expect(output).toContain("staged.gp");
    expect(output).toContain("Changes not staged for commit");
    expect(output).toContain("unstaged.gp");
    expect(output).toContain("Untracked files");
    expect(output).toContain("new.gp");
  });

  it("should show a file in both staged and unstaged when stage=3 (staged with more workdir changes)", async () => {
    // [file, HEAD=1, workdir=2, stage=3 = different from both HEAD and workdir]
    await runStatus(
      {
        statusMatrix: () => Effect.succeed([["song.gp", 1, 2, 3]]),
        resolveRef: () => Effect.succeed("abc123"),
        readBlob: () => Effect.succeed(new Uint8Array([1])),
      },
      { parse: () => Effect.succeed(makeScore([], 0)) },
      { readFile: () => Effect.succeed(new Uint8Array([2])) },
    );

    const output = capturedOutput();
    expect(output).toContain("Changes staged for commit");
    expect(output).toContain("Changes not staged for commit");
  });

  // ─── No HEAD commits ─────────────────────────────────────────────────────

  it("should handle repos with no commits (resolveRef fails)", async () => {
    await runStatus({
      statusMatrix: () => Effect.succeed([["song.gp", 0, 2, 2]]),
      resolveRef: () => Effect.fail(new Error("no commits")),
    });

    const output = capturedOutput();
    expect(output).toContain("added");
    expect(output).toContain("song.gp");
  });

  it("should gracefully handle statusMatrix failure", async () => {
    await runStatus({
      statusMatrix: () => Effect.fail(new Error("not a git repo")),
      resolveRef: () => Effect.fail(new Error("no HEAD")),
    });

    // Falls back to empty matrix → nothing to commit
    expect(capturedOutput()).toContain("Nothing to commit");
  });

  // ─── JSON output ─────────────────────────────────────────────────────────

  it("should output valid JSON with ok=true when --json is passed", async () => {
    await runStatus(
      {
        statusMatrix: () =>
          Effect.succeed([
            ["staged.gp", 1, 2, 2],
            ["unstaged.gp", 1, 2, 1],
            ["new.gp", 0, 2, 0],
          ]),
        resolveRef: () => Effect.succeed("abc123"),
        readBlob: () => Effect.succeed(new Uint8Array([1])),
      },
      { parse: () => Effect.succeed(makeScore([], 0)) },
      { readFile: () => Effect.succeed(new Uint8Array([2])) },
      { json: true },
    );

    const raw = capturedOutput();
    const parsed = JSON.parse(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.branch).toBe("main");
    expect(parsed.data.staged).toHaveLength(1);
    expect(parsed.data.staged[0].file).toBe("staged.gp");
    expect(parsed.data.staged[0].status).toBe("modified");
    expect(parsed.data.unstaged).toHaveLength(1);
    expect(parsed.data.unstaged[0].file).toBe("unstaged.gp");
    expect(parsed.data.untracked).toEqual(["new.gp"]);
  });

  it("should include diff summary in JSON output for staged modified files", async () => {
    const baseScore = makeScore([makeTrack("Guitar", [simpleBar(5)])], 1);
    const headScore = makeScore([makeTrack("Guitar", [simpleBar(5), simpleBar(7)])], 2);

    const headBytes = new Uint8Array([1]);
    const workdirBytes = new Uint8Array([2]);

    await runStatus(
      {
        statusMatrix: () => Effect.succeed([["song.gp", 1, 2, 2]]),
        resolveRef: () => Effect.succeed("abc123"),
        readBlob: () => Effect.succeed(headBytes),
      },
      {
        parse: (bytes) =>
          Effect.succeed(bytes === headBytes ? baseScore : headScore),
      },
      { readFile: () => Effect.succeed(workdirBytes) },
      { json: true },
    );

    const parsed = JSON.parse(capturedOutput());
    expect(parsed.data.staged[0].summary).toBeDefined();
    expect(parsed.data.staged[0].summary).toContain("Guitar");
  });

  it("should not include summary key in JSON when scores are identical", async () => {
    const score = makeScore([], 0);
    const bytes = new Uint8Array([1]);

    await runStatus(
      {
        statusMatrix: () => Effect.succeed([["song.gp", 1, 2, 2]]),
        resolveRef: () => Effect.succeed("abc123"),
        readBlob: () => Effect.succeed(bytes),
      },
      { parse: () => Effect.succeed(score) },
      { readFile: () => Effect.succeed(bytes) },
      { json: true },
    );

    const parsed = JSON.parse(capturedOutput());
    expect(parsed.data.staged[0].summary).toBeUndefined();
  });
});
