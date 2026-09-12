# Hub, next slice: adopting a score and importing a file

Two capabilities the v1 surface does not have, written down while the reasons
are still fresh. Neither is built. This is the survey a future implementer
would otherwise have to redo, plus the one finding that would have bitten late.

## Where v1 leaves us

v1 is one-directional in practice, though not on the wire. A musician creates a
score in the browser, finishes setup, pastes the triple into companion, and
pushes. Everything flows local → hub.

What already works, and needs nothing new:

- **The hub serves fetch.** `git/routes.ts` proxies every verb to
  `git-http-backend`, and `createRepository` only had to opt *into* receive-pack
  — upload-pack is on by default. A `git clone` of a score works today, given
  the triple.
- **Companion can pull.** `src-tauri/src/pull.rs` fetches, refuses to merge
  (locked decision 8), snapshots the disk file before overwriting it, and
  fast-forwards. `fetch_remote` and `pull_remote` are both exposed as commands.

So "pull" is not missing transport. It is missing two things either side of it.

## 1. Adopting a score companion has never seen

`pull()` opens with `state.tracked(id)?` — it pulls *into* a tracked file that
already carries a remote descriptor. There is no path that materialises a `.gp`
on disk from a remote alone. Today the only way a score becomes tracked is
`track_file` / `pick_and_track_file`: the user points at a file that already
exists.

Adoption is the inverse and needs its own command — clone the bare repo into
the score's git dir, read `score.gp` out of `refs/heads/main`, write it to a
path the user chooses, and register it as tracked with the remote already set.
Note the ordering constraint: the file lands on disk *from* the repo, where
every existing flow puts a file on disk first and the repo second.

The open question is discovery, and it is a real fork:

- **Paste a triple, as setup already does.** No hub change at all. Adoption
  becomes "paste this the way you pasted the last one", which is honest and
  costs nothing.
- **List the account's scores in companion.** `GET /scores` is
  session-authenticated, and a session cookie is a browser thing — deliberately
  so: "a browser session must not be a push credential". A score token cannot
  ask this question either, because `readScoreToken` resolves to exactly one
  score and that one-to-one mapping *is* the isolation guarantee. Listing from
  companion therefore means a new account-scoped credential, which is a new
  thing to leak. It should not be added casually.

Start with the paste. The second only earns its keep once someone has more
scores than they care to paste.

## 2. Importing a file on the website

Today `POST /scores` inits an empty bare repo and the hub never writes a git
object again — every object arrives through receive-pack. Import breaks that:
the hub must author the initial commit itself, and the commit has to be
indistinguishable from one companion would have pushed.

The shape companion expects, from `git.rs`:

- a single blob at tree root named **`score.gp`** (`SCORE_ENTRY`), mode
  `100644`, whatever the file was called when the user picked it
- the tip on **`refs/heads/main`** (`NAMED_REF`) — matching the
  `--initial-branch=main` that `createRepository` already sets
- `refs/snapshots` is local-only; push is `NAMED_REF:NAMED_REF` and never
  carries it, so an import must not invent one

**The finding that matters: the normalizer is Rust-only.** Bytes are committed
as `normalize_gp(bytes)` — zip entries sorted, stored uncompressed, DOS
timestamps zeroed — so that a Guitar Pro save which changed no note produces no
new version. `normalize.rs` calls itself a port of `normalizeGp` from
`@gpt/gpt-core`, but that function is gone: nothing in the TypeScript tree
mentions it any more. `docs/normalize-gp.md` still describes the algorithm.

So an import endpoint has three options, in descending order of how much they
cost later:

1. **Port the normalizer back to TypeScript** and share the doc as the spec,
   with fixtures asserting the Rust and TS outputs are byte-identical. The
   right answer, and the only one where both writers stay honest.
2. **Skip normalization on import.** The first companion save then looks like a
   musical change when nothing changed — precisely the failure normalization
   exists to prevent. It would be a bug reported as "it says I changed
   something and I didn't".
3. Have companion normalize on first pull. Moves the lie rather than removing
   it, and makes the hub's history depend on which client touched it first.

Do (1), and treat the round-trip fixture as the gate.

Mechanically the commit itself is small — `git hash-object -w`, `mktree`,
`commit-tree`, `update-ref` against the bare repo, no worktree needed — but it
is the first code that writes to a repository outside http-backend, so it wants
the same id validation `repositoryPath` already does rather than its own.

## The flow this unlocks

Import a `.gp` on the site → the hub makes a real first version → companion
adopts it by triple and pulls it down. That is the mirror of v1's flow, and it
closes the loop: a score can start its life on either side.

## Not decided here

Whether import creates a score or adds a first version to an existing empty
one. `POST /scores` already exists and `POST /scores/:id/token` already covers
the finish-setup case, so an import that targets an *existing* empty score
composes with both rather than duplicating them — but that is a call for
whoever builds the screen, not one to make in advance.
