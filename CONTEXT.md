# Gitarpro

Version control for Guitar Pro scores. Git handles the bytes; this context is
about understanding what actually changed *musically* between two versions of a
score, and showing it to a musician.

## Language

### Score structure

**Measure**:
A temporal slot shared by every track in the score — "the 3rd measure of the
song". Its count is a property of the score, not of any track.
_Avoid_: bar (when the score-wide slot is meant)

**Bar**:
One track's content within one measure — "the bass bar of measure 3". Every
track has exactly one bar per measure.
_Avoid_: measure (when a single track's content is meant)

### Diffing

**Alignment**:
The correspondence between base measures and head measures — which measure of
the old version is which measure of the new one. A property of the score:
computed once, shared by every track.
_Avoid_: matching, pairing, mapping

**Attribution**:
The verdict that a given track's bar did or did not change within an aligned
measure. Independent per track: editing the bass leaves the guitar unchanged.

**Anchor**:
An aligned measure that both versions agree is identical, used to pin the
alignment. Runs between anchors are resolved positionally.

**Fingerprint**:
The canonical summary of a musical element that decides whether two versions of
it are the same. Deliberately blind to how Guitar Pro happened to spell it — a
silent bar is silent however its rests are subdivided.

**Change**:
A precise, verifiable fact about one element: this note's fret went from 14 to
12. The diff reports only changes.

**Intent**:
A reading of one or more changes at a more legible altitude — "a chord was
modified", "this passage moved up a semitone". Always *derived* from changes,
never stored in their place, so it can never contradict them.
_Avoid_: interpretation, summary
