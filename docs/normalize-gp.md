# Why `.gp` bytes churn, and what is done about it

Guitar Pro saves `.gp`/`.gpx` files as **zip containers**. Every save stamps the
current date and time into each zip entry header, and the entries are not
written in a stable order. The result: the bytes change on every save even when
**no note changed**. Left alone, that means a version recorded for every save,
each one identical in every way a musician would care about.

Normalization rebuilds the archive deterministically, so two saves with the same
musical content produce **byte-identical** output:

- entries sorted by name, so layout never depends on write order,
- stored uncompressed, so no deflate implementation can drift,
- DOS timestamp fields zeroed in every local and central-directory header.

That last one matters more than it looks: zip writers encode those fields from
*local* time, so without scrubbing them the same content normalized in two
timezones would still differ.

Entry payloads — including the musical `Content/score.gpif` XML — are copied
byte for byte, so Guitar Pro reopens the file losslessly. Non-zip input (legacy
binary `.gp5`) passes through untouched, as does anything whose directory will
not read: a file caught mid-write is stored raw rather than lost.

## Where it lives

[`apps/companion/src-tauri/src/normalize.rs`](../apps/companion/src-tauri/src/normalize.rs).
It runs in the Rust host, on the commit path for both tiers, because
auto-snapshots fire from the watcher thread and must never depend on a live
webview.

There was a TypeScript implementation in `gpt-core` as well. It went with the
CLI in M6 — its only consumer — leaving one implementation rather than two that
have to agree on byte-exact output.

It does not carry over the TS version's `volatileElements` option, which blanked
named XML elements. Nothing used it. If a Guitar Pro release turns out to
rewrite an element inside `score.gpif` on every save, that is the thing to port.

## Never a git filter

`.gitattributes` with a `clean` filter is the obvious-looking way to do this and
it is forbidden here — long-standing project doctrine, and independently true of
the current design.

The app writes blobs through libgit2 (`git2`), which does not run clean or
smudge filters. Neither did isomorphic-git before it. A filter configured in
`.gitattributes` would apply only when someone ran the real `git` command line
against the repo by hand, which is not how anything reaches the object store
here — so it would look configured and do nothing.

The rule that replaces it: **normalize before writing the blob**, in the
application, always. `git.rs` takes bytes and hashes what it is given — every
caller that reads a `.gp` off disk passes it through `normalize_gp` first
(`commands.rs`, `watcher.rs`, `pull.rs`). A new read path that forgets to is a
stream of identical versions, not a crash, so it is worth checking against those
call sites when adding one.
