//! Taking a remote version into the score.
//!
//! The counterpart to [`crate::push`], and the only operation in the app that
//! overwrites the user's `.gp` on the strength of something another machine
//! said. Two rules follow from that.
//!
//! It fast-forwards or it stops. Locked decision 8 keeps merge out of v1, so a
//! score that changed in both places is a situation this app reports rather
//! than resolves — `gpt-core` can merge scores, but nothing here may decide on
//! the user's behalf which bridge was the real one.
//!
//! And whatever is on disk is snapshotted before it is replaced, exactly as a
//! restore does. Guitar Pro may have saved something since the last named
//! version, and a pull is not allowed to be the thing that loses it.

use serde::Serialize;

use crate::error::{Error, Result};
use crate::git::{self, Version};
use crate::normalize::normalize_gp;
use crate::remote::{self, SyncState, REMOTE_REF};
use crate::secrets;
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pulled {
    /// Where the score stands now that the pull is done.
    pub state: SyncState,
    /// The version now in the file. `None` when there was nothing to take.
    pub version: Option<Version>,
    /// What was on disk beforehand, kept in case the pull was not wanted.
    /// `None` when disk already matched a version we hold.
    pub safety: Option<Version>,
}

/// Asks the remote what it has and, if it has versions built on ours, makes
/// the newest of them the score on disk.
pub fn pull(state: &AppState, id: &str) -> Result<Pulled> {
    let file = state.tracked(id)?;
    let Some(descriptor) = file.remote.as_ref() else {
        return Err(Error::NoRemote(file.name.clone()));
    };

    let token = secrets::for_remote(id, descriptor)?;
    let repo = state.open_repo(&file.id)?;
    remote::fetch(&repo, descriptor, token.as_deref())?;

    let standing = remote::compare(&repo, Some(descriptor))?;
    match standing {
        SyncState::Behind { .. } => {}
        SyncState::Diverged { ahead, behind } => {
            return Err(Error::Diverged(file.name.clone(), ahead, behind))
        }
        // Up to date, ahead, or nowhere to pull from: the remote has nothing
        // this score is missing, and the file on disk is not touched.
        _ => {
            return Ok(Pulled {
                state: standing,
                version: None,
                safety: None,
            })
        }
    }

    let onto = repo.refname_to_id(REMOTE_REF)?;
    let arriving = git::read_score(&repo, REMOTE_REF)?;

    let safety = match std::fs::read(&file.path) {
        Ok(current) => git::commit_snapshot(&repo, &normalize_gp(&current))?,
        // The file is gone; the pull is the recovery, nothing to preserve.
        Err(_) => None,
    };

    // Disk before ref. If this ordering breaks halfway the score still reads
    // as behind, and pulling again finishes the job; the other way round it
    // would read as up to date while holding the old music.
    std::fs::write(&file.path, &arriving)?;
    let version = git::fast_forward_named(&repo, onto)?;

    state.set_active(&file.id);
    Ok(Pulled {
        state: remote::compare(&repo, Some(descriptor))?,
        version: Some(version),
        safety,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Remote, RemoteAuth, TrackedFile};
    use crate::git::NAMED_REF;
    use std::path::PathBuf;

    /// A tracked score with a bare repo standing in for the server, and a
    /// second repo playing the other machine.
    struct Fixture {
        _dir: tempfile::TempDir,
        state: AppState,
        id: String,
        score: PathBuf,
        remote_path: PathBuf,
        elsewhere: git2::Repository,
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let score = dir.path().join("riff.gp");
        std::fs::write(&score, b"take one").unwrap();

        let state = AppState::load(dir.path().join("data")).unwrap();
        let file = TrackedFile::new(score.clone());
        let id = file.id.clone();
        let remote_path = dir.path().join("remote");
        git::open_or_init(&remote_path).unwrap();

        state
            .update(|config| {
                let mut file = file;
                file.remote = Some(Remote {
                    url: remote_path.to_string_lossy().into_owned(),
                    auth: RemoteAuth::None,
                });
                config.tracked_files.push(file);
                Ok(())
            })
            .unwrap();

        let elsewhere = git::open_or_init(&dir.path().join("elsewhere")).unwrap();
        Fixture {
            score,
            state,
            id,
            remote_path,
            elsewhere,
            _dir: dir,
        }
    }

    impl Fixture {
        fn repo(&self) -> git2::Repository {
            self.state.open_repo(&self.id).unwrap()
        }

        fn descriptor(&self) -> Remote {
            Remote {
                url: self.remote_path.to_string_lossy().into_owned(),
                auth: RemoteAuth::None,
            }
        }

        /// The other machine commits and pushes.
        fn published(&self, bytes: &[u8], message: &str) {
            git::commit_named(&self.elsewhere, bytes, message).unwrap();
            remote::push(&self.elsewhere, &self.descriptor(), None).unwrap();
        }

        /// Adopts the remote's history, so later commits build on it rather
        /// than diverging from it.
        fn adopt_remote(&self, repo: &git2::Repository) {
            remote::fetch(repo, &self.descriptor(), None).unwrap();
            let tip = repo.refname_to_id(REMOTE_REF).unwrap();
            repo.reference(NAMED_REF, tip, true, "adopt").unwrap();
        }

        fn on_disk(&self) -> Vec<u8> {
            std::fs::read(&self.score).unwrap()
        }
    }

    #[test]
    fn a_version_published_elsewhere_becomes_the_score_on_disk() {
        let f = fixture();
        f.published(b"riff with a bridge", "Bridge");

        let pulled = pull(&f.state, &f.id).unwrap();

        assert_eq!(f.on_disk(), b"riff with a bridge");
        assert_eq!(pulled.version.unwrap().message, "Bridge");
        assert_eq!(pulled.state, SyncState::UpToDate);
    }

    #[test]
    fn what_was_on_disk_is_kept_before_being_replaced() {
        let f = fixture();
        f.published(b"riff with a bridge", "Bridge");

        let pulled = pull(&f.state, &f.id).unwrap();

        // "take one" was never named — only the safety snapshot has it now.
        let safety = pulled.safety.expect("the unnamed save was worth keeping");
        assert_eq!(git::read_score(&f.repo(), &safety.id).unwrap(), b"take one");
    }

    #[test]
    fn pulling_when_the_remote_has_nothing_new_leaves_the_score_alone() {
        let f = fixture();
        f.published(b"riff with a bridge", "Bridge");
        pull(&f.state, &f.id).unwrap();

        let again = pull(&f.state, &f.id).unwrap();

        assert_eq!(again.state, SyncState::UpToDate);
        assert!(again.version.is_none());
        assert!(again.safety.is_none());
        assert_eq!(f.on_disk(), b"riff with a bridge");
    }

    #[test]
    fn a_score_edited_in_both_places_is_refused_not_merged() {
        let f = fixture();
        f.published(b"riff", "Intro");

        let repo = f.repo();
        f.adopt_remote(&repo);
        // Both sides write a different bridge over the same intro.
        git::commit_named(&repo, b"riff, my bridge", "My bridge").unwrap();
        f.published(b"riff, their bridge", "Their bridge");

        let refused = pull(&f.state, &f.id).unwrap_err();

        assert!(matches!(refused, Error::Diverged(_, 1, 1)), "{refused}");
        // Refused means untouched: neither the file nor our history moved.
        assert_eq!(f.on_disk(), b"take one");
        assert_eq!(
            git::read_score(&repo, NAMED_REF).unwrap(),
            b"riff, my bridge"
        );
    }

    #[test]
    fn a_score_that_is_only_ahead_has_nothing_to_pull() {
        let f = fixture();
        let repo = f.repo();
        git::commit_named(&repo, b"riff, mine alone", "Mine").unwrap();

        let pulled = pull(&f.state, &f.id).unwrap();

        assert_eq!(pulled.state, SyncState::Ahead { versions: 1 });
        assert!(pulled.version.is_none());
    }

    #[test]
    fn a_score_with_no_remote_cannot_be_pulled() {
        let f = fixture();
        f.state
            .update(|config| {
                config.find_mut(&f.id).unwrap().remote = None;
                Ok(())
            })
            .unwrap();

        assert!(matches!(pull(&f.state, &f.id), Err(Error::NoRemote(_))));
    }

    #[test]
    fn pulling_makes_the_score_the_active_file() {
        let f = fixture();
        f.published(b"riff with a bridge", "Bridge");

        pull(&f.state, &f.id).unwrap();

        assert_eq!(f.state.active().as_deref(), Some(f.id.as_str()));
    }
}
