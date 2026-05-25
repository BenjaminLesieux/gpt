import { Effect } from "effect";
import { intro, outro, text } from "@clack/prompts";
import { GitLayer } from "../runtime/GitLayer.js";

interface CommitOptions {
  message?: string;
  dir?: string;
}

export const commitCommand = ({ message, dir = process.cwd() }: CommitOptions) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    intro("gpt commit");

    const msg = message ?? (yield* Effect.promise(() =>
      text({ message: "Commit message:", placeholder: "Describe your changes…" }) as Promise<string>
    ));

    const hash = yield* git.commit(dir, msg, {
      name: process.env["GIT_AUTHOR_NAME"] ?? "Musician",
      email: process.env["GIT_AUTHOR_EMAIL"] ?? "musician@local",
    });

    outro(`[${hash.slice(0, 7)}] ${msg}`);
    return hash;
  }).pipe(Effect.provide(GitLayer.Live));
