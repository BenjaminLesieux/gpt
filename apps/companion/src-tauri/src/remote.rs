//! Talking to a remote.
//!
//! Only named versions travel. `refs/snapshots` is local scratch — every
//! Guitar Pro save lands there, it is pruned behind the user's back, and
//! pruning rewrites ids, so it is not something a remote could usefully hold.
//!
//! Nothing here is allowed to be slow on the caller's behalf: this module
//! blocks on the network by definition, so the only correct place to call it
//! from is a background thread — which is the next commit's job, and why
//! nothing outside the tests calls in yet.
#![allow(dead_code)]

use std::cell::RefCell;
use std::rc::Rc;

use git2::{Cred, CredentialType, PushOptions, RemoteCallbacks, Repository};

use crate::config::{Remote, RemoteAuth};
use crate::error::{Error, Result};
use crate::git::NAMED_REF;

/// Sent when a token carries no username of its own. Forgejo, Gitea and
/// GitHub all ignore the username on a personal access token, but libgit2
/// still has to put something in the header.
const DEFAULT_USERNAME: &str = "git";

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
