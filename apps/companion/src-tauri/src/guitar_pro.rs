//! What score Guitar Pro currently has open.
//!
//! Guitar Pro is a Qt app: its windows leave `AXDocument` empty, so the
//! accessibility API can only hand us the window *title*, which is the score's
//! display name. There is no path to be had — callers match the name against
//! tracked files, and settle for no answer when it is ambiguous. Windows has
//! the same title, read straight off the window, with no permission to ask.

use serde::Serialize;

/// Whether the host can see Guitar Pro at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Access {
    Granted,
    /// The user has not allowed accessibility access yet. Guitar Pro is
    /// invisible to us until they do.
    Denied,
    /// No window detection on this platform. Part of the contract on every
    /// platform so the panel's copy doesn't change shape off macOS and Windows.
    #[allow(dead_code)]
    Unsupported,
}

pub fn access() -> Access {
    imp::access()
}

/// The display name shown by Guitar Pro's front window, if it has one.
pub fn open_document() -> Option<String> {
    imp::open_document()
}

/// Puts the system's accessibility prompt up and sends the user to the pane
/// that grants it.
pub fn request_access() {
    imp::request_access();
}

/// Guitar Pro titles its window with the score's display name. A document with
/// unsaved edits picks up a trailing marker; everything else has to match, so
/// "Riff" never adopts "Riff v2".
pub fn document_matches(title: &str, name: &str) -> bool {
    title.trim().trim_end_matches(['*', '•']).trim_end() == name
}

/// Qt appends the application's name to a title everywhere but macOS:
/// "Blackbird* - Guitar Pro 8".
// ponytail: the suffix is Qt's documented format, not one seen on a real
// Guitar Pro install; if Windows titles come out differently, this is the
// one place to teach.
#[cfg_attr(not(windows), allow(dead_code))]
fn without_app_name(title: &str) -> &str {
    match title.rsplit_once(" - ") {
        Some((score, app)) if app.starts_with("Guitar Pro") => score,
        _ => title,
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};
    use core_foundation_sys::base::Boolean;
    use objc2_app_kit::NSRunningApplication;
    use objc2_foundation::NSString;

    use super::Access;

    /// Newest first — a machine with both installed is running the new one.
    const BUNDLE_IDS: [&str; 2] = ["com.arobas-music.guitarpro8", "com.arobas-music.guitarpro7"];

    /// Accessibility calls block until the target app answers, and the default
    /// wait is six seconds. The panel is read on the way to being shown, so a
    /// Guitar Pro busy rendering a score must cost a hiccup, not the gesture.
    const TIMEOUT: f32 = 0.1;

    /// The document window, then whatever has focus — a modal up in front of
    /// the score must not be mistaken for the score.
    const WINDOW_ATTRIBUTES: [&str; 2] = ["AXMainWindow", "AXFocusedWindow"];

    const TITLE_ATTRIBUTE: &str = "AXTitle";

    type AXUIElementRef = CFTypeRef;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> Boolean;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> Boolean;
        fn AXUIElementCreateApplication(pid: libc::pid_t) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> i32;
        fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, seconds: f32) -> i32;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    pub fn access() -> Access {
        // Also how the app earns its row in System Settings — until something
        // asks, there is nothing for the user to switch on.
        match unsafe { AXIsProcessTrusted() } != 0 {
            true => Access::Granted,
            false => Access::Denied,
        }
    }

    pub fn open_document() -> Option<String> {
        if access() != Access::Granted {
            return None;
        }

        let app = app_element()?;
        let window = WINDOW_ATTRIBUTES
            .iter()
            .find_map(|attribute| copy_attribute(&app, attribute))?;
        let title = copy_attribute(&window, TITLE_ATTRIBUTE)?
            .downcast::<CFString>()?
            .to_string();

        let title = title.trim();
        (!title.is_empty()).then(|| title.to_owned())
    }

    pub fn request_access() {
        let options = CFDictionary::from_CFType_pairs(&[(
            unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) },
            CFBoolean::true_value(),
        )]);
        unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) };

        // The prompt only ever shows once per install, so on every run after
        // the first it would be a button that does nothing.
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }

    fn app_element() -> Option<CFType> {
        let element = unsafe { AXUIElementCreateApplication(pid()?) };
        if element.is_null() {
            return None;
        }
        unsafe { AXUIElementSetMessagingTimeout(element, TIMEOUT) };
        Some(unsafe { CFType::wrap_under_create_rule(element) })
    }

    fn pid() -> Option<libc::pid_t> {
        BUNDLE_IDS
            .iter()
            .find_map(|bundle_id| {
                NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(
                    bundle_id,
                ))
                .firstObject()
            })
            .map(|app| app.processIdentifier())
            .filter(|pid| *pid > 0)
    }

    fn copy_attribute(element: &CFType, attribute: &str) -> Option<CFType> {
        let name = CFString::new(attribute);
        let mut value: CFTypeRef = std::ptr::null();
        let status = unsafe {
            AXUIElementCopyAttributeValue(
                element.as_CFTypeRef(),
                name.as_concrete_TypeRef(),
                &mut value,
            )
        };
        if status != 0 || value.is_null() {
            return None;
        }
        Some(unsafe { CFType::wrap_under_create_rule(value) })
    }
}

