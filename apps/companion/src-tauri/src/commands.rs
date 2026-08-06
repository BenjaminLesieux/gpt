//! The IPC surface. Typed mirrors live in `src/lib/ipc.ts`.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::config::{is_guitar_pro_file, Remote, RemoteAuth, TrackedFile, GP_EXTENSIONS};
use crate::error::{Error, Result};
use crate::events;
use crate::git::{self, Version, NAMED_REF, SNAPSHOT_REF};
use crate::normalize::normalize_gp;
use crate::state::{AppState, Binding};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PushState {
    Unconfigured,
    Idle,
    // Constructed by the M5 push queue; part of the contract already so the
    // panel's status badge doesn't change shape then.
    #[allow(dead_code)]
    Pending,
    #[allow(dead_code)]
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushStatus {
    pub state: PushState,
    pub last_pushed_at: Option<i64>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn list_tracked_files(state: State<'_, AppState>) -> Vec<TrackedFile> {
    state.config().tracked_files.clone()
}

#[tauri::command]
pub fn track_file(
    app: AppHandle,
    state: State<'_, AppState>,
    path: PathBuf,
) -> Result<TrackedFile> {
    track(&app, &state, path)
}

/// Opens the native picker and tracks what comes back. `None` means the user
/// cancelled — not an error the UI should report.
#[tauri::command]
pub async fn pick_and_track_file(app: AppHandle) -> Result<Option<TrackedFile>> {
    let picked = {
        // The picker takes focus; without this the panel would dismiss itself
        // the moment the dialog opens.
        let _hold = crate::panel::hold();
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        app.dialog()
            .file()
            .add_filter("Guitar Pro", &GP_EXTENSIONS)
            .pick_file(move |picked| {
                // Capacity 1 and a single send: this can never be full.
                let _ = sender.try_send(picked);
            });
        receiver.recv().await.flatten()
    };
    crate::panel::focus(&app);

    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|err| Error::NotAFile(err.to_string()))?;

    track(&app, &app.state::<AppState>(), path).map(Some)
}

/// Adds the file to the config, gives it a repo, and seeds that repo with the
/// score as it stands — so the first Guitar Pro save already has a baseline to
/// diff against.
fn track(app: &AppHandle, state: &AppState, path: PathBuf) -> Result<TrackedFile> {
    let path = path.canonicalize()?;
    if !path.is_file() {
        return Err(Error::NotAFile(path.display().to_string()));
    }
    if !is_guitar_pro_file(&path) {
        return Err(Error::UnsupportedExtension(path.display().to_string()));
    }

    let file = state.update(|config| match config.find_by_path(&path) {
        Some(existing) => Err(Error::AlreadyTracked(existing.name.clone())),
        None => {
            let file = TrackedFile::new(path);
            config.tracked_files.push(file.clone());
            Ok(file)
        }
    })?;

    let repo = state.open_repo(&file.id)?;
    git::commit_snapshot(&repo, &normalize_gp(&std::fs::read(&file.path)?))?;

    state.set_active(&file.id);
    state.watcher.resync(&state.tracked_paths())?;
    events::tracked_files_changed(app, state.config().tracked_files.clone());
    Ok(file)
}

/// The repo under `repos/<id>/` is left alone — re-tracking the same file
/// finds its history again.
#[tauri::command]
pub fn untrack_file(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<()> {
    state.update(|config| {
        let before = config.tracked_files.len();
        config.tracked_files.retain(|file| file.id != id);
        if config.tracked_files.len() == before {
            return Err(Error::UnknownFile(id.clone()));
        }
        Ok(())
    })?;

    state.clear_active(&id);
    state.watcher.resync(&state.tracked_paths())?;
    events::tracked_files_changed(&app, state.config().tracked_files.clone());
    Ok(())
}

#[tauri::command]
pub fn get_active_file(state: State<'_, AppState>) -> Option<TrackedFile> {
    state.active().and_then(|id| state.tracked(&id).ok())
}

/// The panel's file switcher. Opening the panel adopts whatever Guitar Pro has
/// in front, and saves move the active file too; this is the manual override
/// for when neither found the right score.
#[tauri::command]
pub fn set_active_file(state: State<'_, AppState>, id: String) -> Result<TrackedFile> {
    let file = state.tracked(&id)?;
    state.set_active(&file.id);
    Ok(file)
}

/// A named version can only record a save that actually happened: naming a
/// file whose bytes are already its newest version is how a change made to one
/// score ends up filed under another.
#[tauri::command]
pub fn commit_named(state: State<'_, AppState>, id: String, message: String) -> Result<Version> {
    let file = state.tracked(&id)?;
    let bytes = normalize_gp(&std::fs::read(&file.path)?);
    let repo = state.open_repo(&file.id)?;

    if git::is_named_tip(&repo, &bytes)? {
        return Err(Error::NothingToName(file.name));
    }

    let version = git::commit_named(&repo, &bytes, &message)?;
    state.set_active(&file.id);
    Ok(version)
}

/// What `commit_named` would decide, so the panel can say so before the user
/// has typed anything.
#[tauri::command]
pub fn has_pending_change(state: State<'_, AppState>, id: String) -> Result<bool> {
    let file = state.tracked(&id)?;
    let bytes = normalize_gp(&std::fs::read(&file.path)?);
    Ok(!git::is_named_tip(&state.open_repo(&file.id)?, &bytes)?)
}

#[tauri::command]
pub fn list_versions(
    state: State<'_, AppState>,
    id: String,
    limit: Option<usize>,
) -> Result<Vec<Version>> {
    git::list(&state.open_repo(&state.tracked(&id)?.id)?, NAMED_REF, limit)
}

#[tauri::command]
pub fn list_snapshots(
    state: State<'_, AppState>,
    id: String,
    limit: Option<usize>,
) -> Result<Vec<Version>> {
    git::list(
        &state.open_repo(&state.tracked(&id)?.id)?,
        SNAPSHOT_REF,
        limit,
    )
}

/// Raw bytes, not a JSON byte array — scores run to hundreds of KB.
#[tauri::command]
pub fn get_version_blob(
    state: State<'_, AppState>,
    id: String,
    rev: String,
) -> Result<tauri::ipc::Response> {
    let repo = state.open_repo(&state.tracked(&id)?.id)?;
    Ok(tauri::ipc::Response::new(git::read_score(&repo, &rev)?))
}

/// Returns the safety snapshot taken before overwriting, if one was needed.
#[tauri::command]
pub fn restore_version(
    state: State<'_, AppState>,
    id: String,
    rev: String,
) -> Result<Option<Version>> {
    let file = state.tracked(&id)?;
    let repo = state.open_repo(&file.id)?;

    // Read first: an unknown rev must not touch the file on disk.
    let restored = git::read_score(&repo, &rev)?;

    let safety = match std::fs::read(&file.path) {
        Ok(current) => git::commit_snapshot(&repo, &normalize_gp(&current))?,
        // File gone — restoring is the recovery, nothing to preserve.
        Err(_) => None,
    };

    std::fs::write(&file.path, &restored)?;
    state.set_active(&file.id);
    Ok(safety)
}

#[tauri::command]
pub fn set_remote(
    state: State<'_, AppState>,
    id: String,
    url: Option<String>,
    auth: Option<RemoteAuth>,
) -> Result<()> {
    state.update(|config| {
        let file = config
            .find_mut(&id)
            .ok_or_else(|| Error::UnknownFile(id.clone()))?;
        file.remote = url.map(|url| Remote {
            url,
            auth: auth.unwrap_or_default(),
        });
        Ok(())
    })
}

/// Stub until M5 owns the background push queue.
#[tauri::command]
pub fn push_status(state: State<'_, AppState>, id: String) -> Result<PushStatus> {
    let file = state.tracked(&id)?;
    Ok(PushStatus {
        state: match file.remote {
            Some(_) => PushState::Idle,
            None => PushState::Unconfigured,
        },
        last_pushed_at: None,
        error: None,
    })
}

/// What the active file is anchored to. Read from the host's cache — the
/// accessibility lookup itself runs on the way to showing the panel, so this
/// stays a plain memory read.
#[tauri::command]
pub fn guitar_pro_binding(state: State<'_, AppState>) -> Binding {
    state.binding()
}

#[tauri::command]
pub fn request_accessibility() {
    crate::guitar_pro::request_access();
}

#[tauri::command]
pub fn toggle_panel(app: AppHandle) {
    crate::panel::toggle(&app);
}

#[tauri::command]
pub fn hide_panel(app: AppHandle) {
    crate::panel::hide(&app);
}

#[tauri::command]
pub fn open_extended_window(app: AppHandle) -> Result<()> {
    crate::window::open_extended(&app).map_err(Error::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SnapshotPolicy;
    use std::path::Path;

    /// Exercises the pipeline without a Tauri app: same calls the commands
    /// make, minus the state/event plumbing.
    fn track_and_snapshot(data_dir: &Path, file: &Path) -> (String, git::Version) {
        let id = crate::config::file_id(file);
        let repo = git::open_or_init(&data_dir.join("repos").join(&id)).unwrap();
        let bytes = std::fs::read(file).unwrap();
        let version = git::commit_snapshot(&repo, &normalize_gp(&bytes))
            .unwrap()
            .unwrap();
        (id, version)
    }

    #[test]
    fn a_resave_with_no_musical_change_adds_no_version() {
        let dir = tempfile::tempdir().unwrap();
        let score = dir.path().join("riff.gp");
        let fixture = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../packages/gpt-core/src/__fixtures__/sample.gp"
        ))
        .unwrap();
        std::fs::write(&score, &fixture).unwrap();

        let (id, _) = track_and_snapshot(dir.path(), &score);
        let repo = git::open_or_init(&dir.path().join("repos").join(&id)).unwrap();

        // Same score, saved again: only the zip timestamps differ.
        let resaved = resave(&fixture);
        assert_ne!(resaved, fixture);
        std::fs::write(&score, &resaved).unwrap();

        assert!(git::commit_snapshot(&repo, &normalize_gp(&resaved))
            .unwrap()
            .is_none());
        assert_eq!(git::list(&repo, git::SNAPSHOT_REF, None).unwrap().len(), 1);
    }

    #[test]
    fn a_named_version_restores_the_exact_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let repo = git::open_or_init(&dir.path().join("repo")).unwrap();

        let first = git::commit_named(&repo, b"intro v1", "Intro").unwrap();
        git::commit_named(&repo, b"intro v2", "Intro reworked").unwrap();

        assert_eq!(git::read_score(&repo, &first.id).unwrap(), b"intro v1");
    }

    #[test]
    fn snapshots_stay_within_policy_as_saves_pile_up() {
        let dir = tempfile::tempdir().unwrap();
        let repo = git::open_or_init(&dir.path().join("repo")).unwrap();
        let policy = SnapshotPolicy {
            keep_days: 3650,
            keep_count: 5,
        };

        for take in 0..20 {
            git::commit_snapshot(&repo, format!("take {take}").as_bytes()).unwrap();
            git::prune_snapshots(&repo, policy).unwrap();
        }

        let kept = git::list(&repo, git::SNAPSHOT_REF, None).unwrap();
        assert_eq!(kept.len(), 5);
        assert_eq!(git::read_score(&repo, &kept[0].id).unwrap(), b"take 19");
    }

    /// Rewrites the zip headers the way a second Guitar Pro save would.
    fn resave(bytes: &[u8]) -> Vec<u8> {
        use std::io::{Cursor, Read, Write};

        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .last_modified_time(zip::DateTime::from_date_and_time(2026, 7, 26, 11, 5, 30).unwrap());

        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for index in (0..archive.len()).rev() {
            let mut entry = archive.by_index(index).unwrap();
            let name = entry.name().to_owned();
            if entry.is_dir() {
                writer.add_directory(name, options).unwrap();
                continue;
            }
            let mut data = Vec::new();
            entry.read_to_end(&mut data).unwrap();
            writer.start_file(name, options).unwrap();
            writer.write_all(&data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
}
