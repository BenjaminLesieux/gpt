//! Host error type. Serializes to its `Display` text for the webview's
//! rejected promise — these are dev-facing strings, the UI owns user copy.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("unknown tracked file: {0}")]
    UnknownFile(String),

    #[error("already tracked: {0}")]
    AlreadyTracked(String),

    #[error("not a file: {0}")]
    NotAFile(String),

    /// Adoption writes the score it fetched; whatever is already at that path
    /// is someone's work, and overwriting it is never the answer.
    #[error("a file already exists at {0}")]
    FileExists(String),

    #[error("unsupported extension (expected .gp/.gpx/.gp5/.gp4/.gp3): {0}")]
    UnsupportedExtension(String),

    #[error("no version matching {0}")]
    UnknownVersion(String),

    #[error("nothing to name in {0}: it is already the newest version")]
    NothingToName(String),

    #[error("the remote refused {refname}: {reason}")]
    PushRejected { refname: String, reason: String },

    /// The hub answered, and said no. `code` is what the UI branches on;
    /// `message` is what the hub already wrote for a musician to read.
    #[error("{1}")]
    Hub(String, String),

    #[error("could not reach the hub: {0}")]
    HubUnreachable(String),

    /// A token is a git password. Over plain http it would travel in the
    /// clear to an origin that arrived in a link nobody vouched for.
    #[error("{0} is not an https address, so a token sent there would travel in the clear")]
    InsecureHub(String),

    #[error("{0} is not an address")]
    InvalidHub(String),

    #[error("that link does not carry a usable claim")]
    InvalidClaim,

    #[error("background task failed: {0}")]
    BackgroundTask(String),

    #[error("no remote is set for {0}")]
    NoRemote(String),

    /// A reachable remote with nothing on `main`: an empty repo is a fine
    /// thing to push to and nothing to adopt from.
    #[error("the remote at {0} holds no version yet")]
    RemoteEmpty(String),

    /// v1 has no merge, so this is where the app stops and a person takes over.
    #[error("{0} changed here and on the remote ({1} version(s) here, {2} there)")]
    Diverged(String, usize, usize),

    #[error("that would discard versions this score already has")]
    NotFastForward,

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Git(#[from] git2::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Watch(#[from] notify::Error),

    #[error(transparent)]
    Keychain(#[from] keyring::Error),

    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
