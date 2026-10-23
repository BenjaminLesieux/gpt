# The band lifecycle

A band losing track of its own work:

> We are really getting lost in the number of demos we have with the band,
> their state and advancement.

The hub can version a score and say who changed bar 19. It cannot say which
songs the band is working on, which ones are going on the EP, or where the
recording from last Tuesday went. This is the design for that. Nothing here is
built.

**Read first:** [ADR 0012 — a band owns its songs](adr/0012-a-band-owns-its-songs.md)
and [ADR 0013 — recordings are uploaded to the hub](adr/0013-recordings-are-uploaded-to-the-hub.md).
Every term in bold is defined in [CONTEXT.md](../CONTEXT.md); use those words
in code, copy and commits, and none of the ones listed under *Avoid*.

The hub is where all of this lives. The companion stays a versioning tool.

---

# 1. The model

```
Band ──< Member >── Account
 │
 ├──< Song ── stage, shelved?
 │     ├── Score (0..1)       the .gp, a git repository
 │     └──< Recording         audio, maquette | demo
 │
 └──< Project ── active | done | abandoned
       └──< (Song, status)    candidate | selected | postponed | dropped
```

Three facts about a song, kept apart on purpose:

| Fact | Belongs to | Set by |
|---|---|---|
| **Stage** — Idea … Finished | the song | hand, any member |
| Status in a project | the song *within* that project | hand, any member |
| **Shelved** | the song | hand, any member |

None is inferred from another. Having a demo does not make a song *Finished*;
being *Selected* for the EP says nothing about the album. The two overlaps are
written transitions, not derivations — see decisions 6 and 7.

---

# 2. Decisions

## Decision 1 — the repository lives under its band

`<band>/<score>.git`, replacing `<owner-account>/<score>.git`.

ADR 0007's trap was that the path segment named one account and the token named
another. Under a band the two facts become the natural pair: *this repository
is stored under band B* and *this token's holder is a member of band B*. The git
route compares `account` against `bearer.bandId` instead of `bearer.ownerId`;
nothing else about it changes.

The URL keeps two segments, so `hub_score` in the companion's `hub.rs` parses it
unchanged — the segment it calls `owner` is now a band id, and it never read it.

**Refused: a flat `<score>.git`.** It removes the comparison altogether, but it
changes the URL's shape and therefore the companion, for no gain over a segment
that is already validated against the same opaque-id charset.

No migration: nothing is deployed. A developer's local `hub.sqlite` and
`git-repos/` are deleted, not mapped.

## Decision 2 — membership is to the band, behind the same two functions

`band_members(id, band_id, account_id, role, created_at)`, unique on the pair,
roles `owner | member` exactly as `score_members` had them. `score_members` is
dropped.

Every score route already asks `scores/members.ts` — `readMemberScore` and
`listMemberScores` — and `readScoreToken` in `scores/tokens.ts`. Those three
queries change their join from `score_members` to `band_members` through
`scores.band_id`; their call sites do not. That is the whole authorization
change, and why it is safe: the seam was built for exactly this.

`MemberScore.ownerId` becomes `bandId`. Renaming it, rather than leaving an
`ownerId` that holds a band id, is what makes every path-building call site fail
to compile until someone looks at it.

The test that matters: a member of band A, holding a valid token for a score in
A, pointed at a score in band B — through the JSON API and through `/git`.

## Decision 3 — signup makes a band of one

`POST /auth/signup` creates the account, a band named after the email's local
part, and an `owner` membership, in one transaction. A solo musician never sees
the word *band* until they invite somebody, and the band can be renamed.

A person in several bands switches between them in the header. The web app
remembers the last band in `localStorage`; nothing server-side needs a
"current band".

## Decision 4 — invites join a band

`score_invites` becomes `band_invites`: same columns with `band_id` for
`score_id`, same sha256-of-the-code, same single-use-by-the-write, same
peek/accept split. `POST /bands/:id/invites`, and `/invites/:code` keeps its
path. The join screen names the band instead of a score.

