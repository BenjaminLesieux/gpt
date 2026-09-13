# The hub parses scores, and merges them

[ADR 0006](0006-the-hub-serves-git-itself.md) made the hub a git server that
knows nothing about music: one route proxying `git-http-backend`, a token
check, and bytes in and out. `gpt-core` diffs AlphaTab models and lives
entirely on the companion side.

That stops. The hub takes a dependency on `@gpt/gpt-core` and, through it,
`@coderline/alphatab`, and it reads the `.gp` blobs in the repositories it
serves — to say what a branch changed, and to merge one into another.

## Why now

Because a merge has to happen *somewhere*, and every other somewhere is worse.

A `.gp` is a single binary blob at the tree root (`score.gp`, see
`git/versions.ts`). Git can never merge it — there is no text to three-way. The
only merge that exists is `mergeScores` in `gpt-core`, which is note-level, and
which needs a parsed AlphaTab model on both sides plus their common ancestor.

So either the hub can do that, or accepting a branch on the web is a button
that records an intention and waits for somebody's laptop to honour it later.
That is not a feature, it is a to-do list.

## The fact that made it cheap

`packages/gpt-core/vite.config.mts` sets `environment: 'node'`, and
`diff.integration.spec.ts` parses a real four-track, 36-bar `.gp` through
`importer.ScoreLoader.loadScoreFromBytes` — under Node, in CI, today.

There is no headless browser, no jsdom, no canvas shim. AlphaTab's *renderer*
needs a DOM; its **importer does not**, and importing is all of what this
needs. The capability has been sitting in the repository, exercised on every
test run, used by nothing outside the companion.

`applyMerge` and `mergeScores` are likewise built, spec'd against an oracle,
and wired to nothing at all.

## What the hub gains, precisely

Three reads, all of them on blobs it already stores:

- **what a branch touched** — `diffScores(base, tip)`, projected per track, so
  a branch can say *bars 17–24 in Guitar 1* without anyone declaring it;
- **whether a branch can land** — `mergeScores(ancestor, ours, theirs)`, whose
  conflict set is either empty or is the thing a human has to look at;
- **the merged score itself**, when the conflict set is empty — written back as
  an ordinary version through the same `commit-tree` / `update-ref` path
  `writeFirstVersion` already uses.

It gains no renderer and no playback. It never draws a note.

## Why not the companion

It would work, and it is where the parsing already happens. But it means the
merge runs only when the right machine is awake, on the branch author's
hardware rather than on the shared song's server, and *Accept* on the web
becomes a request rather than an act. Two people accepting at once would race
through two laptops instead of through one `update-ref` with an expected old
value — the same atomicity argument that `versions.ts` already makes for
imports.

## Why not in the browser

`hub-web` depends on neither `gpt-core` nor AlphaTab and stays a small app that
renders lists. Pulling a notation engine into it to compute a merge would put
the decision on whichever laptop happened to open the page, over a score it
would first have to download in full.

The renderer is a different question and gets a different answer: **the
companion resolves conflicts**, because resolving means hearing both options,
and `TabDiff`, the score stage and playback are already there. The hub's answer
to a conflict is a sentence — *bar 19, Guitar 1* — and a button that opens the
app.

## What this costs

**The hub's memory profile changes.** It currently streams; parsing a score
holds two or three full models in memory at once. Scores are small — the
storage measurement in ADR 0006 puts raw `.gp` in the hundreds of KB — but this
is the first thing in the hub whose cost scales with the *content* of what it
stores rather than the number of requests. Merges are rare and should be
serialised per score rather than run concurrently.

**AlphaTab becomes a production dependency of the server image**, alongside the
`git` binary. Its importer is the only part used; that should be asserted by a
test rather than assumed, because an accidental import of the renderer would
pull a DOM requirement into a process that has no DOM.

**A parse can fail on a file the hub did not write.** Every `.gp` in a
repository arrived from a companion, but Guitar Pro's format has versions and
AlphaTab's importer has limits. A branch whose tip will not parse must degrade
to "I can't read this one — open it in the app", never to a 500 and never to a
silently empty diff.

## The unknown worth naming

**`mergeScores` has never run outside its own tests.** This ADR authorises a
merge engine to write to the song a band plays.

So the first production use ships behind a dry run: compute the merge, report
what it *would* do, write nothing. Check it against real files from real
sessions. Only then let it commit. The engine being well-tested against an
oracle is not the same as it having ever been trusted, and the gap between
those two is exactly where a band loses a bridge.
