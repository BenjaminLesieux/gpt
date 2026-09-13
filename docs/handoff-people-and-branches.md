# Handoff — people, branches and proposals

A brief for whoever picks this up next. It assumes you have read nothing.

**Read first, in this order:**

1. [ADR 0007 — a score has members; a token names a person](adr/0007-a-score-has-members-and-a-token-names-a-person.md)
2. [ADR 0008 — the hub parses scores, and merges them](adr/0008-the-hub-parses-scores-and-merges-them.md)
3. [people, branches and proposals](people-branches-and-proposals.md) — the
   full design, including everything that was refused and why
4. [ADR 0006 — the hub serves git itself](adr/0006-the-hub-serves-git-itself.md)
   — what 0008 extends

Do not start at item 3. The ADRs carry the decisions; the design doc carries
the detail, and detail without the decision behind it invites relitigating
settled ground.

---

## The one-paragraph version

A band is more than one person and the hub cannot say so: a score has a single
`accountId` and no members table. Tokens name machines, not people. The work is
to make a person the unit of identity, then record who pushed what, then let a
score have more than one line of work going at once, then let those lines come
back together — using the note-level merge engine that already exists in
`packages/gpt-core` and has never once been run in production.

## What is already done

`feat(hub): tell an issued token from a working one` — on branch
`feat/clone-from-the-web`. Migration `0003_token_activity` adds
`score_tokens.last_used_at` and `.last_pushed_at`, stamped in `git/routes.ts`;
`GET /scores` returns them; the score list draws only machines that actually
connected. **Do not redo this.** It is the fact everything below reads.

Its web half (`apps/hub-web/src/components/device-avatars.tsx`) draws one
square per *machine*, which ADR 0007 supersedes. It is deliberate interim work:
the component takes a list and renders squares with initials, so #13 replaces
what it is given rather than rewriting it.

## Non-negotiables

These are settled. If one looks wrong, say so before working around it.

- **Never invent a UI word for a branch.** The product owner calls them
  branches and so does the UI. Do not ship "arrangements", "takes" or
  "variants".
- **Pushing is not landing.** A branch collects versions and touches the song
  only when its author says it is done. Auto-merging every push puts
  half-formed ideas into what the band plays.
- **Clean merges need no review.** Two people on different tracks is the common
  case and it resolves by construction. Do not put an approval gate in front of
  "I added the bass part".
- **The hub reports conflicts; the companion resolves them.** Resolving means
  hearing both options. Do not pull AlphaTab into `hub-web`.
- **Track scope is derived from the diff, never declared.** A label someone
  typed is a claim; a diff is a fact, and this is the one place people look to
  stay out of each other's way.
- **`mergeScores` ships behind a dry run first.** See ADR 0008's last section.
- **Design rules hold**: dark only, 2px radii, no pills, no emoji, the accent
  rationed, shadcn variants named the shadcn way. `CLAUDE.md` and
  `docs/hub-ui-design-brief.md` are binding.

## Two traps that will cost you a day each

**The repository path belongs to the owner; the token belongs to a member.**
`git/routes.ts` compares the URL's account segment against `bearer.accountId`.
Once a score is shared those are different accounts. Splitting that comparison
wrong returns 403 on every shared score in one direction, and is a
cross-account hole in the other. ADR 0007 has the shape.

**`refs/heads/main` is hardcoded in three places across two languages** —
`NAMED_REF` in `apps/companion/src-tauri/src/git.rs`, `REMOTE_REF` in
`remote.rs`, and `NAMED_REF` in `apps/hub/src/git/versions.ts`. #17 is where
they get named once. Do not parameterise them piecemeal before then.

---

## The work

One commit per item, in this order, and each is a GitHub issue carrying the
same brief plus the traps specific to it — the issue is the prompt, this list
is the map. Milestones on the repo mirror the four headings below.

Each says what "done" means; none is finished without tests in the style
already in the file next to it (Given/When/Then, real git against real bare
repositories, no mocked child processes).

### Milestone: People

