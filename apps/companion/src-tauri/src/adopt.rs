//! Materialising a score this machine has never seen.
//!
//! The inverse of tracking. `commands::track` starts from a file the user
//! points at and gives it a repo; here the repo comes first and the `.gp`
//! falls out of it — the one flow in the app where the score on disk is not
//! the thing that existed already.
//!
//! Nothing is kept unless all of it worked. The token is an argument rather
//! than something read back out of the keychain, so a remote that refuses the
//! credentials, or turns out to hold nothing, leaves no keychain entry, no
//! config row and no file behind.

use std::path::{Path, PathBuf};

use crate::config::{self, is_guitar_pro_file, Remote, TrackedFile};
use crate::error::{Error, Result};
use crate::git;
use crate::remote::{self, REMOTE_REF};
use crate::secrets;
use crate::state::AppState;

/// Name offered by the save dialog when nothing better can be read off the url.
const DEFAULT_FILE_NAME: &str = "score.gp";

/// Fetches the remote's named history into the score's repo, writes its
/// `score.gp` to `path`, and tracks the result with the remote already set.
pub fn adopt(
    state: &AppState,
    path: &Path,
    remote: Remote,
    token: Option<&str>,
) -> Result<TrackedFile> {
    let path = intended_path(path)?;
    if !is_guitar_pro_file(&path) {
        return Err(Error::UnsupportedExtension(path.display().to_string()));
    }
    if path.exists() {
        return Err(Error::FileExists(path.display().to_string()));
    }
    if let Some(existing) = state.tracked_by_path(&path) {
        return Err(Error::AlreadyTracked(existing.name));
    }

    let id = config::file_id(&path);
    let repo = state.open_repo(&id)?;
    remote::fetch(&repo, &remote, token)?;

    // `fetch` treats a remote with no `main` as an answer rather than an
    // error, so a missing mirror here means an empty repo and not a failure.
    let Ok(onto) = repo.refname_to_id(REMOTE_REF) else {
        return Err(Error::RemoteEmpty(remote.url));
    };
    let arriving = git::read_score(&repo, REMOTE_REF)?;

    // `repos/<id>/` may already hold history — untracking leaves it behind so
    // re-tracking finds it again — and that history could be ahead of the
    // remote. Advancing through `fast_forward_named` is what refuses to drop
    // it, and doing so before the file is written means a refusal cannot
    // leave a score lying at a path nothing tracks.
    git::fast_forward_named(&repo, onto)?;

    // Secret, then file, then config row. The first pair is the reasoning in
    // `set_remote`: a descriptor persisted against a token that never reached
    // the keychain would describe an authentication that cannot happen. And a
    // token filed under an id no config row mentions is invisible and gets
    // overwritten by the next attempt, so of the three it is the one whose
    // orphan costs nothing.
    if let Some(token) = token {
        secrets::store(&id, token)?;
    }
    std::fs::write(&path, &arriving)?;

    let file = state.update(|config| match config.find_by_path(&path) {
        Some(existing) => Err(Error::AlreadyTracked(existing.name.clone())),
        None => {
            let file = TrackedFile {
                remote: Some(remote.clone()),
                ..TrackedFile::new(path.clone())
            };
            config.tracked_files.push(file.clone());
            Ok(file)
        }
    })?;

    // No seed snapshot, unlike tracking: the bytes on disk came out of the
    // repo, so they already are the newest named version.
    state.set_active(&file.id);
    state.watcher.resync(&state.tracked_paths())?;
    Ok(file)
}

/// The path the score will have once it exists.
///
/// [`TrackedFile::new`] canonicalizes what it is handed, but there is nothing
/// to canonicalize yet, and the raw path would derive a different id from the
/// one tracking computes for the same file later — macOS answers both
/// `/var/…` and `/private/var/…`. The parent directory does exist.
fn intended_path(path: &Path) -> Result<PathBuf> {
    let name = path
        .file_name()
        .ok_or_else(|| Error::NotAFile(path.display().to_string()))?;
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    Ok(config::canonical(parent).join(name))
}

