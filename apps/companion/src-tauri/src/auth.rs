//! Signing the companion in to a hub, through the browser.
//!
//! ADR 0011 and `docs/companion-sign-in.md` carry the why. The shape is the
//! clone claim's with two additions: PKCE, because any installed app may
//! register `gitarpro://` and a code lifted off the link is useless without a
//! verifier that never left this process; and a nonce, because a link this
//! process did not ask for must not sign it in as someone else.

use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use url::Url;

use crate::config::Account;
use crate::deep_link::SignedInLink;
use crate::error::{Error, Result};
use crate::events;
use crate::hub::{self, Hub};
use crate::secrets;
use crate::state::AppState;
use crate::window;

/// How often a resident companion asks whether its token still works. A
/// revoked token signs it out at the first answer; no answer changes nothing.
const RECHECK: Duration = Duration::from_secs(60 * 60);

/// What the hub says to a token it will not take (`GET /companion/me`, 401).
const REFUSED: [&str; 3] = ["no_token", "invalid_token", "token_revoked"];

#[cfg(target_os = "macos")]
const OPENER: &str = "open";
#[cfg(not(target_os = "macos"))]
const OPENER: &str = "xdg-open";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AuthState {
    SignedOut {
        /// The browser was opened and has not answered yet.
        waiting: bool,
        /// Why the last attempt did not end signed in.
        failure: Option<String>,
        /// The origin last asked or signed out of by this process, to prefill.
        hub: Option<String>,
    },
    SignedIn {
        hub: String,
        email: String,
    },
}

/// The sign-in in flight. Memory only: a link arriving after a restart was
/// not asked for by this process, and is refused.
#[derive(Default)]
pub struct SignIn(Mutex<Flow>);

#[derive(Default)]
struct Flow {
    pending: Option<Pending>,
    failure: Option<String>,
    hub: Option<String>,
}

struct Pending {
    hub: Url,
    state: String,
    verifier: String,
}

impl SignIn {
    fn lock(&self) -> MutexGuard<'_, Flow> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The pending sign-in, if this link answers it. A link that does not is
    /// left alone rather than cancelling anything: a stray link must not be
    /// able to break the real one.
    fn take(&self, link: &SignedInLink) -> Option<Pending> {
        let mut flow = self.lock();
        let pending = flow.pending.as_ref()?;

        let same_hub = Url::parse(&link.hub).is_ok_and(|hub| hub.origin() == pending.hub.origin());
        // ponytail: plain compare; no constant-time crate is declared, and a
        // deep link gives nobody a timing channel worth the name.
        if link.state != pending.state || !same_hub {
            return None;
        }
        flow.pending.take()
    }
}

pub fn auth_state(state: &AppState) -> AuthState {
    if let Some(Account { hub, email }) = state.config().account.clone() {
        return AuthState::SignedIn { hub, email };
    }

    let flow = state.sign_in.lock();
    AuthState::SignedOut {
        waiting: flow.pending.is_some(),
        failure: flow.failure.clone(),
        hub: flow.hub.clone(),
    }
}

/// Starts a sign-in, replacing any already in flight, and returns the page the
/// browser should open.
pub fn begin(state: &AppState, hub: &str, device: &str) -> Result<Url> {
    // Refused here rather than after the round trip through the browser.
    Hub::new(hub)?;
    let hub = Url::parse(hub).map_err(|_| Error::InvalidHub(hub.to_owned()))?;

    let verifier = random_token()?;
    let nonce = random_token()?;

    let mut page = hub
        .join("/connect")
        .map_err(|_| Error::InvalidHub(hub.to_string()))?;
    page.query_pairs_mut()
        .append_pair("challenge", &challenge(&verifier))
        .append_pair("state", &nonce)
        .append_pair("device", device);

    *state.sign_in.lock() = Flow {
        hub: Some(hub.origin().ascii_serialization()),
        pending: Some(Pending {
            hub,
            state: nonce,
            verifier,
        }),
        failure: None,
    };
    Ok(page)
}

