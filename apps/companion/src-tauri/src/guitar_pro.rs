//! What score Guitar Pro currently has open.
//!
//! Guitar Pro is a Qt app: its windows leave `AXDocument` empty, so the
//! accessibility API can only hand us the window *title*, which is the score's
//! display name. There is no path to be had — callers match the name against
//! tracked files, and settle for no answer when it is ambiguous.

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
    /// platform so the panel's copy doesn't change shape when Windows lands.
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

#[cfg(not(target_os = "macos"))]
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
}
