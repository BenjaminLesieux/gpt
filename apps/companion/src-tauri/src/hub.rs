//! Talking to a hub over its JSON API.
//!
//! The first HTTP this process has ever spoken that git2 did not speak for
//! it: reading what a claim is about, spending it, and landing a branch.
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

/// What pressing land did. `MainMoved` is the hub's 409: someone else landed
/// between its read of main and its write.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum LandOutcome {
    Landed {
        commit: String,
    },
    /// Would land, but the hub is in dry run and wrote nothing.
    Clean,
    Waiting,
    Conflicts {
        clean_bars: u32,
        conflicts: Vec<Conflict>,
    },
    Unreadable,
    UpToDate,
    MainMoved,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub bar: Option<u32>,
    pub track: Option<String>,
    pub description: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AskFirst {
    ask_first: bool,
}

#[derive(Deserialize)]
struct Branches {
    branches: Vec<ListedBranch>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListedBranch {
    name: String,
    ask_first: bool,
}

/// A score's own remote, read as the hub that serves it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HubScore {
    pub origin: Url,
    pub score: String,
}

/// `<hub>/git/<owner>/<score>.git`, or `None` for a remote that is not a hub.
pub fn hub_score(remote_url: &str) -> Option<HubScore> {
    let url = Url::parse(remote_url).ok()?;
    let segments: Vec<&str> = url.path_segments()?.collect();
    let ["git", owner, repo] = segments.as_slice() else {
        return None;
    };
    let score = repo.strip_suffix(".git")?;
    if owner.is_empty() || score.is_empty() {
        return None;
    }

    let mut origin = url.clone();
    origin.set_path("");
    origin.set_query(None);
    origin.set_fragment(None);
    let _ = origin.set_username("");
    let _ = origin.set_password(None);
    Some(HubScore {
        origin,
        score: score.to_owned(),
    })
}

/// Whether `remote_url` is `score` on the hub at `hub`. Compared by origin, so
/// a link naming the right score on another host matches nothing.
pub fn is_score_remote(remote_url: &str, hub: &str, score: &str) -> bool {
    let (Some(remote), Ok(hub)) = (hub_score(remote_url), Url::parse(hub)) else {
        return false;
    };
    remote.score == score && remote.origin.origin() == hub.origin()
}

/// The account and token a score's git remote already authenticates with.
pub struct ScoreAuth {
    pub username: String,
    pub token: String,
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

    /// Lands `branch` on main. Whatever the merge says is an answer, not an
    /// error — including losing a race to someone else's landing.
    pub async fn land(&self, score: &str, branch: &str, auth: &ScoreAuth) -> Result<LandOutcome> {
        let request = self.branch_request(
            reqwest::Method::POST,
            score,
            branch,
            "land",
            auth,
            serde_json::json!({}),
        )?;
        let response = self
            .client
            .execute(request)
            .await
            .map_err(unreachable_hub)?;

        match read(response).await {
            Err(Error::Hub(code, _)) if code == "main_moved" => Ok(LandOutcome::MainMoved),
            other => other,
        }
    }

    /// Returns what the hub now holds, which is what the toggle shows.
    pub async fn set_ask_first(
        &self,
        score: &str,
        branch: &str,
        ask_first: bool,
        auth: &ScoreAuth,
    ) -> Result<bool> {
        let request = self.branch_request(
            reqwest::Method::PUT,
            score,
            branch,
            "ask-first",
            auth,
            serde_json::json!({ "askFirst": ask_first }),
        )?;
        let response = self
            .client
            .execute(request)
            .await
            .map_err(unreachable_hub)?;

        Ok(read::<AskFirst>(response).await?.ask_first)
    }

    /// Whether `branch` asks the band first. A branch the hub has not seen
    /// yet does not.
    pub async fn ask_first(&self, score: &str, branch: &str, auth: &ScoreAuth) -> Result<bool> {
        let mut url = self.origin.clone();
        url.path_segments_mut()
            .map_err(|_| Error::InvalidHub(self.origin.to_string()))?
            .clear()
            .extend(["scores", score, "branches"]);

        let response = self
            .client
            .get(url)
            .basic_auth(&auth.username, Some(&auth.token))
            .send()
            .await
            .map_err(unreachable_hub)?;

        Ok(read::<Branches>(response)
            .await?
            .branches
            .into_iter()
            .any(|listed| listed.name == branch && listed.ask_first))
    }

