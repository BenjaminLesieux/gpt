# The companion updates itself from a signed GitHub feed, and the first build carries the key

A build handed to a bandmate without an updater can never update itself: the
only way forward from it is another hand-delivered build. So the updater ships
in the very first build anyone installs, and everything it trusts is fixed at
that moment.

## The decision

- **Tauri's updater** (`tauri-plugin-updater`), driven from Rust in
  `update.rs`. Checked on launch and every four hours, downloaded in the
  background, installed only when the user presses *Restart to update* in the
  extended window. Never the panel: it is a 420×320 card with a latency budget.
- **The feed is `companion-latest/latest.json`** on this repository's GitHub
  Releases. `releases/latest` is not usable: `hub-v*` releases share the
  repository and would take that slot. `release-companion.yml` builds each
  `companion-v*` tag into its own release, then copies that release's
  `latest.json` onto the `companion-latest` pre-release. Moving the feed is the
  last step, so a failed build never announces itself.
- **Updates are signed with a minisign key** the owner generated. The public
  half is in `tauri.conf.json`; the private half and its password are repo
  secrets. An archive that does not verify against the baked-in key is refused.
- **One universal macOS binary.** Apple Silicon and Intel read the same archive.
- **Code signing is ad-hoc** (`APPLE_SIGNING_IDENTITY=-`). There is no Apple
  Developer Program account yet.
- **`tauri.conf.json`'s `version` is the version.** The workflow refuses a tag
  that disagrees with it.

## Why the restart waits for the user, and for the push queue

The push queue (`push.rs`) lives in memory. Restarting while a named version is
queued or in flight drops it until the next commit. So the restart is refused
while any push is pending, and the window says so. Restarting the companion
does not touch Guitar Pro or its unsaved work, but the user is the only one who
knows whether now is a good moment, so nothing restarts on its own.

## What it costs

- **The public key can never change.** Every installed build trusts exactly
  one key. Losing the private key, or its password, or rotating it, means every
  bandmate reinstalls by hand. Keep a copy outside GitHub (a password manager):
  repo secrets cannot be read back.
- **The feed URL can never change** for the same reason. Renaming the repository
  or deleting the `companion-latest` release strands every install.
- **First install fights Gatekeeper.** An ad-hoc signature is not a Developer
  ID, so macOS refuses the first launch of a downloaded copy. Bandmates open it
  once through *System Settings → Privacy & Security → Open Anyway* (or
  `xattr -dr com.apple.quarantine /Applications/Gitarpro.app`). Updates are
  downloaded by the app, not a browser, so they carry no quarantine and do not
  ask again.
- **Accessibility is re-asked after every update.** macOS ties the grant to the
  code signature's designated requirement, and an ad-hoc signature's
  requirement is the binary's own hash (`codesign -d -r-` prints
  `cdhash H"…"`). Every update has a new hash, so Guitar Pro binding goes blind
  until the user allows Gitarpro again. Everything else keeps working.
- **No Windows build.** Some of the band is on Windows, and the companion reads
  Guitar Pro through macOS accessibility. A Windows port adds a leg to the
  workflow; `latest.json` already keys entries per platform, so it joins the
  same feed without changing anything an installed Mac trusts.

## The way out of ad-hoc

A Developer ID certificate plus notarization removes both Gatekeeper and the
Accessibility re-prompt. A self-signed code-signing certificate, imported in
the workflow, removes only the re-prompt: its designated requirement names the
certificate rather than the hash, so it survives updates. Either is a change to
the workflow's signing environment only. The update key and feed are untouched,
so switching does not need a reinstall.
