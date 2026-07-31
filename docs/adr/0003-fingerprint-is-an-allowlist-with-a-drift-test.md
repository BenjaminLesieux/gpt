# The fingerprint is an allowlist, guarded by a drift test and a byte backstop

A fingerprint decides whether two bars are the same. It enumerates the fields
that matter (an allowlist) rather than serializing everything and excluding noise
(a denylist). Two guards compensate for the allowlist's failure mode.

## Why an allowlist

alphaTab's model carries fields computed by `Score.finish()` — `Beat.displayStart`,
`playbackStart`, `Bar.isEmpty`, `Note.realValue` — plus back-references
(`bar.staff`, `beat.voice`) and ordinals (`id`, `index`). A denylist that
included the computed fields would report every bar after any rhythm edit as
changed, which is the same class of bug the `SILENT` voice collapsing exists to
fix. A denylist moves the maintenance burden rather than removing it.

alphaTab's own `BarSerializer`/`BeatSerializer`/`NoteSerializer` are not an
option: the `alphaTab.json` export barrel is empty in 1.8.2, so they are internal
and unversioned.

## Guard 1 — the drift test

An allowlist fails **silently**: a field alphaTab adds is a change we never see,
reported as "No changes". For a version control tool that is not an ergonomic
defect, it is data loss from the user's point of view. Version 1.8 already showed
this — `Bar.clef`, `keySignature`, `simileMark`, `barLineLeft/Right`,
`sustainPedals`, `MasterBar.section`, `tempoAutomations`, `directions`,
`fermata` were all invisible.

So a test reflects over the model's runtime fields (`Object.keys` on a fresh
instance plus prototype getters) and fails in CI when a field appears that the
fingerprint does not mention. The silence becomes a loud failure, at the moment
of the alphaTab upgrade rather than in a user's repository.

**Between two failure modes, choose the one you can see.**

## Guard 2 — the byte backstop

No fingerprint over the model can see a change confined to what alphaTab does
not import (`LayoutConfiguration`, `PartConfiguration`, `BinaryStylesheet`,
opaque `XProperty` values — see [0001](./0001-diff-against-the-alphatab-model-not-the-gpif-xml.md)).

Therefore we never claim "no changes" on the authority of the semantic diff
alone. When `normalizeGp(base) !== normalizeGp(head)` and the diff is empty, we
report an uninterpretable modification instead. `normalizeGp` already neutralises
zip timestamps and `EditingDate`, so a plain re-save does not trigger it.
