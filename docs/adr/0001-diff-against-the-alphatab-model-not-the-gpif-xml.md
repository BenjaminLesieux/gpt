# Diff against the alphaTab model, not the gpif XML

`.gp`/`.gpx` files are zip containers holding `Content/score.gpif`, an XML file.
It is tempting to diff that XML directly — it is the authoritative, lossless
source, and it would seem to hand us element-level granularity for free. We
looked, and decided against it: the semantic diff runs on alphaTab's imported
model.

## Why

The gpif is not a musical tree. It is a **deduplicated object pool with integer
references**:

```xml
<MasterBar>    <Bars>0 1 2 3</Bars>
<Bar id="0">   <Voices>0 -1 -1 -1</Voices>
<Voice id="0"> <Beats>0 1 2 1 3 0 3 4</Beats>
```

Measured on `packages/gpt-core/src/__fixtures__/sample.gp`: 99 distinct `<Beat>`
objects carrying 907 references — a 9.16× reuse factor — and 17 distinct voice
contents shared across 79 voices. Beat `1` appears twice inside voice `0` alone.

Consequences that kill the idea:

- **No positional identity exists in the XML.** "The 2nd beat of measure 5" has
  no element of its own; it shares an object with dozens of other positions. The
  XML can only say "pool object 1 changed", which implicates 907 sites.
- **`id` attributes are serialization ordinals, not identities.** Inserting a
  note can renumber the whole pool — a huge XML delta for a tiny musical one.
  Conversely, editing a shared beat forces Guitar Pro to split it into a new
  object and repoint references, so the XML delta has no shape relationship to
  the musical delta.
- **`.gp3/.gp4/.gp5` are binary** and contain no XML at all, yet are supported.
  We would maintain two diff engines.
- The format is proprietary and undocumented (`<XProperty id="1124139010">`).

The inverted conclusion is the important one: **alphaTab's granularity is better
than the XML's**, because the importer's job is precisely to dereference this
pool into a tree where every beat has a position. That is value we would be
throwing away. It is also consistent with `docs/normalize-gp.md`, which already
established that the byte/XML layer is noisy.

## Consequence we accept

alphaTab does not import everything — `LayoutConfiguration`, `PartConfiguration`,
`BinaryStylesheet`, opaque `XProperty` values. No fingerprint over the model can
ever see a change confined to those. We therefore never claim "no changes" on
authority of the semantic diff alone: when `normalizeGp(base) !== normalizeGp(head)`
but the diff is empty, we report an uninterpretable modification. See
[0003](./0003-fingerprint-is-an-allowlist-with-a-drift-test.md).
