# A band owns its songs; membership moves off the score

ADR 0007 gave a score members and deliberately stopped there: *scores owned by
a band, bands owning accounts* was named as the right shape eventually, and too
much for the first step. This is that step.

A **band** owns **songs** and **projects**. People are members of the band, not
of a score. A song has at most one score (the `.gp`) and any number of
recordings. Solo work is a band of one, and a person can be in several bands.
The terms are defined in [CONTEXT.md](../../CONTEXT.md).

## What forced it

Not a feature request this time either. A band losing track of its own work:

> We are really getting lost in the number of demos we have with the band,
> their state and advancement.

Picking songs for an EP, dropping one for the album, postponing another — none
of it can be said about a score. A score is a file. What a band picks is a
song, and a song can exist before anyone has tabbed it: a phone recording from
rehearsal is already a song. So the thing a project refers to has to sit above
the score, and something has to own both the songs and the projects that pick
from them. Per-score membership has no answer to *who can see this project*.

## Why a band and not the alternatives

- **Keep members per song, projects as lists.** Inviting the drummer means
  inviting them to every song, and a project can list songs some of its readers
  cannot open. The question 0007 deferred comes back on every screen.
- **Members per project.** A song in no project has no owner. Every idea that
  has not been picked yet — which is most of them — is homeless.
- **A personal space next to bands.** Two kinds of owner on every route, and
  moving a song from solo work into the band becomes a transfer. A band of one
  costs nothing and keeps one model.

0007's objection was that a band would have to exist before a solo musician
could save a file. It still does — it is simply created for them.

## What it reverses in 0007

- **Authorization moves again**, from `score_members` to band membership. The
  same broad, boring edit across every score route, with the same risk: a
  missed call site shows a song to the wrong person or hides it from the right
  one. The test is a member of one band pointed at a song of another band.
- **Invites are to a band.** The mechanism is unchanged — a link, sha256 of the
  code, single-use enforced by the write — only the thing joined changes.
- **The repository path is free to move.** 0007 refused to move repositories
  because it would rewrite clone URLs already pasted into companions. Nothing
  is deployed, so there are none. There is no migration: existing local data is
  thrown away rather than mapped onto bands.

`owner | member` survives on the band unchanged. Changing a song's standing in a
project, its stage, or shelving it is open to any member; every change records
who made it. Bands decide in the rehearsal room — the hub records the decision,
it does not run the vote.

## The companion stays a versioning tool

It learns one thing: when a `.gp` is shared for the first time, which band it
goes to and whether it is a new song or the score of an existing song that has
none yet. A file already linked to a song never creates another. Stages,
projects, recordings and shelving live in the hub only.
