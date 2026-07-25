//! Gitarpro companion — resident menu-bar app.
//!
//! The Rust layer stays deliberately thin: windows, tray, global shortcut and
//! (from M2) storage + file watching. Every bit of Guitar Pro domain logic
//! lives in TypeScript (`packages/gpt-core`).

mod panel;
mod shortcut;
mod tray;
mod window;

/// Label of the always-alive hotkey panel. Created hidden at startup and only
/// ever shown/hidden — never recreated, so the hotkey feels instant.
pub const PANEL_LABEL: &str = "panel";
/// Label of the lazily created extended window.
pub const EXTENDED_LABEL: &str = "extended";

/// See the window event handler: blur-to-dismiss is disabled while developing.
const HIDE_PANEL_ON_BLUR: bool = !cfg!(debug_assertions);

#[tauri::command]
fn toggle_panel(app: tauri::AppHandle) {
    panel::toggle(&app);
}

#[tauri::command]
fn hide_panel(app: tauri::AppHandle) {
    panel::hide(&app);
}

#[tauri::command]
fn open_extended_window(app: tauri::AppHandle) -> Result<(), String> {
    window::open_extended(&app).map_err(|err| err.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            toggle_panel,
            hide_panel,
            open_extended_window
        ])
        .setup(|app| {
            // Menu-bar resident: no dock icon, no app menu bar of its own.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            tray::init(app.handle())?;
            shortcut::init(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // The panel is a transient overlay: losing focus dismisses it.
            // Off in debug builds — opening devtools steals focus and the panel
            // would vanish from under you.
            if HIDE_PANEL_ON_BLUR && window.label() == PANEL_LABEL {
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
