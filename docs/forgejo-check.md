# Checking sync against a real server

The Rust suite pushes and fetches against a bare repo in a tempdir. libgit2
treats that as a real remote — same negotiation, same refspecs, same
fast-forward rule — so the logic is covered without a network.

What it cannot cover is the transport underneath: TLS through SecureTransport,
and a token going over the wire to something that checks it. That is what this
walkthrough is for. Run it once against a real server before shipping M5, and
again whenever `remote.rs` or the credential callback changes.

## Bring up a server

```bash
docker run -d --name forgejo -p 3000:3000 -v forgejo-data:/data codeberg.org/forgejo/forgejo:11
```

Open <http://localhost:3000>, complete the installer (SQLite is fine), and
create the admin account. Then:

1. Create an empty repository — no README, no initial commit. A repo with a
   commit in it is *diverged* from any local score, which is a real case but
   not the one to start with.
2. **Settings → Applications → Generate token**, scope `write:repository`.
   Copy it; Forgejo shows it once.

Forgejo over plain `http://localhost` will make the app warn that the token
travels unencrypted. That warning is correct and worth seeing at least once —
it is why the check below also covers a real HTTPS host.

## The walkthrough

Start the app with `pnpm nx dev @gpt/companion`.

**Push**

1. Track a `.gp` file, open the extended window, **Set up sync**.
2. URL `http://localhost:3000/<you>/<repo>.git`, your username, the token.
   Save.
3. The header should go to *N versions to send*, then *in sync* on its own —
   pointing a score at a remote enqueues what it already has. Confirm the
   versions are in Forgejo's UI, on `main`, one `score.gp` per commit.
4. Name a new version from the panel. It should reach the server without the
   panel ever waiting on it.

**Failure handling**

5. `docker stop forgejo`. Name another version. The commit must still succeed
   instantly. The panel says *sending…* and stays silent — this is the
   backoff, not a failure.
6. `docker start forgejo`. Within five minutes the queued version arrives with
   no further input. (Impatient? Naming another version resets the backoff.)
7. Put a wrong token in the settings dialog and name a version. This one *does*
   raise the panel's badge, because retrying a rejected token would only burn
   attempts. Fix the token to clear it.

**Pull**

8. Clone the repo elsewhere, commit a different `score.gp`, push it:
   ```bash
   git clone http://localhost:3000/<you>/<repo>.git /tmp/elsewhere
   ```
9. Back in the app: **Check the remote** → *1 version waiting* → **Bring them
   in**. The `.gp` on disk changes, the timeline gains the pulled version plus
   a safety snapshot of what was there, and Guitar Pro offers to reload.

**Divergence**

10. Push a version from `/tmp/elsewhere`, and name a different one in the app
    without checking first.
11. **Check the remote** must read *changed in two places*, with no button
    offering to combine them, and the queued push must fail with the badge
    rather than force anything. Confirm in Forgejo that the version pushed
    from `/tmp/elsewhere` is still the tip.

**HTTPS**

12. Repeat steps 1–4 against a real HTTPS host (a Codeberg or GitHub repo with
    a PAT). This is the only step that exercises SecureTransport; localhost
    Forgejo never leaves the loopback.

## Tearing down

```bash
docker rm -f forgejo && docker volume rm forgejo-data
```

The token stays in your login keychain under service `com.gitarpro.companion`.
Clearing the remote in the settings dialog deletes it; Keychain Access will
show any that survive.
