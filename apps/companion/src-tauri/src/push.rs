//! The background push queue.
//!
//! A named version is committed locally and the panel dismisses itself; the
//! network happens afterwards, on this thread, where it cannot make the user
//! wait and cannot fail the commit. That is the whole point of the queue —
//! decision 7 of the plan: *a local commit must never fail or block because of
//! the network*.
//!
//! Work is held as a map keyed by file rather than a channel of events, which
//! is what the watcher does and for the same reason: three commits made while
//! offline are one push once the laptop reconnects, not three.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::config::{now_seconds, RemoteAuth};
use crate::error::{Error, Result};
use crate::events;
use crate::remote;
use crate::secrets;
use crate::state::AppState;

const TICK: Duration = Duration::from_millis(500);
/// First retry delay. Doubles per consecutive failure, up to [`BACKOFF_CAP`].
const BACKOFF_BASE: Duration = Duration::from_secs(5);
/// A laptop can be shut for hours; there is no point checking more often than
/// this, and no point ever giving up while the failure is only the network.
const BACKOFF_CAP: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PushState {
    /// No remote set. Nothing is wrong; there is simply nowhere to push.
    Unconfigured,
    /// Everything committed locally is on the remote.
    Idle,
    /// Queued, or being attempted right now.
    Pending,
    /// Stopped trying. Only ever a failure the user has to resolve.
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushStatus {
    pub state: PushState,
    /// Unix seconds.
    pub last_pushed_at: Option<i64>,
    pub error: Option<String>,
}

impl PushStatus {
    pub fn idle() -> Self {
        Self {
            state: PushState::Idle,
            last_pushed_at: None,
            error: None,
        }
    }

    pub fn unconfigured() -> Self {
        Self {
            state: PushState::Unconfigured,
            last_pushed_at: None,
            error: None,
        }
    }
}

/// A file waiting its turn.
struct Attempt {
    /// Not before this instant — the backoff, expressed as a deadline.
    due: Instant,
    /// Consecutive failures, which is what the backoff is a function of.
    failures: u32,
}

#[derive(Default)]
pub struct Queue {
    waiting: Mutex<HashMap<String, Attempt>>,
    statuses: Mutex<HashMap<String, PushStatus>>,
}

impl Queue {
    pub fn new() -> Self {
        Self::default()
    }

    /// Never fails and never blocks: the commit that calls this has already
    /// succeeded, and nothing about the network may retroactively spoil it.
    pub fn enqueue(&self, id: &str) {
        self.enqueue_at(id, Instant::now());
    }

    fn enqueue_at(&self, id: &str, now: Instant) {
        // A fresh commit resets the backoff — the situation has changed, so
        // the evidence that the last attempt failed is stale.
        lock(&self.waiting).insert(
            id.to_owned(),
            Attempt {
                due: now,
                failures: 0,
            },
        );
        self.set_status(
            id,
            PushStatus {
                state: PushState::Pending,
                last_pushed_at: self.status(id).and_then(|status| status.last_pushed_at),
                error: None,
            },
        );
    }

    fn take_due(&self) -> Vec<String> {
        self.take_due_at(Instant::now())
    }

    /// Removes what it returns: an attempt is re-queued by its own outcome,
    /// so a file cannot be picked up twice for one commit.
    fn take_due_at(&self, now: Instant) -> Vec<String> {
        let mut waiting = lock(&self.waiting);
        let due: Vec<String> = waiting
            .iter()
            .filter(|(_, attempt)| attempt.due <= now)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &due {
            waiting.remove(id);
        }
        due
    }

    fn succeeded(&self, id: &str) {
        self.set_status(
            id,
            PushStatus {
                state: PushState::Idle,
                last_pushed_at: Some(now_seconds()),
                error: None,
            },
        );
    }

    fn failed(&self, id: &str, error: &Error, failures: u32) {
        self.failed_at(id, error, failures, Instant::now());
    }

    /// Transient failures go back in the queue; terminal ones stop.
    ///
    /// Retrying a push the remote *refused* would refuse identically forever,
    /// and retrying a rejected token only burns attempts against the server.
    /// Both need a person, so both stop and say so.
    fn failed_at(&self, id: &str, error: &Error, failures: u32, now: Instant) {
        let state = if is_terminal(error) {
            PushState::Failed
        } else {
            lock(&self.waiting).insert(
                id.to_owned(),
                Attempt {
                    due: now + backoff(failures),
                    failures,
                },
            );
            PushState::Pending
        };

        self.set_status(
            id,
            PushStatus {
                state,
                last_pushed_at: self.status(id).and_then(|status| status.last_pushed_at),
                error: Some(error.to_string()),
            },
        );
    }

    /// `None` for a file that has never been pushed this run — the caller
    /// decides whether that reads as unconfigured or merely idle.
    pub fn status(&self, id: &str) -> Option<PushStatus> {
        lock(&self.statuses).get(id).cloned()
    }

    /// Dropped along with the remote it described.
    pub fn forget(&self, id: &str) {
        lock(&self.waiting).remove(id);
        lock(&self.statuses).remove(id);
    }

    fn set_status(&self, id: &str, status: PushStatus) {
        lock(&self.statuses).insert(id.to_owned(), status);
    }

    fn failures_of(&self, id: &str) -> u32 {
        lock(&self.waiting)
            .get(id)
            .map(|attempt| attempt.failures)
            .unwrap_or(0)
    }
}

/// Doubling, capped. `failures` is the count *including* the one just seen, so
/// the first retry waits [`BACKOFF_BASE`].
fn backoff(failures: u32) -> Duration {
    BACKOFF_BASE
        .saturating_mul(2u32.saturating_pow(failures.saturating_sub(1).min(16)))
        .min(BACKOFF_CAP)
}

/// Whether waiting and trying again could plausibly change the answer.
fn is_terminal(error: &Error) -> bool {
    match error {
        // The remote has versions we don't. Time alone will not fix that.
        Error::PushRejected { .. } => true,
        // A token that is wrong now will be wrong in five minutes, and
        // hammering a server with it invites a rate limit.
        Error::Git(err) => err.code() == git2::ErrorCode::Auth,
        Error::Keychain(_) => true,
        _ => false,
    }
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(TICK);
        for id in app.state::<AppState>().pushes.take_due() {
            attempt(&app, &id);
        }
    });
}

