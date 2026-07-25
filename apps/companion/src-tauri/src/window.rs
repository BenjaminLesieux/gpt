//! The extended window: created on first request, then reused.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn open_extended(app: &AppHandle) -> tauri::Result<()> {
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
