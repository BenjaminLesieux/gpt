//! `gitarpro://` — the hub handing a score, or a sign-in, to this machine.
//!
//! Three shapes:
//!
//! ```text
//! gitarpro://adopt?hub=https://hub.example.com&claim=<code>
//! gitarpro://open?hub=https://hub.example.com&score=<id>&branch=<name>
//! gitarpro://signed-in?hub=https://hub.example.com&code=<code>&state=<nonce>
//! ```
//!
//! `open` carries no secret at all and buys nothing: it points at a score this
//! machine may already track, and is never a reason to adopt one. `signed-in`
//! answers a sign-in this process started; `auth.rs` owns what it is checked
//! against. The rest of this note is about `adopt`.
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
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

use crate::auth;
use crate::branch;
use crate::error::{Error, Result};
use crate::events;
use crate::hub;
use crate::remote;
use crate::secrets;
use crate::state::AppState;
use crate::window;

pub const SCHEME: &str = "gitarpro";
/// The actions the scheme carries. Anything else is ignored rather than
/// reported: an unknown link is not this app's business.
const ADOPT: &str = "adopt";
const OPEN: &str = "open";
const SIGNED_IN: &str = "signed-in";

/// A link asking for one score.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdoptLink {
    /// Where to redeem. Unvalidated here — see `hub::Hub::new`.
    pub hub: String,
    /// The single-use code. Never written to disk and never logged.
    pub claim: String,
}

/// A link asking to see one score on one branch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenLink {
    pub hub: String,
    pub score: String,
    pub branch: String,
}

/// The browser handing back a sign-in code. Every value is untrusted: the
/// nonce and the hub are checked against the sign-in this process started
/// (see `auth::complete`), and the code is useless without the verifier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignedInLink {
    pub hub: String,
    pub code: String,
    pub state: String,
}

/// The last claim handed to the window.
///
/// A cold launch delivers the URL twice: once through `get_current`, which is
/// how a link that started the app is read, and once through the `Opened`
/// event that carries it. Both are real and neither can be dropped on its own
/// — so the second one for the same code is dropped instead.
static LAST_CLAIM: Mutex<Option<String>> = Mutex::new(None);

/// The same double delivery for `open`. Unlike a claim, the same link clicked
/// again later is a real request, so only a repeat close behind is dropped.
static LAST_OPEN: Mutex<Option<(OpenLink, Instant)>> = Mutex::new(None);
const REPEAT_WINDOW: Duration = Duration::from_secs(5);

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
    if let Some(link) = parse_open(url) {
        return deliver_open(app, link);
    }
    // No dedupe needed: the first delivery spends the pending sign-in, so a
    // second copy of the same link finds nothing to complete.
    if let Some(link) = parse_signed_in(url) {
        auth::arrived(app, link);
        return;
    }

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

/// Brings the window forward at once, then finds the score, fetches and
/// switches off the main thread: the fetch waits on the network.
fn deliver_open(app: &AppHandle, link: OpenLink) {
    {
        let mut last = LAST_OPEN.lock().unwrap();
        if matches!(&*last, Some((seen, at)) if *seen == link && at.elapsed() < REPEAT_WINDOW) {
            return;
        }
        *last = Some((link.clone(), Instant::now()));
    }

    if let Err(err) = window::open_extended(app) {
        eprintln!("[gitarpro] could not open the window for a link: {err}");
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let opened = open(&state, &link);
        if matches!(opened, Ok(Some(_))) {
            events::tracked_files_changed(&app, state.config().tracked_files.clone());
        }
        events::score_link_opened(&app, &link, opened);
    });
}

