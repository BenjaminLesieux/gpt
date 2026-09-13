# A score has members; a token names a person, not a machine

A score belongs to one `accounts` row. It is reached with tokens, and a token
names a device — `Ben's MacBook`, minted per machine because
[cloning to a second computer cannot re-send the first one's credential](../clone-from-the-web-and-updating.md).
There is no members table, no sharing, and no second account that can ever
touch a score.

That stops being true. A score gains members, a token gains an `account_id`,
and authorization moves off `scores.account_id`.

## What forced it

Not a feature request. A question about an avatar.

The score list had a column headed *Set up on*, rendering `score_tokens`. It
was wrong — `POST /scores` mints a token in the same statement as the score
row, so a score claimed to be on a computer the instant it was named. Fixing it
meant recording *use* rather than *issuance*, which gave the hub, for the first
time, a real answer to "which machines have this score".

The obvious next step was an avatar per machine. Put to the question — *why a
device, can't we just show who pushed?* — the answer was that there is nobody
to show. "Who pushed" resolves to the score's owner, on every push, forever.
One face, permanently.

But the question was asked in these words:

> I could work on adding the bass while **my drummer** works on adding the drums.

The drummer is a second person and the product had no way to be one. They would
have to log in as the owner — at which point they are a device again, and the
device avatar was a correct answer to the wrong model.

The avatar is not why this matters. It is the first place the missing primitive
became visible.

## Why a members table and not a second owner column

The alternatives were considered and are worse:

- **A shared band login.** Costs nothing and is what people would do anyway.
  But everyone can revoke everyone, there is no authorship to attribute a push
  to, and "who changed bar 19" degrades to guessing from a machine's hostname.
  It makes the identity question permanently unanswerable rather than deferring
  it.
- **Scores owned by a band, bands owning accounts.** The right shape eventually,
  and too much for the first step: it forces a band to exist before a solo
  musician can save a file, and every existing score would need a band invented
  for it.

Membership is the smallest thing that makes a second person real:

```
score_members(id, score_id, account_id, role, created_at)
  unique(score_id, account_id)
```

Roles are `owner | member`. `owner` buys removing people and deleting the
score, and nothing else, until something needs more.

## The cost, stated plainly

**Every score route's authorization changes.** `scores.account_id = me` becomes
a join. It is a broad, boring edit across every call site and it is the whole of
this decision's risk: a missed one is a score its owner can no longer see, or —
in the other direction — one they should not.

The migration backfills an `owner` row for every existing score, so nothing
that works today stops working.

## An invite is a link, because nothing sends email

The hub has no mailer. Signup has no verification; the design brief put it out
of scope and it stayed there. So an invite cannot arrive by email — it is a
link the inviter copies and sends however they already talk to their band.

This is not a workaround, it is `clone_claims` again, and it should be built as
a deliberate sibling of that table rather than as a new idea: the row holds
`sha256(code)` and never the code, single-use is enforced by the write rather
than a read-then-write, and peek and accept are separate endpoints so a
confirmation screen can name the score before anyone agrees to anything.

It differs in one way. A clone claim expires in five minutes because it is
fired at an app on the same machine. An invite is sent to a drummer who may be
asleep, so it lives for days.

**Refused: inviting by typing an email address.** Without a mailer that creates
a row addressed to someone who is never told. A pending invite nobody can see
is worse than no invite. The link *is* the message.

## The trap: the path belongs to the owner, the token belongs to a member

A repository lives at `<owner-account>/<score>.git` — `repositoryPath` builds
it and `createRepository` made it there. `git/routes.ts` authorises with one
comparison:

```ts
if (account !== bearer.accountId || repo !== `${bearer.scoreId}.git`)
```

For a shared score those two accounts are **different**. The URL segment is the
owner's; the token is the drummer's. That single comparison has to become two
separate facts:

- *this token's score is the one stored at this path* — against the score's
  **owner**;
- *this token belongs to a member of that score* — against the token's
  **account**.

Conflating them in one direction returns 403 on every shared score. In the
other it is a cross-account hole. `readScoreToken` should return both ids under
names that cannot be swapped by accident, and the test for it should be a
member of one score pointed at a sibling score in the owner's namespace.

**Refused: moving repositories under a score id to make the problem vanish.**
It would rewrite every clone URL already pasted into a companion. The paths
stay; the comparison gets careful.

## Identity is an email until someone types a name

`accounts` has an email and no display name, so initials come from the local
part split on `.`, `_` and `-` — `ben.lesieux@…` gives `BL`. The tooltip
carries the full address, so an ambiguous pair is never a mystery. A real
`display_name` is a later one-column migration; the avatar component takes a
person rather than an email so that it is the only thing that changes.

Squares at 2px, never circles, and no photographs ever: there is no upload, and
a gravatar would mean a third-party request from a page that currently makes
none.

## What this unblocks

Everything in [people, branches and proposals](../people-branches-and-proposals.md).
A branch that says *Sam is on the drums*, a push history that says who, and a
proposal that can be addressed to somebody all need a person to exist first.
This is why that work does not start with branches.
