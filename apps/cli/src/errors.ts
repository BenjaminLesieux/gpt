import { Data } from "effect";

const msg = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export class GitError extends Data.TaggedError("GitError")<{
  readonly operation: string;
  readonly message: string;
}> {
  constructor(operation: string, cause: unknown) {
    super({ operation, message: `git ${operation} failed: ${msg(cause)}` });
  }
}

export class FSError extends Data.TaggedError("FSError")<{
  readonly operation: "read" | "write" | "mkdir" | "unlink";
  readonly path: string;
  readonly message: string;
}> {
  constructor(
    operation: "read" | "write" | "mkdir" | "unlink",
    path: string,
    cause: unknown,
  ) {
    super({ operation, path, message: `${operation} '${path}' failed: ${msg(cause)}` });
  }
}

export class AlphaTabParseError extends Data.TaggedError("AlphaTabParseError")<{
  readonly message: string;
}> {
  constructor(cause: unknown) {
    super({ message: `Failed to parse Guitar Pro file: ${msg(cause)}` });
  }
}

export class AlphaTabExportError extends Data.TaggedError("AlphaTabExportError")<{
  readonly message: string;
}> {
  constructor(cause: unknown) {
    super({ message: `Failed to export Guitar Pro file: ${msg(cause)}` });
  }
}

export class NoCommonAncestorError extends Data.TaggedError("NoCommonAncestorError")<{
  readonly branch: string;
  readonly message: string;
}> {
  constructor(branch: string) {
    super({ branch, message: `Cannot merge '${branch}': no common ancestor (unrelated histories)` });
  }
}

export class NoMergeInProgressError extends Data.TaggedError("NoMergeInProgressError")<{
  readonly message: string;
}> {
  constructor() {
    super({ message: "No merge in progress (conflict sidecar not found)" });
  }
}

export class UnresolvedConflictsError extends Data.TaggedError("UnresolvedConflictsError")<{
  readonly count: number;
  readonly message: string;
}> {
  constructor(count: number) {
    super({ count, message: `${count} conflict${count === 1 ? "" : "s"} still need resolution` });
  }
}

export class CommitNotFoundError extends Data.TaggedError("CommitNotFoundError")<{
  readonly hash: string;
  readonly message: string;
}> {
  constructor(hash: string) {
    super({ hash, message: `No commit found matching '${hash}'` });
  }
}
