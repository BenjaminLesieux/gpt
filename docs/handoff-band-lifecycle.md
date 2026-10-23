# Handoff — the band lifecycle

A brief for whoever picks this up next. It assumes you have read nothing.

**Read first, in this order:**

1. [CONTEXT.md](../CONTEXT.md), *Band lifecycle* — the words. Song, Score,
   Recording, Stage, Shelved, Candidate/Selected/Postponed/Dropped mean exactly
   what it says, and the *Avoid* lists are binding in code and copy.
2. [ADR 0012 — a band owns its songs](adr/0012-a-band-owns-its-songs.md)
3. [ADR 0013 — recordings are uploaded to the hub](adr/0013-recordings-are-uploaded-to-the-hub.md)
4. [The band lifecycle](band-lifecycle.md) — the design, decision by decision
5. [ADR 0007](adr/0007-a-score-has-members-and-a-token-names-a-person.md) —
   what 0012 partly supersedes, and the owner/holder trap that decision 1 of
   the design dissolves

The decisions were settled in a grilling session with the owner. Do not
relitigate them; if the code contradicts one, stop and ask.

---

## The one-paragraph version

The hub's top-level thing is a score, with members of its own. It becomes a
**band** that owns **songs**; a song has at most one score and any number of
**recordings** (uploaded audio, never versioned). A band picks songs for
**projects** (an EP, a gig) where each song is a candidate, selected, postponed
or dropped. A song has a hand-set **stage** and can be **shelved**. Any member
can change any of it, and every change is recorded with who made it.

## Where the seams are

- Authorization is three queries: `readMemberScore` and `listMemberScores` in
  `apps/hub/src/scores/members.ts`, and `readScoreToken` in
  `apps/hub/src/scores/tokens.ts`. Move their joins; leave their call sites.
- The git route's path check is one line in `apps/hub/src/git/routes.ts`.
- Raw-body upload already exists in `apps/hub/src/scores/import.ts`; recordings
  stream rather than buffer, but follow its shape.
- The score page (`apps/hub-web/src/routes/score.tsx`) becomes the song page's
  score section. Reuse its components.

## Not deployed, so no migration

Delete your local `hub.sqlite` and `git-repos/` after the first commit lands.
New migrations are additive drizzle migrations as usual; there is no backfill.

## Work order

The milestone **Band lifecycle** on GitHub, one issue per commit, in the order
listed in §4 of the design. Hub before web at every step.
