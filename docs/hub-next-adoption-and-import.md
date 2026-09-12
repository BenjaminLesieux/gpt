# Adopting a score, and importing a file

v1 was one-directional in practice: a musician created a score in the browser,
pasted the triple into companion, and pushed. Everything flowed local → hub.

Both halves of the return path are now built. A score can start its life on
either side.

- **Import** — `POST /scores/:id/import` takes a `.gp` and writes it as the
  score's first version, server-side.
- **Adoption** — the companion's `adopt_remote` materialises a `.gp` on disk
  from a remote it has never seen, and registers it as tracked.

Together: import a file on the site → the hub makes a real first version →
companion adopts it by triple and pulls it down.

## What was already there

Neither half needed new transport. `git/routes.ts` proxies every verb to
`git-http-backend`, and `createRepository` only ever had to opt *into*
receive-pack — upload-pack is on by default, so a `git clone` always worked
given the triple. `pull.rs` already fetched, refused to merge (locked decision
8), snapshotted the disk file before overwriting it, and fast-forwarded.

What was missing sat on either side of that.

## 1. Adoption

`pull()` opens with `state.tracked(id)?` — it pulls *into* a file that already
carries a remote descriptor. Nothing could materialise a `.gp` from a remote
alone, because `track_file` / `pick_and_track_file` both start from a file the
user points at.

`adopt.rs` inverts that: fetch the remote into the score's bare repo, make its
tip `main`, read `score.gp` out of it, write that to a path the user chooses,
and register it as tracked with the remote and keychain token already set. The
file lands on disk *from* the repo, where every other flow puts the file down
first and the repo second.

Three things it has to get right, all of which have tests:

- **The id.** `TrackedFile::new` derives the id from the canonicalized path,
  but at adoption time the file does not exist yet, so `canonicalize` would
  fall back to the raw path and yield a *different* id from the one tracking
  the same file later would produce (macOS hands out both `/var/…` and
  `/private/var/…`). The parent directory is canonicalized and the filename
  joined onto it.
- **Not losing history.** `repos/<id>/` may already hold versions — `untrack_file`
  deliberately leaves repos behind so re-tracking finds its history again — so
  the ref update goes through `git::fast_forward_named`, which already refuses
  to drop versions, rather than forcing the ref.
- **Nothing left behind on failure.** `remote::fetch` takes the token as an
  argument, so adoption authenticates without storing first and writes to the
  keychain only once it has succeeded.

Refused: a remote with no `main`, a path that already exists, a path already
tracked, an extension that is not Guitar Pro's.

### Discovery: the paste, and why not a list

Adoption takes the same pasted triple `RemoteDialog` already takes. This was a
real fork and it stays decided this way:

`GET /scores` is session-authenticated, and a session cookie is a browser thing
— deliberately so: *a browser session must not be a push credential*. A score
token cannot ask the question either, because `readScoreToken` resolves to
exactly one score and that one-to-one mapping *is* the isolation guarantee.
Listing an account's scores from companion therefore means a new
account-scoped credential — a new thing to leak — and it earns its keep only
once someone has more scores than they care to paste. Not yet.

## 2. Import

`POST /scores` inits an empty bare repo and, before this, the hub never wrote a
git object again — every object arrived through receive-pack. Import is the
first code that writes into a repository without http-backend in front of it,
so it validates ids through the same `repositoryPath` rather than its own.

`git/versions.ts` authors the commit with plumbing — `hash-object -w`, `mktree`,
`commit-tree`, `update-ref` — no worktree. The shape is not the hub's to choose,
because companion reads it back (`git.rs`): a single blob at the tree root named
`score.gp`, mode `100644`, tip on `refs/heads/main`, and **no** `refs/snapshots`
— that ref is local scratch and a push never carries one, so a repository
holding one would not look like it came from a client.

Two decisions worth keeping:

- **Emptiness is enforced by `update-ref`, not by a check.** Passing the empty
  string as the expected old value makes git assert the ref is unborn as it
  writes. Two racing imports produce one version and one refusal; reading the
  ref first and writing second would produce one lost import.
- **The first version's message is `Imported`, not the filename.** Passing a
  filename would have put the song title into a query string and the access
  log, which is the thing decision 9 keeps out of clone URLs. The name the
  musician typed is already on the row.

The endpoint takes the raw bytes as `application/octet-stream` — no multipart,
no base64. Every wrapper is a chance for the bytes that land to differ from the
bytes that were picked. It is registered as its own plugin scope under the
`/scores` prefix, for the reason `gitRoutes` is also its own: the parser that
accepts a file must not reach the JSON API.

### Import targets an existing empty score

This was left open for whoever built the screen. The answer: the server
primitive adds a first version to a score that already exists, and the **UI
composes** `createScore` then `importScore` into one user-visible step. It
composes with `POST /scores` and `POST /scores/:id/token` rather than
duplicating either, and it avoids a three-way rollback.

The seam that creates is real and is handled rather than hidden: between the two
calls the score can exist with no version in it. That is **not** a broken state
— it is exactly what `Create score` produces on its own — so the recovery is to
send the file again at the score already made, never to make another. The failed
mutation carries the created score so the retry can target it, and so the
credentials it minted are not lost with the error: they had been shown nowhere
yet and the server keeps no copy.

### The normalizer, which was the finding that mattered

Bytes are committed as `normalize_gp(bytes)` — zip entries sorted, stored
uncompressed, DOS timestamps zeroed — so that a Guitar Pro save which changed no
note produces no new version. That existed only in Rust, so an import written
naively would have stored raw bytes and made the musician's *next* save look
like a musical change. The bug would have been reported as "it says I changed
something and I didn't".

The normalizer is therefore ported to TypeScript, and the two implementations
are pinned to each other by checked-in goldens that both suites assert against.
[`docs/normalize-gp.md`](./normalize-gp.md) is the spec and describes the gate,
including why a second, deliberately unsorted fixture was needed on top of the
real `.gp` one.

It lives in `apps/hub/src/git/normalize.ts` rather than in `gpt-core`. The hub is
its only TypeScript consumer, and `gpt-core` builds as one bundled entry, so
importing it would have made the hub take its first workspace dependency and
carry alphaTab into the Docker image for the sake of a zip utility.

## Still not done

- **Listing an account's scores in companion**, per the fork above. Wants an
  account-scoped credential first.
- **Whether the score list should distinguish an empty score.** It deliberately
  does not: a score with no versions is the ordinary state of a freshly created
  one, so there is nothing to flag. If that changes, note that `GET /scores`
  would need to read each repository's refs — a git call per row.
