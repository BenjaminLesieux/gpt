# Smoke-testing the alpha

The automated suites cover the pieces: `cargo test` for storage, watching and
sync, `vitest` for the webview. What none of them touch is the whole gesture
end to end, in the bundled app, against a real Guitar Pro.

Run this against the `.app`, not `tauri dev`. The differences are exactly where
things break: the dev build disables blur-to-dismiss, runs unminified, has
devtools, and is not the binary TCC granted anything to.

```bash
APPLE_SIGNING_IDENTITY="-" pnpm nx bundle @gpt/companion
open apps/companion/src-tauri/target/release/bundle/macos/
```

Drag `Gitarpro.app` to `/Applications`, then right-click → **Open** the first
time — it is ad-hoc signed, so Gatekeeper refuses a double-click. See the
companion README's *Bundling* section for why.

## Starting clean

The app keeps everything under one directory, so a clean run is one move:

```bash
mv ~/Library/"Application Support"/com.gitarpro.companion{,.bak}
```

Tokens live in the login keychain, not there — Keychain Access, service
`com.gitarpro.companion`, if you want those gone too.

## The loop

**Track**

1. Launch. There should be a plectrum in the menu bar and **no dock icon at any
   point**, including the moment of launch. A bounce means `LSUIElement` did not
   make it into the bundle.
2. Left-click the tray. The panel offers *Track a Guitar Pro file*; pick one.
   The picker is a native modal and the panel must stay open behind it — the
   panel dismisses on blur, and this is the one case that is suppressed.

**Save → snapshot**

3. Open the same file in Guitar Pro, change a note, save (⌘S).
4. Hit **⌘⇧G**. The panel says *1 unnamed save*. This is the silent tier: the
   save was captured with nothing asked of you.
5. Save twice more in quick succession. Still counts them individually, but a
   single save must never produce two — writes within 500 ms of each other
   debounce into one capture.

**Name a version**

6. With the panel open, type a message and press **Enter**. The panel confirms
   briefly and dismisses itself. Watch the clock here: hotkey to visible is
   meant to stay under ~100 ms, and this is the only place you will notice it
   slipping.
7. ⌘⇧G again — the version is in *Recent versions*, and the unnamed-save count
   is back to zero.
8. Name a version with nothing changed since the last one. It must refuse
   rather than record an empty version.

**Which file is active**

9. Open a second tracked file in Guitar Pro and save it. The panel follows —
   *active file* is whichever tracked file was saved last.
10. With an **untracked** score in front in Guitar Pro, open the panel: it
    should say Guitar Pro has that file open and offer to track it. If it
    instead says it cannot see what Guitar Pro has open, the Accessibility
    grant is missing or stale — see below.
11. **⌘K** opens the switcher, `Esc` steps back to the commit view, a second
    `Esc` closes the panel.

**Diff**

12. **Full window** from the panel. The timeline lists named versions under
    *Versions* and the silent ones under *Recovery*.
13. Select a version, **Compare with previous**. Both panes render, the changed
    bars are marked in both, and the same measure sits across from itself —
    that alignment is the whole feature, and a row break in one pane that is
    not in the other is the way it goes wrong.
14. Switch tracks. A track you did not touch reads *no change* even though the
    version as a whole changed.
15. Press play. Audio comes out and the cursor tracks it; the cursor stays
    behind any dialog you open over it.

**Restore**

16. **Restore** an older version. Confirm the dialog says the current contents
    are snapshotted first.
17. The `.gp` on disk changes and Guitar Pro offers to reload it. Check
    *Recovery* for the safety snapshot of what was there — restoring is not
    supposed to be able to lose anything.

**Sync**

18. Point the score at a remote and run [`forgejo-check.md`](forgejo-check.md).
    It covers push, both kinds of failure, pull, and divergence, and does not
    need repeating here — but run it against the **bundle** at least once. The
    keychain prompt behaves differently for an app that was just installed than
    for one Cargo rebuilt in place.

## Accessibility

Step 10 is the one that fails for reasons unrelated to the code. The grant is
tied to the code signature, and an ad-hoc signature changes on every build, so
a rebuilt app inherits a dead entry:

**System Settings → Privacy & Security → Accessibility** — remove `Gitarpro`,
then let the app ask again. macOS will not replace the stale entry on its own,
and a toggle that is already on but does not work is exactly what that looks
like.

Everything else in this document works without the grant. Only step 10 —
knowing which score Guitar Pro has in front — depends on it.

## What this does not cover

- **Windows.** Nothing here has been run there; the tray, the shortcut and the
  panel window are all platform surfaces.
- **Snapshot pruning.** The policy is 200 snapshots within 14 days, which no
  hand-run session will reach. `cargo test` covers it.
- **Anything at score scale.** Everything above works on one small file. Large
  scores, many tracked files, and a long history are untested by hand.
