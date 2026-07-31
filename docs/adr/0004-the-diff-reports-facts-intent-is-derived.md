# The diff reports facts; intent is a derived layer

`ScoreDiff` contains only **changes** — precise, verifiable facts ("this note's
fret went 14 → 12"). Legible readings such as "a chord was modified" or "this
passage moved up a semitone" are **intent**, computed *from* the changes by a
separate layer in `gpt-core`. Intent is never stored in place of the facts it
summarises.

## Why derived, not stored

"Four notes changed on one beat = a chord changed" is a heuristic, not a truth.
It fails immediately on:

- four notes changed on a beat that previously held one — that is a note
  becoming a chord;
- four notes changed across four consecutive beats — that is a melodic line;
- four notes changed on a percussion beat — that is a drum pattern.

Heuristics get corrected. If the reading lives *in* the model, every correction
is a breaking type change, and tests for "did the diff see the right note?"
become entangled with tests for "how do we phrase it?". Derived, the two are
tested separately and the phrasing can change without touching the algorithm.

Intent lives in `gpt-core`, not in each consumer: the CLI and the UI need the
same sentences, it is testable without a DOM, and duplicating it guarantees
divergence.

## Chord naming

The intent layer names chords from the explicit chord symbol when the file has
one (`Beat.chordId` → `Staff.chords` → `Chord.name`), and otherwise infers from
pitch. `Note.realValue` already yields MIDI with tuning, capo,
`transpositionPitch` and harmonics applied, so inference starts from a set of
integers rather than fretboard arithmetic.

Three rules constrain the inference:

- **Scope is the beat, within its track.** Attribution is per-track
  ([ADR 0002](./0002-alignment-is-score-level-attribution-is-per-track.md)) and
  intent derives from changes, so intent is per-track too. Cross-track harmony —
  a guitar's `[C, E, G]` over a bass `A` is really `Am7` — is *score analysis*,
  not diffing: it is meaningful with no second version to compare, which is the
  sign it belongs elsewhere. It would also produce intents attached to bars
  marked `equal`.
- **Never guess.** A name is emitted only when the pitch set determines one.
  `[C, G]` is a power chord with no third and therefore no quality; `[C, E, G♯]`
  is equally `C+`, `E+` and `A♭+`. Where the set is undetermined, the layer falls
  back to the precise fact underneath — which always exists, by construction. A
  namer that always answers is a namer nobody trusts.
- **Spell against `Bar.keySignature`, ignore inversions.** In E major,
  `[C♯, F, G♯]` is `C♯m`, not `D♭m` — an exact rule, not a heuristic. And no slash
  chords: within one track, the lowest note of a guitar voicing says nothing
  about the actual bass.
