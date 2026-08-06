//! Remote tokens, kept in the system keychain.
//!
//! `config.json` is plain text and stores a *descriptor* only — which kind of
//! auth a remote uses, and under whose name. The secret itself never leaves
//! this module: it goes in under the tracked file's id and comes back out only
//! when [`crate::remote`] is about to hand it to libgit2.
//!
//! Keying by file id means two scores on the same server hold two copies of
//! the same token. That is the price of a secret whose lifetime matches
//! exactly one config entry — clearing a remote can delete its token without
//! wondering who else was using it.

use crate::error::Result;

/// Matches the bundle identifier, so the entries are attributable in
/// Keychain Access rather than showing up as an anonymous service.
const SERVICE: &str = "com.gitarpro.companion";

pub fn store(file_id: &str, token: &str) -> Result<()> {
    entry(file_id)?.set_password(token)?;
    Ok(())
}

/// `None` when no token was ever stored for this file — the ordinary state of
/// a score with no remote, not a failure.
pub fn read(file_id: &str) -> Result<Option<String>> {
    match entry(file_id)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

/// Idempotent: clearing a remote that never had a token is not an error.
pub fn clear(file_id: &str) -> Result<()> {
    match entry(file_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

fn entry(file_id: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, file_id)?)
}

/// Two suites, and they must not share a process.
///
/// What is ours to test is the mapping of "no such entry" onto an ordinary
/// empty answer, and keyring's mock store covers that. It cannot cover a round
/// trip: the mock keeps its data in the entry handle, so a token stored
/// through one [`entry`] call is invisible to the next. That the keychain
/// remembers things is the keychain's business — so the round trip runs
/// `#[ignore]`d against the real store, where it is worth something.
///
/// `--include-ignored` would run both, install the mock, and make the real
/// suite silently test the mock instead. Use `--ignored` on its own.
#[cfg(test)]
mod tests {
    use super::*;

    /// Process-wide and settable once, hence the [`Once`](std::sync::Once).
    fn use_mock_keychain() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        });
    }

    #[test]
    fn a_file_with_no_token_reads_as_none() {
        use_mock_keychain();

        assert!(read("never-stored").unwrap().is_none());
    }

    #[test]
    fn clearing_a_file_that_has_no_token_is_not_an_error() {
        use_mock_keychain();

        clear("never-stored").unwrap();
    }

    /// `cargo test -- --ignored` — writes to the login keychain, so it names
    /// itself and cleans up after itself.
    #[test]
    #[ignore = "touches the real keychain"]
    fn a_stored_token_reads_back_and_clears_per_file() {
        let a = format!("test-score-a-{}", std::process::id());
        let b = format!("test-score-b-{}", std::process::id());

        store(&a, "token-a").unwrap();
        store(&b, "token-b").unwrap();
        assert_eq!(read(&a).unwrap().as_deref(), Some("token-a"));

        clear(&a).unwrap();
        assert!(read(&a).unwrap().is_none());
        assert_eq!(read(&b).unwrap().as_deref(), Some("token-b"));

        clear(&b).unwrap();
    }
}
