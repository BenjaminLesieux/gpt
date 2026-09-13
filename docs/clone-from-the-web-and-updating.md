# Cloning from the web, and how the app updates itself

Two things the app could not do, which turned out to share a dependency: the
companion had never made an HTTP request. git2 speaks git-over-https and
nothing else in the process spoke anything. Both features below need a plain
JSON client, and the updater plugin brings one (reqwest) whether or not we ask,
so the order of the work was not arbitrary.

Part 1 is built. Part 2 is not.

---

# 1. Clone from the hub — built

The return path used to be: create or import on the site → read three values
off the credentials screen → switch apps → paste them into `AdoptDialog` →
pick where the file goes. Adoption itself was already there (`adopt.rs`); what
was missing was everything before the paste.

Now: **Clone** on a score row opens the companion, which asks "add
*Blackbird* to this computer?", and on yes writes the `.gp` and tracks it.

## The finding that shaped the design

**An existing score's token cannot be handed over again.** It was shown once
and the hub kept only its sha256. So Clone on a row can never re-send the
credentials that row was set up with — it has to mint a *new* one.

That is the correct meaning anyway: cloning to a second machine is a second
device, and a device that is lost should be revocable without breaking the
first. The schema already allowed it — `score_tokens` has no unique on
`score_id`. Two places assumed otherwise and changed:

- `POST /scores/:id/token` refused with `already_set_up` when a token existed.
- `GET /scores` left-joined `score_tokens`, so a score with two tokens would
  have appeared as two rows.

## Decision 1 — the deep link carries a claim, never the token

`gitarpro://adopt?hub=<origin>&claim=<code>`

Not `?url=&username=&token=`. A custom-scheme URL is handed to LaunchServices,
which is not an access log but is not nothing either: any installed app may
register the same scheme and macOS picks one handler, and browsers vary on
whether an external-protocol navigation lands in history. A token in that URL
is a token in a place we do not control. The claim is a bearer capability that
is single-use, expires in five minutes, and buys exactly one score.

It also means the browser never holds the token for the clone path at all —
the value goes hub → app and is seen by nothing else, which is strictly better
than the copy-paste flow it replaces.

## Decision 2 — the token is minted at redemption, not at claim

The claim row holds `sha256(code)`, `score_id`, `expires_at`, `redeemed_at` —
no secret. `POST /claims/:code` mints the token as it answers. Nothing
plaintext is ever at rest, which is the property the rest of the hub already
has and would have been quietly given up by a claim row that carried a
pre-minted value for five minutes.

Consumption is enforced by the write, not by a read-then-write:
`UPDATE clone_claims SET redeemed_at = ? WHERE code_hash = ? AND redeemed_at
IS NULL` and a check that one row changed. Two racing redemptions produce one
token and one refusal — the same shape as `update-ref` with an empty old value
in `git/versions.ts`.

## Decision 3 — peek and redeem are separate

`GET /claims/:code` answers `{ scoreName, hubName }` and consumes nothing.
`POST /claims/:code` redeems.

The confirmation dialog has to name the score before the user has agreed to
anything, and the name must come from the hub rather than from the link, or a
crafted link could say *Blackbird* and deliver something else. Redeeming to
populate the dialog would burn the claim on every cancel.

It also fixed a small ugliness: `adopt::suggested_file_name` derives the save
dialog's filename from the last URL segment, which for the hub is an opaque
score id. With the name in hand, `adopt::file_name_for` offers `Blackbird.gp`.

## Decision 4 — the hub origin comes from the link, and must be https

The hub is self-hosted; the app cannot know where to redeem unless told. It is
therefore told, and the value is attacker-controllable, so: https only
(`http://localhost` excepted for development, which is the only reason the
flow can be exercised at all before a deployment exists), and the confirmation
dialog shows the origin it is about to trust. The blast radius of a lie is
"you adopted a score you did not want", which the confirmation is there to
catch.

## Decision 5 — the save dialog comes *before* the redemption

The one place the shipped flow differs from the plan, and it came out of
writing the failure cases down.

The plan had redeem → save dialog → adopt, with a note that cancelling the
save dialog after redeeming spends the claim and the only retry is a new
Clone. But cancelling a save dialog is an ordinary thing to do, and the peek
consumes nothing and already carries the name the dialog needs. So the order
is peek → confirm → save dialog → redeem → adopt, and a cancel costs nothing.

It cannot be made free altogether: `adopt` can still fail after the token
exists — the path is taken, or the repo already holds history the remote has
not seen — and then the hub holds a credential this machine never got. That is
a stale row in the score's device list rather than a lost score, and the error
says to press Clone again.

## Decision 6 — the machine names its own token

