//! The extended window: created on first request, then reused.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// The panel goes away on the way out: the two surfaces are alternatives, and
/// leaving a hotkey overlay floating over the window it just handed off to
/// reads as a stuck window.
pub fn open_extended(app: &AppHandle) -> tauri::Result<()> {
    crate::panel::hide(app);
    show_in_dock(app, true);

    if let Some(window) = app.get_webview_window(crate::EXTENDED_LABEL) {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(
        app,
        crate::EXTENDED_LABEL,
        WebviewUrl::App("extended.html".into()),
    )
    .title("Gitarpro")
    .inner_size(1100.0, 760.0)
    .min_inner_size(720.0, 480.0)
    .resizable(true)
    .visible(true);

    // The window chrome is drawn by the webview (see ExtendedApp's header).
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    let window = builder.build()?;
    window.set_focus()?;

    Ok(())
}

/// Closing the window keeps the process alive behind the tray, so the dock
/// icon has to leave with the window rather than with the app.
pub fn hide_extended(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(crate::EXTENDED_LABEL) {
        let _ = window.hide();
    }
    show_in_dock(app, false);
}

/// The dock icon tracks the extended window, not the process. A menu-bar
/// resident with nothing on screen has no business in the dock; while its
/// window is up it should ⌘-Tab, own a menu bar and be reachable like any
/// other app. `LSUIElement` makes accessory the state the app launches in,
/// and this promotes it from there.
#[cfg(target_os = "macos")]
fn show_in_dock(app: &AppHandle, visible: bool) {
    let policy = if visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };

    if let Err(err) = app.set_activation_policy(policy) {
        eprintln!("[gitarpro] could not change the activation policy: {err}");
    }
}

#[cfg(not(target_os = "macos"))]
fn show_in_dock(_app: &AppHandle, _visible: bool) {}