fn attempt(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    let failures = state.pushes.failures_of(id) + 1;

    match deliver(&state, id) {
        Ok(()) => state.pushes.succeeded(id),
        Err(err) => state.pushes.failed(id, &err, failures),
    }

    if let Some(status) = state.pushes.status(id) {
        events::push_status_changed(app, id, status);
    }
}

/// One attempt at getting this score's named versions onto its remote.
///
/// A file with no remote is a no-op rather than an error: remotes can be
/// cleared while something is still queued behind them.
pub fn deliver(state: &AppState, id: &str) -> Result<()> {
    let file = state.tracked(id)?;
    let Some(remote_descriptor) = file.remote else {
        return Ok(());
    };

    let token = match remote_descriptor.auth {
        RemoteAuth::Token { .. } => secrets::read(id)?,
        _ => None,
    };

    let repo = state.open_repo(id)?;
    remote::push(&repo, &remote_descriptor, token.as_deref())
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Remote, TrackedFile};
    use crate::git;
    use std::path::{Path, PathBuf};

    fn transient() -> Error {
        Error::Git(git2::Error::from_str("could not resolve host"))
    }

    fn terminal() -> Error {
        Error::PushRejected {
            refname: git::NAMED_REF.to_owned(),
            reason: "the remote holds versions this score does not".to_owned(),
        }
    }

    #[test]
    fn a_commit_queues_its_file_for_the_next_tick() {
        let queue = Queue::new();

        queue.enqueue("score");

        assert_eq!(queue.status("score").unwrap().state, PushState::Pending);
        assert_eq!(queue.take_due(), ["score"]);
        // Taken means claimed: the tick after this must not push it again.
        assert!(queue.take_due().is_empty());
    }

    #[test]
    fn commits_made_while_offline_coalesce_into_one_push() {
        let queue = Queue::new();

        queue.enqueue("score");
        queue.enqueue("score");
        queue.enqueue("score");

        assert_eq!(queue.take_due(), ["score"]);
    }

    #[test]
    fn a_transient_failure_waits_before_trying_again() {
        let queue = Queue::new();
        let now = Instant::now();

        queue.enqueue_at("score", now);
        queue.take_due_at(now);
        queue.failed_at("score", &transient(), 1, now);

        // Still on the books, but not yet.
        assert_eq!(queue.status("score").unwrap().state, PushState::Pending);
        assert!(queue.take_due_at(now).is_empty());
        assert_eq!(queue.take_due_at(now + BACKOFF_BASE), ["score"]);
    }

    #[test]
    fn each_consecutive_failure_waits_longer_up_to_the_cap() {
        assert_eq!(backoff(1), BACKOFF_BASE);
        assert_eq!(backoff(2), BACKOFF_BASE * 2);
        assert_eq!(backoff(3), BACKOFF_BASE * 4);
        assert_eq!(backoff(999), BACKOFF_CAP);
    }

    #[test]
    fn a_refused_push_stops_instead_of_retrying_forever() {
        let queue = Queue::new();
        let now = Instant::now();

        queue.enqueue_at("score", now);
        queue.take_due_at(now);
        queue.failed_at("score", &terminal(), 1, now);

        let status = queue.status("score").unwrap();
        assert_eq!(status.state, PushState::Failed);
        assert!(status.error.is_some());
        // No amount of waiting brings it back.
        assert!(queue.take_due_at(now + BACKOFF_CAP * 10).is_empty());
    }

    #[test]
    fn a_new_commit_revives_a_file_that_had_given_up() {
        let queue = Queue::new();
        let now = Instant::now();

        queue.enqueue_at("score", now);
        queue.take_due_at(now);
        queue.failed_at("score", &terminal(), 1, now);

        // Whatever the user did about it, there is something new to send.
        queue.enqueue_at("score", now);

        assert_eq!(queue.status("score").unwrap().state, PushState::Pending);
        assert_eq!(queue.take_due_at(now), ["score"]);
    }

    #[test]
    fn a_success_clears_the_error_and_records_when() {
        let queue = Queue::new();
        let now = Instant::now();

        queue.enqueue_at("score", now);
        queue.failed_at("score", &transient(), 1, now);
        queue.succeeded("score");

        let status = queue.status("score").unwrap();
        assert_eq!(status.state, PushState::Idle);
        assert!(status.error.is_none());
        assert!(status.last_pushed_at.is_some());
    }

    /// The queue's own end of the pipeline, with a bare repo standing in for
    /// the server — same code path the ticking thread runs.
    fn state_tracking(dir: &Path, score: &Path) -> (AppState, String) {
        std::fs::write(score, b"take one").unwrap();
        let state = AppState::load(dir.join("data")).unwrap();
        let file = TrackedFile::new(score.to_path_buf());
        let id = file.id.clone();
        state
            .update(|config| {
                config.tracked_files.push(file);
                Ok(())
            })
            .unwrap();
        (state, id)
    }

    fn point_at(state: &AppState, id: &str, url: PathBuf) {
        state
            .update(|config| {
                config.find_mut(id).unwrap().remote = Some(Remote {
                    url: url.to_string_lossy().into_owned(),
                    auth: RemoteAuth::None,
                });
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn delivering_puts_the_named_versions_on_the_remote() {
        let dir = tempfile::tempdir().unwrap();
        let (state, id) = state_tracking(dir.path(), &dir.path().join("riff.gp"));

        let remote_path = dir.path().join("remote");
        let remote_repo = git::open_or_init(&remote_path).unwrap();
        point_at(&state, &id, remote_path);

        git::commit_named(&state.open_repo(&id).unwrap(), b"riff", "Intro").unwrap();
        deliver(&state, &id).unwrap();

        assert_eq!(
            git::read_score(&remote_repo, git::NAMED_REF).unwrap(),
            b"riff"
        );
    }

    #[test]
    fn a_score_with_no_remote_is_delivered_nowhere_and_that_is_fine() {
        let dir = tempfile::tempdir().unwrap();
        let (state, id) = state_tracking(dir.path(), &dir.path().join("riff.gp"));

        git::commit_named(&state.open_repo(&id).unwrap(), b"riff", "Intro").unwrap();

        deliver(&state, &id).unwrap();
    }

    #[test]
    fn delivering_to_an_unreachable_remote_fails_without_giving_up() {
        let dir = tempfile::tempdir().unwrap();
        let (state, id) = state_tracking(dir.path(), &dir.path().join("riff.gp"));
        point_at(&state, &id, dir.path().join("not-a-repo"));

        git::commit_named(&state.open_repo(&id).unwrap(), b"riff", "Intro").unwrap();

        let err = deliver(&state, &id).unwrap_err();
        assert!(!is_terminal(&err), "{err}");
    }
}
