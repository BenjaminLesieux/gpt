//! Save detection → silent auto-snapshot.
//!
//! Guitar Pro saves atomically, replacing the file, so we watch each tracked
//! file's *parent directory* and filter. Events are buffered and only acted on
//! once a path has been quiet for [`QUIET`] — a single save produces a burst.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};
use tauri::{AppHandle, Manager};

use crate::config::is_guitar_pro_file;
use crate::error::Result;
use crate::events;
use crate::git;
use crate::normalize;
use crate::state::AppState;

const TICK: Duration = Duration::from_millis(200);
const QUIET: Duration = Duration::from_millis(500);

type Pending = Arc<Mutex<HashMap<PathBuf, Instant>>>;

pub struct Watcher {
    inner: Mutex<Option<RecommendedWatcher>>,
    pending: Pending,
}

impl Watcher {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            pending: Pending::default(),
        }
    }

    /// Rebuilds the whole watch set. Cheap, and far less error-prone than
    /// diffing watches as files are tracked and untracked.
    pub fn resync(&self, paths: &[PathBuf]) -> Result<()> {
        let mut inner = lock(&self.inner);
        *inner = None;

        let mut dirs: Vec<&Path> = paths.iter().filter_map(|path| path.parent()).collect();
        dirs.sort_unstable();
        dirs.dedup();

        if dirs.is_empty() {
            return Ok(());
        }

        let pending = self.pending.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                let Ok(event) = event else { return };
                if !event.kind.is_create() && !event.kind.is_modify() {
                    return;
                }
                let mut pending = lock(&pending);
                for path in event.paths.into_iter().filter(|p| is_guitar_pro_file(p)) {
                    pending.insert(path, Instant::now());
                }
            })?;

        for dir in dirs {
            watcher.watch(dir, RecursiveMode::NonRecursive)?;
        }
        *inner = Some(watcher);
        Ok(())
    }

    fn take_due(&self) -> Vec<PathBuf> {
        let mut pending = lock(&self.pending);
        let due: Vec<PathBuf> = pending
            .iter()
            .filter(|(_, seen)| seen.elapsed() >= QUIET)
            .map(|(path, _)| path.clone())
            .collect();
        for path in &due {
            pending.remove(path);
        }
        due
    }
}

impl Default for Watcher {
    fn default() -> Self {
        Self::new()
    }
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(TICK);
        for path in app.state::<AppState>().watcher.take_due() {
            if let Err(err) = snapshot(&app, &path) {
                eprintln!("[gitarpro] snapshot of {} failed: {err}", path.display());
            }
        }
    });
}

fn snapshot(app: &AppHandle, path: &Path) -> Result<()> {
    if let Some(saved) = capture(&app.state::<AppState>(), path)? {
        events::file_saved(app, saved);
    }
    Ok(())
}

/// `None` when the path isn't tracked, or when the file is still being
/// written — the write that follows re-arms the debounce.
fn capture(state: &AppState, path: &Path) -> Result<Option<events::FileSaved>> {
    let Some(file) = state.tracked_by_path(&crate::config::canonical(path)) else {
        return Ok(None);
    };

    let bytes = std::fs::read(&file.path)?;
    if !normalize::is_intact(&bytes) {
        return Ok(None);
    }

    let repo = state.open_repo(&file.id)?;
    let version = git::commit_snapshot(&repo, &normalize::normalize_gp(&bytes))?;
    if version.is_some() {
        git::prune_snapshots(&repo, state.snapshot_policy())?;
    }

    state.set_active(&file.id);
    Ok(Some(events::FileSaved {
        id: file.id,
        path: file.path,
        version,
    }))
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::TrackedFile;
    use crate::git::SNAPSHOT_REF;

    /// Real fs events, real debounce — only the Tauri handle is absent.
    fn tracked_state(score: &Path) -> AppState {
        let state = AppState::load(score.parent().unwrap().join("data")).unwrap();
        state
            .update(|config| {
                config
                    .tracked_files
                    .push(TrackedFile::new(score.to_path_buf()));
                Ok(())
            })
            .unwrap();
        state.watcher.resync(&state.tracked_paths()).unwrap();
        state
    }

    /// Polls rather than sleeping a fixed amount: FSEvents latency varies.
    fn wait_for_due(state: &AppState) -> Vec<PathBuf> {
        for _ in 0..50 {
            let due = state.watcher.take_due();
            if !due.is_empty() {
                return due;
            }
            std::thread::sleep(TICK);
        }
        Vec::new()
    }

    #[test]
    fn a_save_becomes_a_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let score = dir.path().join("riff.gp");
        std::fs::write(&score, b"take one").unwrap();

        let state = tracked_state(&score);
        std::fs::write(&score, b"take two").unwrap();

        let due = wait_for_due(&state);
        assert_eq!(due.len(), 1);

        let saved = capture(&state, &due[0]).unwrap().expect("tracked");
        assert!(saved.version.is_some());

        let repo = state.open_repo(&saved.id).unwrap();
        assert_eq!(git::read_score(&repo, SNAPSHOT_REF).unwrap(), b"take two");
        assert_eq!(state.active().as_deref(), Some(saved.id.as_str()));
    }

    #[test]
    fn a_burst_of_writes_debounces_into_one_capture() {
        let dir = tempfile::tempdir().unwrap();
        let score = dir.path().join("riff.gp");
        std::fs::write(&score, b"take one").unwrap();

        let state = tracked_state(&score);
        for take in 0..5 {
            std::fs::write(&score, format!("take {take}").as_bytes()).unwrap();
        }

        let due = wait_for_due(&state);
        assert_eq!(due.len(), 1, "one path, however many writes");

        let saved = capture(&state, &due[0]).unwrap().unwrap();
        let repo = state.open_repo(&saved.id).unwrap();
        assert_eq!(git::list(&repo, SNAPSHOT_REF, None).unwrap().len(), 1);
    }

    #[test]
    fn untracked_neighbours_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let score = dir.path().join("riff.gp");
        std::fs::write(&score, b"take one").unwrap();
        let state = tracked_state(&score);

        let neighbour = dir.path().join("other.gp");
        std::fs::write(&neighbour, b"not mine").unwrap();

        let due = wait_for_due(&state);
        for path in due {
            assert!(capture(&state, &path).unwrap().is_none());
        }
    }

    #[test]
    fn a_half_written_container_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let score = dir.path().join("riff.gp");
        std::fs::write(&score, b"take one").unwrap();
        let state = tracked_state(&score);

        // Zip signature, no central directory: Guitar Pro is mid-save.
        std::fs::write(&score, b"PK\x03\x04truncated").unwrap();

        assert!(capture(&state, &score).unwrap().is_none());
    }
}
