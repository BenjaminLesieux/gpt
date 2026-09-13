//! `gitarpro://` — the hub handing a score to this machine.
//!
//! One shape, and deliberately only one:
//!
//! ```text
//! gitarpro://adopt?hub=https://hub.example.com&claim=<code>
//! ```
//!
//! What travels here is a claim, never a credential. A custom-scheme URL is
//! handed to LaunchServices, which is not an access log but is not nothing
//! either: any installed app may register the same scheme and macOS picks one
//! handler, and browsers vary on whether an external-protocol navigation lands
//! in history. The claim is single-use, expires in five minutes and buys
//! exactly one score, so what it costs to leak is bounded and short.
//!
//! Both values are therefore attacker-controllable and neither is trusted
//! here. This module parses; `hub.rs` refuses a non-https origin, and the
//! score's name comes back from the hub rather than from the link so that a
//! crafted link cannot say *Blackbird* and deliver something else.
//!
//! Known cost: macOS registers schemes from the bundle's `Info.plist` through
//! LaunchServices, so none of this can be exercised under `tauri dev` — the
//! app has to be bundled and run from `/Applications`.

use std::sync::Mutex;

use tauri::AppHandle;
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

use crate::events;
use crate::window;

pub const SCHEME: &str = "gitarpro";
/// The only action the scheme carries. Anything else is ignored rather than
/// reported: an unknown link is not this app's business.
const ADOPT: &str = "adopt";

/// A link asking for one score.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdoptLink {
    /// Where to redeem. Unvalidated here — see `hub::Hub::new`.
    pub hub: String,
    /// The single-use code. Never written to disk and never logged.
    pub claim: String,
}

/// The last claim handed to the window.
///
/// A cold launch delivers the URL twice: once through `get_current`, which is
/// how a link that started the app is read, and once through the `Opened`
/// event that carries it. Both are real and neither can be dropped on its own
/// — so the second one for the same code is dropped instead.
static LAST_CLAIM: Mutex<Option<String>> = Mutex::new(None);

/// Wires the scheme up. Called from `setup`, before the run loop, so the
/// launch that opened the app is not missed.
pub fn init(app: &AppHandle) {
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            deliver(&handle, &url);
        }
    });

    // What the app was started with, as opposed to what arrived while it was
    // already running. On a machine where the companion is not resident this
    // is the only one of the two that fires.
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            deliver(app, &url);
        }
    }
}

/// Puts the claim in front of the user: the extended window comes forward and
/// is told what arrived. Nothing is redeemed until they say so — the claim
/// works once, and spending it to fill a dialog would waste it on every
/// cancel.
fn deliver(app: &AppHandle, url: &Url) {
    let Some(link) = parse(url) else { return };

    {
        let mut last = LAST_CLAIM.lock().unwrap();
        if last.as_deref() == Some(link.claim.as_str()) {
            return;
        }
        *last = Some(link.claim.clone());
    }

    if let Err(err) = window::open_extended(app) {
        eprintln!("[gitarpro] could not open the window for a link: {err}");
        return;
    }
    events::claim_arrived(app, &link);
}

/// `None` for anything that is not an adopt link with both values present.
///
/// The query is read through `url`'s own parser rather than split by hand:
/// the hub origin is percent-encoded on the way in and a `&` inside it must
/// not be able to introduce a second `claim`.
pub fn parse(url: &Url) -> Option<AdoptLink> {
    if url.scheme() != SCHEME {
        return None;
    }
    // `gitarpro://adopt?…` puts `adopt` in the host for a scheme with an
    // authority, and in the path for one without. Accept either rather than
    // depending on which shape the browser normalised to.
    let action = url.host_str().unwrap_or_else(|| url.path().trim_matches('/'));
    if action != ADOPT {
        return None;
    }

    let mut hub = None;
    let mut claim = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "hub" => hub = Some(value.into_owned()),
            "claim" => claim = Some(value.into_owned()),
            _ => {}
        }
    }

    let hub = hub.filter(|value| !value.is_empty())?;
    let claim = claim.filter(|value| !value.is_empty())?;
    Some(AdoptLink { hub, claim })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(raw: &str) -> Option<AdoptLink> {
        parse(&Url::parse(raw).unwrap())
    }

    #[test]
    fn an_adopt_link_carries_a_hub_and_a_claim() {
        let parsed = link("gitarpro://adopt?hub=https%3A%2F%2Fhub.example.com&claim=abc123").unwrap();

        assert_eq!(parsed.hub, "https://hub.example.com");
        assert_eq!(parsed.claim, "abc123");
    }

    #[test]
    fn the_order_of_the_parameters_does_not_matter() {
        let parsed = link("gitarpro://adopt?claim=abc123&hub=https%3A%2F%2Fhub.example.com").unwrap();

        assert_eq!(parsed.hub, "https://hub.example.com");
    }

    /// A hub origin with a query string of its own is one value, not two.
    #[test]
    fn an_encoded_ampersand_in_the_origin_cannot_add_a_claim() {
        let parsed =
            link("gitarpro://adopt?hub=https%3A%2F%2Fevil.example%2F%3Fclaim%3Dtheirs&claim=mine")
                .unwrap();

        assert_eq!(parsed.claim, "mine");
        assert_eq!(parsed.hub, "https://evil.example/?claim=theirs");
    }

    #[test]
    fn another_scheme_is_not_ours() {
        assert_eq!(link("https://adopt?hub=https%3A%2F%2Fh.example&claim=abc"), None);
    }

    #[test]
    fn an_action_we_do_not_know_is_ignored() {
        assert_eq!(link("gitarpro://settings?hub=https%3A%2F%2Fh.example&claim=abc"), None);
    }

    #[test]
    fn a_link_missing_either_value_is_not_a_link() {
        assert_eq!(link("gitarpro://adopt?hub=https%3A%2F%2Fh.example"), None);
        assert_eq!(link("gitarpro://adopt?claim=abc"), None);
        assert_eq!(link("gitarpro://adopt?hub=&claim=abc"), None);
    }
}
