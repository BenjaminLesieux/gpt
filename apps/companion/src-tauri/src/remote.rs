//! Talking to a remote.
//!
//! Only named versions travel. `refs/snapshots` is local scratch — every
//! Guitar Pro save lands there, it is pruned behind the user's back, and
//! pruning rewrites ids, so it is not something a remote could usefully hold.
//!
//! Everything here blocks on the network, so nothing here may be called from
//! somewhere the user is waiting: pushes go through the queue in
//! [`crate::push`], and fetches run off the main thread.

use std::cell::RefCell;
use std::rc::Rc;

use git2::{Cred, CredentialType, FetchOptions, PushOptions, RemoteCallbacks, Repository};
use serde::Serialize;

use crate::config::{Remote, RemoteAuth};
use crate::error::{Error, Result};
use crate::git::NAMED_REF;

/// Where the remote's named history is mirrored. Never checked out and never
/// written to by anything but a fetch — it is our record of what the remote
/// last said, which is what makes [`compare`] answerable without the network.
pub const REMOTE_REF: &str = "refs/remotes/origin/main";

/// Sent when a token carries no username of its own. Forgejo, Gitea and
/// GitHub all ignore the username on a personal access token, but libgit2
/// still has to put something in the header.
const DEFAULT_USERNAME: &str = "git";

/// How this score stands against its remote, counted in named versions.
///
/// v1 has no merge (locked decision 8), so [`SyncState::Diverged`] is a real
/// destination and not a step on the way to one: the two sides both moved and
/// nothing in this app can reconcile them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SyncState {
    /// Nowhere to sync with.
    Unconfigured,
    /// Both sides hold the same versions.
    UpToDate,
    /// The remote has versions this score does not. A pull fast-forwards.
    Behind { versions: usize },
    /// This score has versions the remote does not. A push fast-forwards.
    Ahead { versions: usize },
    /// Both sides gained versions the other has not seen.
    Diverged { ahead: usize, behind: usize },
}

/// Fast-forwards the remote's `main` to ours.
///
/// The refspec carries no leading `+`, so a remote that has moved on rejects
/// the update instead of losing versions. That rejection is reported, never
/// retried as a force — someone else's history is not ours to discard.
pub fn push(repo: &Repository, remote: &Remote, token: Option<&str>) -> Result<()> {
    let mut git_remote = repo.remote_anonymous(&remote.url)?;

    // libgit2 reports a refused ref through this callback and still returns
    // success overall; without it a rejected push would look like a clean one.
    let rejection: Rc<RefCell<Option<Error>>> = Rc::new(RefCell::new(None));
    let recorder = Rc::clone(&rejection);

    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(credentials(&remote.auth, token));
    callbacks.push_update_reference(move |refname, status| {
        if let Some(reason) = status {
            *recorder.borrow_mut() = Some(Error::PushRejected {
                refname: refname.to_owned(),
                reason: reason.to_owned(),
            });
        }
        Ok(())
    });

    let mut options = PushOptions::new();
    options.remote_callbacks(callbacks);
    let outcome = git_remote.push(&[format!("{NAMED_REF}:{NAMED_REF}")], Some(&mut options));

    // A refusal reaches us one of two ways: libgit2 sees the divergence during
    // negotiation and errors, or the server sees it and answers through the
    // callback. Same situation, so the caller is told the same thing.
    if let Some(refused) = rejection.borrow_mut().take() {
        return Err(refused);
    }
    match outcome {
        Ok(()) => Ok(()),
        Err(err) if err.code() == git2::ErrorCode::NotFastForward => Err(Error::PushRejected {
            refname: NAMED_REF.to_owned(),
            reason: "the remote holds versions this score does not".to_owned(),
        }),
        Err(err) => Err(err.into()),
    }
}