/// Spends the code the link carries. `Ok(false)` for a link this process did
/// not ask for, which is ignored and costs nothing.
pub async fn complete(state: &AppState, link: &SignedInLink) -> Result<bool> {
    let Some(pending) = state.sign_in.take(link) else {
        return Ok(false);
    };

    let hub = pending.hub.origin().ascii_serialization();
    let signed_in = Hub::new(&hub)?
        .redeem_code(&link.code, &pending.verifier, &hub::device_name())
        .await?;

    // Secret first, as everywhere else: an account in the config with no
    // token behind it could never be checked.
    secrets::store(secrets::ACCOUNT, &signed_in.token)?;
    state.update(|config| {
        config.account = Some(Account {
            hub,
            email: signed_in.email,
        });
        Ok(())
    })?;
    state.watch()?;
    Ok(true)
}

/// Config first: whatever the keychain says, the companion is signed out, and
/// a token left behind is overwritten by the next sign-in.
pub fn sign_out(state: &AppState) -> Result<()> {
    let signed_out_of = state.update(|config| Ok(config.account.take()))?;
    secrets::clear(secrets::ACCOUNT)?;
    if let Some(account) = signed_out_of {
        state.sign_in.lock().hub = Some(account.hub);
    }
    state.watch()
}

/// Signs out when the hub refuses the token, and only then. Offline, or a hub
/// that is down, leaves the companion signed in.
pub async fn verify(state: &AppState) -> Result<bool> {
    let Some(account) = state.config().account.clone() else {
        return Ok(false);
    };
    let refused = match secrets::read(secrets::ACCOUNT)? {
        Some(token) => is_refusal(&Hub::new(&account.hub)?.me(&token).await),
        None => true,
    };

    if refused {
        sign_out(state)?;
    }
    Ok(refused)
}

fn is_refusal<T>(answer: &Result<T>) -> bool {
    matches!(answer, Err(Error::Hub(code, _)) if REFUSED.contains(&code.as_str()))
}

/// 32 random bytes, base64url without padding: 43 characters, inside what
/// RFC 7636 allows for a verifier and what the hub allows for a nonce.
fn random_token() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|err| std::io::Error::other(err.to_string()))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// S256, the only method the hub takes.
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

// ── Tauri glue ──────────────────────────────────────────────────────────

pub fn sign_in(app: &AppHandle, hub: &str) -> Result<()> {
    let page = begin(&app.state::<AppState>(), hub, &hub::device_name())?;

    let opened = std::process::Command::new(OPENER)
        .arg(page.as_str())
        .status()?;
    if !opened.success() {
        return Err(std::io::Error::other(format!("{OPENER} exited with {opened}")).into());
    }

    changed(app);
    Ok(())
}

/// The deep link's half. Brings the window forward only for a link that was
/// asked for — anything else is not this app's business.
pub fn arrived(app: &AppHandle, link: SignedInLink) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        match complete(&state, &link).await {
            Ok(false) => return,
            Ok(true) => {}
            Err(err) => state.sign_in.lock().failure = Some(err.to_string()),
        }

        changed(&app);
        if let Err(err) = window::open_extended(&app) {
            eprintln!("[gitarpro] could not open the window after signing in: {err}");
        }
    });
}

/// On launch, then every [`RECHECK`] while the app stays resident.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        match tauri::async_runtime::block_on(verify(&app.state::<AppState>())) {
            Ok(true) => changed(&app),
            Ok(false) => {}
            Err(err) => eprintln!("[gitarpro] could not check the account token: {err}"),
        }
        std::thread::sleep(RECHECK);
    });
}