/// The tracked file `link` names, now on its branch; `None` when this machine
/// does not track that score. Never starts a branch: a name the score does not
/// have, even after a fetch, is refused.
fn open(state: &AppState, link: &OpenLink) -> Result<Option<String>> {
    let file = state
        .config()
        .tracked_files
        .iter()
        .find(|file| {
            file.remote
                .as_ref()
                .is_some_and(|remote| hub::is_score_remote(&remote.url, &link.hub, &link.score))
        })
        .cloned();
    let Some(file) = file else { return Ok(None) };
    let descriptor = file.remote.as_ref().expect("matched on its remote");

    // The file's own remote and credential, never anything from the link.
    let token = secrets::for_remote(&file.id, descriptor)?;
    remote::fetch(&state.open_repo(&file.id)?, descriptor, token.as_deref())?;

    if !branch::list(state, &file.id)?.contains(&link.branch) {
        return Err(Error::UnknownBranch(file.name, link.branch.clone()));
    }
    branch::switch(state, &file.id, &link.branch)?;
    // Also when it was already on that branch: a window opened by this link
    // seeds its selection from the active file.
    state.set_active(&file.id);
    Ok(Some(file.id))
}

/// `gitarpro://adopt?…` puts `adopt` in the host for a scheme with an
/// authority, and in the path for one without. Accept either rather than
/// depending on which shape the browser normalised to.
fn action(url: &Url) -> Option<&str> {
    if url.scheme() != SCHEME {
        return None;
    }
    Some(
        url.host_str()
            .unwrap_or_else(|| url.path().trim_matches('/')),
    )
}

/// `None` for anything that is not an open link with all three values.
pub fn parse_open(url: &Url) -> Option<OpenLink> {
    if action(url)? != OPEN {
        return None;
    }

    Some(OpenLink {
        hub: param(url, "hub")?,
        score: param(url, "score")?,
        branch: param(url, "branch")?,
    })
}

/// `None` for anything that is not an adopt link with both values present.
///
/// The query is read through `url`'s own parser rather than split by hand:
/// the hub origin is percent-encoded on the way in and a `&` inside it must
/// not be able to introduce a second `claim`.
pub fn parse(url: &Url) -> Option<AdoptLink> {
    if action(url)? != ADOPT {
        return None;
    }

    Some(AdoptLink {
        hub: param(url, "hub")?,
        claim: param(url, "claim")?,
    })
}

/// `None` for anything that is not a signed-in link with all three values.
pub fn parse_signed_in(url: &Url) -> Option<SignedInLink> {
    if action(url)? != SIGNED_IN {
        return None;
    }

    Some(SignedInLink {
        hub: param(url, "hub")?,
        code: param(url, "code")?,
        state: param(url, "state")?,
    })
}

