//! Global shortcut → panel toggle.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Default toggle shortcut: ⌘⇧G (Ctrl+Shift+G elsewhere).
/// Hard-coded for now; user-configurable once the settings surface exists.
fn panel_shortcut() -> Shortcut {
    #[cfg(target_os = "macos")]
    let modifiers = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let modifiers = Modifiers::CONTROL | Modifiers::SHIFT;

    Shortcut::new(Some(modifiers), Code::KeyG)
}

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let shortcut = panel_shortcut();

    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, triggered, event| {
                // Fire on press only — the release event would toggle right back.
                if triggered == &shortcut && event.state() == ShortcutState::Pressed {
                    crate::panel::toggle(app);
                }
            })
            .build(),
    )?;

    app.global_shortcut().register(shortcut)?;

    Ok(())
}
