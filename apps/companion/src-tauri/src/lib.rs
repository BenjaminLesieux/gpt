//! Gitarpro companion — resident menu-bar app.
//!
//! The Rust layer stays deliberately thin: windows, tray, global shortcut,
//! storage and file watching. Every bit of Guitar Pro domain logic lives in
//! TypeScript (`packages/gpt-core`).

mod commands;
mod config;
mod error;
mod events;
mod git;
mod guitar_pro;
mod normalize;
mod panel;
mod secrets;
mod shortcut;
mod state;
mod tray;
mod watcher;
mod window;

use tauri::Manager;

use crate::state::AppState;

/// Label of the always-alive hotkey panel. Created hidden at startup and only
/// ever shown/hidden — never recreated, so the hotkey feels instant.
pub const PANEL_LABEL: &str = "panel";
/// Label of the lazily created extended window.
pub const EXTENDED_LABEL: &str = "extended";

/// See the window event handler: blur-to-dismiss is disabled while developing.
const HIDE_PANEL_ON_BLUR: bool = !cfg!(debug_assertions);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::toggle_panel,
            commands::hide_panel,
            commands::open_extended_window,
            commands::list_tracked_files,
            commands::track_file,
            commands::pick_and_track_file,
            commands::untrack_file,
            commands::get_active_file,
            commands::set_active_file,
            commands::guitar_pro_binding,
            commands::request_accessibility,
            commands::commit_named,
            commands::has_pending_change,
            commands::list_versions,
            commands::list_snapshots,
            commands::get_version_blob,
            commands::restore_version,
            commands::set_remote,
            commands::push_status,
        ])
        .setup(|app| {
            // Menu-bar resident: no dock icon, no app menu bar of its own.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let state = AppState::load(data_dir)?;
            state.watcher.resync(&state.tracked_paths())?;
            app.manage(state);
            watcher::start(app.handle().clone());

            tray::init(app.handle())?;
            shortcut::init(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // The panel is a transient overlay: losing focus dismisses it.
            // Off in debug builds — opening devtools steals focus and the panel
            // would vanish from under you — and while a native modal is up.
            if HIDE_PANEL_ON_BLUR && window.label() == PANEL_LABEL && !panel::is_held() {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }

            // Closing the extended window hides it instead of destroying it, so
            // reopening from the tray is instant and the app keeps running.
            if window.label() == EXTENDED_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the Gitarpro companion");
}