/// The last value given for `key`, if it is not empty.
fn param(url: &Url, key: &str) -> Option<String> {
    url.query_pairs()
        .filter(|(name, _)| name == key)
        .last()
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(raw: &str) -> Option<AdoptLink> {
        parse(&Url::parse(raw).unwrap())
    }

    #[test]
    fn an_adopt_link_carries_a_hub_and_a_claim() {
        let parsed =
            link("gitarpro://adopt?hub=https%3A%2F%2Fhub.example.com&claim=abc123").unwrap();

        assert_eq!(parsed.hub, "https://hub.example.com");
        assert_eq!(parsed.claim, "abc123");
    }

    #[test]
    fn the_order_of_the_parameters_does_not_matter() {
        let parsed =
            link("gitarpro://adopt?claim=abc123&hub=https%3A%2F%2Fhub.example.com").unwrap();

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
        assert_eq!(
            link("https://adopt?hub=https%3A%2F%2Fh.example&claim=abc"),
            None
        );
    }

    #[test]
    fn an_action_we_do_not_know_is_ignored() {
        assert_eq!(
            link("gitarpro://settings?hub=https%3A%2F%2Fh.example&claim=abc"),
            None
        );
    }

    #[test]
    fn a_link_missing_either_value_is_not_a_link() {
        assert_eq!(link("gitarpro://adopt?hub=https%3A%2F%2Fh.example"), None);
        assert_eq!(link("gitarpro://adopt?claim=abc"), None);
        assert_eq!(link("gitarpro://adopt?hub=&claim=abc"), None);
    }

    fn open_link(raw: &str) -> Option<OpenLink> {
        parse_open(&Url::parse(raw).unwrap())
    }

    #[test]
    fn an_open_link_carries_a_hub_a_score_and_a_branch() {
        let parsed = open_link(
            "gitarpro://open?hub=https%3A%2F%2Fhub.example.com&score=k7m2x&branch=new-chorus",
        )
        .unwrap();

        assert_eq!(
            parsed,
            OpenLink {
                hub: "https://hub.example.com".to_owned(),
                score: "k7m2x".to_owned(),
                branch: "new-chorus".to_owned(),
            }
        );
    }

    /// `URLSearchParams` encodes a `/` in a branch name; it comes back whole.
    #[test]
    fn an_encoded_branch_name_is_decoded_once() {
        let parsed = open_link(
            "gitarpro://open?branch=ideas%2Fnew+chorus&score=k7m2x&hub=https%3A%2F%2Fhub.example.com",
        )
        .unwrap();

        assert_eq!(parsed.branch, "ideas/new chorus");
    }

    #[test]
    fn an_encoded_ampersand_in_the_origin_cannot_change_the_branch() {
        let parsed = open_link(
            "gitarpro://open?hub=https%3A%2F%2Fevil.example%2F%3Fbranch%3Dtheirs&score=k7m2x&branch=mine",
        )
        .unwrap();

        assert_eq!(parsed.branch, "mine");
        assert_eq!(parsed.hub, "https://evil.example/?branch=theirs");
    }

    #[test]
    fn an_open_link_missing_or_emptying_any_value_is_not_a_link() {
        assert_eq!(
            open_link("gitarpro://open?hub=https%3A%2F%2Fh.example&score=k7m2x"),
            None
        );
        assert_eq!(
            open_link("gitarpro://open?hub=https%3A%2F%2Fh.example&branch=b"),
            None
        );
        assert_eq!(open_link("gitarpro://open?score=k7m2x&branch=b"), None);
        assert_eq!(
            open_link("gitarpro://open?hub=https%3A%2F%2Fh.example&score=&branch=b"),
            None
        );
        assert_eq!(
            open_link("gitarpro://open?hub=https%3A%2F%2Fh.example&score=k7m2x&branch="),
            None
        );
    }

    /// The two actions never stand in for each other: an open link is not a
    /// claim, and a claim does not open anything.
    #[test]
    fn open_and_adopt_are_different_links() {
        let open = "gitarpro://open?hub=https%3A%2F%2Fh.example&score=k7m2x&branch=b&claim=abc";
        let adopt = "gitarpro://adopt?hub=https%3A%2F%2Fh.example&claim=abc&score=k7m2x&branch=b";

        assert_eq!(link(open), None);
        assert_eq!(open_link(adopt), None);
        assert_eq!(
            open_link("https://open?hub=https%3A%2F%2Fh.example&score=s&branch=b"),
            None
        );
    }

    #[test]
    fn a_signed_in_link_carries_a_hub_a_code_and_a_state() {
        let url = Url::parse(
            "gitarpro://signed-in?hub=https%3A%2F%2Fhub.example.com&code=c0de&state=n0nce",
        )
        .unwrap();

        assert_eq!(
            parse_signed_in(&url),
            Some(SignedInLink {
                hub: "https://hub.example.com".to_owned(),
                code: "c0de".to_owned(),
                state: "n0nce".to_owned(),
            })
        );
        assert_eq!(parse(&url), None);
    }

    #[test]
    fn a_signed_in_link_missing_any_value_is_not_a_link() {
        for raw in [
            "gitarpro://signed-in?hub=https%3A%2F%2Fh.example&code=c",
            "gitarpro://signed-in?hub=https%3A%2F%2Fh.example&state=s",
            "gitarpro://signed-in?code=c&state=s",
            "gitarpro://signed-in?hub=https%3A%2F%2Fh.example&code=&state=s",
        ] {
            assert_eq!(parse_signed_in(&Url::parse(raw).unwrap()), None, "{raw}");
        }
    }
}
