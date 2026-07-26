import { Effect } from "effect";
import { GitLayer } from "../runtime/GitLayer";

interface BranchListOptions {
  dir?: string;
  json?: boolean;
}

interface BranchCreateOptions {
  dir?: string;
  name: string;
}

interface CheckoutOptions {
  dir?: string;
  ref: string;
}

export const branchListData = (dir: string = process.cwd()) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    const [branches, current] = yield* Effect.all([
      git.listBranches(dir),
      git.currentBranch(dir),
    ]);
    return { branches, current };
  });

export const branchListCommand = ({ dir = process.cwd(), json = false }: BranchListOptions) =>
  Effect.gen(function* () {
    const { branches, current } = yield* branchListData(dir);

    if (json) {
      process.stdout.write(JSON.stringify({ ok: true, data: { branches, current } }, null, 2));
      return { branches, current };
    }

    for (const b of branches) {
      const marker = b === current ? "* " : "  ";
      console.log(`${marker}\x1b[${b === current ? "32" : "0"}m${b}\x1b[0m`);
    }

    return { branches, current };
  }).pipe(Effect.provide(GitLayer.Live));

export const branchCreateCommand = ({ dir = process.cwd(), name }: BranchCreateOptions) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    yield* git.branch(dir, name);
    console.log(`Branch '${name}' created.`);
  }).pipe(Effect.provide(GitLayer.Live));

export const checkoutCommand = ({ dir = process.cwd(), ref }: CheckoutOptions) =>
  Effect.gen(function* () {
    const git = yield* GitLayer;
    yield* git.checkout(dir, ref);
    console.log(`Switched to branch '${ref}'.`);
  }).pipe(Effect.provide(GitLayer.Live));
