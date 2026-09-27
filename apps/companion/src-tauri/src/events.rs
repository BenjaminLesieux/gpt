//! Events pushed to the webview. Names are mirrored in `src/lib/ipc.ts`.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::auth::AuthState;
use crate::config::TrackedFile;
use crate::deep_link::{AdoptLink, OpenLink};
use crate::error::Result;
use crate::git::Version;
use crate::push::PushStatus;

pub const FILE_SAVED: &str = "file-saved";
pub const TRACKED_FILES_CHANGED: &str = "tracked-files-changed";
pub const PUSH_STATUS_CHANGED: &str = "push-status-changed";
pub const CLAIM_ARRIVED: &str = "claim-arrived";
pub const SCORE_LINK_OPENED: &str = "score-link-opened";
pub const AUTH_STATE_CHANGED: &str = "auth-state-changed";

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

/// Emitted from the push thread after every attempt, so a badge can follow a
/// push the user is not waiting on.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushStatusChanged {
    pub id: String,
    pub status: PushStatus,
}

pub fn push_status_changed(app: &AppHandle, id: &str, status: PushStatus) {
    let _ = app.emit(
        PUSH_STATUS_CHANGED,
        PushStatusChanged {
            id: id.to_owned(),
            status,
        },
    );
}

/// A `gitarpro://` link reached this machine. Carries no credential: the
/// window shows a confirmation and the redemption happens back in Rust.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimArrived {
    pub hub: String,
    pub claim: String,
}

pub fn claim_arrived(app: &AppHandle, link: &AdoptLink) {
    let _ = app.emit(
        CLAIM_ARRIVED,
        ClaimArrived {
            hub: link.hub.clone(),
            claim: link.claim.clone(),
        },
    );
}

/// What a `gitarpro://open` link came to: `id` is the tracked file now on
/// `branch`, `None` with no `error` means this machine does not have the score.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreLinkOpened {
    pub hub: String,
    pub branch: String,
    pub id: Option<String>,
    pub error: Option<String>,
}

pub fn score_link_opened(app: &AppHandle, link: &OpenLink, opened: Result<Option<String>>) {
    let (id, error) = match opened {
        Ok(id) => (id, None),
        Err(err) => (None, Some(err.to_string())),
    };
    let _ = app.emit(
        SCORE_LINK_OPENED,
        ScoreLinkOpened {
            hub: link.hub.clone(),
            branch: link.branch.clone(),
            id,
            error,
        },
    );
}

/// Signed in, signed out, or waiting on the browser. Both windows gate on it.
pub fn auth_state_changed(app: &AppHandle, state: AuthState) {
    let _ = app.emit(AUTH_STATE_CHANGED, state);
}
