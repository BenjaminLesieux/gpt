//! One bare repo per tracked file. Named versions live on `main`, silent
//! auto-snapshots on `refs/snapshots`; the two histories never meet.
//!
//! Git is storage only — nothing here understands a score. The tree always
//! holds a single blob under [`SCORE_ENTRY`], whatever the file is called on
//! disk, so renaming it doesn't churn the history.

use std::path::Path;

use git2::{Commit, Oid, Repository, Signature, Time};
use serde::Serialize;

use crate::config::{now_seconds, SnapshotPolicy};
use crate::error::{Error, Result};

pub const SCORE_ENTRY: &str = "score.gp";
pub const NAMED_REF: &str = "refs/heads/main";
pub const SNAPSHOT_REF: &str = "refs/snapshots";

const AUTHOR_NAME: &str = "Gitarpro";
const AUTHOR_EMAIL: &str = "companion@gitarpro.app";
const BLOB_MODE: i32 = 0o100644;
const SECONDS_PER_DAY: i64 = 86_400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionKind {
    Named,
    Snapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub id: String,
    pub message: String,
    /// Unix seconds.
    pub timestamp: i64,
    pub kind: VersionKind,
}

impl Version {
    fn from_commit(commit: &Commit, kind: VersionKind) -> Self {
        Self {
            id: commit.id().to_string(),
            message: commit.message().unwrap_or_default().to_owned(),
            timestamp: commit.time().seconds(),
            kind,
        }
    }
}

pub fn open_or_init(dir: &Path) -> Result<Repository> {
    if dir.join("HEAD").exists() {
        return Ok(Repository::open_bare(dir)?);
    }
    std::fs::create_dir_all(dir)?;
    let repo = Repository::init_bare(dir)?;
    repo.set_head(NAMED_REF)?;
    Ok(repo)
}

/// `None` when the bytes already match the tip of either ref — nothing
/// musically changed, so there is nothing to record.
pub fn commit_snapshot(repo: &Repository, bytes: &[u8]) -> Result<Option<Version>> {
    commit_snapshot_at(repo, bytes, now_seconds())
}

pub fn commit_named(repo: &Repository, bytes: &[u8], message: &str) -> Result<Version> {
    commit_named_at(repo, bytes, message, now_seconds())
}

fn commit_snapshot_at(repo: &Repository, bytes: &[u8], when: i64) -> Result<Option<Version>> {
    let blob = repo.blob(bytes)?;
    if score_of(repo, SNAPSHOT_REF)? == Some(blob) || score_of(repo, NAMED_REF)? == Some(blob) {
        return Ok(None);
    }
    let commit = write(repo, SNAPSHOT_REF, blob, "", when)?;
    Ok(Some(Version::from_commit(&commit, VersionKind::Snapshot)))
}

/// Whether these bytes are already the newest named version. Storage has no
/// opinion about that; the caller does (see `commands::commit_named`).
pub fn is_named_tip(repo: &Repository, bytes: &[u8]) -> Result<bool> {
    // Hashed, not written: a refused commit must not leave a loose object
    // behind, and scores run to hundreds of KB.
    let oid = Oid::hash_object(git2::ObjectType::Blob, bytes)?;
    Ok(score_of(repo, NAMED_REF)? == Some(oid))
}

/// Commits whatever it is handed, changed or not — the guard against naming a
/// version with nothing in it lives at the IPC surface.
fn commit_named_at(repo: &Repository, bytes: &[u8], message: &str, when: i64) -> Result<Version> {
    let blob = repo.blob(bytes)?;
    let commit = write(repo, NAMED_REF, blob, message, when)?;
    Ok(Version::from_commit(&commit, VersionKind::Named))
}

pub fn list(repo: &Repository, refname: &str, limit: Option<usize>) -> Result<Vec<Version>> {
    let kind = if refname == NAMED_REF {
        VersionKind::Named
    } else {
        VersionKind::Snapshot
    };

    let Some(tip) = tip(repo, refname)? else {
        return Ok(Vec::new());
    };

    let mut versions = Vec::new();
    let mut current = Some(tip);
    while let Some(commit) = current {
        versions.push(Version::from_commit(&commit, kind));
        if limit.is_some_and(|max| versions.len() >= max) {
            break;
        }
        current = commit.parent(0).ok();
    }
    Ok(versions)
}

pub fn read_score(repo: &Repository, rev: &str) -> Result<Vec<u8>> {
    let commit = repo
        .revparse_single(rev)
        .and_then(|object| object.peel_to_commit())
        .map_err(|_| Error::UnknownVersion(rev.to_owned()))?;

    let entry = commit
        .tree()?
        .get_name(SCORE_ENTRY)
        .ok_or_else(|| Error::UnknownVersion(rev.to_owned()))?
        .id();

    Ok(repo.find_blob(entry)?.content().to_vec())
}

/// Drops snapshots outside the policy. Kept snapshots are rewritten (dropping
/// the tail orphans everything above it), so their ids change — callers must
/// re-list rather than hold on to one across a prune.
pub fn prune_snapshots(repo: &Repository, policy: SnapshotPolicy) -> Result<usize> {
    prune_snapshots_at(repo, policy, now_seconds())
}

