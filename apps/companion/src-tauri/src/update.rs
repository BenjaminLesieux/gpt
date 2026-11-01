//! Self-update (ADR 0014).
//!
//! Checked on launch and every few hours, downloaded in the background, and
//! installed only when the user asks for the restart. Nothing here restarts on
//! its own: the push queue lives in memory, so a restart is only safe once it
//! has drained, and only the user knows whether now is a good moment.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{Error, Result};
use crate::events;
use crate::state::AppState;

const EVERY: Duration = Duration::from_secs(4 * 60 * 60);

/// A downloaded, signature-checked update waiting for the restart.
#[derive(Default)]
pub struct Ready(Mutex<Option<(Update, Vec<u8>)>>);

pub fn start(app: AppHandle) {
    app.manage(Ready::default());
    std::thread::spawn(move || loop {
        if let Err(err) = tauri::async_runtime::block_on(fetch(&app)) {
            eprintln!("[gitarpro] update check failed: {err}");
        }
        std::thread::sleep(EVERY);
    });
}

async fn fetch(app: &AppHandle) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    if version(app).as_deref() == Some(update.version.as_str()) {
        return Ok(());
    }

    let bytes = update.download(|_, _| {}, || {}).await?;
    let version = update.version.clone();
    *lock(app) = Some((update, bytes));
    events::update_ready(app, &version);
    Ok(())
}

/// The version waiting for a restart, if any. The window asks on mount, since
/// the event may have fired before it was listening.
pub fn version(app: &AppHandle) -> Option<String> {
    lock(app).as_ref().map(|(update, _)| update.version.clone())
}

/// `false` while a push is queued or in flight: the queue lives in memory and
/// a restart would drop it.
pub fn install_and_restart(app: &AppHandle) -> Result<bool> {
    if app.state::<AppState>().pushes.any_pending() {
        return Ok(false);
    }
    let Some((update, bytes)) = lock(app).take() else {
        return Ok(false);
    };
    update
        .install(bytes)
        .map_err(|err| Error::Update(err.to_string()))?;
    app.restart()
}

fn lock(app: &AppHandle) -> std::sync::MutexGuard<'_, Option<(Update, Vec<u8>)>> {
    app.state::<Ready>()
        .inner()
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
