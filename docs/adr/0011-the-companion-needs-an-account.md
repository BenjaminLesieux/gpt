# The companion needs an account, and signs every version with it

The companion signs every commit `Gitarpro <companion@gitarpro.app>`. The hub
reads authorship from the commit (`%ae` in `apps/hub/src/git/history.ts`), so
every version pushed from the app shows the same *CO* square on the score page,
whoever made it. For a band, *who did this* is half of what the history is for.

From now on **the companion cannot be used signed out.** It signs in to a hub
through the browser, holds an account token in the keychain, and authors every
version — named or snapshot — as that account.

## Why sign-in, and not just the score token

Since ADR 0007 a score token names a person, so the companion could ask the hub
*whose token is this* and sign with the answer. It would fix the avatars for
files already connected to a hub, and nothing else: a file tracked before it is
connected would still be anonymous, and the companion would still have no way
to list your scores.

That list was deferred in `docs/hub-next-adoption-and-import.md` because it
*wants an account-scoped credential first*. This ADR is that credential, and the
deferral ends with it.

## Why forbidden when signed out

Because every other answer is an author that is sometimes true.

A signed-out mode would commit with the placeholder, the hub would have to
treat that email as *nobody*, and the history would be a mix of people and
gaps with no way to fill the gaps later — a commit's author is part of its id.
Requiring an account makes authorship a property of every version rather than
of the ones made while someone happened to be signed in.

**Signed in and offline is not signed out.** The token and the account's email
are held locally; versions are made and signed without a network. The hub is
asked again only when it is reachable, and a revoked token signs the companion
out then.

## The flow

No password is ever typed into the companion.

1. The companion generates a PKCE verifier and a `state` nonce, and opens the
   hub's `/connect` page in the browser with the challenge and the nonce.
2. The browser signs in as usual — the session cookie never leaves it.
3. The hub mints a one-time code and hands it back as
   `gitarpro://signed-in?hub=…&code=…&state=…`.
4. The companion checks the nonce, sends the code **and the verifier** to the
   hub, and receives an account token and the account's email.

This is the clone claim's shape (`scores/claims.ts`, `deep_link.rs`) with two
additions the claim did not need. **PKCE**, because `deep_link.rs` already
names the risk: any installed app may register `gitarpro://`, and a code
intercepted there is useless without the verifier, which never left the
companion. **The nonce**, because a link the companion did not ask for must not
sign it in — otherwise a crafted link signs you in as someone else, and your
next version is authored in their name.

## What the account token can do

- say who it belongs to;
- list the account's scores;
- mint a score token for a score the account is a member of — which is how a
  signed-in companion adopts a score without the pasted triple.

It **cannot push.** Pushing stays on score tokens, one per score, so the
isolation `readScoreToken` guarantees is untouched: a leaked account token
reads a list and mints tokens the hub can see and revoke, and a leaked score
token still buys exactly one score.

Stored hashed, like every other secret on the hub. Revocable from the hub's
web interface, where a signed-in companion appears as a device.

## What happens to what already exists

- **An existing install** opens on the sign-in screen after the update. Tracked
  files, their repositories and their history are untouched.
- **Versions already committed** keep the placeholder author; rewriting them
  would change every id the hub has already seen. The hub shows no author for
  `companion@gitarpro.app` rather than *CO*.
- **The pasted triple** stays for scores on a hub the companion is not signed
  in to, and for self-hosters.

## What it costs

- **No anonymous use.** Someone who wanted local version history and nothing
  else now needs an account on a hub. That is the point, but it is a real door
  closed.
- **Saves are not snapshotted while signed out.** The watcher stops with the
  rest of the app. Signing out is rare and deliberate; the sign-in screen says
  so.
- **The first launch needs a network.** Offline afterwards is fine.
- **A second credential class on the hub**, with its own table, revocation and
  tests.

## Open

**Which is the truth when they disagree: the commit's author, or the person
whose token pushed it?** A commit's author is whatever the client wrote;
`score_pushes` records who actually pushed. With every companion signing
correctly they agree, and this ADR does not decide it. It needs deciding before
anything else can write commits to a hub.