**[#10](https://github.com/BenjaminLesieux/gpt/issues/10) — `feat(hub): a score has members`**
`score_members(id, score_id, account_id, role, created_at)` with
`unique(score_id, account_id)`. Migration backfills an `owner` row for every
existing score. Authorization moves from `scores.account_id = me` to a
membership join **at every call site** — `scores/routes.ts`, `scores/import.ts`,
`scores/claims.ts`. No UI.
*Done when:* every existing test passes unchanged, plus new ones proving a
non-member gets the same 404 a stranger gets, and that the backfill leaves
every current score visible to its owner.
*Risk:* the highest of the set. A missed call site is a score someone loses, or
one they gain.

**[#11](https://github.com/BenjaminLesieux/gpt/issues/11) — `feat(hub): invite someone to a score`**
`score_invites(id, score_id, code_hash, invited_by, created_at, expires_at,
accepted_at)`. Build it as a deliberate sibling of `scores/claims.ts` — read
that file first and mirror it. Hashed code, single-use enforced by the UPDATE's
WHERE rather than read-then-write, `GET /invites/:code` peeks without
consuming, `POST /invites/:code` accepts and requires a session. Days, not
minutes, of expiry.
*Done when:* the race test from `claims.spec.ts` has a counterpart here — two
concurrent accepts produce one membership and one refusal.

**[#12](https://github.com/BenjaminLesieux/gpt/issues/12) — `feat(hub): a token belongs to a person`**
`score_tokens.account_id`, set when a clone claim is redeemed by a member.
Split the `git/routes.ts` comparison per ADR 0007.
*Done when:* a member of score A, holding a valid token, is refused at the
owner's sibling score B; and a shared score's member can push to it.

**[#13](https://github.com/BenjaminLesieux/gpt/issues/13) — `feat(hub-web): who a score is shared with`**
The invite dialog (mint link, copy it — no email field), the accept screen, and
the avatars showing people. Replace what `device-avatars.tsx` is *given*, not
how it draws. Initials from the email local part split on `.`, `_`, `-`.
*Done when:* a score shared with two people shows two squares, and a member who
has never opened the app shows as invited rather than absent.

### Milestone: Attribution

**[#14](https://github.com/BenjaminLesieux/gpt/issues/14) — `feat(hub): record who pushed what`**
`score_pushes(id, score_id, token_id, ref, old_oid, new_oid, pushed_at)`.
Written by the git route, not a `post-receive` hook — see the refusal in the
design doc. Oids and not messages: `git log old..new` at read time beats a
second copy of the history that can disagree with the first.

**[#15](https://github.com/BenjaminLesieux/gpt/issues/15) — `feat(hub-web): a score's own page`**
**There is no score detail route today** — `apps/hub-web/src/routes/` is auth,
authed, credentials, scores, and the list is the whole app. This is the surface
everything after it hangs on. Activity lands here.

### Milestone: Branches

**[#16](https://github.com/BenjaminLesieux/gpt/issues/16) — `feat(hub): list a score's branches`**
`GET /scores/:id/branches` over `refs/heads/*` with tips, last pusher, and the
derived track scope — `diffScores(base, tip)` projected per track. This is
where the hub first takes the `@gpt/gpt-core` dependency; ADR 0008 covers what
that costs and what must not come with it.
*Done when:* a tip that will not parse degrades to "can't read this one", never
a 500 and never a silently empty diff.

**[#17](https://github.com/BenjaminLesieux/gpt/issues/17) — `feat(companion): work on a branch`**
The large one, and all Rust. A current branch per tracked file; `commit_named`,
`fast_forward_named` and `read_score` parameterised on it; the push refspec
following it; the panel gets a switcher. Name the three `main` constants once.
*Done when:* the existing Rust suite passes with a branch other than `main` as
the parameter.

**[#18](https://github.com/BenjaminLesieux/gpt/issues/18) — `feat(hub-web): branches on the score page`**

### Milestone: Proposals

**[#19](https://github.com/BenjaminLesieux/gpt/issues/19) — `feat(hub): merge a branch when it is clean`**
`mergeScores` server-side, its first production use, behind the one deliberate
"I'm done" act. **Dry run first** — compute, report, write nothing — checked
against real files before it is allowed to commit. Write the result through the
same `commit-tree` / `update-ref` path `writeFirstVersion` uses, with an
expected old value so two accepts race into one merge and one refusal.

**[#20](https://github.com/BenjaminLesieux/gpt/issues/20) — `feat(hub-web): a branch that needs a decision`**
Conflicts listed as *bar 19, Guitar 1* plus a button that opens the app. No
notation in the browser.

**[#21](https://github.com/BenjaminLesieux/gpt/issues/21) — `feat(companion): resolve a conflicting bar`**
Where `TabDiff`, the score stage and playback already are.

---

## How to work

- `pnpm nx run hub:test`, `pnpm nx run hub-web:test`. Nx for every task; never
  the underlying tool directly.
- Migrations: `pnpm nx run hub:db-generate`, then **rename** the file drizzle
  invents and update `meta/_journal.json` to match — the repo's tags are
  descriptive (`0003_token_activity`), not `0003_remarkable_robbie_robertson`.
- New shadcn primitives: from `packages/ui`, never from an app. The CLI writes
  `import { cn } from "cn"` and installs that package — **this is correct**.
  `cn` is shadcn's own zero-dependency replacement for `clsx + tailwind-merge`,
  and `packages/ui/src/lib/utils.ts` re-exports it. Rewrite the CLI's `cn`
  import to `../../lib/utils` only to match the components already there.
- Commit per item above, message in the repo's voice — lowercase, what it does
  for the person using it, not what it does to the code.