#[cfg(windows)]
mod imp {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;

    use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, GW_OWNER,
    };

    use super::Access;

    /// Guitar Pro 8, then 7.
    const EXECUTABLES: [&str; 2] = ["GuitarPro.exe", "GuitarPro7.exe"];

    /// Nothing to grant: any process may read another's window titles.
    pub fn access() -> Access {
        Access::Granted
    }

    /// `EnumWindows` walks top-level windows front to back, so the first
    /// Guitar Pro one is the one in front. Owned windows are skipped — a
    /// dialog up in front of the score must not be mistaken for the score.
    pub fn open_document() -> Option<String> {
        let mut found: Option<String> = None;
        unsafe { EnumWindows(Some(visit), &mut found as *mut _ as LPARAM) };
        let title = super::without_app_name(found?.trim()).trim().to_owned();
        (!title.is_empty()).then_some(title)
    }

    pub fn request_access() {}

    unsafe extern "system" fn visit(window: HWND, found: LPARAM) -> BOOL {
        if IsWindowVisible(window) == 0
            || !GetWindow(window, GW_OWNER).is_null()
            || !is_guitar_pro(window)
        {
            return 1;
        }
        // Another process's window: the caption is read from the system's
        // copy rather than asked of the window, so a busy Guitar Pro cannot
        // stall the panel.
        let mut text = [0u16; 512];
        let len = GetWindowTextW(window, text.as_mut_ptr(), text.len() as i32);
        if len <= 0 {
            return 1;
        }
        *(found as *mut Option<String>) = Some(String::from_utf16_lossy(&text[..len as usize]));
        0
    }

    unsafe fn is_guitar_pro(window: HWND) -> bool {
        let mut pid = 0;
        GetWindowThreadProcessId(window, &mut pid);
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let mut image = [0u16; 1024];
        let mut len = image.len() as u32;
        let ok =
            QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, image.as_mut_ptr(), &mut len);
        CloseHandle(process);
        if ok == 0 {
            return false;
        }
        let image = OsString::from_wide(&image[..len as usize]);
        Path::new(&image)
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| EXECUTABLES.iter().any(|exe| exe.eq_ignore_ascii_case(name)))
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod imp {
    use super::Access;

    pub fn access() -> Access {
        Access::Unsupported
    }

    pub fn open_document() -> Option<String> {
        None
    }

    pub fn request_access() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_title_matches_the_score_it_names() {
        assert!(document_matches("Blackbird", "Blackbird"));
        // Unsaved edits.
        assert!(document_matches("Blackbird*", "Blackbird"));
        assert!(document_matches("Blackbird •", "Blackbird"));
    }

    #[test]
    fn a_window_title_never_matches_a_neighbouring_score() {
        assert!(!document_matches("Blackbird v2", "Blackbird"));
        assert!(!document_matches("Blackbird", "Blackbird v2"));
        assert!(!document_matches("", "Blackbird"));
    }

    #[test]
    fn the_windows_title_suffix_comes_off_and_nothing_else_does() {
        assert_eq!(without_app_name("Blackbird* - Guitar Pro 8"), "Blackbird*");
        assert_eq!(
            without_app_name("Rock - Live - Guitar Pro 7"),
            "Rock - Live"
        );
        assert_eq!(without_app_name("Rock - Live"), "Rock - Live");
    }
}
