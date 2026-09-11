# Checking sync against a real server

The Rust suite pushes and fetches against a bare repo in a tempdir. libgit2
treats that as a real remote — same negotiation, same refspecs, same
fast-forward rule — so the logic is covered without a network.

What it cannot cover is the transport underneath: TLS through SecureTransport,
and a token going over the wire to something that checks it. That is what this
walkthrough is for. Run it once against a real server before shipping M5, and
again whenever `remote.rs` or the credential callback changes.

## Bring up a server

The hub serves git itself — see [ADR 0006](adr/0006-the-hub-serves-git-itself.md).
One process, one port:

```bash
pnpm nx serve @gpt/hub
```

That listens on <http://localhost:3000>, creates `apps/hub/hub.sqlite` on
first boot and puts one bare repository per score under
`apps/hub/git-repos`. Nothing else has to be running.

The hub has no web UI yet, so make the account and the score over the API. The
signup and login endpoints set a session cookie, which `-c`/`-b` keep in a jar:

```bash
curl -sc /tmp/hub.jar -X POST http://localhost:3000/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"a-long-enough-password"}'

curl -sb /tmp/hub.jar -X POST http://localhost:3000/scores \
  -H 'content-type: application/json' \
  -d '{"name":"Sync check"}'
```

The second call answers with the three values the companion's *Set up sync*
dialog asks for, and it is the only time the token exists outside the
keychain:

```json
{ "url": "http://localhost:3000/git/<account>/<score>.git",
  "username": "<account>",
  "token": "<48 chars>",
  "tokenName": "companion" }
```

The repository starts genuinely empty — no README, no initial commit, and
HEAD already on `main`. That matters: a repo with a commit in it is *diverged*
from any local score, which is a real case but not the one to start with.

Over plain `http://localhost:3000` the app will warn that the token travels
unencrypted. That warning is correct and worth seeing at least once — it is
why the check below also covers a real HTTPS host.

## The walkthrough

Start the app with `pnpm nx dev @gpt/companion`.

**Push**

1. Track a `.gp` file, open the extended window, **Set up sync**.
2. Paste the three values from above. Save.
3. The header should go to *N versions to send*, then *in sync* on its own —
   pointing a score at a remote enqueues what it already has. Confirm the
   versions landed, on `main`, one `score.gp` per commit:
   ```bash
   git -C apps/hub/git-repos/<account>/<score>.git log --oneline --stat main
   ```
4. Name a new version from the panel. It should reach the server without the
   panel ever waiting on it.

**Failure handling**

5. Stop the hub (Ctrl-C). Name another version. The commit must still succeed
   instantly. The panel says *sending…* and stays silent — this is the
   backoff, not a failure.
6. Start the hub again. Within five minutes the queued version arrives with
   no further input. (Impatient? Naming another version resets the backoff.)
7. Put a wrong token in the settings dialog and name a version. This one *does*
   raise the panel's badge, because retrying a rejected token would only burn
   attempts. Fix the token to clear it.
8. Point the URL at another account's score id, keeping the same token. The
   hub answers 403 and the badge rises — one token reaches exactly one
   repository.

**Pull**

9. Clone the repo elsewhere, commit a different `score.gp`, push it:
   ```bash
   git clone http://<account>:<token>@localhost:3000/git/<account>/<score>.git /tmp/elsewhere
   ```
10. Back in the app: **Check the remote** → *1 version waiting* → **Bring them
    in**. The `.gp` on disk changes, the timeline gains the pulled version plus
    a safety snapshot of what was there, and Guitar Pro offers to reload.

**Divergence**

11. Push a version from `/tmp/elsewhere`, and name a different one in the app
    without checking first.
12. **Check the remote** must read *changed in two places*, with no button
    offering to combine them, and the queued push must fail with the badge
    rather than force anything. Confirm with `git ls-remote` that the version
    pushed from `/tmp/elsewhere` is still the tip.

**HTTPS**

13. Repeat steps 1–4 against a real HTTPS host (a Codeberg or GitHub repo with
    a PAT). This is the only step that exercises SecureTransport; a localhost
    hub never leaves the loopback.

## Tearing down

```bash
rm -rf apps/hub/hub.sqlite apps/hub/git-repos
```

That is the hub's entire state: the database holds the account, the score row
and the token's hash, and the directory holds the scores themselves.

The token stays in your login keychain under service `com.gitarpro.companion`.
Clearing the remote in the settings dialog deletes it; Keychain Access will
show any that survive.
