//! Shared host state: the config, the active file, and the fs watcher.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use git2::Repository;
use serde::Serialize;

use crate::config::{Config, SnapshotPolicy, TrackedFile, CONFIG_FILE, REPOS_DIR};
use crate::error::{Error, Result};
use crate::git;
use crate::guitar_pro::{self, Access};
use crate::watcher::Watcher;

/// What the active file is anchored to. Only [`Binding::GuitarPro`] means the
/// panel is pointed at the score being edited rather than at a guess.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Binding {
    /// Adopted from the score Guitar Pro has in front.
    GuitarPro,
    /// Guitar Pro has a score open that we don't track, or that shares its
    /// name with another tracked file.
    Unmatched { name: String },
    /// Accessibility access is missing — Guitar Pro cannot be read at all.
    Blind,
    /// Guitar Pro isn't running, or has nothing open.
    Idle,
}

pub struct AppState {
    data_dir: PathBuf,
    config: Mutex<Config>,
    /// The file the panel commits. Adopted from Guitar Pro where possible,
    /// otherwise the most recently saved tracked file.
    active: Mutex<Option<String>>,
    binding: Mutex<Binding>,
    pub watcher: Watcher,
}

impl AppState {
    pub fn load(data_dir: PathBuf) -> Result<Self> {
        let config = Config::load(&data_dir.join(CONFIG_FILE))?;
        let active = config.tracked_files.first().map(|file| file.id.clone());

        Ok(Self {
            data_dir,
            config: Mutex::new(config),
            active: Mutex::new(active),
            binding: Mutex::new(Binding::Idle),
            watcher: Watcher::new(),
        })
    }

    pub fn config(&self) -> MutexGuard<'_, Config> {
        lock(&self.config)
    }

    /// Mutate and persist in one go, so config.json can never lag behind
    /// what's in memory.
    pub fn update<T>(&self, mutate: impl FnOnce(&mut Config) -> Result<T>) -> Result<T> {
        let mut config = lock(&self.config);
        let outcome = mutate(&mut config)?;
        config.save(&self.data_dir.join(CONFIG_FILE))?;
        Ok(outcome)
    }

    pub fn tracked(&self, id: &str) -> Result<TrackedFile> {
        self.config()
            .find(id)
            .cloned()
            .ok_or_else(|| Error::UnknownFile(id.to_owned()))
    }

    pub fn tracked_by_path(&self, path: &Path) -> Option<TrackedFile> {
        self.config().find_by_path(path).cloned()
    }

    pub fn tracked_paths(&self) -> Vec<PathBuf> {
        self.config()
            .tracked_files
            .iter()
            .map(|file| file.path.clone())
            .collect()
    }

    pub fn snapshot_policy(&self) -> SnapshotPolicy {
        self.config().snapshot_policy
    }

    pub fn open_repo(&self, id: &str) -> Result<Repository> {
        git::open_or_init(&self.data_dir.join(REPOS_DIR).join(id))
    }

    pub fn active(&self) -> Option<String> {
        lock(&self.active).clone()
    }

    pub fn set_active(&self, id: &str) {
        *lock(&self.active) = Some(id.to_owned());
    }

    pub fn binding(&self) -> Binding {
        lock(&self.binding).clone()
    }

    /// Points the active file at the score Guitar Pro has in front.
    ///
    /// Anything we cannot resolve leaves the active file where it was; the
    /// commit guard, not this, is what stops a stale one from taking the
    /// credit for someone else's change.
    pub fn adopt_open_document(&self) -> Binding {
        let binding = match guitar_pro::access() {
            Access::Granted => match guitar_pro::open_document() {
                Some(name) => match self.find_by_document(&name) {
                    Some(id) => {
                        self.set_active(&id);
                        Binding::GuitarPro
                    }
                    None => Binding::Unmatched { name },
                },
                None => Binding::Idle,
            },
            Access::Denied => Binding::Blind,
            Access::Unsupported => Binding::Idle,
        };

        *lock(&self.binding) = binding.clone();
        binding
    }

    /// The display name is all Guitar Pro gives us, so two tracked files
    /// sharing one are indistinguishable — better no answer than the wrong one.
    fn find_by_document(&self, name: &str) -> Option<String> {
        let config = self.config();
        let mut matched = config
            .tracked_files
            .iter()
            .filter(|file| guitar_pro::document_matches(name, &file.name));

        let first = matched.next()?;
        matched.next().is_none().then(|| first.id.clone())
    }

    /// Falls back to any remaining tracked file so the panel is never empty
    /// while something is tracked.
    pub fn clear_active(&self, id: &str) {
        let mut active = lock(&self.active);
        if active.as_deref() == Some(id) {
            *active = self.config().tracked_files.first().map(|f| f.id.clone());
        }
    }
}

/// A panicking command must not poison the whole app; the data behind these
/// locks stays consistent because every guard is short-lived.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Guitar Pro's side of this can't be faked in a unit test — what can is
    /// the part that decides which tracked file a window title names.
    fn state_tracking(paths: &[&str]) -> (tempfile::TempDir, AppState) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().to_path_buf()).unwrap();
        state
            .update(|config| {
                config.tracked_files = paths
                    .iter()
                    .map(|path| TrackedFile::new(PathBuf::from(path)))
                    .collect();
                Ok(())
            })
            .unwrap();
        (dir, state)
    }

    #[test]
    fn an_open_document_resolves_to_the_score_it_names() {
        let (_dir, state) = state_tracking(&["/songs/Blackbird.gp", "/songs/Riff.gp"]);

        let id = state.find_by_document("Riff").expect("one match");
        assert_eq!(state.tracked(&id).unwrap().name, "Riff");
    }

    #[test]
    fn a_document_shared_by_two_tracked_files_resolves_to_neither() {
        let (_dir, state) = state_tracking(&["/songs/Riff.gp", "/demos/Riff.gp"]);

        assert!(state.find_by_document("Riff").is_none());
    }

    #[test]
    fn a_document_we_do_not_track_resolves_to_nothing() {
        let (_dir, state) = state_tracking(&["/songs/Blackbird.gp"]);

        assert!(state.find_by_document("Lasagna").is_none());
    }
}
