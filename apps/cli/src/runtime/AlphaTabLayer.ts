import { importer, exporter } from "@coderline/alphatab";
import { Context, Effect, Layer } from "effect";
import type { Score } from "@gpt/gpt-core";
import { AlphaTabParseError, AlphaTabExportError } from "../errors";

export class AlphaTabLayer extends Context.Tag("AlphaTabLayer")<
  AlphaTabLayer,
  {
    readonly parse: (bytes: Uint8Array) => Effect.Effect<Score, AlphaTabParseError>;
    /**
     * Serializes a Score to Guitar Pro 7 binary format.
     * GP7 is readable by Guitar Pro 6+ and most modern tab editors.
     */
    readonly exportToBytes: (score: Score) => Effect.Effect<Uint8Array, AlphaTabExportError>;
  }
>() {
  static readonly Live = Layer.succeed(AlphaTabLayer, {
    parse: (bytes) =>
      Effect.try({
        try: () => importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(bytes)),
        catch: (e) => new AlphaTabParseError(e),
      }),

    exportToBytes: (score) =>
      Effect.try({
        try: () => new exporter.Gp7Exporter().export(score),
        catch: (e) => new AlphaTabExportError(e),
      }),
  });
}
