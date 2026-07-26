//! `config.json` — tracked files and their preferences. Each entry owns a bare
//! repo under `repos/<id>/`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;

pub const CONFIG_FILE: &str = "config.json";
pub const REPOS_DIR: &str = "repos";

/// Bumped when the on-disk shape needs migrating.
const CONFIG_VERSION: u32 = 1;

pub const GP_EXTENSIONS: [&str; 5] = ["gp", "gpx", "gp5", "gp4", "gp3"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default = "config_version")]
    pub version: u32,
    #[serde(default)]
    pub tracked_files: Vec<TrackedFile>,
    #[serde(default)]
    pub snapshot_policy: SnapshotPolicy,
}

fn config_version() -> u32 {
    CONFIG_VERSION
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            tracked_files: Vec::new(),
            snapshot_policy: SnapshotPolicy::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackedFile {
    /// Derived from the absolute path, but stored, so moving a file keeps its
    /// repo while re-tracking a removed one finds its history again.
    pub id: String,
    pub path: PathBuf,
    pub name: String,
    /// Unix seconds.
    pub added_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote: Option<Remote>,
}

/// Secrets are deliberately absent — `config.json` is plain text. M5 puts them
/// in the system keychain, keyed by this descriptor.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub url: String,
    #[serde(default)]
    pub auth: RemoteAuth,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RemoteAuth {
    #[default]
    None,
    Token {
        username: String,
    },
    Ssh {
        key_path: PathBuf,
    },
}

/// A snapshot survives when it is both among the newest `keep_count` and
/// younger than `keep_days`; the newest is always kept.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPolicy {
    pub keep_days: i64,
    pub keep_count: usize,
}

impl Default for SnapshotPolicy {
    fn default() -> Self {
        Self {
            keep_days: 14,
            keep_count: 200,
        }
    }
}

impl Config {
    pub fn load(path: &Path) -> Result<Self> {
        match std::fs::read(path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(err) => Err(err.into()),
        }
    }

    /// Temp file + rename: a truncated config would read as "nothing tracked".
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    pub fn find(&self, id: &str) -> Option<&TrackedFile> {
        self.tracked_files.iter().find(|file| file.id == id)
    }

    pub fn find_mut(&mut self, id: &str) -> Option<&mut TrackedFile> {
        self.tracked_files.iter_mut().find(|file| file.id == id)
    }

    pub fn find_by_path(&self, path: &Path) -> Option<&TrackedFile> {
        self.tracked_files.iter().find(|file| file.path == path)
    }
}

impl TrackedFile {
    pub fn new(path: PathBuf) -> Self {
        let path = canonical(&path);
        Self {
            id: file_id(&path),
            name: display_name(&path),
            path,
            added_at: now_seconds(),
            remote: None,
        }
    }
}

/// Stored and event paths must agree, and macOS hands out both `/var/…` and
/// `/private/var/…` for the same file.
pub fn canonical(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

/// First 12 hex digits of the path's SHA-1 (git2's hasher, no extra dep).
pub fn file_id(path: &Path) -> String {
    let oid = git2::Oid::hash_object(git2::ObjectType::Blob, path.as_os_str().as_encoded_bytes())
        .expect("hashing a byte slice cannot fail");
    oid.to_string()[..12].to_string()
}

fn display_name(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

pub fn is_guitar_pro_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| GP_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_stable_per_path_and_distinct_across_paths() {
        let a = file_id(Path::new("/Users/x/Songs/riff.gp"));
        let b = file_id(Path::new("/Users/x/Songs/riff.gp"));
        let c = file_id(Path::new("/Users/x/Songs/other.gp"));

        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 12);
    }

    #[test]
    fn only_guitar_pro_extensions_are_trackable() {
        assert!(is_guitar_pro_file(Path::new("/songs/riff.gp")));
        assert!(is_guitar_pro_file(Path::new("/songs/riff.GP5")));
        assert!(!is_guitar_pro_file(Path::new("/songs/riff.mp3")));
        assert!(!is_guitar_pro_file(Path::new("/songs/riff")));
    }

    #[test]
    fn tracked_file_takes_its_name_from_the_stem() {
        let file = TrackedFile::new(PathBuf::from("/songs/Blackbird v2.gp"));
        assert_eq!(file.name, "Blackbird v2");
    }

    #[test]
    fn missing_config_reads_as_empty_and_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(CONFIG_FILE);

        let mut config = Config::load(&path).unwrap();
        assert!(config.tracked_files.is_empty());

        config
            .tracked_files
            .push(TrackedFile::new(PathBuf::from("/songs/riff.gp")));
        config.save(&path).unwrap();

        let reloaded = Config::load(&path).unwrap();
        assert_eq!(reloaded.tracked_files.len(), 1);
        assert_eq!(reloaded.tracked_files[0].name, "riff");
        assert_eq!(reloaded.snapshot_policy.keep_count, 200);
    }
}