`POST /claims/:code` takes `{ device }` and names the token with it; the
companion sends its hostname with `.local` trimmed. Nobody types anything.

The name is not decoration. It is the only thing that tells two of a score's
credentials apart, the only thing that makes one of them revocable on its own,
and — see *What this was shaped for* below — the identity a history of who
pushed what will hang off.

## Flow, as built

```
hub-web              hub                    companion
────────             ───                    ─────────
Clone ──POST /scores/:id/clone-claims (session)
                     ├ insert claim (hash, score, +5min)
                     └ { code, expiresAt, scoreName }
   │
   └─ location = gitarpro://adopt?hub=…&claim=…
                                            on_open_url / get_current
                                            ├ window raised
                                            ├ GET /claims/:code ─────► { scoreName, hubName }
                                            ├ confirm dialog
                                            ├ save dialog (named from scoreName)
                                            ├ POST /claims/:code ────► { url, username, token }
                                            └ adopt_remote(...)   ← already built
```

## When nothing happens

A `gitarpro://` link with no app behind it fails silently in every browser. So
Clone is a dialog, not a bare link: it fires the scheme, and under it offers
*Download Gitarpro* and *Show the values instead*. The second is the flow that
existed before — mint a token and go to `/credentials` — so the fallback is
not new code, only a second entry point into it.

## Refused

- **A token in the URL.** Decision 1.
- **Listing an account's scores in the companion.** Still wants an
  account-scoped credential; see `hub-next-adoption-and-import.md`. The claim
  is per-score and expires, which is why it does not raise the same question.
- **Redeeming from the webview.** The CSP's `connect-src` is a fixed
  allowlist; letting it reach an arbitrary hub origin would mean
  `connect-src https:`. The redemption happens in Rust.
- **Version negotiation.** An old hub simply has no Clone button, because the
  button is rendered by the hub that implements the endpoint behind it.
- **Asking the user to name the machine.** The machine already has a name, and
  a field in the fallback path would have been friction on the one path taken
  by people whose deep link had just failed.

## What was built

1. `feat(hub): a score may have more than one token` — the `already_set_up`
   refusal dropped, tokens named per device, `GET /scores` aggregating so a
   second token does not duplicate a row (`token` became `tokens[]`).
2. `feat(hub): hand a score over with a claim` — migration `0002_clone_claims`,
   `POST /scores/:id/clone-claims`, `GET|POST /claims/:code`, a sweep at
   startup, dead claims collected as the next one is made, rate limits.
3. `feat(hub-web): clone a score into the app` — the Clone button, the dialog,
   the two fallbacks.
4. `feat(companion): open on a gitarpro:// link` — the plugin, the scheme in
   `tauri.conf.json`, `on_open_url` and `get_current` → event to the extended
   window, window raised.
5. `feat(companion): adopt a score from a claim` — `hub.rs` (reqwest, rustls),
   peek, `ClaimDialog`, save-then-redeem-then-adopt.

## Known cost

macOS registers schemes from the bundle's `Info.plist` through LaunchServices,
so **this cannot be tested under `tauri dev`** — the app has to be bundled and
run from `/Applications`. Same lesson as the dock-icon work. The companion
README says how to fire a link by hand once it is installed.

Everything either side of the scheme *is* tested: the hub's claim lifecycle
including the race, the link parser, the https refusal, and the dialog's
behaviour on expiry, on a spent claim and on a cancelled save.

## What this was shaped for

Two things are coming that this work deliberately did not build, and the
shapes above were chosen so that neither needs them undone.

### Who pushed what

The pieces are now in place for a score's history to say who, not just what.

**The identity already exists.** A token is a device with a name, minted per
machine, and `git/routes.ts` already passes `bearer.tokenId` to
`git-http-backend` as `REMOTE_USER`. Nothing else had to change for
attribution to become possible — that is what commit 1 bought.

What is missing is the record. Sketch:

- `score_pushes(id, score_id, token_id, ref, old_oid, new_oid, pushed_at)`.
  Oids and not messages: the repository is authoritative, and
  `git log old..new` at read time is cheaper than a second copy of the history
  that can disagree with the first.
- Written by the git route rather than by a `post-receive` hook, at least at
  first. A hook is the more precise instrument — git hands it exactly what
  moved, atomically, only on success — but it is a second process that needs
  either database access or an internal endpoint, and every repository created
  before it existed would need backfilling. Reading `refs/heads/*` either side
  of a `git-receive-pack` proxy needs none of that. The hook is the upgrade,
  not the starting point.
- `GET /scores/:id/activity` joins that to `score_tokens.name` and expands the
  oid range: *Ben's MacBook pushed 3 versions to main · 2h ago*, with the
  version names read out of git.

