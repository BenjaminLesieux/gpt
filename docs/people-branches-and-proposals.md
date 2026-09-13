# People, branches and proposals

Three features that turned out to be one, discovered in that order and in the
wrong order. The thread: **a band is more than one person, and nothing in the
hub could say so.**

Part 0 is built. Parts 1–4 are designed here and not built.

---

# 0. What the score list was claiming — built

`POST /scores` mints a token in the same statement as the score row. The score
list rendered `tokens` under a column headed *Set up on*. So a score announced
that it was set up on a computer **the instant it was named**, before any app
existed, before anyone had clicked anything.

The bug looks like a missing check — *is this claim redeemed yet?* — and the
first instinct is to add one. That instinct is wrong twice over. Redemption
happens for cloning and not for creating or importing, so a check would fix one
of three paths; and redemption still only means a credential left the building,
not that a score reached a machine. Decision 5 in
`clone-from-the-web-and-updating.md` already records that `adopt` can fail
*after* the token exists.

The column was displaying **issuance** and being read as **installation**.
Those are different facts and the hub only had the first one.

## Decision 0 — record use, not issuance

Two nullable stamps on `score_tokens`, migration `0003_token_activity`:

- `last_used_at` — this credential authenticated something. The score is on
  that machine.
- `last_pushed_at` — this credential completed a `git-receive-pack`. Somebody
  is working on it.

Written in `git/routes.ts`, the one place that knows a token was really used,
throttled to a minute for connections because one push is several requests and
`push.rs` retries on a backoff. A push is never throttled: every push begins
inside the window a throttle would cover, and it is the only event that
matters.

Stamped *before* the proxy, not after, because `proxyToGit` hijacks the reply
and streams — there is no completion to hang it off without reaching into the
CGI's exit. The cost is that a push failing inside receive-pack still counts as
activity, which is true; somebody tried. The cost of being late would be
dropping the stamp whenever a client hangs up.

**Refused: a `post-receive` hook.** The more precise instrument — git hands it
exactly what moved, atomically, only on success — but it is a second process
needing either database access or an internal endpoint, and every repository
created before it existed would need backfilling. It stays the upgrade, not the
starting point. Same reasoning as the sketch in the clone doc.

---

# 1. People

## What forced it

The column now knows which *machines* have a score, so the obvious next step
was an avatar per machine. Put to the question — *why a device, can't we show
who pushed?* — the answer is that there is nobody to show. A score has one
`accountId`. There is no members table, no sharing, no second account that can
ever touch it. "Who pushed" resolves to the owner, on every push, forever.

But the question was asked in these words: *I could work on adding the bass
while **my drummer** works on the drums.* The drummer is a second person, and
the product had no way to be one. They would have to log in as you — at which
point they are a device again, and the device avatar was the right answer to
the wrong model.

So people are not a feature that comes after branches. They are the thing
branches are *for*, and everything below assumes them.

## Decision 1 — a score has members, and the owner is one of them

```
score_members(id, score_id, account_id, role, created_at)
  unique(score_id, account_id)
```

Every existing score gets an `owner` row in the migration. Authorization stops
being `scores.account_id = me` and becomes a join against this table. That is a
broad, boring change across every score route, and it is the whole of the
feature's risk: a missed call site is a score someone can no longer see, or
worse, one they can.

Roles start at `owner | member` and the only thing `owner` buys is removing
people and deleting the score. Resist more until something needs it.

## Decision 2 — an invite is a link, because there is no mailer

Nothing in the hub sends email. Signup has no verification; the design brief
put it out of scope and it stayed there. An invite therefore cannot arrive by
email — it is a link the inviter copies and sends however they already talk to
their band.

This is not a compromise, it is the `clone_claims` pattern again, and it should
be built as a deliberate sibling of it rather than as a new idea:

```
score_invites(id, score_id, code_hash, invited_by, created_at, expires_at, accepted_at)
```

- the row holds `sha256(code)` and never the code;
- single-use enforced by the write — `UPDATE … WHERE code_hash = ? AND
  accepted_at IS NULL` and a check that one row changed;
