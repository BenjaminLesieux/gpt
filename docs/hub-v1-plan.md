# Gitarpro Hub — v1 slice: serving git + auth

## Vision

Companion pushes to any plain HTTPS git remote. Decision 9 of
[the companion plan](./companion-v1-plan.md) sealed the contract for what sits
on the other end — "vanilla unmodified git server (Forgejo/Gitea) + separate
Gitarpro web app with its own DB... **No custom sync protocol, ever**" — and
deferred building it. The parenthesis was an example, not the requirement:
`git http-backend` *is* the vanilla unmodified git server, and
[ADR 0006](./adr/0006-the-hub-serves-git-itself.md) is why it runs inside the
hub rather than beside it.

This is the first slice of that platform, and nothing more: a user creates an
account, clicks *create score*, and gets back a URL, a username and a token to
paste into companion's **Set up sync** dialog. No web score viewer, no share
links, no comments. The one thing it proves is that account↔repo provisioning
works end to end, and that the origin it hands back — the hub's own — is one a
real companion can push to.

## Locked decisions

Decisions 1–4 were Forgejo's: one Forgejo user per platform account, three
site-admin API calls, repo-scoped Forgejo tokens, and a hard `>= 16.0.0`
version pin. All four were built and all four worked;
[ADR 0006](./adr/0006-the-hub-serves-git-itself.md) records why working was not
the same as being worth it. What replaces them sits in the same four slots
below, and 5–10 keep their numbers — 6, 8, 9 and 10 with their Forgejo-shaped
reasoning rewritten rather than renumbered.

1. **The hub owns the git namespace.** A repository is a directory under the
   hub's own data directory, at `<GIT_ROOT>/<account>/<score>.git`, and the
   account segment of a clone URL is a row in `accounts` rather than a user on
   another system. The reason is *ownership*, not token blast radius (decision 3
   handles that): nothing but the hub can create, rename or delete inside that
   namespace, so a name in the database and a directory on disk cannot
   disagree, and later collaboration is a row of ours rather than a forge's
   collaborator model.

2. **Provisioning is one `git init --bare --initial-branch=main` and one row.**
   No remote API, no admin credential, nothing to be halfway through. One
   system means provisioning either happened or it did not.
   `--initial-branch=main` is not a style preference — `git init --bare`
   defaults `HEAD` to `refs/heads/master`, companion pushes `main`, and a clone
   of the mismatch transfers every object and then checks nothing out. See the
   pitfalls below.

