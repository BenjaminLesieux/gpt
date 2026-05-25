import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock AlphaTab before importing our serializer so we avoid DOM/canvas deps in Node tests
vi.mock("@coderline/alphatab", () => ({
  model: {
    JsonConverter: {
      scoreToJson: vi.fn((score: unknown) => JSON.stringify(score)),
      jsonToScore: vi.fn((json: string) => JSON.parse(json)),
    },
  },
}));

import { serialize, deserialize } from "./serializer.js";
import { model } from "@coderline/alphatab";
import type { Score, Settings } from "./types/score.js";

const { JsonConverter } = model;

function stubScore(overrides: Partial<Score> = {}): Score {
  return { title: "Test Song", artist: "Artist", tempo: 120, tracks: [], masterBars: [], ...overrides } as unknown as Score;
}

describe("serialize", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("should delegate to JsonConverter.scoreToJson when called with a score", () => {
    // Given a score
    const score = stubScore();

    // When serialized
    serialize(score);

    // Then JsonConverter.scoreToJson is called with the score
    expect(model.JsonConverter.scoreToJson).toHaveBeenCalledOnce();
    expect(model.JsonConverter.scoreToJson).toHaveBeenCalledWith(score);
  });

  it("should return the string produced by JsonConverter.scoreToJson", () => {
    // Given JsonConverter returns a specific JSON string
    const expected = '{"title":"My Song"}';
    vi.mocked(JsonConverter.scoreToJson).mockReturnValueOnce(expected);
    const score = stubScore({ title: "My Song" });

    // When serialized
    const result = serialize(score);

    // Then the result matches what JsonConverter returned
    expect(result).toBe(expected);
  });
});

describe("deserialize", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("should delegate to JsonConverter.jsonToScore when called with a JSON string", () => {
    // Given a JSON string
    const json = '{"title":"My Song"}';

    // When deserialized
    deserialize(json);

    // Then JsonConverter.jsonToScore is called with the string
    expect(JsonConverter.jsonToScore).toHaveBeenCalledOnce();
    expect(JsonConverter.jsonToScore).toHaveBeenCalledWith(json, undefined);
  });

  it("should forward an optional settings argument to JsonConverter.jsonToScore", () => {
    // Given a JSON string and a settings object
    const json = "{}";
    const settings = { core: {} } as unknown as Settings;

    // When deserialized with settings
    deserialize(json, settings);

    // Then JsonConverter receives the settings
    expect(JsonConverter.jsonToScore).toHaveBeenCalledWith(json, settings);
  });

  it("should return the Score produced by JsonConverter.jsonToScore", () => {
    // Given JsonConverter returns a specific score object
    const expected = stubScore({ title: "Returned Score" });
    vi.mocked(JsonConverter.jsonToScore).mockReturnValueOnce(expected);

    // When deserialized
    const result = deserialize("{}");

    // Then the result is the score JsonConverter returned
    expect(result).toBe(expected);
  });
});