- `GET /invites/:code` peeks and names the score without consuming anything,
  so the accept screen can say *join "Blackbird"?* before anyone agrees;
- `POST /invites/:code` accepts, and requires a session — an invite adds an
  account to a score, so the accepter must be an account first.

Longer-lived than a clone claim: five minutes is right for a link fired at an
app on the same machine, and wrong for one sent to a drummer who is asleep.
Days, not minutes.

**Refused: invite by typing an email address.** Without a mailer it would
create a row addressed to someone who is never told, and a pending invite
nobody can see is worse than no invite. The link is the message.

## Decision 3 — a token belongs to a person, and the path still belongs to the owner

`score_tokens` gains `account_id`. This is what makes attribution possible at
all: a push carries a token, the token names a member, the member is a person
with a face.

The trap is in `git/routes.ts`. A repository lives at
`<owner-account>/<score>.git` — `repositoryPath` builds that path and
`createRepository` made it. Today the route authorises with:

```ts
if (account !== bearer.accountId || repo !== `${bearer.scoreId}.git`)
```

For a shared score those two accounts are **different**: the URL segment is the
owner's, the token is the drummer's. That single comparison has to become two
distinct facts — *this token's score lives at this path* and *this token
belongs to a member of that score* — and confusing them in either direction is
a cross-account hole rather than a bug. `readScoreToken` should return the
score's owner id for the path check and the member's id for attribution, named
so they cannot be swapped by accident.

**Refused: moving repositories under a band or score id.** It would make the
path question disappear, and it would rewrite every clone URL already pasted
into a companion. The paths stay; the comparison gets more careful.

## Decision 4 — initials come from the email until someone types a name

`accounts` has an email and no display name. `ben.lesieux@gmail.com` yields
`BL` by splitting the local part on `.`, `_` and `-`. Good enough to ship, and
the tooltip carries the full address so an ambiguous pair is never a mystery.
A real `display_name` is a later, trivial migration; the avatar component
should take a person, not an email, so that it is the only thing that changes.

Squares, not circles — 2px radius, per the design rules. No photographs, ever:
there is no upload, no gravatar, and adding one would mean a third-party
request from a page that currently makes none.

---

# 2. What a branch is here

Two examples, given unprompted, and they are not the same shape:

1. **"I add the bass while my drummer adds the drums."** Two people, different
   tracks, both meant to land. Nobody needs to approve anything — they just
   need to not overwrite each other.
2. **"I suggest a new chorus."** Same material, and it wants a yes or a no.

Neither is the long-lived *live arrangement vs studio arrangement* the clone
doc speculated about. Both come back to the song. So this is **one concept with
one state**, not two objects, and the vocabulary stays the one already in use:
a branch, named after what it is for — *Bass line*, *New chorus*.

## The fact that makes this cheap

`packages/gpt-core` already contains a note-level three-way merge — `mergeScores`
→ `applyMerge`, with a conflict sidecar — and a bar-level diff with per-track
attribution. The merge is spec'd and wired to **nothing**. `packages/alphatab-react`
has `TabDiff`, which renders a real before/after.

Run example 1 through `mergeScores` and every bar resolves *by construction*:
for each drum bar `base == ours` so it takes theirs, for each bass bar
`base == theirs` so it takes ours. The clean case is not hoped for, it is
guaranteed by the shape of the edit. The engine's best case is the band's
common case.

And `packages/gpt-core/vite.config.mts` sets `environment: 'node'`, with
`diff.integration.spec.ts` parsing a real four-track `.gp` through
`importer.ScoreLoader.loadScoreFromBytes`. **The hub can parse, diff and merge
scores server-side today.** No browser, no new runtime, no headless anything.
That is what lets a web *Accept* button do the work instead of recording an
intention for someone's laptop to honour later.

## Decision 5 — a branch's track scope is derived, never declared

Nobody picks a track when starting work. The hub parses the branch tip, diffs
it against the base, and reads off which tracks were touched. Always true,
never stale, and no question asked at the moment somebody wants to get back to
playing.

The cost is that a branch with no pushes yet shows nothing, which is honest —
nothing has happened. A declared intent would show something, and it would be a
claim rather than a fact: you say bass, then fix a wrong note in the guitar,
and the label is now lying in the one place people look to stay out of each
other's way.