/// Updates our mirror of the remote's named history. Touches nothing else —
/// not `main`, not the `.gp` on disk.
///
/// A remote with no `main` yet is not a failure: it is a brand new repo, and
/// the honest answer is that it holds nothing.
pub fn fetch(repo: &Repository, remote: &Remote, token: Option<&str>) -> Result<()> {
    let mut git_remote = repo.remote_anonymous(&remote.url)?;

    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(credentials(&remote.auth, token));

    let mut options = FetchOptions::new();
    options.remote_callbacks(callbacks);

    // Forced, unlike the push: this ref is our copy of their history, so
    // whatever they say it is now, it is.
    let refspec = format!("+{NAMED_REF}:{REMOTE_REF}");
    match git_remote.fetch(&[refspec], Some(&mut options), None) {
        Ok(()) => Ok(()),
        Err(err) if is_missing_ref(&err) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

/// libgit2 says "not found" both for a remote that has nothing on `main` and
/// for one that cannot be reached at all — the class separates them.
fn is_missing_ref(err: &git2::Error) -> bool {
    err.code() == git2::ErrorCode::NotFound && err.class() == git2::ErrorClass::Reference
}

/// Where this score stands relative to the last fetch. No network: it reads
/// the two refs we already hold, so the UI can ask as often as it likes.
pub fn compare(repo: &Repository, remote: Option<&Remote>) -> Result<SyncState> {
    if remote.is_none() {
        return Ok(SyncState::Unconfigured);
    }

    let ours = tip_of(repo, NAMED_REF)?;
    let theirs = tip_of(repo, REMOTE_REF)?;

    Ok(match (ours, theirs) {
        (None, None) => SyncState::UpToDate,
        // Nothing fetched, or a remote that is still empty. Either way what we
        // hold is what exists.
        (Some(_), None) => SyncState::Ahead {
            versions: count_from(repo, NAMED_REF)?,
        },
        (None, Some(_)) => SyncState::Behind {
            versions: count_from(repo, REMOTE_REF)?,
        },
        (Some(ours), Some(theirs)) => {
            let (ahead, behind) = repo.graph_ahead_behind(ours, theirs)?;
            match (ahead, behind) {
                (0, 0) => SyncState::UpToDate,
                (0, behind) => SyncState::Behind { versions: behind },
                (ahead, 0) => SyncState::Ahead { versions: ahead },
                (ahead, behind) => SyncState::Diverged { ahead, behind },
            }
        }
    })
}

fn tip_of(repo: &Repository, refname: &str) -> Result<Option<git2::Oid>> {
    match repo.find_reference(refname) {
        Ok(reference) => Ok(Some(reference.peel_to_commit()?.id())),
        Err(err) if err.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn count_from(repo: &Repository, refname: &str) -> Result<usize> {
    Ok(crate::git::list(repo, refname, None)?.len())
}

/// libgit2 asks for credentials per attempt, and asks repeatedly if we keep
/// handing back something it cannot use — hence the explicit refusals.
fn credentials(
    auth: &RemoteAuth,
    token: Option<&str>,
) -> impl FnMut(&str, Option<&str>, CredentialType) -> std::result::Result<Cred, git2::Error> {
    let auth = auth.clone();
    let token = token.map(str::to_owned);

    move |_url, username_from_url, allowed| {
        match &auth {
            RemoteAuth::Token { username } => {
                let Some(token) = token.as_deref() else {
                    // The descriptor promised a token the keychain does not
                    // hold — most likely the entry was removed under us.
                    return Err(git2::Error::from_str(
                        "no token stored for this remote; set it again",
                    ));
                };
                let username = [username.as_str(), username_from_url.unwrap_or_default()]
                    .into_iter()
                    .find(|candidate| !candidate.is_empty())
                    .unwrap_or(DEFAULT_USERNAME);
                Cred::userpass_plaintext(username, token)
            }
            // An unauthenticated remote: a bare repo on disk, or a server that
            // asks for nothing. If it does ask, we have nothing to offer.
            RemoteAuth::None => {
                if allowed.contains(CredentialType::DEFAULT) {
                    Cred::default()
                } else {
                    Err(git2::Error::from_str(
                        "this remote wants credentials and none are configured",
                    ))
                }
            }
            // The descriptor can express it; the build cannot speak it.
            RemoteAuth::Ssh { .. } => Err(git2::Error::from_str(
                "ssh remotes are not supported in this build; use an https url",
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git;

    fn open(dir: &std::path::Path) -> Repository {
        git::open_or_init(dir).unwrap()
    }

    /// A bare repo on disk is a real remote as far as libgit2 is concerned:
    /// same negotiation, same refspecs, no network and no credentials.
    fn local_remote(path: &std::path::Path) -> Remote {
        Remote {
            url: path.to_string_lossy().into_owned(),
            auth: RemoteAuth::None,
        }
    }

    #[test]
    fn a_named_version_arrives_at_the_remote() {
        let dir = tempfile::tempdir().unwrap();
        let local = open(&dir.path().join("local"));
        let remote_path = dir.path().join("remote");
        let remote = open(&remote_path);

        git::commit_named(&local, b"riff bytes", "Intro").unwrap();
        push(&local, &local_remote(&remote_path), None).unwrap();

        let landed = git::list(&remote, NAMED_REF, None).unwrap();
        assert_eq!(landed.len(), 1);
        assert_eq!(landed[0].message, "Intro");
        assert_eq!(git::read_score(&remote, NAMED_REF).unwrap(), b"riff bytes");
    }

    #[test]
    fn snapshots_stay_at_home() {
        let dir = tempfile::tempdir().unwrap();
        let local = open(&dir.path().join("local"));
        let remote_path = dir.path().join("remote");
        let remote = open(&remote_path);

        git::commit_named(&local, b"riff", "Intro").unwrap();
        git::commit_snapshot(&local, b"riff, mid-edit").unwrap();
        push(&local, &local_remote(&remote_path), None).unwrap();

        assert!(git::list(&remote, git::SNAPSHOT_REF, None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn pushing_again_with_nothing_new_is_no_error() {
        let dir = tempfile::tempdir().unwrap();
        let local = open(&dir.path().join("local"));
        let remote_path = dir.path().join("remote");
        open(&remote_path);

        git::commit_named(&local, b"riff", "Intro").unwrap();
        let remote = local_remote(&remote_path);

        push(&local, &remote, None).unwrap();
        push(&local, &remote, None).unwrap();
    }

    #[test]
    fn a_remote_that_moved_on_is_refused_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let remote_path = dir.path().join("remote");
        let remote = open(&remote_path);
        let descriptor = local_remote(&remote_path);

        // Two scores that share a remote and know nothing of each other — the
        // second machine, in miniature.
        let first = open(&dir.path().join("first"));
        git::commit_named(&first, b"riff", "Intro").unwrap();
        push(&first, &descriptor, None).unwrap();

        let second = open(&dir.path().join("second"));
        git::commit_named(&second, b"different riff", "Other intro").unwrap();

        let refused = push(&second, &descriptor, None).unwrap_err();
        assert!(matches!(refused, Error::PushRejected { .. }), "{refused}");
        // The version already there survived the refusal.
        assert_eq!(git::read_score(&remote, NAMED_REF).unwrap(), b"riff");
    }

    #[test]
    fn a_score_with_no_remote_has_nothing_to_be_out_of_step_with() {
        let dir = tempfile::tempdir().unwrap();
        let local = open(&dir.path().join("local"));

        git::commit_named(&local, b"riff", "Intro").unwrap();

        assert_eq!(compare(&local, None).unwrap(), SyncState::Unconfigured);
    }

    #[test]
    fn versions_never_sent_read_as_ahead() {
        let dir = tempfile::tempdir().unwrap();
        let local = open(&dir.path().join("local"));
        let remote_path = dir.path().join("remote");
        open(&remote_path);
        let descriptor = local_remote(&remote_path);

        git::commit_named(&local, b"riff", "Intro").unwrap();
        git::commit_named(&local, b"riff II", "Second guitar").unwrap();

        // An empty remote answers "I have no main", which is an answer.
        fetch(&local, &descriptor, None).unwrap();

        assert_eq!(
            compare(&local, Some(&descriptor)).unwrap(),
            SyncState::Ahead { versions: 2 }
        );
    }

    #[test]
    fn a_pushed_score_agrees_with_its_remote() {
        let dir = tempfile::tempdir().unwrap();
        let local = open(&dir.path().join("local"));
        let remote_path = dir.path().join("remote");
        open(&remote_path);
        let descriptor = local_remote(&remote_path);

        git::commit_named(&local, b"riff", "Intro").unwrap();
        push(&local, &descriptor, None).unwrap();
        fetch(&local, &descriptor, None).unwrap();

        assert_eq!(
            compare(&local, Some(&descriptor)).unwrap(),
            SyncState::UpToDate
        );
    }

    #[test]
    fn versions_added_elsewhere_read_as_behind() {
        let dir = tempfile::tempdir().unwrap();
        let remote_path = dir.path().join("remote");
        open(&remote_path);
        let descriptor = local_remote(&remote_path);

        // The other machine commits twice and pushes.
        let elsewhere = open(&dir.path().join("elsewhere"));
        git::commit_named(&elsewhere, b"riff", "Intro").unwrap();
        git::commit_named(&elsewhere, b"riff II", "Second guitar").unwrap();
        push(&elsewhere, &descriptor, None).unwrap();

        // This one has never seen any of it.
        let here = open(&dir.path().join("here"));
        fetch(&here, &descriptor, None).unwrap();

        assert_eq!(
            compare(&here, Some(&descriptor)).unwrap(),
            SyncState::Behind { versions: 2 }
        );
    }

    #[test]
    fn a_score_edited_in_both_places_reads_as_diverged() {
        let dir = tempfile::tempdir().unwrap();
        let remote_path = dir.path().join("remote");
        open(&remote_path);
        let descriptor = local_remote(&remote_path);

        // A shared starting point, so this is divergence and not two
        // unrelated histories.
        let here = open(&dir.path().join("here"));
        git::commit_named(&here, b"riff", "Intro").unwrap();
        push(&here, &descriptor, None).unwrap();

        let elsewhere = open(&dir.path().join("elsewhere"));
        fetch(&elsewhere, &descriptor, None).unwrap();
        elsewhere
            .reference(
                NAMED_REF,
                elsewhere.refname_to_id(REMOTE_REF).unwrap(),
                true,
                "adopt",
            )
            .unwrap();

        // Both sides now write a bridge over the same version.
        git::commit_named(&here, b"riff, bridge A", "Bridge").unwrap();
        git::commit_named(&elsewhere, b"riff, bridge B", "A different bridge").unwrap();
        push(&elsewhere, &descriptor, None).unwrap();
        fetch(&here, &descriptor, None).unwrap();

        assert_eq!(
            compare(&here, Some(&descriptor)).unwrap(),
            SyncState::Diverged {
                ahead: 1,
                behind: 1
            }
        );
        // And the push that would resolve it by force is still refused.
        assert!(matches!(
            push(&here, &descriptor, None),
            Err(Error::PushRejected { .. })
        ));
    }

    #[test]
    fn fetching_leaves_our_own_versions_alone() {
        let dir = tempfile::tempdir().unwrap();
        let remote_path = dir.path().join("remote");
        open(&remote_path);
        let descriptor = local_remote(&remote_path);

        let elsewhere = open(&dir.path().join("elsewhere"));
        git::commit_named(&elsewhere, b"theirs", "Theirs").unwrap();
        push(&elsewhere, &descriptor, None).unwrap();

        let here = open(&dir.path().join("here"));
        git::commit_named(&here, b"ours", "Ours").unwrap();
        fetch(&here, &descriptor, None).unwrap();

        assert_eq!(git::read_score(&here, NAMED_REF).unwrap(), b"ours");
    }

    #[test]
    fn a_token_remote_with_nothing_in_the_keychain_fails_to_authenticate() {
        let dir = tempfile::tempdir().unwrap();
        let local = open(&dir.path().join("local"));
        git::commit_named(&local, b"riff", "Intro").unwrap();

        let remote = Remote {
            url: dir.path().join("remote").to_string_lossy().into_owned(),
            auth: RemoteAuth::Token {
                username: "ben".into(),
            },
        };

        assert!(push(&local, &remote, None).is_err());
    }
}
