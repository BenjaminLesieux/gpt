# Running a hub

The hub is the server the companion app pushes to. This is how to run one
for yourself or your band. It assumes no knowledge of this repository — the
three files in [`deploy/`](../deploy) are all you need, and you can copy them
out and throw the rest away.

## What it needs

- A machine with Docker and the compose plugin, reachable from the internet
  on ports 80 and 443.
- A domain name whose A (and AAAA, if you have v6) record already points at
  it. This has to be true *before* the first start: Caddy proves control of
  the name over those two ports, and Let's Encrypt limits how often you may
  fail at that for the same domain.
- About 512 MB of RAM. Scores are small — git stores a hundred versions of a
  full arrangement in a couple of megabytes, because the `.gp` container is
  written uncompressed for exactly that reason (see
  [ADR 0006](adr/0006-the-hub-serves-git-itself.md)).

Not needed: a database server, an object store, a git host. The hub serves
git itself, out of a directory.

## Install

```bash
cp -r deploy /srv/gitarpro-hub && cd /srv/gitarpro-hub
cp .env.example .env
```

Edit `.env`: `HUB_DOMAIN` is the name your musicians will paste into the app,
`HUB_ACME_EMAIL` is where certificate-expiry warnings go. Set `HUB_VERSION`
to a release rather than leaving it at `latest`, so that a `pull` cannot
change the version under you unattended. Then:

```bash
docker compose up -d
```

Two containers come up. The hub migrates its database before it listens, so
the first health check can arrive before it is answering — Caddy waits for
healthy, and that is deliberate: it asks for the certificate on the first
request, and a failed challenge counts against the same weekly limit.

Confirm it:

```bash
curl https://<your domain>/health
```

`{"status":"ok"}` means the certificate was issued and the hub is behind it.
If it hangs instead, `docker compose logs caddy` will name the challenge that
failed — almost always DNS that has not propagated yet.

## Making the first account

The hub has no web UI yet, so the account and the first score are made over
the API. The session lives in a cookie, which `-c`/`-b` keep in a jar:

```bash
curl -sc /tmp/hub.jar -X POST https://<your domain>/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"a-long-enough-password"}'

curl -sb /tmp/hub.jar -X POST https://<your domain>/scores \
  -H 'content-type: application/json' \
  -d '{"name":"My song"}'
```

The second call answers with the three values the companion's **Set up sync**
dialog asks for, and it is the only time the token exists anywhere you can
read it:

```json
{ "url": "https://<your domain>/git/<account>/<score>.git",
  "username": "<account>",
  "token": "<48 chars>",
  "tokenName": "companion" }
```

Nothing stores that token — the database keeps only its hash. Lose it and the
answer is a new score, not a recovery. One token reaches exactly one
repository, so handing it to a bandmate gives them that song and nothing
else.

Signup is rate-limited to five an hour per caller, which is worth knowing
before you invite four people at once.

## Upgrading

```bash
cd /srv/gitarpro-hub
# Edit HUB_VERSION in .env to the new release, then:
docker compose pull hub && docker compose up -d hub
```

Migrations run at boot, so there is no separate step and no window where the
schema and the code disagree. Take a backup first anyway: a migration that
drops a column is not reversible by downgrading the image.

## Backing up

Everything the hub owns is the `hub-data` volume:

- `/data/hub.sqlite` — accounts, sessions, score names, token hashes.
- `/data/git-repos` — the scores themselves, one bare repository each.

**Back the two up together.** They are not independent: a score row whose
repository is missing is broken in a way no migration repairs, and a
repository with no row is unreachable. That is the cost ADR 0006 accepted in
exchange for git doing the versioning.

**Stop the hub first.** A live copy is not safe to take: SQLite is in WAL
mode, so a database copied mid-write can come back torn, and a repository
copied mid-push can come back with a ref pointing at objects that are not
there yet. The stop costs a few seconds, and a push that arrives during it is
retried by the companion on its own — the app is built so that the network
failing never loses a version.

```bash
docker compose stop hub
docker run --rm \
  -v gitarpro-hub_hub-data:/data:ro \
  -v "$PWD/backups:/backup" \
  docker.io/alpine tar czf "/backup/hub-$(date +%F).tar.gz" -C /data .
docker compose start hub
```

Then copy that tarball somewhere that is not this machine. The volume name is
`<compose project>_hub-data`, and the project is named `gitarpro-hub` in the
compose file, which is why it does not change if you rename the directory.

## Restoring

Onto an empty volume, with the hub stopped:

```bash
docker compose stop hub
docker run --rm \
  -v gitarpro-hub_hub-data:/data \
  -v "$PWD/backups:/backup:ro" \
  docker.io/alpine sh -c 'rm -rf /data/* && tar xzf /backup/hub-YYYY-MM-DD.tar.gz -C /data'
docker compose start hub
```

Restore onto the same version of the image that took the backup, or a newer
one — migrations run forward at boot. An older image will not read a database
that a newer one has migrated.

Musicians do not have to do anything after a restore. The clone url, the
username and the token all still work, because all three are derived from
values that came back with the backup. A version pushed after the backup was
taken is still in the companion's own repository on their Mac and is pushed
again on the next attempt.

## Where the image comes from

Pushing a `hub-v1.2.3` tag builds and publishes
`ghcr.io/benjaminlesieux/gpt/hub` for `linux/amd64` and `linux/arm64`, tagged
`1.2.3`, `1.2`, `1` and `latest`. The git tag carries the `hub-v` prefix
because the companion app ships out of the same repository and will want its
own version sequence; the image tag does not.

A fork can publish its own by running the same workflow — it derives the
image name from the repository rather than hardcoding one — and then pointing
`HUB_IMAGE` at it.

The arm64 image is built on amd64 hardware under emulation, so a release
takes a while. Only the dependency install is genuinely per-architecture:
the JavaScript is built once by Nx before the image build starts, and the
Dockerfile compiles nothing.

## What this deployment does not do

- **It does not scale to a second replica.** The data directory is
  authoritative and git's own locking assumes one machine owns it. Two hubs
  behind a load balancer would corrupt repositories. Vertical growth and a
  bigger disk is the whole story for now.
- **There is no password reset and no email of any kind.** The hub sends
  nothing, so a forgotten password is a database edit.
- **There are no quotas.** Score creation is rate-limited to thirty an hour
  per account, which stops a loop but not a determined person filling your
  disk. Run this for people you know.
- **Backups are yours to schedule.** Nothing here runs on a timer.
