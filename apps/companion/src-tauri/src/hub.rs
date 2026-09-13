//! Talking to a hub over its JSON API.
//!
//! The first HTTP this process has ever spoken that git2 did not speak for
//! it, and it exists for exactly two calls: reading what a claim is about,
//! and spending it.
//!
//! The origin is not ours. It arrives in a `gitarpro://` link, which is to
//! say it arrives from whatever put that link in front of the user — so it is
//! checked here rather than trusted, and the confirmation dialog shows it
//! before anything is fetched. The blast radius of a lie is "you adopted a
//! score you did not want", which is what the confirmation is for.
//!
//! Redemption happens here and not in the webview on purpose: the CSP's
//! `connect-src` is a fixed allowlist, and letting the page reach an
//! arbitrary hub would mean `connect-src https:`.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{Error, Result};

/// Long enough for a hub on a slow link, short enough that an unreachable one
/// is an answer rather than a hang. Nothing behind this is a background task:
/// someone is watching a dialog.
const TIMEOUT: Duration = Duration::from_secs(20);

/// What a claim is about, before anything has been spent.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimPeek {
    /// Read back from the hub, never from the link — otherwise a crafted link
    /// could name one score and deliver another.
    pub score_name: String,
    /// The hub's own idea of where it lives. It disagreeing with the origin
    /// in the link is how a link pointing somewhere unexpected shows up.
    pub hub_name: String,
}

/// What the claim bought. The only time these values exist outside a keychain.
///
/// The response also carries the score's name; it is not read here, because
/// by this point the save dialog has already been named from the peek and
/// there is nothing left for a second copy to decide.
#[derive(Debug, Clone, Deserialize)]
pub struct RedeemedClaim {
    pub url: String,
    pub username: String,
    pub token: String,
}

/// The shape every failure the hub returns takes.
#[derive(Debug, Deserialize)]
struct HubErrorBody {
    error: HubErrorFields,
}

#[derive(Debug, Deserialize)]
struct HubErrorFields {
    code: String,
    message: String,
}

#[derive(Debug)]
pub struct Hub {
    origin: Url,
    client: reqwest::Client,
}

