//! Which line of versions a score is on.
//!
//! Switching is the other operation, beside a pull and a restore, that
//! rewrites the user's `.gp`, and it follows the same rule: whatever is on
//! disk is snapshotted before it is replaced. Starting a new branch replaces
//! nothing — the score as it stands becomes the first thing on it.

use std::collections::BTreeSet;

use git2::{Reference, Repository};

use crate::error::{Error, Result};
use crate::git::{self, Version};
use crate::normalize::normalize_gp;
use crate::remote::{remote_ref, REMOTE_PREFIX};
use crate::state::AppState;

/// Ours and the remote's, as of the last fetch, plus the current one even if
/// nothing has been named on it yet.
pub fn list(state: &AppState, id: &str) -> Result<Vec<String>> {
    let file = state.tracked(id)?;
    let repo = state.open_repo(&file.id)?;

    let mut names: BTreeSet<String> = names_under(&repo, "refs/heads/")?
        .into_iter()
        .chain(names_under(&repo, REMOTE_PREFIX)?)
        .collect();
    names.insert(file.branch);
    Ok(names.into_iter().collect())
}

/// Puts the score on `branch`. A branch that exists here, or only on the
/// remote, replaces the score on disk with its newest version; a branch that
/// exists nowhere starts from the current one and leaves the file alone.
pub fn switch(state: &AppState, id: &str, branch: &str) -> Result<Option<Version>> {
    let file = state.tracked(id)?;
    let target = git::branch_ref(branch);
    if !Reference::is_valid_name(&target) {
        return Err(Error::InvalidBranch(branch.to_owned()));
    }
    if branch == file.branch {
        return Ok(None);
    }

    let repo = state.open_repo(&file.id)?;
    let local = repo.refname_to_id(&target).ok();
    let remote = repo.refname_to_id(&remote_ref(branch)).ok();

    let safety = match local.or(remote) {
        Some(tip) => {
            if local.is_none() {
                repo.reference(&target, tip, false, "branch from the remote")?;
            }
            let arriving = git::read_score(&repo, &target)?;
            let safety = match std::fs::read(&file.path) {
                Ok(current) => git::commit_snapshot(&repo, &file.branch, &normalize_gp(&current))?,
                Err(_) => None,
            };
            std::fs::write(&file.path, &arriving)?;
            safety
        }
        None => {
            // When the current branch has nothing named yet there is nothing to
            // start from, and the first named version starts this one.
            if let Ok(tip) = repo.refname_to_id(&git::branch_ref(&file.branch)) {
                repo.reference(&target, tip, false, "start a branch")?;
            }
            None
        }
    };

    state.update(|config| {
        let tracked = config
            .find_mut(id)
            .ok_or_else(|| Error::UnknownFile(id.to_owned()))?;
        tracked.branch = branch.to_owned();
        Ok(())
    })?;
    state.set_active(&file.id);
    Ok(safety)
}

