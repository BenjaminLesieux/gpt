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

    #[error("unsupported extension (expected .gp/.gpx/.gp5/.gp4/.gp3): {0}")]
    UnsupportedExtension(String),

    #[error("no version matching {0}")]
    UnknownVersion(String),

    #[error("nothing to name in {0}: it is already the newest version")]
    NothingToName(String),

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