## Decision 5 — a song is a row; a score belongs to at most one

```
songs(id, band_id, name, stage, shelved_at, created_at)
scores(id, band_id, song_id UNIQUE, created_at)
```

`scores.name` moves to `songs.name` — a song is renamed, its score follows.
`scores.band_id` is kept beside `song_id` although it is derivable, because it
is the repository path's first segment and every git request reads it; a join
on the hot path to save one column is the wrong trade. Songs never change band,
so the two cannot drift.

A song with no score is ordinary: it is what a band has after a phone recording
and before anybody tabs it.

**Where a score is born.** Today a score is created on the hub — *Create score*,
or *Import* which composes create + import — and the companion adopts it. That
stays. The hub's *New song* dialog creates the song in the band you are looking
at, optionally with a file; a scoreless song's page offers *Add a score* (empty,
or import a `.gp`), which creates the score for that song and never a second
song. A score already attached to a song is never offered again: `song_id` is
unique.

When the companion learns to create scores itself (after the companion account,
#32), its share dialog must make the same offer — band, then *new song* or a
scoreless song of that band. Until then the companion needs nothing new; #34's
list should group by band.

The existing `/scores/:id/*` routes — history, branches, land, versions, token —
keep their paths. The companion already calls them.

## Decision 6 — a project's statuses, and the one written transition

```
projects(id, band_id, name, kind, status, created_at, closed_at)
project_songs(project_id, song_id, status, updated_by, updated_at)  PK(project_id, song_id)
```

`kind` is optional free text — *EP*, *gig* — and drives nothing. `status` is
`active | done | abandoned`. A song's row exists only once it has been added;
a song with no row has no status in that project.

Any member may move a song between `candidate | selected | postponed | dropped`
in an active project, in any direction. A done or abandoned project is
read-only: its rows are history.

Closing a project is the one transition that writes rows: in the same
transaction, every `candidate` becomes `postponed`. Nothing undecided is lost
when a project ends. Reopening a project is allowed and puts nothing back.

**Postponed suggestions** are a query, not a flag: songs of the band that are
`postponed` in some project, not shelved, and have no row in the project being
built. Adding a song from that list makes it a candidate there; it stays
postponed in the old one, which is history.

## Decision 7 — shelving drops; unshelving restores nothing

`songs.shelved_at` is null or a time. Shelving, in one transaction, sets every
row of that song in an **active** project to `dropped`. Unshelving only clears
`shelved_at`: the band re-adds the song to projects on purpose.

A shelved song is absent from the band's song list by default (a filter shows
it), from postponed suggestions, and from *Add songs* pickers. Its score,
recordings and history are untouched, and its score still syncs — shelving is
about attention, not access.

Deleting a song is a separate `owner`-only action, as deleting a score is now.

## Decision 8 — every decision says who

`band_events(id, band_id, song_id, project_id, account_id, kind, data, created_at)`,
append-only, written in the same transaction as the change it records:
song created or renamed, stage changed, shelved or unshelved, status changed
in a project, project created or closed, recording added.

It is a feed — *Sam dropped Riff in D from the EP* — and nothing reads current
state from it; the rows above are the truth. That keeps it cheap to add to and
impossible to contradict the screen it sits under.

**Refused: deriving current state from events.** Every read would become a fold
and the transactions in decisions 6 and 7 would get harder, not easier, for a
history nobody has asked to replay.

## Decision 9 — recordings are files on disk, streamed both ways

```
recordings(id, song_id, kind, recorded_on, name, content_type, bytes,
           uploaded_by, created_at)
```

`kind` is `maquette | demo`. `recorded_on` is a date the uploader can set,
defaulting to today, because a demo is often uploaded days after the session.

Stored at `<RECORDINGS_ROOT>/<band>/<recording>`, a new env var beside
`GIT_ROOT`, with `MAX_RECORDING_BYTES` (default 200 MB, enough for a song-length
WAV). Same opaque-id validation as `repositoryPath`.

