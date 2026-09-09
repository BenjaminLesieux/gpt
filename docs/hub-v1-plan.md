# Gitarpro Hub — v1 slice: Forgejo provisioning + auth

## Vision

Companion pushes to any plain HTTPS git remote. Decision 9 of
[the companion plan](./companion-v1-plan.md) sealed the contract for what sits
on the other end — "vanilla unmodified git server (Forgejo/Gitea) + separate
Gitarpro web app with its own DB... **No custom sync protocol, ever**" — and
deferred building it.

This is the first slice of that platform, and nothing more: a user creates an
account, clicks *create score*, and gets back a URL, a username and a token to
paste into companion's **Set up sync** dialog. No web score viewer, no share
links, no comments. The one thing it proves is that account↔repo provisioning
works end to end without a human ever touching Forgejo's own UI.

## Locked decisions

1. **One Forgejo user per platform account.** Not a shared org. The reason is
   *ownership*, not token blast radius (decision 3 handles that): Forgejo's
   collaborator model, per-user namespaces in clone URLs, and quota all key off
   a real user, and later collaboration is then Forgejo's feature rather than
   ours. A platform account maps 1:1 to a Forgejo user for the life of both.

2. **Provisioning is three admin-API calls over HTTP.** No container exec, no
   `sudo` parameter, no password round-trip:

   | Step | Call | Auth |
   | --- | --- | --- |
   | Create user | `POST /api/v1/admin/users` | admin PAT |
   | Create repo | `POST /api/v1/admin/users/{username}/repos` | admin PAT |
   | Mint token | `POST /api/v1/admin/users/{username}/tokens` | admin PAT |

   All three take the same site-admin personal access token in an
   `Authorization: token …` header. The admin PAT needs the `write:admin`
   scope.