/// What to call the file before the user has said. The last segment of the
/// url is the score on every server this talks to, the hub included.
pub fn suggested_file_name(url: &str) -> String {
    let segment = url
        .trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim_end_matches(".git");

    if segment.is_empty() {
        return DEFAULT_FILE_NAME.to_owned();
    }
    format!("{segment}.gp")
}

/// What to call the file when the hub has said what the score is called.
///
/// Better than [`suggested_file_name`] wherever it can be used: the hub's
/// score id is opaque, so the url gives the save dialog something like
/// `k7m2x….gp` where the name gives it `Blackbird.gp`.
///
/// The name is whatever the musician typed, so it is stripped down to
/// something that can be a filename rather than trusted as one — it reaches a
/// `save_file` call, and a separator in it would point that call elsewhere.
pub fn file_name_for(score_name: &str) -> String {
    let cleaned: String = score_name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':') {
                ' '
            } else {
                c
            }
        })
        .collect();

    // Whatever the separators left behind collapses to one space, and dots
    // come off both ends — leading ones hide the file, trailing ones leave a
    // filename that ends in nothing on the way to an extension.
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());

    if cleaned.is_empty() {
        return DEFAULT_FILE_NAME.to_owned();
    }
    format!("{cleaned}.gp")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::RemoteAuth;
    use crate::git::NAMED_REF;
    use crate::remote::SyncState;

    /// A bare repo on disk standing in for the server, a second repo playing
    /// the machine the score was written on, and nothing tracked yet.
    ///
    /// `RemoteAuth::None` throughout: a token would mean a keychain write,
    /// and the keychain is not something a unit test may touch (see
    /// [`crate::secrets`]).
    struct Fixture {
        _dir: tempfile::TempDir,
        state: AppState,
        score: PathBuf,
        remote_path: PathBuf,
        elsewhere: git2::Repository,
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let remote_path = dir.path().join("remote");
        git::open_or_init(&remote_path).unwrap();

        Fixture {
            state: AppState::load(dir.path().join("data")).unwrap(),
            score: dir.path().join("Blackbird.gp"),
            elsewhere: git::open_or_init(&dir.path().join("elsewhere")).unwrap(),
            remote_path,
            _dir: dir,
        }
    }

    impl Fixture {
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

        fn adopt(&self) -> Result<TrackedFile> {
            adopt(&self.state, &self.score, self.descriptor(), None)
        }
    }

    #[test]
    fn a_score_published_elsewhere_becomes_a_file_on_disk() {
        let f = fixture();
        f.published(b"riff with a bridge", "Bridge");

        let file = f.adopt().unwrap();

        assert_eq!(std::fs::read(&f.score).unwrap(), b"riff with a bridge");
        assert_eq!(file.name, "Blackbird");
        assert_eq!(file.remote.unwrap().url, f.descriptor().url);
        assert_eq!(f.state.config().tracked_files.len(), 1);
    }

    /// The id is derived before the file exists, and has to match what
    /// tracking the same file would have produced.
    #[test]
    fn the_id_is_the_one_tracking_would_derive_for_that_path() {
        let f = fixture();
        f.published(b"riff", "Intro");

        let file = f.adopt().unwrap();

        let once_it_exists = f.score.canonicalize().unwrap();
        assert_eq!(file.id, config::file_id(&once_it_exists));
        assert_eq!(file.path, once_it_exists);
    }

    #[test]
    fn a_remote_with_no_versions_is_refused() {
        let f = fixture();

        let refused = f.adopt().unwrap_err();

        assert!(matches!(refused, Error::RemoteEmpty(_)), "{refused}");
        assert!(!f.score.exists());
        assert!(f.state.config().tracked_files.is_empty());
    }

    #[test]
    fn a_path_that_already_holds_a_file_is_refused() {
        let f = fixture();
        f.published(b"riff", "Intro");
        std::fs::write(&f.score, b"someone else's take").unwrap();

        let refused = f.adopt().unwrap_err();

        assert!(matches!(refused, Error::FileExists(_)), "{refused}");
        assert_eq!(std::fs::read(&f.score).unwrap(), b"someone else's take");
        assert!(f.state.config().tracked_files.is_empty());
    }

    #[test]
    fn a_path_already_tracked_is_refused() {
        let f = fixture();
        f.published(b"riff", "Intro");
        f.adopt().unwrap();

        // Adopting again finds both the file and the config row; the file is
        // the one it reports, because it is the one the user can see.
        std::fs::remove_file(&f.score).unwrap();
        let refused = f.adopt().unwrap_err();

        assert!(matches!(refused, Error::AlreadyTracked(_)), "{refused}");
        assert_eq!(f.state.config().tracked_files.len(), 1);
    }

    #[test]
    fn an_unsupported_extension_is_refused_before_the_network() {
        let f = fixture();
        let path = f.score.with_extension("mp3");

        let refused = adopt(&f.state, &path, f.descriptor(), None).unwrap_err();

        assert!(
            matches!(refused, Error::UnsupportedExtension(_)),
            "{refused}"
        );
    }

    #[test]
    fn history_the_repo_already_held_is_not_dropped() {
        let f = fixture();
        f.published(b"riff", "Intro");

        // What untracking leaves behind: a repo whose `main` the remote has
        // never seen, under the id this path will resolve to.
        let id =
            config::file_id(&config::canonical(f.score.parent().unwrap()).join("Blackbird.gp"));
        let orphaned = f.state.open_repo(&id).unwrap();
        git::commit_named(&orphaned, b"riff, kept locally", "Mine").unwrap();

        let refused = f.adopt().unwrap_err();

        assert!(matches!(refused, Error::NotFastForward), "{refused}");
        assert!(!f.score.exists());
        assert_eq!(
            git::read_score(&orphaned, NAMED_REF).unwrap(),
            b"riff, kept locally"
        );
    }

    #[test]
    fn the_adopted_score_is_the_active_file() {
        let f = fixture();
        f.published(b"riff", "Intro");

        let file = f.adopt().unwrap();

        assert_eq!(f.state.active().as_deref(), Some(file.id.as_str()));
    }

    /// The fetch that materialised the score also mirrored the remote, so the
    /// window has nothing to ask before it can say where the score stands.
    #[test]
    fn an_adopted_score_reads_as_up_to_date_without_another_fetch() {
        let f = fixture();
        f.published(b"riff", "Intro");

        let file = f.adopt().unwrap();

        let repo = f.state.open_repo(&file.id).unwrap();
        assert_eq!(
            remote::compare(&repo, file.remote.as_ref()).unwrap(),
            SyncState::UpToDate
        );
        assert_eq!(git::list(&repo, NAMED_REF, None).unwrap().len(), 1);
    }

    #[test]
    fn a_score_name_becomes_a_filename_the_save_dialog_can_offer() {
        assert_eq!(file_name_for("Blackbird"), "Blackbird.gp");
        assert_eq!(file_name_for("  Bridge rewrite "), "Bridge rewrite.gp");
    }

    /// The name is whatever the musician typed and it reaches a save dialog,
    /// so a separator in it must not be able to point that dialog elsewhere.
    #[test]
    fn a_name_carrying_path_syntax_is_stripped_rather_than_trusted() {
        assert_eq!(file_name_for("../../etc/passwd"), "etc passwd.gp");
        assert_eq!(file_name_for("a/b"), "a b.gp");
        assert_eq!(file_name_for(".hidden"), "hidden.gp");
        assert_eq!(file_name_for("   "), "score.gp");
        assert_eq!(file_name_for("..."), "score.gp");
    }

    #[test]
    fn the_suggested_name_comes_from_the_last_segment_of_the_url() {
        assert_eq!(
            suggested_file_name("https://hub.gitarpro.app/git/blackbird.git"),
            "blackbird.gp"
        );
        assert_eq!(suggested_file_name("/Volumes/backup/riff/"), "riff.gp");
        assert_eq!(suggested_file_name("/"), "score.gp");
    }
}
