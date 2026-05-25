import { Effect } from "effect";
import { GitLayer } from "../runtime/GitLayer.js";

interface LogOptions {
  dir?: string;
  json?: boolean;
}

export const logData = (dir: string = process.cwd()) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    return yield* git.log(dir);
  });

export const logCommand = ({ dir = process.cwd(), json = false }: LogOptions) =>
  Effect.gen(function* () {
    const commits = yield* logData(dir);

    if (json) {
      process.stdout.write(JSON.stringify({ ok: true, data: commits }, null, 2));
      return commits;
    }

    for (const commit of commits) {
      const date = new Date(commit.author.timestamp * 1000).toLocaleDateString();
      console.log(`\x1b[33m${commit.shortHash}\x1b[0m ${commit.message} \x1b[2m(${date})\x1b[0m`);
    }

    return commits;
  }).pipe(Effect.provide(GitLayer.Live));