3. **Tokens are repo-scoped.** `{name, scopes: ["write:repository"],
   repositories: [{owner, name}]}`. A token minted for one score cannot reach
   any other repo in the same account. This is the isolation an SSH deploy key
   would have given, without leaving HTTPS — which matters because companion
   has no SSH transport (`src-tauri/src/remote.rs:211` — *"ssh remotes are not
   supported in this build; use an https url"*).

4. **Forgejo ≥ v16.0.0 is a hard dependency.** The admin token endpoint landed
   in v16.0.0; repo-scoped tokens landed in v15.0.0. Neither exists in Gitea at
   all. `docs/forgejo-check.md` currently pins `forgejo:11` — that pin moves to
   `:16`, here and there.

5. **Backend: Fastify, scaffolded by `@nx/node`.** `AGENTS.md` says never hand-
   write project files, and names `apps/companion` as the sole exception
   because no Nx plugin exists for Tauri. One does exist for Fastify, so hub is
   not an exception.

6. **Data store: SQLite via `better-sqlite3` + Drizzle.** Matches the single-
   self-hosted-operator shape the Forgejo docker-run precedent already implies.
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
   is returned once in the `POST /scores` response and never persisted. The DB
   holds only the Forgejo token's **id and name**, for revocation. The Forgejo
   user's password is generated to satisfy Forgejo's complexity check, used
   once at creation, and discarded — nothing afterwards needs it.

9. **Identifiers are opaque.** Forgejo usernames are `MaxSize(40)`, have a
   restricted charset and a reserved-word list; repo names are `AlphaDashDot`,
   `MaxSize(100)`, and collide with a 409. Deriving either from user input is a
   trap. Accounts get `gp<base32>`, repos get `s<base32>`, both from the row's
   own id. The human-readable score name lives in the hub DB only. This keeps
   PII and score titles out of clone URLs and makes retries idempotent by
   construction.

10. **`packages/forgejo-api` is deferred.** With CLI-exec gone the client is
    three `fetch` calls; a package with its own tsconfigs, vite config and
    build target for a single consumer is overhead against zero reuse. It
    starts as `apps/hub/src/forgejo/` and gets extracted the day a second
    consumer appears.

## Architecture

```
apps/hub/
  src/
    main.ts            # boot: env, db, plugins, routes, listen
    env.ts             # zod schema over .env — fails at startup, not first request
    db/schema.ts       # drizzle: accounts, sessions, scores (metadata only)
    db/client.ts
    db/migrations/
    auth/passwords.ts  # argon2id
    auth/sessions.ts   # issue / verify / revoke
    auth/routes.ts     # POST /auth/signup | login | logout
    forgejo/client.ts  # the three admin calls
    forgejo/types.ts
    scores/provisioning.ts
    scores/routes.ts   # POST /scores, GET /scores
    plugins/error-handler.ts
  docker-compose.dev.yml   # forgejo:16 + hub
  .env.example
  vitest.config.mts        # the workspace runs vitest, not the generator's jest
```

- **DB is metadata only.** Git stays the source of truth for scores and
  history; the hub DB holds accounts, sessions, and the pointer from a score to
  its repo. Decision 9's "DB = social/meta only" applies from the first table.
- **No secret is ever a column.** `scores` stores `forgejo_token_id` and
  `forgejo_token_name`, never a token.
- **Provisioning is idempotent and resumable.** Two systems, no transaction
  across them, so the local row is authoritative and carries the remote state:
  `accounts.forgejo_provisioned_at` and `scores.state` are nullable/enumerated
  rather than assumed. A signup whose Forgejo call fails leaves a usable
  account that provisions on retry; a score whose token mint fails after the
  repo exists retries against the same deterministic repo name.

## API surface (v1 only)

- `POST /auth/signup` `{email, password}` → account row, Forgejo user, session
  cookie
- `POST /auth/login` / `POST /auth/logout`
- `POST /scores` `{name}`, session-authenticated → repo in the caller's
  namespace, repo-scoped `write:repository` token, metadata persisted, returns
  `{url, username, token}` **once**
- `GET /scores`, session-authenticated → name, url, created-at, token name/id.
  No secrets.

## Milestones

**M1 — Provisioning spike.** Stand up `forgejo:16`, create the first admin
account and its PAT by hand (nothing bootstraps the very first admin token —
this stays manual forever). Then, by throwaway script: the three calls of
decision 2, with the request bodies checked against the live instance's own
`/swagger` page rather than against this document. Paste the result into a real
companion **Set up sync** dialog and push. *Gate: a token minted entirely by
script authenticates a real companion push, and that same token is rejected by
a second repo in the same account* — the second half is what proves decision 3.

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
that adds it lands with the code that uses it.

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

**M4 — Score provisioning.** `scores` table, `POST /scores`, `GET /scores`,
signup extended to provision the Forgejo user. *Gate — this slice's definition
of done: signup via the API → create a score via the API → paste the returned
three values into companion's real dialog → name a version → confirm it lands
in the Forgejo repo.*

**M5 — Hardening.** Redact the token from Fastify's request logger; revoke the
Forgejo token when a score is deleted, if delete ships; finish `.env.example`
and `docs/hub-dev-setup.md`; write
`docs/adr/0006-the-hub-provisions-forgejo-through-the-admin-api.md` recording
decisions 2–4 and why CLI-exec, `sudo` and deploy keys were all rejected.
*Gate: grepping the logs and the SQLite file for a test token's literal value
finds nothing.*

### Parallelization

- After M1's contract is written down: **M3 (auth) ∥ the `src/forgejo/` half of
  M2**. M4 depends on both.
- M2's scaffolding is sequential and first — everything else needs a project to
  live in.

## Constraints & pitfalls

- **`.env` is not currently gitignored.** The repo has never had one. That line
  lands in M2, before the admin PAT does.
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
- **`must_change_password` defaults to `true`** on `POST /admin/users` and must
  be sent explicitly as `false`. It gates only the web sign-in chain, so it
  breaks neither the API nor git push — set it anyway.
- **The admin-create password is effectively required.** The schema marks only
  `username` and `email`, but the handler enforces length, complexity and
  (where enabled) a HIBP check, so the throwaway password must be generated to
  pass them.
- **Scopes are mandatory.** An empty scope is a 400; the old unscoped-token mode
  is gone. The string is `write:repository`, not `write:repo`.
- **Trust the live `/swagger`, not the docs.** Neither Forgejo's nor Gitea's
  swagger declares per-endpoint auth constraints — those live in router
  middleware — so the security block on an operation means nothing. Check
  behaviour, not the spec.
- **Dev runs over `http://localhost:3000`**, so companion will show its
  plaintext-token warning. That warning is correct; `docs/forgejo-check.md`
  step 12 exists because loopback never exercises SecureTransport. Repeat M4's
  gate once against an HTTPS host before believing it.
- Node is new territory here: every existing project is vite/browser or
  Rust/cargo. Keep the hub thin and boring.
- CI (`.github/workflows/ci.yml`) is already stale — `npm ci` against a pnpm
  lockfile, node 20, and targets (`lint`, `e2e-ci`) that don't exist. Not this
  plan's job, but don't read a green tick there as coverage.

## Explicitly out of scope (v1)

Score content, diff or viewer endpoints; share links; comments; parsed-score
cache; email verification; password reset; OAuth; Gitea compatibility;
multi-tenancy beyond one self-hosted operator.