3. **Tokens are rows in the hub's own database, one per score.** 256 bits of
   randomness handed back once; the row holds its sha256, its name, and the
   score it was minted for. A token is therefore not *scoped* to one score by a
   permission model — it names one score and has nothing to say about any
   other. This is the isolation an SSH deploy key would have given, without
   leaving HTTPS — which matters because companion has no SSH transport
   (`src-tauri/src/remote.rs:211` — *"ssh remotes are not supported in this
   build; use an https url"*).

4. **Isolation is enforced by the route, not delegated to anything.** One
   Fastify route matches `/:account/:score.git/*`, resolves that pair to a row,
   compares it against the token presented in HTTP Basic, and only then spawns
   `git http-backend` with `GIT_PROJECT_ROOT` pointing at that one repository.
   It is the only path by which git data enters or leaves the hub, which is the
   whole argument for it: there is exactly one place this check has to be right.
   Under Forgejo the equivalent guarantee was *trust another system's scope
   model*.

5. **Backend: Fastify, scaffolded by `@nx/node`.** `AGENTS.md` says never hand-
   write project files, and names `apps/companion` as the sole exception
   because no Nx plugin exists for Tauri. One does exist for Fastify, so hub is
   not an exception.

6. **Data store: SQLite via `better-sqlite3` + Drizzle.** Matches the single-
   self-hosted-operator shape decision 1 already implies — the repositories are
   a directory on a volume, so a database file beside them adds no new kind of
   state to operate.
   `better-sqlite3` is synchronous and will block Fastify's event loop — at
   this scale that is a simplification, not a bug, and it is the reason to
   revisit if the hub ever serves real traffic.

7. **Platform auth: email + password, Argon2id, opaque session id in an
   httpOnly/Secure/SameSite=Lax cookie**, sessions as rows in the same DB.
   Revocation is a `DELETE`; there is no JWT blocklist problem. No OAuth, no
   email verification, no password reset in v1 — a known gap, listed below, not
   silently skipped.

8. **Secrets are write-only, mirroring companion exactly.** `config.rs:57` —
   *"Secrets are deliberately absent"* — and `RemoteDialog.tsx:26` treats the
   token as write-only, never read back. The hub does the same: a minted token
   is returned once in the `POST /scores` response and never stored in a form
   that can be read back. The DB holds its **sha256 and its name** — the same
   treatment sessions already get (M3), for the same reason: a copy of the
   SQLite file should be a list of spent hashes, not a drawer of working
   credentials.

9. **Identifiers are opaque.** Accounts get `gp<base32>`, repos get
   `s<base32>`, both from the row's own id; the human-readable score name lives
   in the hub DB only. Nothing forces this any more — the hub owns the
   namespace, so a path is legal if the filesystem accepts it. It is kept
   because a clone URL gets pasted into a dialog, printed in logs and written
   into a `.git/config`, and neither an email address nor a song title belongs
   in one. It also makes the repository path a pure function of the row, which
   is what makes a retry idempotent. (The original reason — Forgejo's
   `MaxSize(40)` usernames, `AlphaDashDot` repo names and reserved-word list —
   died with Forgejo, and `src/ids.ts`'s own comment still cites it.)

10. **No `packages/` extraction for the git module.** `packages/forgejo-api`
    was deferred for having one consumer and zero reuse; `apps/hub/src/git/`
    inherits that judgement and deserves it more — a route that hijacks a
    Fastify reply to stream a CGI's output is not reusable by anything that is
    not this hub. It gets extracted the day a second consumer appears, which is
    not v1.

## Architecture

```
apps/hub/
  src/
    main.ts                  # boot: env, db, migrate, listen
    env.ts                   # zod over .env — fails at startup, not first request
    ids.ts                   # the opaque base32 both a repo path and a row use
    app/app.ts               # every plugin registered by hand; see M3
    app/errors.ts            # the one error shape
    app/plugins/error-handler.ts
    app/routes/health.ts
    db/schema.ts             # drizzle: accounts, sessions, scores, score_tokens
    db/client.ts
    db/migrations/
    auth/passwords.ts        # argon2id
    auth/sessions.ts         # issue / read / revoke / purge
    auth/session-guard.ts    # requireAccount, called rather than hooked
    auth/cookie.ts
    auth/routes.ts           # POST /auth/signup | login | logout, GET /auth/me
    git/repositories.ts      # init --bare --initial-branch=main; path for account+score
    git/http-backend.ts      # the CGI proxy, streamed both ways
    git/routes.ts            # /:account/:score.git/* → git http-backend
    scores/tokens.ts         # mint, read by sha256, revoke
    scores/routes.ts         # POST /scores, GET /scores
  .env.example
  vitest.config.mts        # the workspace runs vitest, not the generator's jest
```

- **DB is metadata only.** Git stays the source of truth for scores and
  history; the hub DB holds accounts, sessions, score metadata and the token
  hashes that guard the repositories. Companion decision 9's "DB = social/meta
  only" applies from the first table.
- **Repositories are the other half of the state.** `GIT_ROOT` is a validated
  env var and its contents are authoritative — a score row without its
  directory is broken in a way no migration fixes, which is the cost ADR 0006
  names under *What this costs*.
- **No secret is ever a column.** `score_tokens` stores a sha256 and a name,
  never a token. It sits under `scores/` rather than `git/` because it is the
  score's credential; `git/` is only its largest consumer.
- **Provisioning is one operation, so there is no half-provisioned state.**
  `git init` then one `INSERT`; if the insert fails the directory is removed
  and the caller gets an error, not a row to finish later. `scores.state` and
  `accounts.forgejo_provisioned_at` were both artefacts of writing to two
  systems with no transaction between them, and neither exists.

## API surface (v1 only)

- `POST /auth/signup` `{email, password}` → account row, session cookie. It
  provisions nothing else; there is nothing else to provision.
- `POST /auth/login` / `POST /auth/logout`
- `POST /scores` `{name}`, session-authenticated → a bare repo in the caller's
  namespace, a token for that one score, metadata persisted, returns
  `{url, username, token}` **once**
- `GET /scores`, session-authenticated → name, url, created-at, token name. No
  secrets.
- `GET /:account/:score.git/info/refs` and
  `POST /:account/:score.git/git-{upload,receive}-pack` → `git http-backend`.
  These are the git transport and the only routes companion's git layer ever
  touches. They authenticate with HTTP Basic against a score token, never with
  the session cookie — a browser session must not be a push credential.

## Milestones

**M1 — Provisioning spike. Ran, passed, superseded.** Stand up `forgejo:16`,
create the first admin account and its PAT by hand (nothing bootstraps the very
first admin token —
this stays manual forever). Then, by throwaway script: the three calls of
decision 2, with the request bodies checked against the live instance's own
spec — `/api/swagger` for the UI, `/swagger.v1.json` for the raw document; a
bare `/swagger` is not a route — rather than against this document. Paste the result into a real
companion **Set up sync** dialog and push. *Gate: a token minted entirely by
script authenticates a real companion push, and that same token is rejected by
a second repo in the same account* — the second half is what proves decision 3.

M1 landed against `forgejo:16.0.3`, and it moved one thing this plan asserted.
"Nothing bootstraps the very first admin token — this stays manual forever" is
wrong: `forgejo admin user create` and `forgejo admin user generate-access-token
--raw` do it from the container's own CLI, and `INSTALL_LOCK` skips the web
installer entirely, so `pnpm nx run @gpt/hub:forgejo-up` goes from nothing to a
usable token unattended. That is not the container-exec provisioning decision 2
rejects — decision 2 governs how the *hub* provisions, and the hub still does
every user, repo and token over HTTP.

Two observations worth keeping. `CreateUserOption`, `CreateRepoOption`,
`CreateAccessTokenOption` and `RepoTargetOption` on the live instance match
`src/forgejo/types.ts` field for field, so nothing transcribed here was wrong.
And a repo-scoped token does not 403 the API — `GET /repos/{owner}/{other}`
returns **404**, because Forgejo hides what the token cannot see. Over git it
is a 403. Anything that branches on the status has to expect both.

And then the whole milestone was superseded, which is the more useful thing it
settled. Its gate passed on the first attempt — a script-minted token
authenticated a real companion push, and the sibling repository refused it — so
the question stopped being *can this be provisioned* and became *what is the
forge for*. A second, smaller spike answered that by serving git out of Fastify
directly; [ADR 0006](./adr/0006-the-hub-serves-git-itself.md) is the argument
and the measurements. M1's subject no longer exists, and it took decisions 1–4
with it. The Forgejo observations stay written down because they were paid for,
and because the 404/403 asymmetry is the kind of thing that gets rediscovered
expensively by whoever next puts a forge behind something.

**M2 — Scaffold.** `@nx/node` is **not installed** — the workspace has only
`devkit, js, react, vite, vitest, web` — so the plugin lands first, pinned to
the same version as everything else: `pnpm add -Dw @nx/node@22.6.5`. Then
`pnpm nx g @nx/node:application apps/hub --framework=fastify
--bundler=esbuild --unitTestRunner=none --e2eTestRunner=none --docker`, then
`pnpm nx sync`. Add `vitest.config.mts` by hand — the generator's
`unitTestRunner` really is `jest|none`, confirmed against its schema, and the
workspace runs vitest. Add `.env` to `.gitignore`
**before** the first secret exists. Register `apps/hub/**/*.ts` in
`eslint.config.mjs` — the root config is per-path opt-in, so an unregistered
project is linted by nothing. Env validation, health route, and
`src/forgejo/` implementing M1's three calls against mocked HTTP.
*Gate: `pnpm nx serve @gpt/hub` responds; `pnpm nx test @gpt/hub` passes;
`pnpm lint` covers the new files (verify by breaking one deliberately).*

The Drizzle schema does **not** land here as an empty file: `AGENTS.md` bans
placeholder modules, and M3 creates it one commit later with real tables.

Two things the scaffold settles. The generator sets `bundle: false`, so the
`better-sqlite3` external-marking pitfall below does not apply unless someone
turns bundling on — but it also leaves `exclude` empty, which sweeps every
`*.spec.ts` into `dist`, so that needs closing. And registering the project in
ESLint immediately errors on the generator's own `import { FastifyInstance }`,
which answers the "break one deliberately" half of the gate for free.

**M3 — Platform auth.** `accounts` and `sessions` + migrations, argon2id,
signup/login/logout, session middleware, and `@fastify/rate-limit` on the auth
routes. Rate limiting is here rather than in hardening because unauthenticated
signup provisions real remote resources — an abuse amplifier is not something
to leave running through M4. *Gate: signup → login → authenticated route round-
trips; tampered, expired and missing cookies are each rejected distinctly.*

Four things M3 settled.

*Sessions are stored by hash.* Decision 7 says "opaque session id in a cookie,
sessions as rows"; it did not say the row holds the id. It holds the sha256 of
it, so a copy of the SQLite file is a list of spent hashes rather than a drawer
of working cookies. This is not password hashing and deliberately uses nothing
expensive — the token is 256 bits of randomness, so there is no low-entropy
secret to slow an attacker down over.

*The `accounts` table has no Forgejo columns yet.* `forgejo_provisioned_at`
appears in the architecture above, but nothing reads it until M4 and
`AGENTS.md` bans a field that exists only to be filled in later. The migration
that adds it lands with the code that uses it. That migration never got
written: the architecture above no longer lists the column and M4 does not add
it, so the ban paid for itself inside two milestones.

*`@node-rs/argon2`, not `argon2`.* Prebuilt binaries; a node-gyp step in a
workspace whose only other native dependency is `better-sqlite3` buys nothing.

*The generator's `@fastify/autoload` had to go.* It walks `__dirname`, which
vitest's ESM transform does not define, so `app.ts` could only ever be
assembled in production — the one place nothing checks that it assembles.
Registering the plugins by hand is shorter than the comment explaining why the
app could not be tested. The "Hello API" root route and the never-used
`@fastify/sensible` went with it.

The session guard is a function a handler calls, not a Fastify `preHandler`: a
preHandler has to leave the account on the request as optional, and every
handler then narrows an `account?` the guard has already guaranteed.

**M4 — Score provisioning and the git transport.** `scores` and `score_tokens`
tables, `POST /scores`, `GET /scores`, `src/git/` promoted from the spike, and
the `/:account/:score.git/*` route. Signup is not extended — it has nothing
left to provision. `src/forgejo/`, `scripts/forgejo-dev.sh`, the
`forgejo-up` target, `docker-compose.dev.yml` and the three `FORGEJO_*` env
vars go in the same milestone, replaced by `GIT_ROOT`; deleting them is part of
this work, not a follow-up. *Gate — this slice's definition of done: signup via
the API → create a score via the API → paste the returned three values into
companion's real dialog → name a version → confirm the ref and the blob are in
the bare repo under `GIT_ROOT`, and that a token for a second score is refused
by the first one's URL.*

**M5 — Hardening.** Redact the token from Fastify's request logger — including
the `Authorization` header the git route now sees on every request; delete a
score's token row and its repository directory if delete ships, which is one
`DELETE` and one `rm -rf` where the Forgejo version needed a remote call that
could fail; finish `.env.example` and `docs/hub-dev-setup.md`. The ADR this
milestone was going to write has been written, with a different subject: ADR
0006 is *the hub serves git itself*, and the decisions it would have recorded
are the ones it overturned. *Gate: grepping the logs and the SQLite file for a
test token's literal value finds nothing.*

### Parallelization

- M1 through M3 have landed, so what is left is M4 then M5, and M5 is short.
- Inside M4: **the git route ∥ the tables**. The route needs a path and a token
  check, both of which the spike wrote once already; `POST /scores` is where
  the two halves meet.
- The Forgejo deletions are independent of both and can land first — nothing
  reads `src/forgejo/` except its own tests.

## Constraints & pitfalls

- **Git's POST bodies must reach the CGI unbuffered.** `git-receive-pack` and
  `git-upload-pack` stream, so Fastify's default body parsing is wrong twice
  over: the route needs a content-type parser that hands the raw stream over
  for `application/x-git-*`, and `reply.hijack()` to write the CGI's headers
  and body straight to the socket. Parse the body and a push hangs.
- **`git init --bare` sets `HEAD` to `refs/heads/master`.** Companion pushes
  `main`, so a clone of a repository created without `--initial-branch=main`
  transfers every object and then fails to check anything out — *remote HEAD
  refers to a nonexistent ref*. This is the gap Forgejo's `auto_init` was
  covering without anyone having to know it existed, which is a fair summary of
  what a forge was doing for us.
- **`git` is a runtime dependency of the image.** `git-http-backend` ships with
  the binary and is not reimplementable in a library, so the Dockerfile
  installs it and a missing `git` belongs with the env validation that fails at
  startup, not with the first push.
- **The hub is stateful, and cannot be scaled by adding a replica.** Named
  here because it is the price of ADR 0006 and cheap to forget; the mitigations
  in order are one writer with a large disk, then sharding by account, then a
  DFS-backed implementation.
- **`.env` is not currently gitignored.** The repo has never had one. That line
  lands in M2, before the first secret does.
- **`nx run-many -t lint` is a no-op** — no project defines a lint target.
  Linting is `pnpm lint` at the root, and only over paths listed in
  `eslint.config.mjs`. (`AGENTS.md`'s claim that the config "applies to the
  whole workspace" is wrong and worth fixing while nearby.)
- **`better-sqlite3` is a native CJS addon** — mark it external in the esbuild
  bundle or the build silently produces something that won't boot. Inert while
  `bundle: false`, which is where the generator left it.
- **With `bundle: false`, `dist/main.js` is a loader shim.** The real
  entrypoint is emitted at `dist/apps/hub/src/main.js`, so anything resolved
  off `__dirname` — the Drizzle migrations folder, which ships as a build asset
  — has to be copied to the mirrored path, not to the dist root.
- **The build target and the typecheck target both wanted `apps/hub/dist`.**
  `tsc --build` writes declarations and a `.tsbuildinfo` there, esbuild deletes
  the directory and writes a different layout, and the surviving `.tsbuildinfo`
  then reports everything up to date while the declarations are gone — so
  `build` followed by `typecheck` failed the whole workspace with `TS6305`.
  tsc now emits to `out-tsc/app` and the bundle emits no declarations at all.
- **The Nx daemon caches project config across `package.json` edits.** Changing
  a target's `assets` and rebuilding can silently use the previous value;
  `pnpm nx reset` is what makes the edit take.
- **Dev runs over `http://localhost:3000`**, so companion will show its
  plaintext-token warning. That warning is correct, and loopback never
  exercises SecureTransport at all. Repeat M4's gate once against an HTTPS host
  before believing it.
- Node is new territory here: every existing project is vite/browser or
  Rust/cargo. Keep the hub thin and boring.
- CI (`.github/workflows/ci.yml`) is already stale — `npm ci` against a pnpm
  lockfile, node 20, and targets (`lint`, `e2e-ci`) that don't exist. Not this
  plan's job, but don't read a green tick there as coverage.

## Explicitly out of scope (v1)

Score content, diff or viewer endpoints; share links; comments; parsed-score
cache; email verification; password reset; OAuth; multi-tenancy beyond one
self-hosted operator. And now, because the hub is the git server: the dumb-HTTP
protocol, SSH, shallow and partial clone, and a second replica.

"Gitea compatibility" was on this list and has left it — there is no forge to
be compatible with. Whether the hub's own git endpoints stay compatible with
plain `git clone` is not a scope question; it is the gate.
