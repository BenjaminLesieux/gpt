//! Show / hide / position the hotkey panel.
//!
//! Latency is the product here: the window exists from startup (hidden) and we
//! only ever toggle visibility, so hotkey → visible stays a few milliseconds.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

use crate::state::AppState;

/// Gap kept between the panel and the edges of the screen, in logical pixels.
/// Roughly clears the macOS menu bar so the panel reads as hanging from it.
const SCREEN_MARGIN: f64 = 32.0;

/// Set while a native modal is up. The panel dismisses itself on blur, and a
/// file picker steals focus — without this, choosing a file would close the
/// panel out from under the user.
static HELD: AtomicBool = AtomicBool::new(false);

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(crate::PANEL_LABEL)
}

/// Guard rather than a pair of calls: an early return or a `?` must not leave
/// the panel pinned open forever.
pub struct Hold;

pub fn hold() -> Hold {
    HELD.store(true, Ordering::SeqCst);
    Hold
}

impl Drop for Hold {
    fn drop(&mut self) {
        HELD.store(false, Ordering::SeqCst);
    }
}

pub fn is_held() -> bool {
    HELD.load(Ordering::SeqCst)
}

/// Hand focus back after a modal closes, so typing goes to the panel again.
pub fn focus(app: &AppHandle) {
    if let Some(window) = window(app) {
        let _ = window.set_focus();
    }
}

/// Hide the panel if it is showing, show it (near the cursor) otherwise.
pub fn toggle(app: &AppHandle) {
    let Some(window) = window(app) else { return };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        // Before the webview is told to reload: showing the panel is the
        // moment Guitar Pro still has the score the user was just editing in
        // front, and by the time the panel has focus it no longer does.
        app.state::<AppState>().adopt_open_document();

        position_near_cursor(app, &window);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = window(app) {
        let _ = window.hide();
    }
}

/// Drop the panel under the cursor's monitor, horizontally centred on the
/// pointer and clamped inside the screen. Approximates "hanging from the tray
/// icon" without asking the OS where the tray item actually is.
fn position_near_cursor(app: &AppHandle, window: &WebviewWindow) {
    let Ok(cursor) = app.cursor_position() else {
        return;
    };

    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };

    let Ok(size) = window.outer_size() else {
        return;
    };

    let margin = (SCREEN_MARGIN * monitor.scale_factor()).round() as i32;
    let screen_pos = monitor.position();
    let screen_size = monitor.size();

    let min_x = screen_pos.x + margin;
    let max_x = screen_pos.x + screen_size.width as i32 - size.width as i32 - margin;
    let x = (cursor.x.round() as i32 - size.width as i32 / 2).clamp(min_x, max_x.max(min_x));
    let y = screen_pos.y + margin;

    let _ = window.set_position(PhysicalPosition::new(x, y));
}