Upload is the raw body with an `audio/*` content type, the way `import.ts`
already takes a `.gp` — no multipart dependency. It is **streamed to a temp
file and renamed**, never buffered: `import.ts` can buffer a 300 KB score, but a
WAV in memory is a hub falling over. The row is written after the rename; a
failed upload leaves no row and no file.

Playback is `GET /recordings/:id/audio` through `@fastify/static`'s
`sendFile`, which already answers `Range` — the browser's `<audio>` seeks
without downloading the whole file. Authorization is band membership, the same
as everything else.

Recordings never enter git, and the companion never sees them. `hub-deploy.md`
gains a line: back up `RECORDINGS_ROOT` with the database and the repositories.

---

# 3. The screens

- **Header** — the band switcher, and the band's members and *Invite*, which
  move here from the score page.
- **Songs** (`/b/$bandId`) — every unshelved song: name, stage, which active
  projects it is in and its status there, whether it has a score, its latest
  recording. Filter by stage; show shelved.
- **Song** (`/songs/$songId`) — rename, stage, shelve; the score as the score
  page draws it today (history, branches, player) or *Add a score*; the
  recordings, newest first, each playable inline; the song's events.
- **Projects** (`/b/$bandId/projects`) — active ones first, each with its
  counts: *3 selected · 2 candidates · 4 of 5 rehearsing or beyond*.
- **Project** (`/projects/$projectId`) — its songs grouped by status, each with
  its stage; *Add songs*, which leads with postponed suggestions; *Mark done* /
  *Abandon*.

All of it on shadcn primitives from `packages/ui` and TanStack Router, Query
and Form, per CLAUDE.md. The song page reuses the score page's components; it
does not fork them.

---

# 4. What this costs, in order

One issue per commit, milestone [**Band lifecycle**](https://github.com/BenjaminLesieux/gpt/milestone/7). Each hub commit ships with
its tests; each web commit with its en and fr strings.

1. #39 `feat(hub): a band owns its scores` — decisions 1–3. `bands`,
   `band_members`, `scores.band_id`; drop `score_members` and
   `scores.account_id`; signup makes a band of one; the three queries move.
2. #40 `feat(hub): invite someone to a band` — decision 4.
3. #41 `feat(hub-web): switch between bands` — header switcher, members and
   invites move off the score page, the score list scoped to a band.
4. #42 `feat(hub): a song above its score` — decision 5, the hub half.
5. #43 `feat(hub-web): songs, and a score for a song` — the song list and song
   page; *New song*; *Add a score*.
6. #44 `feat(hub): stage, shelving and the band's events` — decisions 7 and 8,
   minus the project half of shelving, which arrives with projects.
7. #45 `feat(hub-web): a song's stage, shelving it, and what happened` — controls
   and the events feed.
8. #46 `feat(hub): projects` — decision 6, and shelving's drop.
9. #47 `feat(hub-web): projects` — both project screens.
10. #48 `feat(hub): recordings` — decision 9, and the `hub-deploy.md` line.
11. #49 `feat(hub-web): recordings on a song` — upload, list, play.

Plus a comment on #34: list the account's scores grouped by band.

**The first deploy waits for #43.** The owner's band starts using the hub once
bands and songs exist (#39–#43; #43 is included because #42 removes the
`POST /scores` the web's *Create score* dialog calls), so the first real data is already in this
shape and the no-migration premise of ADR 0012 holds. Projects, stages and
recordings ship afterwards as ordinary additive migrations. From that deploy
on, every schema change needs a real migration.

## Left out, on purpose

Song order within a project, target dates, comments on songs, notifications,
band-defined stages, moving a song between bands, the companion creating scores.
Each is additive on this model; none needs a decision here undone.

## Known unknowns

- Whether *Finished* is the right last stage for a band that plays live but
  never records. The list is fixed until a band says otherwise.
- How big real demo files are. 200 MB is a guess; the env var is the knob.