One thing to be honest about: a score belongs to one account, so today *who*
means *which machine*, not *which person*. For a band on one shared account
those are the same thing. If scores ever become shareable across accounts, the
token already resolves to both, and the display name is the only thing that
has to change.

### Branches

The transport is already branch-ready — the git route proxies whatever ref a
push carries, and `git/routes.spec.ts` covers a push to `refs/snapshots` as
well as to `main`. It is the two ends that assume one name:
`NAMED_REF = refs/heads/main` in `apps/companion/src-tauri/src/git.rs`,
`REMOTE_REF` in `remote.rs`, and the same constant in
`apps/hub/src/git/versions.ts`.

What it would take:

- **companion** — a current branch per tracked file, `commit_named`,
  `fast_forward_named` and `read_score` parameterised on it, and the push
  refspec following it. Restore and diff stay within a branch; the panel gets
  a switcher.
- **hub** — `GET /scores/:id/branches` over `refs/heads/*` with their tips, and
  the score page showing them. `writeFirstVersion` still seeds `main`.
- **adoption** — currently takes `main`. It would take a branch, defaulting to
  `main`.

The harder half is not the plumbing. A musician does not have branches; they
have *the version we play live* and *the studio arrangement*. Whatever this
ends up called in the UI, it is probably not "branch", and the naming is worth
deciding before the switcher is drawn.

**Nothing in the clone work stands in the way.** A claim is per-score and a
token reaches the whole repository, so neither the claim table nor the link
format acquires a branch. The one place a branch will surface is the clone
flow's save dialog, which will have to say which branch it is materialising —
and that is a question the peek response can answer without spending anything.

---

# 2. How the companion updates

Nothing exists here: no release workflow for the app, no feed, no version
sequence. `release.yml` already scopes itself to `hub-v*` in anticipation of
this.

## Decision 7 — the feed is the publisher's, not the hub's

The obvious-looking idea is to serve updates from the hub the user already
trusts. It is wrong. A hub is self-hosted by a band, pinned to a `HUB_VERSION`
its operator chose, and has no relationship to who builds the app. Updates
would then arrive or not depending on whose server you paste into, and a hub
operator would become able to ship code to their bandmates' machines.

The feed is a static `latest.json` on GitHub Releases, signed with a minisign
key only CI holds:

```json
"plugins": {
  "updater": {
    "pubkey": "…",
    "endpoints": ["https://github.com/<owner>/gpt/releases/latest/download/latest.json"]
  }
}
```

## Decision 8 — Developer ID first, updater second

This is the blocker and it is worth being blunt about. Today's build is ad-hoc
signed (`APPLE_SIGNING_IDENTITY="-"`). The README already records what that
costs: TCC keys the Accessibility grant to the code hash, so every rebuild
loses it. An auto-update *is* a rebuild. Shipping the updater on ad-hoc builds
means every user silently loses "which score is Guitar Pro showing" on every
update and has to go dig the stale entry out of System Settings. Expect the
keychain to behave the same way — items are ACL'd to the signing identity, and
the remote tokens live there.

So the sequence is: Developer ID + notarization in CI → then the updater. Not
the reverse.

## Decision 9 — one universal artifact

`--target universal-apple-darwin`, published under `darwin-universal`. Emit
`darwin-aarch64` and `darwin-x86_64` pointing at the same file as well; it
costs two lines and means a non-universal local build still finds an update.

## Decision 10 — offered, never imposed, and never mid-push

The app is resident. It holds a file watcher and a background push queue, and
restarting it under a push in flight is the one thing an update must not do.
So:

- check at launch and every six hours, from Rust;
- an available update is a quiet strip in the extended window — *Version 0.2.0
  is ready · What's new · Update and restart* — never a modal, never automatic;
- the tray gets *Check for updates…* so the answer is reachable without the
  window;
- install waits for `push::status` to be idle across every tracked file, and
  the strip says so rather than appearing to hang.

The download runs in Rust, so no CSP change: `connect-src` stays the fixed
allowlist it is.

## Commits

1. `ci(companion): sign and notarize the bundle` — Developer ID, the secrets,
   `companion-v*` tag trigger, artifacts on the release. No updater yet, and
   the point of the separation: this is the commit whose result has to be
   downloaded and launched by hand on a machine that never had the app.
2. `feat(companion): ship an update feed` — `createUpdaterArtifacts`, minisign
   key, `latest.json` with the three platform keys.
3. `feat(companion): check for updates` — the plugin, launch and interval
   checks, the tray item, the strip.
4. `feat(companion): install when the queue is quiet` — the idle gate and what
   the strip says while it waits.
5. `docs(companion): how releases work` — key custody, what to do when the
   private key is lost (nothing: every installed copy stops updating and has
   to be reinstalled by hand — say so where whoever holds the key will read it).