This is what pays for the whole feature in the UI: *Ben is on Bass, Sam is on
Drums, these don't overlap.*

## Decision 6 — pushing is not landing

A branch collects versions. None of them touch the song until its author says
they are done. Auto-merging every push would put *try the 7th* — a half-formed
idea, pushed because pushing is automatic here — straight into what the band
plays.

So there is one deliberate act, and the panel makes it one tap. On it:

- **merges cleanly** → it lands, immediately, with nobody reviewing anything.
  This is example 1, and it is the common case.
- **conflicts** → it stops and becomes something needing a decision, and the
  hub names who has to make it.

A branch can also be marked *ask the band first* at any point, which makes it
wait even when clean. That is example 2, and it is deliberately not a question
asked at creation time: you rarely know at the first note whether you are
adding a part or suggesting one, and a radio button at that moment is friction
on the path that does not need it.

## Decision 7 — the hub reports the conflict, the companion resolves it

The hub computes the merge either way, so it can always say exactly what
conflicts and where: *bar 19, Guitar 1*. What it does not do is ask someone to
choose, because choosing means hearing both, and the companion already has
`TabDiff`, the score stage and playback. The hub's answer to a conflict is a
sentence and a button that opens the app.

This also keeps alphaTab out of `hub-web`, which today depends on neither it
nor `gpt-core` and stays a small web app that renders a list.

**Refused: refusing conflicts outright** — *the song moved on, redo it*. Zero
conflict UI, and it throws away the merge engine's entire reason for existing
at exactly the moment it becomes useful.

---

# 3. What this costs, in order

Each line is a commit. The first four are the prerequisite nobody asked for and
everything needs.

**People**

1. `feat(hub): a score has members` — `score_members`, owner rows backfilled,
   authorization moved off `scores.account_id` at every call site. No UI. The
   risky one; it wants the fullest test pass of the set.
2. `feat(hub): invite someone to a score` — `score_invites`, peek and accept as
   separate endpoints, the sibling of `claims.ts` and written to look like it.
3. `feat(hub): a token belongs to a person` — `score_tokens.account_id`, and
   the `git/routes.ts` comparison split into owner-path and member-identity.
4. `feat(hub-web): who a score is shared with` — the invite dialog, the accept
   screen, and the avatars finally showing people.

**Attribution**

5. `feat(hub): record who pushed what` — `score_pushes(id, score_id, token_id,
   ref, old_oid, new_oid, pushed_at)`. Oids, not messages: the repository is
   authoritative and `git log old..new` at read time beats a second copy of the
   history that can disagree with the first.
6. `feat(hub-web): a score's own page` — there is no score detail route at all
   today; the list is the whole app. Activity lands here, and so does
   everything below it.

**Branches**

7. `feat(hub): list a score's branches` — `refs/heads/*` with tips, last
   pusher, and the derived track scope from Decision 5.
8. `feat(companion): work on a branch` — the large one, and all Rust:
   `NAMED_REF` in `git.rs`, `REMOTE_REF` in `remote.rs`, a current branch per
   tracked file, `commit_named` / `fast_forward_named` / `read_score`
   parameterised, and the push refspec following it.
9. `feat(hub-web): branches on the score page`.

**Proposals**

10. `feat(hub): merge a branch when it is clean` — `mergeScores` server-side,
    its first production use, behind the one deliberate act from Decision 6.
11. `feat(hub-web): a branch that needs a decision`.
12. `feat(companion): resolve a conflicting bar`.

## Known unknowns

- **`mergeScores` has never run outside its own tests.** Commit 10 is where a
  merge engine starts writing to the shared song. It should land behind a
  dry-run that reports what it *would* do, checked against real band files,
  before it writes anything.
- **`writeFirstVersion` seeds `main`** and the constant is duplicated in three
  places across two languages. Commit 8 is the moment to name it once.
- **Adoption takes `main`.** It would take a branch, defaulting to `main`, and
  the clone flow's save dialog will have to say which branch it is
  materialising — a question the existing peek response can already answer
  without spending the claim.
