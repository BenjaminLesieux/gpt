# The hub serves git itself; there is no forge behind it

`POST /scores` runs `git init --bare --initial-branch=main` under the hub's own
data directory and mints a token in the hub's own database. Git reaches the
outside through one Fastify route that proxies `git http-backend`, and that
route is the only thing checking whether a token may touch a repository.

This replaces Forgejo, which [the v1 plan](../hub-v1-plan.md) had provisioning
accounts through three site-admin API calls. Those calls were built, verified
against a live `forgejo:16.0.3`, and are now removed.

## Why not Forgejo

Nothing was wrong with it. It worked on the first try and the isolation it
promised held — a repo-scoped token pushed to its own repository and got a 403
on its sibling. The problem is the ratio.

Forgejo is a forge: issues, pull requests, CI, packages, webhooks, 2FA, an
SSH server, a web UI. The hub used four endpoints of it and showed none of its
pages to anybody — a musician never loads it, by design. In exchange it brought:

- a site-admin token that nothing can bootstrap from inside the product, so
  standing up an instance began with a manual step;
- provisioning across two systems with no transaction between them, which is
  why the plan needed `scores.state`, `accounts.forgejo_provisioned_at`, and a
  *Finish setup* screen for the case where the repo exists and the token does
  not;
- opaque `gp<base32>` usernames, because Forgejo's namespace has a charset, a
  length cap and a reserved-word list that user input cannot be trusted against;
- a hard dependency on `>= 16.0.0`, since the admin token endpoint does not
  exist before it;
- a second public origin. The clone URL points at the git server, so Forgejo
  has to be reachable from the internet with its own TLS, its own `ROOT_URL`
  and its own hardening.

Serving git directly deletes all five. Provisioning becomes one local `git init`
and one row, in one system, so it either happened or it did not — the resumable
two-phase state and the screen that surfaced it both stop existing. Repository
names need no laundering because the hub owns the namespace. And there is one
process on one origin behind one certificate.

Isolation gets stronger rather than weaker. Under Forgejo it was *trust the
scope model of another system*; now the route resolves `/:account/:score.git`
and refuses anything the presented token does not own.

## Why still git

The versioning model is not what earns it — `gpt-core` diffs AlphaTab models,
never git objects, and `companion` touches a deliberately tiny slice of libgit2:
blobs, a one-entry tree, a commit per version, two ref namespaces, an
ahead/behind check, and push/fetch.

Git earns it twice over anyway.

**Transport.** Push and fetch over HTTPS are resumable, atomic per ref, offline
tolerant, and answer *did this land* precisely. Replacing them means writing a
sync protocol, which [companion decision 9](../companion-v1-plan.md) forbids in
as many words: *no custom sync protocol, ever*.

**Storage, by a margin worth writing down.** Normalization rebuilds `.gp` with
`CompressionMethod::Stored` ([normalize-gp](../normalize-gp.md)), so the bytes
git sees are uncompressed XML rather than a deflate stream. Git's delta and
zlib then work as intended. Measured on a synthetic 350 KB score edited eight
notes at a time:

| | |
| --- | --- |
| 100 versions written | 34.6 MB of raw `.gp` |
| the resulting repository | **224 KB** |

A real `.gp` carries entries that delta less kindly, so treat the true ratio as
10–30× rather than 150×. Either figure makes server-side storage a non-problem:
10,000 scores at 100 versions each is single-digit to low-tens of GB.

That number is also the argument against the tempting alternative — drop git,
keep `(score, version, blob)` rows with the blobs in object storage. It is
object-storage-native and conceptually smaller, and it would store the 34.6 MB
that git stores in 224 KB, because it keeps whole copies of a file that changed
by eight notes.

## Repositories live on a disk, not in a bucket

Object storage mounted as a filesystem is a trap. Git does many small random
reads and updates refs through atomic rename and `.lock` files; S3 offers
neither, so the arrangement works in a demo and races under concurrency. The
correct version of that idea is JGit's `DfsRepository`, which keeps packfiles
in object storage and refs in a database — proven, and running under Gerrit —
but it is Java, so adopting it means adding a JVM service to avoid adding a
volume.

So: repositories on the hub's volume, and object storage as the durability
layer behind a backup job. At the sizes above the whole deployment fits in one
nightly bundle.

## What this costs

**The hub is now stateful.** Its data directory is authoritative, so it cannot
be scaled by running a second replica behind a load balancer. That is the price
of this decision and it is worth naming while it is cheap to reverse. The
mitigations, in the order they would be reached for: one writer with a large
disk, which the storage measurement says goes a long way; sharding by account;
and only then a DFS-backed implementation.

**The `git` binary is a runtime dependency of the image**, because
`git-http-backend` ships with it rather than being reimplementable in a library.

## What the spike settled

A ~50-line Fastify route proxying `git-http-backend` was enough to clone, push
`refs/heads/main`, push `refs/snapshots/latest`, fetch both back, reject a
token that was never issued with 401, and reject a valid token aimed at a
sibling repository with 403.

Two things it taught:

- **Git's POST bodies must reach the CGI unbuffered.** `git-receive-pack` and
  `git-upload-pack` stream, so the route needs a content-type parser that hands
  over the raw stream for `application/x-git-*`, and `reply.hijack()` to write
  the CGI's headers and body straight to the socket.
- **`git init --bare` sets `HEAD` to `refs/heads/master`.** Companion pushes
  `main`, so a clone of such a repository transfers every object and then fails
  to check anything out — *remote HEAD refers to a nonexistent ref*. Creating
  with `--initial-branch=main` fixes it. This is the gap Forgejo's `auto_init`
  was covering without anyone having to know about it.
