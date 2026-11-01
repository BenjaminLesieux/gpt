# Cutting a companion release

How the companion reaches bandmates and updates itself. The decisions are in
[ADR 0014](adr/0014-the-companion-updates-itself-from-a-signed-github-feed.md).

## Once: the update signing key

Do this before the first release. The public key goes into every build, so it
cannot change later without everyone reinstalling.

```bash
pnpm --dir apps/companion tauri signer generate -w ~/.tauri/gitarpro-updater.key
```

It asks for a password. Then store both halves of the secret:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/gitarpro-updater.key
```

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

Put the contents of `~/.tauri/gitarpro-updater.key.pub` into
`apps/companion/src-tauri/tauri.conf.json` as `plugins.updater.pubkey` and
commit it. Keep the private key and password in a password manager too: GitHub
will not give them back.

## Every release

1. Bump `version` in `apps/companion/src-tauri/tauri.conf.json`. It is the only
   version that counts; the workflow refuses a tag that disagrees with it.
2. Commit, then tag and push:

   ```bash
   git tag companion-v0.1.1 && git push origin companion-v0.1.1
   ```

3. `release-companion.yml` builds a universal macOS bundle and publishes the
   `companion-v0.1.1` release (`.dmg`, `.app.tar.gz`, `.sig`, `latest.json`),
   then builds the Windows installer into the same release
   (`_x64-setup.exe`, its `.sig`, and a `windows-x86_64` entry merged into
   `latest.json`). Only then does it copy `latest.json` onto the
   `companion-latest` pre-release, after checking that both platforms are in
   it. That last copy is what installed apps read. Never delete
   `companion-latest`.

   If the Windows leg fails, the release exists with only the Mac files and
   the feed has not moved: fix, delete the release and its tag, and tag again.

Within four hours (or at next launch) each running companion downloads the
update and shows *Restart to update* in the extended window header. The
restart waits while a named version is still being pushed.

## First install, for bandmates on a Mac

1. Download the `.dmg` from the newest `companion-v*` release and drag
   Gitarpro to Applications.
2. The first launch is refused because the build is not notarized. Open
   *System Settings → Privacy & Security*, find Gitarpro, press *Open Anyway*.
3. Allow Accessibility when asked, so Gitarpro can see which score Guitar Pro
   has open.

After each update, macOS asks for Accessibility again: the grant is tied to an
ad-hoc signature that changes with every build. Allowing it again is all it
takes.

## First install, for bandmates on Windows

1. Download `Gitarpro_<version>_x64-setup.exe` from the newest `companion-v*`
   release and run it. It installs for you alone, so it asks for no
   administrator password.
2. Windows shows *Windows protected your PC*, because the installer is not
   code-signed. Press *More info*, then *Run anyway*. Some browsers also hold
   the download back first (Edge: *Keep* → *Show more* → *Keep anyway*).
3. Gitarpro opens and sits in the notification area. The panel is
   Ctrl+Shift+G. There is nothing to allow: Windows lets Gitarpro read Guitar
   Pro's window title without asking.

Updates install themselves after *Restart to update*: a progress bar shows
briefly, then Gitarpro starts again. SmartScreen does not come back.

## Testing an update locally

To exercise the whole loop without publishing anything, use a throwaway key and
a local feed. Each `--config` passed to `pnpm tauri build` is merged over
`tauri.conf.json`:

```bash
pnpm --dir apps/companion tauri signer generate --ci -p test -w /tmp/test.key
```

Build twice, `0.1.0` then `0.1.1`, with `TAURI_SIGNING_PRIVATE_KEY` and its
password set and a `--config` file holding `version`,
`bundle.createUpdaterArtifacts: true` and a `plugins.updater` whose `pubkey` is
the contents of `/tmp/test.key.pub`, whose endpoint is `http://127.0.0.1:8765/latest.json`, and
with `dangerousInsecureTransportProtocol: true`. Serve the second build's
`.app.tar.gz` with a hand-written `latest.json` (`version`, and
`platforms.darwin-aarch64` with `url` and the `.sig` contents as `signature`).
Then launch the first build's binary directly.