pub fn changed(app: &AppHandle) {
    events::auth_state_changed(app, auth_state(&app.state::<AppState>()));
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    use super::*;
    use crate::config::TrackedFile;

    const EXAMPLE: &str = "https://hub.example.com";

    fn signed_out() -> (tempfile::TempDir, AppState) {
        secrets::use_mock_keychain();
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().join("data")).unwrap();
        (dir, state)
    }

    /// The link the browser would hand back for the sign-in `begin` started.
    fn answer(page: &Url, hub: &str) -> SignedInLink {
        let state = page
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();
        SignedInLink {
            hub: hub.to_owned(),
            code: "c0de".to_owned(),
            state,
        }
    }

    fn complete_now(state: &AppState, link: &SignedInLink) -> Result<bool> {
        tauri::async_runtime::block_on(complete(state, link))
    }

    /// One request, one canned answer. Returns the origin and what was asked.
    fn hub_answering(status: &str, body: &str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let response = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );

        let asked = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut chunk = [0u8; 4096];
            // Headers, then as much body as they announce.
            loop {
                let read = stream.read(&mut chunk).unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
                let text = String::from_utf8_lossy(&request).to_lowercase();
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .map_or(0, |value| value.trim().parse().unwrap());
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            stream.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&request).into_owned()
        });

        (origin, asked)
    }

    /// RFC 7636, appendix B.
    #[test]
    fn the_challenge_is_s256_of_the_verifier() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn a_verifier_is_43_unreserved_characters_and_never_repeats() {
        let a = random_token().unwrap();
        let b = random_token().unwrap();

        assert_eq!(a.len(), 43);
        assert!(a
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'));
        assert_ne!(a, b);
    }

    #[test]
    fn the_connect_page_carries_the_challenge_the_state_and_the_device() {
        let (_dir, state) = signed_out();

        let page = begin(&state, EXAMPLE, "studio-imac").unwrap();

        assert_eq!(page.origin().ascii_serialization(), EXAMPLE);
        assert_eq!(page.path(), "/connect");
        let query: std::collections::HashMap<_, _> = page.query_pairs().into_owned().collect();
        assert_eq!(query["challenge"].len(), 43);
        assert_eq!(query["state"].len(), 43);
        assert_eq!(query["device"], "studio-imac");

        let flow = state.sign_in.lock();
        let pending = flow.pending.as_ref().unwrap();
        assert_eq!(query["state"], pending.state);
        assert_eq!(query["challenge"], challenge(&pending.verifier));
    }

    #[test]
    fn the_hub_is_kept_as_its_origin() {
        let (_dir, state) = signed_out();

        let page = begin(
            &state,
            "https://hub.example.com:443/scores/k7m2x?tab=1",
            "mac",
        )
        .unwrap();

        assert_eq!(page.origin().ascii_serialization(), EXAMPLE);
        assert_eq!(page.path(), "/connect");
        assert!(matches!(
            auth_state(&state),
            AuthState::SignedOut { hub: Some(hub), .. } if hub == EXAMPLE
        ));
    }

    #[test]
    fn a_plain_http_hub_is_refused_before_the_browser_opens() {
        let (_dir, state) = signed_out();

        assert!(matches!(
            begin(&state, "http://hub.example.com", "mac"),
            Err(Error::InsecureHub(_))
        ));
        assert!(state.sign_in.lock().pending.is_none());
    }

    #[test]
    fn a_link_with_the_wrong_state_is_ignored() {
        let (_dir, state) = signed_out();
        let page = begin(&state, EXAMPLE, "mac").unwrap();
        let link = SignedInLink {
            state: "not-the-nonce-we-sent".to_owned(),
            ..answer(&page, EXAMPLE)
        };

        assert!(!complete_now(&state, &link).unwrap());
        // Still waiting for the real one.
        assert_eq!(
            auth_state(&state),
            AuthState::SignedOut {
                waiting: true,
                failure: None,
                hub: Some(EXAMPLE.to_owned())
            }
        );
    }

    #[test]
    fn a_link_with_no_sign_in_pending_is_ignored() {
        let (_dir, state) = signed_out();
        let link = SignedInLink {
            hub: EXAMPLE.to_owned(),
            code: "c0de".to_owned(),
            state: "whatever".to_owned(),
        };

        assert!(!complete_now(&state, &link).unwrap());
        assert!(state.config().account.is_none());
    }

    #[test]
    fn a_link_from_another_hub_is_ignored() {
        let (_dir, state) = signed_out();
        let page = begin(&state, EXAMPLE, "mac").unwrap();

        let link = answer(&page, "https://evil.example.com");

        assert!(!complete_now(&state, &link).unwrap());
        assert!(state.sign_in.lock().pending.is_some());
    }

    /// Starting again is how a lost browser tab is recovered, and the link
    /// the old tab would hand back must stop working.
    #[test]
    fn starting_again_retires_the_previous_nonce() {
        let (_dir, state) = signed_out();
        let first = begin(&state, EXAMPLE, "mac").unwrap();
        begin(&state, EXAMPLE, "mac").unwrap();

        assert!(!complete_now(&state, &answer(&first, EXAMPLE)).unwrap());
    }

    #[test]
    fn a_link_that_answers_the_sign_in_stores_the_account() {
        let (_dir, state) = signed_out();
        let (origin, asked) = hub_answering(
            "201 Created",
            r#"{"token":"t0ken","email":"ben@example.com"}"#,
        );
        let page = begin(&state, &origin, "mac").unwrap();
        let verifier = state
            .sign_in
            .lock()
            .pending
            .as_ref()
            .unwrap()
            .verifier
            .clone();

        assert!(complete_now(&state, &answer(&page, &origin)).unwrap());

        let request = asked.join().unwrap();
        assert!(request.starts_with("POST /companion/tokens "), "{request}");
        assert!(
            request.contains(&format!(r#""verifier":"{verifier}""#)),
            "{request}"
        );
        assert!(request.contains(r#""code":"c0de""#), "{request}");

        assert_eq!(
            auth_state(&state),
            AuthState::SignedIn {
                hub: origin,
                email: "ben@example.com".to_owned()
            }
        );
        // Spent: the same link a second time is nothing.
        assert!(state.sign_in.lock().pending.is_none());
    }

    #[test]
    fn a_refused_code_leaves_the_companion_signed_out() {
        let (_dir, state) = signed_out();
        let (origin, _asked) = hub_answering(
            "410 Gone",
            r#"{"error":{"code":"code_expired","message":"That code has expired."}}"#,
        );
        let page = begin(&state, &origin, "mac").unwrap();

        let refused = complete_now(&state, &answer(&page, &origin)).unwrap_err();

        assert!(matches!(refused, Error::Hub(ref code, _) if code == "code_expired"));
        assert!(state.config().account.is_none());
    }

    #[test]
    fn signing_out_forgets_the_account_on_disk() {
        let (dir, state) = signed_out();
        state
            .update(|config| {
                config.account = Some(Account {
                    hub: EXAMPLE.to_owned(),
                    email: "ben@example.com".to_owned(),
                });
                Ok(())
            })
            .unwrap();

        sign_out(&state).unwrap();

        let reloaded = AppState::load(dir.path().join("data")).unwrap();
        assert!(reloaded.config().account.is_none());
        // The sign-in screen offers the same hub again.
        assert!(matches!(
            auth_state(&state),
            AuthState::SignedOut { hub: Some(hub), .. } if hub == EXAMPLE
        ));
    }

    #[test]
    fn only_a_refused_token_counts_as_revoked() {
        let hub_said =
            |code: &str| -> Result<String> { Err(Error::Hub(code.to_owned(), String::new())) };

        assert!(is_refusal(&hub_said("token_revoked")));
        assert!(is_refusal(&hub_said("invalid_token")));
        // Offline is not signed out, and neither is a hub having a bad day.
        assert!(!is_refusal::<String>(&Err(Error::HubUnreachable(
            "offline".to_owned()
        ))));
        assert!(!is_refusal(&hub_said("unexpected_response")));
        assert!(!is_refusal(&Ok("ben@example.com".to_owned())));
    }

    #[test]
    fn the_watcher_runs_only_while_signed_in() {
        let (dir, state) = signed_out();
        let score = dir.path().join("riff.gp");
        std::fs::write(&score, b"take one").unwrap();
        state
            .update(|config| {
                config.tracked_files.push(TrackedFile::new(score.clone()));
                Ok(())
            })
            .unwrap();

        state.watch().unwrap();
        assert!(!state.watcher.is_watching());

        state
            .update(|config| {
                config.account = Some(Account {
                    hub: EXAMPLE.to_owned(),
                    email: "ben@example.com".to_owned(),
                });
                Ok(())
            })
            .unwrap();
        state.watch().unwrap();
        assert!(state.watcher.is_watching());

        sign_out(&state).unwrap();
        assert!(!state.watcher.is_watching());
    }
}
