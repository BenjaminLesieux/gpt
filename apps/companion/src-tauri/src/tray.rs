//! Menu-bar tray icon: left click toggles the panel, right click opens a menu.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle,
};

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let panel_item = MenuItem::with_id(app, "panel", "Panneau rapide", true, None::<&str>)?;
    let extended_item = MenuItem::with_id(app, "extended", "Fenêtre complète", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quitter Gitarpro", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &panel_item,
            &extended_item,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    TrayIconBuilder::with_id("gitarpro")
        .icon(tauri::include_image!("icons/tray.png"))
        // The icon is black-on-alpha; as a template macOS recolours it to match
        // the menu bar, including the inversion under a dark or tinted one. The
        // app icon cannot do that — it is a colour logotype on an opaque square.
        .icon_as_template(true)
        .tooltip("Gitarpro")
        .menu(&menu)
        // Left click toggles the panel; the menu is right-click only.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "panel" => crate::panel::toggle(app),
            "extended" => {
                let _ = crate::window::open_extended(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::panel::toggle(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
