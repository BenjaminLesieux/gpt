# Recordings are uploaded to the hub, not linked

A **recording** — a maquette or a demo — is an audio file a member uploads to
the hub. The hub stores it beside the git repositories and plays it on the
song's page. It is never versioned: a new take is a new recording.

## Why upload, when a link costs nothing

The problem being solved is a band that cannot find its own demos. They already
exist, scattered across phones, Drive folders and chat threads. A recording
that is a link to one of those places keeps them scattered:

- links die when someone tidies their Drive or leaves the band;
- playback depends on another site's sharing settings, per file, per member;
- the hub would make a third-party request from a page that makes none today
  (the same reason 0007 refused gravatars).

Supporting both upload and link was considered and refused: two kinds of
recording to show, two code paths, and the scattered kind wins by being easier.

## The cost, stated plainly

**Disk on a self-hosted box.** Repositories are kilobytes; a WAV of a rehearsal
is hundreds of megabytes. Uploads carry a per-file size limit, lossy formats are
encouraged, and backups now include audio — `hub-deploy.md` has to say so.

**Not in git.** Audio does not diff, and putting it in the repository would make
every clone carry every take. Recordings live outside the repositories, so the
companion never downloads them.