fn prune_snapshots_at(repo: &Repository, policy: SnapshotPolicy, now: i64) -> Result<usize> {
    let Some(tip) = tip(repo, SNAPSHOT_REF)? else {
        return Ok(0);
    };

    let mut chain = vec![tip];
    while let Ok(parent) = chain[chain.len() - 1].parent(0) {
        chain.push(parent);
    }

    let cutoff = now - policy.keep_days * SECONDS_PER_DAY;
    let keep = chain
        .iter()
        .take(policy.keep_count)
        .take_while(|commit| commit.time().seconds() >= cutoff)
        .count()
        .max(1);

    if keep >= chain.len() {
        return Ok(0);
    }

    let mut parent: Option<Commit> = None;
    for commit in chain[..keep].iter().rev() {
        let parents: Vec<&Commit> = parent.iter().collect();
        let oid = repo.commit(
            None,
            &commit.author(),
            &commit.committer(),
            commit.message().unwrap_or_default(),
            &commit.tree()?,
            &parents,
        )?;
        parent = Some(repo.find_commit(oid)?);
    }

    if let Some(new_tip) = parent {
        repo.reference(SNAPSHOT_REF, new_tip.id(), true, "prune snapshots")?;
    }
    Ok(chain.len() - keep)
}

fn write<'repo>(
    repo: &'repo Repository,
    refname: &str,
    blob: Oid,
    message: &str,
    when: i64,
) -> Result<Commit<'repo>> {
    let mut builder = repo.treebuilder(None)?;
    builder.insert(SCORE_ENTRY, blob, BLOB_MODE)?;
    let tree = repo.find_tree(builder.write()?)?;

    let signature = Signature::new(AUTHOR_NAME, AUTHOR_EMAIL, &Time::new(when, 0))?;
    let parent = tip(repo, refname)?;
    let parents: Vec<&Commit> = parent.iter().collect();

    let oid = repo.commit(
        Some(refname),
        &signature,
        &signature,
        message,
        &tree,
        &parents,
    )?;
    Ok(repo.find_commit(oid)?)
}

