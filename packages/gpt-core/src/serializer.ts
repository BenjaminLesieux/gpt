import { model } from "@coderline/alphatab";
import type { Score, Settings } from "./types/score.js"; // Score = model.Score instance type

export function serialize(score: Score): string {
  return model.JsonConverter.scoreToJson(score);
}

export function deserialize(json: string, settings?: Settings): Score {
  return model.JsonConverter.jsonToScore(json, settings);
}
