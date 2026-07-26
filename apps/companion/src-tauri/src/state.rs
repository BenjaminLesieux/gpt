//! Shared host state: the config, the active file, and the fs watcher.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use git2::Repository;

use crate::config::{Config, SnapshotPolicy, TrackedFile, CONFIG_FILE, REPOS_DIR};
use crate::error::{Error, Result};
use crate::git;
use crate::watcher::Watcher;

pub struct AppState {
    data_dir: PathBuf,
    config: Mutex<Config>,
    /// Most recently saved tracked file — what the panel commits by default.
    active: Mutex<Option<String>>,
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
