# Companion sign-in

The detail behind [ADR 0011](adr/0011-the-companion-needs-an-account.md). Read
the ADR first.

## Shape

```text
companion                     browser                         hub
─────────                     ───────                         ───
verifier, challenge, state
open /connect?challenge&state&device ──►  signed in? (session cookie)
                              "Connect Gitarpro on <device>?"
                              [Connect] ── POST /companion/codes ──►  mint code
                              ◄── gitarpro://signed-in?hub&code&state
state matches?
POST /companion/tokens {code, verifier, device} ───────────────────►  spend code,
◄────────────────────────────────────── {token, email} ─────────────  check PKCE,
keychain ← token                                                      mint token
config   ← {hub, email}
```

## Hub

**Tables.** Two, each a sibling of something that already exists — read that
first and mirror it.

- `companion_codes(id, account_id, code_hash, challenge, created_at,
  expires_at, redeemed_at)` — `clone_claims`' shape. Five minutes, single use,
  spent by the UPDATE's WHERE so two redemptions are one token and one refusal.
- `companion_tokens(id, account_id, token_hash, device, created_at,
  last_used_at, revoked_at)` — `score_tokens`' shape, minus the score.

**Routes**, under a new `/companion` prefix registered as its own plugin scope:

| Route | Auth | Does |
|---|---|---|
| `POST /companion/codes` | session | mints a code bound to the PKCE challenge |
| `POST /companion/tokens` | code + verifier | spends the code, mints a companion token |
| `GET /companion/me` | companion token | `{ email }` — also how a revoked token is noticed |
| `GET /companion/scores` | companion token | the scores the account is a member of |
| `POST /companion/scores/:id/token` | companion token | a score token for one of them — adoption without the triple |
| `DELETE /companion/tokens/:id` | session | revoke, from the web |

PKCE is S256 only. A `plain` challenge is refused, not downgraded.

**Authorship.** `git/history.ts` reads `%ae`. It maps
`companion@gitarpro.app` to *no author* — `authorEmail` omitted — so the
history shows nothing rather than *CO* for versions made before this.

## Hub web

- **`/connect`** — a page, not an API route. Signed out, it goes through the
  existing sign-in and comes back. Signed in, it names the device from the
  query and asks once. **Connect** posts for a code and navigates to the
  `gitarpro://` link; the page then says *you can close this tab*.
- **Devices** — a signed-in companion appears with the machines already listed
  on a score, with a revoke action.

## Companion

**Rust.**

- `auth.rs` — verifier and challenge (32 random bytes, S256), the pending
  `state`, `sign_in` (open the browser), `complete` (on the deep link), `sign_out`.
  The pending state lives in memory only: a link arriving after a restart was
  not asked for by this process and is refused.
- `deep_link.rs` — a second action, `signed-in`, beside `adopt`. Same parsing
  rules: `url`'s own query parser, both values untrusted.
- `hub.rs` — `redeem_code`, `me`, `scores`, `score_token`. The same https check
  and timeout as the claim calls.
- `secrets.rs` — the companion token under a fixed key (`account`), beside the
  per-file remote tokens.
- `config.rs` — `account: Option<{ hub, email }>`. The email is here, not only
  in the keychain, because it signs every commit and the keychain can prompt.
- `git.rs` — `AUTHOR_NAME` / `AUTHOR_EMAIL` stop being constants. Commits take
  a `Signature` built from the account; name is the email's local part, since
  accounts have no display name.
- `watcher.rs` — does not start, and stops, while signed out.

**Frontend.** Both windows open on a sign-in screen while signed out: one
button, a line saying why, and — after the browser opened — *waiting for the
browser* with a way to start again. The panel is 420×320 and gets the compact
version. `ExtendedApp.spec.tsx` and `PanelApp.spec.tsx` need a signed-in
default in their IPC mocks.

## Traps

**`/connect` must not fall under an API prefix.** `app/plugins/web.ts` decides
page-or-API by prefix, and so does `hub-web/vite.config.mts`, separately. Add
`/companion/` to both lists and keep `/connect` out of both — the score page
already cost someone a blank screen this way.

**Deep links cannot be exercised under `tauri dev`.** macOS registers the scheme
from the bundle's `Info.plist`; test the full flow from a bundled app in
`/Applications`. `auth.rs` is unit-tested with the link handed in directly.

**The signature is part of the commit id.** Nothing may rewrite existing
versions to fix their author — the hub has seen those ids.

## Order

1. **[#30](https://github.com/BenjaminLesieux/gpt/issues/30) `feat(hub): a companion can sign in`** — tables, migration, routes,
   PKCE. Race test on the code, like `claims.spec.ts`.
2. **[#31](https://github.com/BenjaminLesieux/gpt/issues/31) `feat(hub-web): connect a companion`** — `/connect`, devices, revoke.
3. **[#32](https://github.com/BenjaminLesieux/gpt/issues/32) `feat(companion): sign in through the browser`** — Rust flow, deep link,
   keychain, the sign-in screen, the watcher gated.
4. **[#33](https://github.com/BenjaminLesieux/gpt/issues/33) `feat(companion): sign versions as you`** — commit signature from the
   account; the hub stops showing *CO*.
5. **[#34](https://github.com/BenjaminLesieux/gpt/issues/34) `feat(companion): pick a score instead of pasting it`** — list and adopt
   through the companion token.