fn names_under(repo: &Repository, prefix: &str) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for reference in repo.references_glob(&format!("{prefix}*"))? {
        let reference = reference?;
        if let Some(name) = reference
            .name()
            .ok()
            .and_then(|name| name.strip_prefix(prefix))
        {
            names.push(name.to_owned());
        }
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Remote, RemoteAuth, TrackedFile};
    use crate::git::{branch_ref, MAIN_BRANCH, SNAPSHOT_REF};
    use crate::remote;
    use std::path::PathBuf;

    const BRANCH: &str = "bass-line";

    struct Fixture {
        dir: tempfile::TempDir,
        state: AppState,
        id: String,
        score: PathBuf,
        remote: Remote,
    }

    /// A tracked score with one named version on main, and a bare repo
    /// standing in for the hub.
    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let score = dir.path().join("riff.gp");
        std::fs::write(&score, b"riff").unwrap();

        let remote_path = dir.path().join("remote");
        git::open_or_init(&remote_path).unwrap();
        let remote = Remote {
            url: remote_path.to_string_lossy().into_owned(),
            auth: RemoteAuth::None,
        };

        let state = AppState::load(dir.path().join("data")).unwrap();
        let file = TrackedFile {
            remote: Some(remote.clone()),
            ..TrackedFile::new(score.clone())
        };
        let id = file.id.clone();
        state
            .update(|config| {
                config.tracked_files.push(file);
                Ok(())
            })
            .unwrap();
        git::commit_named(
            &state.open_repo(&id).unwrap(),
            MAIN_BRANCH,
            b"riff",
            "Intro",
        )
        .unwrap();

        Fixture {
            dir,
            state,
            id,
            score,
            remote,
        }
    }

    impl Fixture {
        fn repo(&self) -> Repository {
            self.state.open_repo(&self.id).unwrap()
        }

        fn current(&self) -> String {
            self.state.tracked(&self.id).unwrap().branch
        }

        fn on_disk(&self) -> Vec<u8> {
            std::fs::read(&self.score).unwrap()
        }
    }

    #[test]
    fn a_new_branch_starts_from_the_current_one_and_keeps_the_file() {
        let f = fixture();
        std::fs::write(&f.score, b"riff, unnamed idea").unwrap();

        let safety = switch(&f.state, &f.id, BRANCH).unwrap();

        assert!(safety.is_none());
        assert_eq!(f.current(), BRANCH);
        assert_eq!(f.on_disk(), b"riff, unnamed idea");
        let versions = git::list(&f.repo(), &branch_ref(BRANCH), None).unwrap();
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].message, "Intro");
    }

    #[test]
    fn switching_back_brings_that_branch_onto_disk_and_keeps_what_was_there() {
        let f = fixture();
        switch(&f.state, &f.id, BRANCH).unwrap();
        git::commit_named(&f.repo(), BRANCH, b"riff and bass", "Bass line").unwrap();
        std::fs::write(&f.score, b"riff and bass, unnamed").unwrap();

        let safety = switch(&f.state, &f.id, MAIN_BRANCH).unwrap().unwrap();

        assert_eq!(f.current(), MAIN_BRANCH);
        assert_eq!(f.on_disk(), b"riff");
        assert_eq!(
            git::read_score(&f.repo(), &safety.id).unwrap(),
            b"riff and bass, unnamed"
        );
        // Main never saw the bass line.
        assert_eq!(
            git::list(&f.repo(), &branch_ref(MAIN_BRANCH), None)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn a_file_already_on_its_branch_tip_needs_no_safety_snapshot() {
        let f = fixture();
        switch(&f.state, &f.id, BRANCH).unwrap();
        git::commit_named(&f.repo(), BRANCH, b"riff and bass", "Bass line").unwrap();
        std::fs::write(&f.score, b"riff and bass").unwrap();

        assert!(switch(&f.state, &f.id, MAIN_BRANCH).unwrap().is_none());
        assert!(git::list(&f.repo(), SNAPSHOT_REF, None).unwrap().is_empty());
    }

    #[test]
    fn a_branch_only_the_remote_has_is_taken_from_it() {
        let f = fixture();
        let elsewhere = git::open_or_init(&f.dir.path().join("elsewhere")).unwrap();
        git::commit_named(&elsewhere, BRANCH, b"their bass line", "Bass line").unwrap();
        remote::push(&elsewhere, BRANCH, &f.remote, None).unwrap();
        remote::fetch(&f.repo(), &f.remote, None).unwrap();

        assert!(list(&f.state, &f.id).unwrap().contains(&BRANCH.to_owned()));

        switch(&f.state, &f.id, BRANCH).unwrap();

        assert_eq!(f.on_disk(), b"their bass line");
        assert_eq!(
            remote::compare(&f.repo(), BRANCH, Some(&f.remote)).unwrap(),
            remote::SyncState::UpToDate
        );
    }

    #[test]
    fn a_name_git_cannot_hold_is_refused() {
        let f = fixture();

        for name in ["", "two..dots", "ends.lock", "has space"] {
            assert!(
                matches!(switch(&f.state, &f.id, name), Err(Error::InvalidBranch(_))),
                "{name:?}"
            );
        }
        assert_eq!(f.current(), MAIN_BRANCH);
    }

    #[test]
    fn the_current_branch_is_listed_before_anything_is_named_on_it() {
        let f = fixture();
        let repo = f.repo();
        repo.find_reference(&branch_ref(MAIN_BRANCH))
            .unwrap()
            .delete()
            .unwrap();

        switch(&f.state, &f.id, "new-chorus").unwrap();

        assert_eq!(list(&f.state, &f.id).unwrap(), ["new-chorus"]);
        assert!(repo.find_reference(&branch_ref("new-chorus")).is_err());
    }
}
