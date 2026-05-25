import { Context, Effect, Layer } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import { FSError } from "../errors.js";

export class FSLayer extends Context.Tag("FSLayer")<
  FSLayer,
  {
    readonly readFile: (p: string) => Effect.Effect<Uint8Array, FSError>;
    readonly writeFile: (p: string, data: Uint8Array) => Effect.Effect<void, FSError>;
    readonly exists: (p: string) => Effect.Effect<boolean>;
    readonly mkdir: (p: string) => Effect.Effect<void, FSError>;
    readonly resolve: (...parts: string[]) => string;
  }
>() {
  static readonly Live = Layer.succeed(FSLayer, {
    readFile: (p) =>
      Effect.tryPromise({
        try: () => fs.promises.readFile(p),
        catch: (e) => new FSError("read", p, e),
      }),
    writeFile: (p, data) =>
      Effect.tryPromise({
        try: () => fs.promises.writeFile(p, data),
        catch: (e) => new FSError("write", p, e),
      }),
    exists: (p) =>
      Effect.sync(() => fs.existsSync(p)),
    mkdir: (p) =>
      Effect.tryPromise({
        try: () => fs.promises.mkdir(p, { recursive: true }),
        catch: (e) => new FSError("mkdir", p, e),
      }).pipe(Effect.map(() => undefined)),
    resolve: path.resolve,
  });
}