impl Hub {
    /// Refuses anything but https, and `http://localhost` for development.
    ///
    /// The token this is about to fetch is a git password. Over plain http it
    /// would travel in the clear to an origin nobody vouched for, and the
    /// user's only evidence that anything was wrong would be a dialog that
    /// looked exactly like the right one.
    pub fn new(origin: &str) -> Result<Self> {
        let origin = Url::parse(origin).map_err(|_| Error::InvalidHub(origin.to_owned()))?;

        let secure = origin.scheme() == "https"
            || (origin.scheme() == "http"
                && matches!(origin.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")));
        if !secure {
            return Err(Error::InsecureHub(origin.to_string()));
        }

        let client = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .build()
            .map_err(|err| Error::HubUnreachable(err.to_string()))?;

        Ok(Self { origin, client })
    }

    /// What the claim is about. Consumes nothing: the confirmation dialog has
    /// to name the score before the user has agreed to anything, and a claim
    /// works once — spending it to fill a dialog would waste it on a cancel.
    pub async fn peek(&self, claim: &str) -> Result<ClaimPeek> {
        let response = self
            .client
            .get(self.claim_url(claim)?)
            .send()
            .await
            .map_err(unreachable_hub)?;

        read(response).await
    }

    /// Spends the claim. `device` names the token the hub mints, which is how
    /// this machine is told apart from the others in the score's list.
    pub async fn redeem(&self, claim: &str, device: &str) -> Result<RedeemedClaim> {
        let response = self
            .client
            .post(self.claim_url(claim)?)
            .json(&serde_json::json!({ "device": device }))
            .send()
            .await
            .map_err(unreachable_hub)?;

        read(response).await
    }

    /// The code goes in a path segment, so it is checked against the alphabet
    /// it is minted from rather than escaped. A value that is not a code
    /// cannot name a claim anyway, and refusing it here means nothing else
    /// downstream has to wonder what is in it.
    fn claim_url(&self, claim: &str) -> Result<Url> {
        if claim.is_empty()
            || !claim
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        {
            return Err(Error::InvalidClaim);
        }

        self.origin
            .join(&format!("/claims/{claim}"))
            .map_err(|_| Error::InvalidHub(self.origin.to_string()))
    }
}

/// The hub's own error body, or the status on its own when the answer is not
/// one — a proxy in front of an origin that is not a hub at all answers with
/// HTML, and "that did not look like a hub" is the useful thing to say.
async fn read<T: serde::de::DeserializeOwned>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    let body = response.bytes().await.map_err(unreachable_hub)?;

    if !status.is_success() {
        return Err(match serde_json::from_slice::<HubErrorBody>(&body) {
            Ok(parsed) => Error::Hub(parsed.error.code, parsed.error.message),
            Err(_) => Error::Hub(
                "unexpected_response".to_owned(),
                format!("The hub answered {status}."),
            ),
        });
    }

    serde_json::from_slice(&body).map_err(|_| {
        Error::Hub(
            "unexpected_response".to_owned(),
            "That address answered, but not like a Gitarpro hub.".to_owned(),
        )
    })
}

fn unreachable_hub(err: reqwest::Error) -> Error {
    Error::HubUnreachable(err.to_string())
}

/// What this machine calls itself, for the token the hub is about to mint.
///
/// The hostname rather than anything the user types: the name's whole job is
/// to tell two of their own computers apart in a list, and a machine already
/// has a name for that. `.local` is noise on every Mac and comes off.
pub fn device_name() -> String {
    tidy(&hostname())
}

/// The hub's own default, and what is left when the machine will not say.
const UNNAMED_DEVICE: &str = "companion";

#[cfg(target_os = "macos")]
fn hostname() -> String {
    let mut buffer = [0i8; 256];
    // SAFETY: the buffer is ours, and the length passed is its own.
    if unsafe { libc::gethostname(buffer.as_mut_ptr(), buffer.len()) } != 0 {
        return String::new();
    }

    let bytes: Vec<u8> = buffer
        .iter()
        .take_while(|&&byte| byte != 0)
        .map(|&byte| byte as u8)
        .collect();

    String::from_utf8_lossy(&bytes).into_owned()
}

#[cfg(not(target_os = "macos"))]
fn hostname() -> String {
    String::new()
}

fn tidy(raw: &str) -> String {
    let name = raw.trim().trim_end_matches(".local").trim();

    if name.is_empty() {
        UNNAMED_DEVICE.to_owned()
    } else {
        name.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_http_hub_is_refused() {
        let refused = Hub::new("http://hub.example.com").unwrap_err();

        assert!(matches!(refused, Error::InsecureHub(_)), "{refused}");
    }

    /// Development runs the hub on plain http by design, and the whole flow
    /// would be untestable without this.
    #[test]
    fn localhost_over_http_is_allowed() {
        assert!(Hub::new("http://localhost:3000").is_ok());
        assert!(Hub::new("http://127.0.0.1:3000").is_ok());
    }

    #[test]
    fn something_that_is_not_an_origin_is_refused() {
        assert!(matches!(
            Hub::new("not a url").unwrap_err(),
            Error::InvalidHub(_)
        ));
        assert!(matches!(
            Hub::new("file:///etc/passwd").unwrap_err(),
            Error::InsecureHub(_)
        ));
    }

    #[test]
    fn the_claim_lands_in_the_path_it_is_meant_to() {
        let hub = Hub::new("https://hub.example.com").unwrap();

        assert_eq!(
            hub.claim_url("abc-123_XYZ").unwrap().as_str(),
            "https://hub.example.com/claims/abc-123_XYZ"
        );
    }

    /// The code is checked rather than escaped, so a value carrying path
    /// syntax is refused instead of quietly naming something else.
    #[test]
    fn a_code_that_is_not_a_code_is_refused() {
        let hub = Hub::new("https://hub.example.com").unwrap();

        for bad in ["../auth/me", "a/b", "a?b", "a b", ""] {
            assert!(matches!(hub.claim_url(bad), Err(Error::InvalidClaim)), "{bad}");
        }
    }

    /// A hub origin with a path keeps the app off it: claims live at the root.
    #[test]
    fn a_path_on_the_origin_does_not_move_the_endpoint() {
        let hub = Hub::new("https://hub.example.com/some/where").unwrap();

        assert_eq!(
            hub.claim_url("abc").unwrap().as_str(),
            "https://hub.example.com/claims/abc"
        );
    }

    #[test]
    fn this_machine_has_a_name() {
        assert!(!device_name().is_empty());
        assert!(!device_name().ends_with(".local"));
    }

    /// The name lands in a list the user reads to tell their own computers
    /// apart, so `.local` comes off and a machine that will not say gets the
    /// hub's own default rather than an empty cell.
    #[test]
    fn a_hostname_is_tidied_into_a_label() {
        assert_eq!(tidy("Bens-MacBook-Pro.local"), "Bens-MacBook-Pro");
        assert_eq!(tidy("  studio-imac  "), "studio-imac");
        assert_eq!(tidy(""), "companion");
        assert_eq!(tidy(".local"), "companion");
    }
}
