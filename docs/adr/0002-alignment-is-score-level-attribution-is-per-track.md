# Alignment is score-level; attribution is per-track

Bar alignment used to run as an independent LCS per track. It now runs **once**
for the whole score, over a measure fingerprint (the `MasterBar` plus every
track's bar at that index), and every track inherits that skeleton. The verdict
`equal`/`changed` stays strictly per track — editing the bass leaves the guitar
unchanged.

## Why

alphaTab's `Score.finish()` pads every staff: `while (staff.bars.length <
score.masterBars.length) staff.addBar(...)`. **Every staff in a parsed score has
exactly `masterBars.length` bars.** Measure count is a property of the score,
never of a track — so "where was a measure inserted?" has exactly one true
answer, and per-track alignment could produce several.

Concretely: an 8-measure score where the bass has distinct measures and the
rhythm guitar has eight identical bars of one chord. Insert a measure at
position 3. The bass LCS says "measure 3 added"; the guitar LCS sees nine
interchangeable bars and says "measure 9 added". Same file, same edit,
contradictory answers — both painted over a single rendered score.

Score-level alignment is also *cheaper*: one LCS instead of N.

## Alignment is one concept applied at two scales

The same shape — longest common subsequence over fingerprints, with a tie-break
among equal-length alignments — is used at both levels. Only the tie-break
changes:

| Scale | Anchors on | Ties broken by |
|---|---|---|
| Measure | measure fingerprint | proximity to the index diagonal |
| Beat (within a bar) | beat fingerprint | proximity in **musical time** (`Beat.displayStart`, MIDI ticks) |

Beat-level pairing by index is wrong for any rhythm edit: replacing a quarter
with two eighths shifts every later index, reporting the rest of the bar as
changed. Pairing by tick alone is wrong the other way: inserting an eighth rest
at the start moves every beat to a new tick, reporting the whole bar as changed
when the readable answer is "one rest added". LCS with a tick tie-break gets both.

Voices pair by index (0–3 is a fixed role, not content) and notes within a beat
pair by string, or by percussion articulation on a kit. Neither needs alignment.

## Consequence we accept

A measure anchors only if **no** track changed in it. Rewriting one track end to
end in a many-track score leaves no anchors, degrading the alignment to
positional — still correct when nothing was inserted, but blind to an insertion
made in the same commit.
