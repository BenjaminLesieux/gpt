# Gitarpro

Version control for Guitar Pro scores, and the place a band keeps track of its
songs. Git handles the bytes; this context is about what a band is working on
and where each song stands, and about understanding what actually changed
*musically* between two versions of a score.

## Language

### Band lifecycle

**Band**:
The people who make music together, and everything they own: songs and
projects. Solo work is a band of one. A person can be in several bands.
_Avoid_: workspace, artist, team

**Member**:
A person in a band. Membership is to the band, not to any one song.

**Project**:
A goal a band picks songs toward: an EP, an album, a gig, a tour set. A song
can be considered for several projects at once. A project is **active** while
the band works toward it, **done** once released or played, **abandoned** if
the band gives up; a done or abandoned project is frozen as history, and its
candidates become postponed.
_Avoid_: release, setlist (those are kinds of project)

**Candidate**:
A song under consideration for a project, not yet decided.

**Selected**:
A song the band has decided belongs in a project.
_Avoid_: in, picked, kept

**Postponed**:
A song taken out of a project but wanted for a later one. It is suggested
again when the band builds its next project.
_Avoid_: deferred, on hold, paused

**Dropped**:
A song taken out of a project with nothing more to say. It says nothing about
other projects: the same song can be dropped from the EP and selected for the
album.
_Avoid_: discarded, rejected, deleted

**Song**:
A piece of music the band is working on, independent of any file or
recording of it. What a band picks, drops or postpones. Its name can change;
it stays the same song.
_Avoid_: track (that is one instrument's part), demo (that is a recording)

**Stage**:
How far along a song is, wherever it is used: Idea, Writing, Arranging,
Rehearsing, Finished. Set by the band, never inferred, and it can go back — a
finished song can be reopened.
_Avoid_: status (that is a song's standing in a project), progress, state

**Shelved**:
A song the band has given up on altogether, not just for one project. Kept
whole — score, recordings, history — and out of sight until unshelved.
Shelving drops it from every active project; unshelving puts it back in none.
Independent of its stage.
_Avoid_: archived, deleted, dropped (that is per project)

**Score**:
The Guitar Pro file of a song — what the band versions and shares. A song has
at most one; competing drafts are branches of it, not second scores.

**Recording**:
Audio of exactly one song being played, partly or fully real. A session that
covered five songs is five recordings. Never versioned — a new
take is a new recording, not a new version of an old one. Comes in two kinds:
a **maquette** (a rough mock-up, often the score's playback with some real
parts over it) and a **demo** (a real recording session).
_Avoid_: version (that is a score's), take

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
