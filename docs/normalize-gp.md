# Normalizing Guitar Pro files (`normalize-gp`)

Guitar Pro saves `.gp`/`.gpx` files as **zip containers**. Every save stamps the
current date/time into each zip entry header (and some versions rewrite an
editing-date element inside `Content/score.gpif`). The result: the bytes change
on every save even when **no notes changed**, so plain git reports a diff where
there is none.

`normalizeGp` (in `@gpt/gpt-core`) rebuilds the archive deterministically so that
two saves with identical musical content produce **byte-identical** output:

- entries sorted by name (stable layout),
- stored uncompressed (no deflate-implementation drift over time),
- DOS timestamp fields zeroed in every local + central-directory header,
- (optional) named volatile XML elements blanked.

Entry payloads — including the musical `score.gpif` XML — are preserved exactly,
so Guitar Pro still reopens the file losslessly.

## CLI

```bash
# Reads a .gp on stdin, writes the normalized bytes to stdout.
gpt normalize-gp < song.gp > song.normalized.gp

# Also blank an embedded editing-date element, if your files carry one:
gpt normalize-gp --volatile-elements=EditingDate < song.gp > out.gp
```

Non-zip input (e.g. legacy binary `.gp5`) is passed through unchanged, so it's
safe to point all `*.gp` at the filter regardless of format.

## Wiring it as a git clean filter (real `git` CLI)

This makes musically-identical saves invisible to `git status` / `git diff` when
you use the **standard git command line** (or a GUI built on it).

`.gitattributes` (committed to the repo):

```gitattributes
*.gp   filter=gpnorm
*.gpx  filter=gpnorm
```

Per-clone git config (run once; `gpt` must be on `PATH`):

```bash
git config filter.gpnorm.clean "gpt normalize-gp"
# clean-only: we normalize what goes *into* git; the working tree is left as GP wrote it.
```

> The `clean` filter rewrites the blob stored in git, not your working file.
> Git recompresses blobs in its packfiles, so the stored-uncompressed archive
> does not bloat the repository.

## ⚠️ Important: the gpt app does not use this filter

The gpt desktop/CLI app computes status with **isomorphic-git**, which does
**not** execute git clean/smudge filters. So the `.gitattributes` setup above
only affects the real `git` CLI — it will **not** stop phantom changes from
showing in the gpt app's Changes view.

To fix phantom changes **inside the gpt app**, `normalizeGp` must be wired into
gpt's own status/diff/stage path — i.e. treat a `.gp` file as unchanged when
`normalizeGp(workingTree)` equals `normalizeGp(HEAD blob)`. That is a separate,
app-level integration (see the status command in `apps/cli/src/commands/status.ts`).
