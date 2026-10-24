//! Request activity for background jobs.
//!
//! Neon suspends an idle compute after five minutes and meters every minute it
//! stays awake (the free plan stops the database for the rest of the month once
//! the allowance is used). A job that queries on a short fixed timer keeps the
//! compute running around the clock even when nobody has the app open, so the
//! background jobs check `recently_active` first and the push worker sleeps
//! until `wake_push` instead of polling the outbox.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::Notify;

/// How long after the last API request the app still counts as in use.
pub const ACTIVE_WINDOW: Duration = Duration::from_secs(10 * 60);

static LAST_REQUEST: AtomicU64 = AtomicU64::new(0);

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

fn push_signal() -> &'static Notify {
    static SIGNAL: OnceLock<Notify> = OnceLock::new();
    SIGNAL.get_or_init(Notify::new)
}

/// Records an API request. Health probes are not activity.
pub fn touch() {
    LAST_REQUEST.store(unix_seconds(), Ordering::Relaxed);
}

/// True when an API request arrived within `window`.
pub fn recently_active(window: Duration) -> bool {
    let last = LAST_REQUEST.load(Ordering::Relaxed);
    last != 0 && unix_seconds().saturating_sub(last) <= window.as_secs()
}

/// Asks the push worker to look for queued notifications now.
pub fn wake_push() {
    push_signal().notify_one();
}

/// Resolves after the next `wake_push`, or at once if one is already pending.
pub async fn push_woken() {
    push_signal().notified().await;
}

/// True for requests that can queue an account email (verification, reset,
/// email change, deletion code) for the separate mail worker.
pub fn may_queue_mail(path: &str) -> bool {
    path.starts_with("/v1/auth/")
        || matches!(
            path,
            "/v1/rpc/sendBrandedEmailVerification"
                | "/v1/rpc/sendBrandedPasswordReset"
                | "/v1/rpc/sendCampusEmailChange"
                | "/v1/rpc/sendAccountDeletionOtp"
                | "/v1/rpc/adminConsole"
        )
}

/// Tells the mail worker (another Fly app, reached over the private network
/// at `MAIL_WORKER_WAKE_URL`) to send queued account email now, so it can
/// sleep instead of polling the database. Best effort: the worker also
/// rechecks on its own.
pub fn wake_mail() {
    static URL: OnceLock<Option<String>> = OnceLock::new();
    let Some(url) = URL
        .get_or_init(|| {
            std::env::var("MAIL_WORKER_WAKE_URL")
                .ok()
                .filter(|url| url.starts_with("http://") || url.starts_with("https://"))
        })
        .clone()
    else {
        return;
    };
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let client = CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(Duration::from_secs(3))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap_or_default()
        })
        .clone();
    tokio::spawn(async move {
        let _ = client.get(url).send().await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_window_follows_the_last_request() {
        touch();
        assert!(recently_active(ACTIVE_WINDOW));
        LAST_REQUEST.store(unix_seconds() - 3600, Ordering::Relaxed);
        assert!(!recently_active(ACTIVE_WINDOW));
        assert!(recently_active(Duration::from_secs(2 * 3600)));
    }

    #[tokio::test]
    async fn a_wake_before_the_wait_is_not_lost() {
        wake_push();
        tokio::time::timeout(Duration::from_secs(1), push_woken())
            .await
            .expect("pending wake resolves immediately");
    }
}