    /// `/scores/<score>/branches/<branch>/<action>`, each pushed as one
    /// segment so a `/` in a branch name is escaped rather than followed.
    fn branch_request(
        &self,
        method: reqwest::Method,
        score: &str,
        branch: &str,
        action: &str,
        auth: &ScoreAuth,
        body: serde_json::Value,
    ) -> Result<reqwest::Request> {
        let mut url = self.origin.clone();
        url.path_segments_mut()
            .map_err(|_| Error::InvalidHub(self.origin.to_string()))?
            .clear()
            .extend(["scores", score, "branches", branch, action]);

        self.client
            .request(method, url)
            .basic_auth(&auth.username, Some(&auth.token))
            .json(&body)
            .build()
            .map_err(unreachable_hub)
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
    fn a_land_request_names_the_branch_in_one_segment_and_carries_the_git_credential() {
        let hub = Hub::new("https://hub.example.com/ignored/path").unwrap();
        let auth = ScoreAuth {
            username: "acct_1".to_owned(),
            token: "secret".to_owned(),
        };

        let request = hub
            .branch_request(
                reqwest::Method::POST,
                "k7m2x",
                "ideas/new chorus",
                "land",
                &auth,
                serde_json::json!({}),
            )
            .unwrap();

        assert_eq!(request.method(), reqwest::Method::POST);
        assert_eq!(
            request.url().as_str(),
            "https://hub.example.com/scores/k7m2x/branches/ideas%2Fnew%20chorus/land"
        );
        // base64("acct_1:secret")
        assert_eq!(
            request.headers()[reqwest::header::AUTHORIZATION],
            "Basic YWNjdF8xOnNlY3JldA=="
        );
        assert_eq!(request.body().unwrap().as_bytes().unwrap(), b"{}");
    }

    #[test]
    fn every_outcome_the_hub_can_send_reads_back() {
        let read = |json: &str| serde_json::from_str::<LandOutcome>(json).unwrap();

        assert_eq!(
            read(r#"{"status":"landed","commit":"abc","dryRun":false}"#),
            LandOutcome::Landed {
                commit: "abc".to_owned()
            }
        );
        assert_eq!(
            read(r#"{"status":"clean","dryRun":true}"#),
            LandOutcome::Clean
        );
        assert_eq!(read(r#"{"status":"waiting"}"#), LandOutcome::Waiting);
        assert_eq!(read(r#"{"status":"unreadable"}"#), LandOutcome::Unreadable);
        assert_eq!(read(r#"{"status":"up_to_date"}"#), LandOutcome::UpToDate);
        assert_eq!(
            read(
                r#"{"status":"conflicts","cleanBars":6,"conflicts":[{"bar":19,"track":"Guitar 1","description":"both changed"},{"bar":null,"track":null,"description":"tempo"}]}"#
            ),
            LandOutcome::Conflicts {
                clean_bars: 6,
                conflicts: vec![
                    Conflict {
                        bar: Some(19),
                        track: Some("Guitar 1".to_owned()),
                        description: "both changed".to_owned(),
                    },
                    Conflict {
                        bar: None,
                        track: None,
                        description: "tempo".to_owned(),
                    },
                ],
            }
        );
    }

    #[test]
    fn a_hub_remote_names_its_score_and_origin() {
        let parsed = hub_score("https://ben@hub.example.com:8443/git/acct_1/k7m2x.git").unwrap();

        assert_eq!(parsed.score, "k7m2x");
        assert_eq!(parsed.origin.as_str(), "https://hub.example.com:8443/");
    }

    #[test]
    fn a_remote_that_is_not_a_hub_has_no_score() {
        for url in [
            "https://github.com/ben/blackbird.git",
            "https://hub.example.com/git/acct_1/k7m2x",
            "https://hub.example.com/elsewhere/git/acct_1/k7m2x.git",
            "https://hub.example.com/git//k7m2x.git",
            "https://hub.example.com/git/acct_1/.git",
            "/Users/ben/remote",
        ] {
            assert_eq!(hub_score(url), None, "{url}");
        }
    }

    #[test]
    fn a_link_matches_its_score_on_the_same_origin_only() {
        let remote = "https://hub.example.com/git/acct_1/k7m2x.git";

        assert!(is_score_remote(remote, "https://hub.example.com", "k7m2x"));
        assert!(is_score_remote(remote, "https://hub.example.com/", "k7m2x"));
        assert!(!is_score_remote(remote, "https://hub.example.com", "other"));
        assert!(!is_score_remote(remote, "http://hub.example.com", "k7m2x"));
        assert!(!is_score_remote(
            remote,
            "https://hub.example.com:8443",
            "k7m2x"
        ));
        assert!(!is_score_remote(remote, "https://evil.example", "k7m2x"));
        assert!(!is_score_remote(remote, "not a url", "k7m2x"));
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