fn tip<'repo>(repo: &'repo Repository, refname: &str) -> Result<Option<Commit<'repo>>> {
    match repo.find_reference(refname) {
        Ok(reference) => Ok(Some(reference.peel_to_commit()?)),
        // Unborn ref: nothing committed on this side yet.
        Err(err) if err.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn score_of(repo: &Repository, refname: &str) -> Result<Option<Oid>> {
    let Some(commit) = tip(repo, refname)? else {
        return Ok(None);
    };
    Ok(commit.tree()?.get_name(SCORE_ENTRY).map(|entry| entry.id()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> (tempfile::TempDir, Repository) {
        let dir = tempfile::tempdir().unwrap();
        let repo = open_or_init(&dir.path().join("repo")).unwrap();
        (dir, repo)
    }

    #[test]
    fn a_fresh_repo_has_no_history() {
        let (_dir, repo) = repo();
        assert!(list(&repo, NAMED_REF, None).unwrap().is_empty());
        assert!(list(&repo, SNAPSHOT_REF, None).unwrap().is_empty());
    }

    #[test]
    fn snapshots_and_named_versions_are_separate_histories() {
        let (_dir, repo) = repo();

        commit_snapshot(&repo, b"take one").unwrap().unwrap();
        commit_named(&repo, b"take two", "Intro reworked").unwrap();

        let named = list(&repo, NAMED_REF, None).unwrap();
        let snapshots = list(&repo, SNAPSHOT_REF, None).unwrap();

        assert_eq!(named.len(), 1);
        assert_eq!(named[0].message, "Intro reworked");
        assert_eq!(named[0].kind, VersionKind::Named);
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].kind, VersionKind::Snapshot);
    }

    #[test]
    fn an_unchanged_save_makes_no_snapshot() {
        let (_dir, repo) = repo();

        assert!(commit_snapshot(&repo, b"riff").unwrap().is_some());
        assert!(commit_snapshot(&repo, b"riff").unwrap().is_none());
        assert!(commit_snapshot(&repo, b"riff II").unwrap().is_some());

        assert_eq!(list(&repo, SNAPSHOT_REF, None).unwrap().len(), 2);
    }

    #[test]
    fn a_save_matching_the_named_tip_makes_no_snapshot() {
        let (_dir, repo) = repo();

        commit_named(&repo, b"riff", "Named").unwrap();

        assert!(commit_snapshot(&repo, b"riff").unwrap().is_none());
    }

    #[test]
    fn a_named_version_is_recorded_even_without_changes() {
        let (_dir, repo) = repo();

        commit_named(&repo, b"riff", "First").unwrap();
        commit_named(&repo, b"riff", "Same bytes, still a milestone").unwrap();

        assert_eq!(list(&repo, NAMED_REF, None).unwrap().len(), 2);
    }

    #[test]
    fn only_the_newest_named_version_reads_as_the_named_tip() {
        let (_dir, repo) = repo();

        assert!(!is_named_tip(&repo, b"riff").unwrap());

        commit_named(&repo, b"riff", "First").unwrap();
        assert!(is_named_tip(&repo, b"riff").unwrap());
        assert!(!is_named_tip(&repo, b"riff II").unwrap());

        // A snapshot on top leaves the named tip where it was.
        commit_snapshot(&repo, b"riff II").unwrap();
        assert!(is_named_tip(&repo, b"riff").unwrap());
    }

    #[test]
    fn hashing_a_score_that_is_never_committed_writes_nothing() {
        let (_dir, repo) = repo();

        is_named_tip(&repo, b"never committed").unwrap();

        let oid = Oid::hash_object(git2::ObjectType::Blob, b"never committed").unwrap();
        assert!(repo.find_blob(oid).is_err());
    }

    #[test]
    fn versions_come_back_newest_first_and_honour_the_limit() {
        let (_dir, repo) = repo();

        for take in 1..=3 {
            commit_named(
                &repo,
                format!("take {take}").as_bytes(),
                &format!("Take {take}"),
            )
            .unwrap();
        }

        let all = list(&repo, NAMED_REF, None).unwrap();
        assert_eq!(
            all.iter().map(|v| v.message.as_str()).collect::<Vec<_>>(),
            ["Take 3", "Take 2", "Take 1"]
        );
        assert_eq!(list(&repo, NAMED_REF, Some(2)).unwrap().len(), 2);
    }

    #[test]
    fn a_version_reads_back_byte_for_byte() {
        let (_dir, repo) = repo();

        let version = commit_named(&repo, b"riff bytes", "First").unwrap();
        commit_named(&repo, b"other bytes", "Second").unwrap();

        assert_eq!(read_score(&repo, &version.id).unwrap(), b"riff bytes");
        assert_eq!(read_score(&repo, NAMED_REF).unwrap(), b"other bytes");
        assert!(matches!(
            read_score(&repo, "deadbeef"),
            Err(Error::UnknownVersion(_))
        ));
    }

    #[test]
    fn pruning_caps_the_snapshot_count() {
        let (_dir, repo) = repo();
        let now = 100 * SECONDS_PER_DAY;
        let policy = SnapshotPolicy {
            keep_days: 365,
            keep_count: 3,
        };

        for take in 0..6 {
            let minutes_ago = 6 - take;
            commit_snapshot_at(
                &repo,
                format!("take {take}").as_bytes(),
                now - minutes_ago * 60,
            )
            .unwrap();
        }

        assert_eq!(prune_snapshots_at(&repo, policy, now).unwrap(), 3);

        let kept = list(&repo, SNAPSHOT_REF, None).unwrap();
        assert_eq!(kept.len(), 3);
        assert_eq!(read_score(&repo, &kept[0].id).unwrap(), b"take 5");
        assert_eq!(read_score(&repo, &kept[2].id).unwrap(), b"take 3");
    }

    #[test]
    fn pruning_drops_snapshots_past_the_age_limit() {
        let (_dir, repo) = repo();
        let now = 100 * SECONDS_PER_DAY;
        let policy = SnapshotPolicy {
            keep_days: 14,
            keep_count: 500,
        };

        for day in [60, 80, 95, 99] {
            commit_snapshot_at(
                &repo,
                format!("day {day}").as_bytes(),
                day * SECONDS_PER_DAY,
            )
            .unwrap();
        }

        assert_eq!(prune_snapshots_at(&repo, policy, now).unwrap(), 2);

        let kept = list(&repo, SNAPSHOT_REF, None).unwrap();
        assert_eq!(kept.len(), 2);
        assert_eq!(read_score(&repo, &kept[0].id).unwrap(), b"day 99");
        assert_eq!(kept[0].timestamp, 99 * SECONDS_PER_DAY);
    }

    #[test]
    fn pruning_always_keeps_the_newest_snapshot() {
        let (_dir, repo) = repo();
        let policy = SnapshotPolicy {
            keep_days: 1,
            keep_count: 100,
        };

        commit_snapshot_at(&repo, b"ancient", 0).unwrap();

        assert_eq!(
            prune_snapshots_at(&repo, policy, 10 * SECONDS_PER_DAY).unwrap(),
            0
        );
        assert_eq!(list(&repo, SNAPSHOT_REF, None).unwrap().len(), 1);
    }

    #[test]
    fn pruning_a_repo_within_policy_rewrites_nothing() {
        let (_dir, repo) = repo();
        let policy = SnapshotPolicy::default();

        commit_snapshot(&repo, b"one").unwrap();
        let before = list(&repo, SNAPSHOT_REF, None).unwrap();

        assert_eq!(prune_snapshots(&repo, policy).unwrap(), 0);
        assert_eq!(list(&repo, SNAPSHOT_REF, None).unwrap()[0].id, before[0].id);
    }

    #[test]
    fn a_repo_reopens_with_its_history() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("repo");

        let first = open_or_init(&path).unwrap();
        commit_named(&first, b"riff", "First").unwrap();
        drop(first);

        let reopened = open_or_init(&path).unwrap();
        assert_eq!(list(&reopened, NAMED_REF, None).unwrap().len(), 1);
    }
}
