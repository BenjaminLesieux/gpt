//! Events pushed to the webview. Names are mirrored in `src/lib/ipc.ts`.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::config::TrackedFile;
use crate::git::Version;

pub const FILE_SAVED: &str = "file-saved";
pub const TRACKED_FILES_CHANGED: &str = "tracked-files-changed";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSaved {
    pub id: String,
    pub path: PathBuf,
    /// `None` when the save changed nothing musically.
    pub version: Option<Version>,
}

pub fn file_saved(app: &AppHandle, payload: FileSaved) {
    let _ = app.emit(FILE_SAVED, payload);
}

pub fn tracked_files_changed(app: &AppHandle, files: Vec<TrackedFile>) {
    let _ = app.emit(TRACKED_FILES_CHANGED, files);
}
