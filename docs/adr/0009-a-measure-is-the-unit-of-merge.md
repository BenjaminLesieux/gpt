# A measure is the unit of merge

[ADR 0008](0008-the-hub-parses-scores-and-merges-them.md) authorised the hub to
merge scores, and described `mergeScores` as note-level. It is: 587 lines that
three-way merge every field down to `note.leftHandFinger`.

That granularity is wrong. **The smallest thing a merge may resolve is one
measure in one track.** Either our bar 12 lands or theirs does.

## Why

The three-way rule is sound for independent values and the fields inside a bar
are not independent. `duration`, `dots`, tuplets and the note list are one
utterance about one span of time. Merge them separately and a rhythm change on
one side plus a fret change on the other merge *cleanly* into a bar neither
musician wrote — a confident wrong answer written into the shared song, where a
conflict would at least have been a question.

The unit a merge resolves has to be a unit somebody can listen to and judge.

## The code was already there

`mergeBar` compares three `barFingerprint`s first and returns in three cases of
four. The voice/beat/note descent runs only when both sides changed the same
bar — only on conflicts — and its result is used by nobody: `applyMerge` keeps
ours for conflicted bars by design, and `collectConflicts` flattens the tree to
a sentence. Decision 7 of `people-branches-and-proposals.md` already fixed that
sentence at *bar 19, Guitar 1*, because resolving means hearing both and that
happens in the companion.

Four hundred lines, computing something discarded on one path and truncated on
the other.

## What it buys beyond deletion

Insertion tolerance, which the note-level engine cannot have. `mergeTracks`
indexes tracks positionally and `mergeBar` indexes bars positionally, so one
inserted measure conflicts the rest of the song and a track reordered in Guitar
Pro merges the guitar into the drums.

[ADR 0002](0002-alignment-is-score-level-attribution-is-per-track.md) solved
both for the diff: score-level alignment over measure fingerprints, per-track
attribution, tracks paired by identity. Once a bar is an opaque token a track is
a sequence of lines and the merge is `diff3` — with `align.ts` already the hard
half of it. The merge stops being a second, worse implementation of alignment
beside a correct one.

## What it costs

Two sides editing different fields of the same bar now conflict, and so do two
sides editing different master-bar fields of the same measure. Both were
resolving into chimeras or near-chimeras. Conflict descriptions get coarser,
which nothing consumed.

The clean path — two people on two tracks, the band's common case — is
unchanged: it was already a fingerprint comparison.

## Refused

**Keeping the note-level merge behind a flag.** Two engines means two behaviours
to trust and the untrusted one is the fallback. ADR 0008 already says
`mergeScores` has never run outside its own tests; nothing is being preserved
here except code.

**Merging per voice inside a bar.** One measure of one instrument is one thing.
Revisit against a real two-voice file, not against a hypothetical.

See `docs/measure-level-merge.md` for the algorithm and the commit plan.
