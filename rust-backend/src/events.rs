//! Per-account change signals over Server-Sent Events.
//!
//! A signal names only a coarse topic (for example `conversations`). It never
//! carries record data: the client refetches through the normal authorized
//! endpoint, so a stale or misrouted signal cannot disclose anything. Signals
//! are written with `pg_notify` inside the writer's transaction, which
//! PostgreSQL delivers only after commit and drops on rollback.
use std::{
    convert::Infallible,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use axum::{
    extract::State,
    http::HeaderMap,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::{stream, Stream};
use sqlx::{postgres::PgListener, PgConnection, PgPool};
use tokio::sync::broadcast;

use crate::{error::ApiError, AppState};

pub const CHANNEL: &str = "campusmate_events";
const TOPICS: &[&str] = &[
    "account",
    "profile",
    "decisions",
    "conversations",
    "messages",
    "appointments",
    "notifications",
    "membership",
    "parties",
    "group-messages",
    "calls",
    "blocks",
    "config",
    "preferences",
    "presence",
];

#[derive(Clone, Debug)]
pub struct Signal {
    pub user: Arc<str>,
    pub topic: Arc<str>,
    /// Optional resource ID (room, party, call) so a client can refetch one item.
    pub id: Option<Arc<str>>,
}

pub struct Hub {
    sender: broadcast::Sender<Signal>,
    /// Set while the listener holds a LISTEN on a direct connection.
    listening: AtomicBool,
}

impl Hub {
    pub fn new() -> Arc<Self> {
        let (sender, _) = broadcast::channel(4096);
        Arc::new(Self {
            sender,
            listening: AtomicBool::new(false),
        })
    }
    pub fn is_listening(&self) -> bool {
        self.listening.load(Ordering::Relaxed)
    }
    pub fn subscribe(&self) -> broadcast::Receiver<Signal> {
        self.sender.subscribe()
    }
    /// Delivers a parsed NOTIFY payload. Payloads are produced only by
    /// [`publish`]; anything malformed is ignored.
    pub fn dispatch(&self, payload: &str) {
        let mut parts = payload.splitn(3, '\u{1f}');
        let (Some(user), Some(topic)) = (parts.next(), parts.next()) else {
            return;
        };
        if !valid_user(user) || !TOPICS.contains(&topic) {
            return;
        }
        let id = parts
            .next()
            .filter(|id| !id.is_empty() && id.len() <= 259)
            .map(Arc::from);
        let _ = self.sender.send(Signal {
            user: Arc::from(user),
            topic: Arc::from(topic),
            id,
        });
    }
}

fn valid_user(user: &str) -> bool {
    !user.is_empty()
        && user.len() <= 128
        && user
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Queue a signal for each account. Delivered on commit of the caller's
/// transaction; a rolled-back write sends nothing.
pub async fn publish(
    connection: &mut PgConnection,
    users: &[&str],
    topic: &str,
    id: Option<&str>,
) -> Result<(), ApiError> {
    debug_assert!(TOPICS.contains(&topic));
    let users: Vec<&str> = users.iter().copied().filter(|u| valid_user(u)).collect();
    if users.is_empty() {
        return Ok(());
    }
    let _ = sqlx::query(
        "SELECT pg_notify($1, u || chr(31) || $3 || chr(31) || COALESCE($4::text,''))
         FROM unnest($2::text[]) AS u",
    )
    .bind(CHANNEL)
    .bind(users)
    .bind(topic)
    .bind(id.filter(|id| id.len() <= 259))
    .fetch_all(connection)
    .await?;
    Ok(())
}

/// Same as [`publish`] for a single account.
pub async fn publish_one(
    connection: &mut PgConnection,
    user: &str,
    topic: &str,
    id: Option<&str>,
) -> Result<(), ApiError> {
    publish(connection, &[user], topic, id).await
}

/// Whether the listener reached PostgreSQL through PgBouncer, whose server
/// connections carry its name. A LISTEN there stays on a shared server
/// connection after the transaction ends, and every later client of that
/// connection receives notifications it cannot parse, failing its commit.
async fn behind_pooler(listener: &mut PgListener) -> Result<bool, sqlx::Error> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT application_name FROM pg_stat_activity WHERE pid = pg_backend_pid()",
    )
    .fetch_optional(&mut *listener)
    .await?;
    Ok(name.as_deref() == Some("pgbouncer"))
}

/// Long-running LISTEN loop. It needs a direct (non-transaction-pooled)
/// connection; reconnects with backoff and tells every client to resync after
/// a gap, because NOTIFY is not replayed.
pub async fn listen(pool: PgPool, hub: Arc<Hub>) {
    let mut backoff = Duration::from_secs(1);
    loop {
        match PgListener::connect_with(&pool).await {
            Ok(mut listener) => {
                let direct = match behind_pooler(&mut listener).await {
                    Ok(pooled) => {
                        if pooled {
                            tracing::warn!("event listener refused a transaction-pooled connection; set DATABASE_LISTEN_URL to a direct endpoint");
                        }
                        !pooled
                    }
                    Err(_) => false,
                };
                if direct && listener.listen(CHANNEL).await.is_ok() {
                    backoff = Duration::from_secs(1);
                    hub.listening.store(true, Ordering::Relaxed);
                    hub.resync_all();
                    loop {
                        match listener.try_recv().await {
                            Ok(Some(notification)) => hub.dispatch(notification.payload()),
                            Ok(None) => {
                                hub.resync_all();
                                continue;
                            }
                            Err(_) => break,
                        }
                    }
                    hub.listening.store(false, Ordering::Relaxed);
                }
            }
            Err(_) => tracing::warn!("event listener connection failed"),
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(30));
    }
}

impl Hub {
    fn resync_all(&self) {
        let _ = self.sender.send(Signal {
            user: Arc::from("*"),
            topic: Arc::from("resync"),
            id: None,
        });
    }
}

fn event(signal: &Signal) -> Event {
    let data = match &signal.id {
        Some(id) => serde_json::json!({"topic":&*signal.topic,"id":&**id}),
        None => serde_json::json!({"topic":&*signal.topic}),
    };
    Event::default().event("change").data(data.to_string())
}

/// `GET /v1/events`. The stream ends when the access token expires or the
/// session is revoked; clients reconnect with a fresh token and refetch.
pub async fn stream(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    // Without a working LISTEN, a stream would stay silent; 503 makes
    // clients fall back to polling.
    let hub = state
        .events
        .clone()
        .filter(|hub| hub.is_listening())
        .ok_or_else(|| ApiError::unavailable("ระบบแจ้งเตือนแบบเรียลไทม์ไม่พร้อม"))?;
    let user = crate::auth::authenticate_session(&state, &headers).await?;
    crate::throttle(&state.db, "events", &user.uid, 30).await?;
    let receiver = hub.subscribe();
    let uid: Arc<str> = Arc::from(user.uid.as_str());
    let started = tokio::time::Instant::now();
    struct Ctx {
        receiver: broadcast::Receiver<Signal>,
        uid: Arc<str>,
        db: PgPool,
        headers: HeaderMap,
        started: tokio::time::Instant,
        last_check: tokio::time::Instant,
        opened: bool,
    }
    let ctx = Ctx {
        receiver,
        uid,
        db: state.db.clone(),
        headers,
        started,
        last_check: started,
        opened: false,
    };
    let events = stream::unfold(ctx, |mut ctx| async move {
        if !ctx.opened {
            ctx.opened = true;
            let ready = Event::default().event("ready").data("{}");
            return Some((Ok(ready), ctx));
        }
        loop {
            // Recheck the session once a minute; close at most 15 minutes in.
            if ctx.started.elapsed() > Duration::from_secs(15 * 60) {
                return None;
            }
            if ctx.last_check.elapsed() > Duration::from_secs(60) {
                ctx.last_check = tokio::time::Instant::now();
                let mut connection = ctx.db.acquire().await.ok()?;
                let principal = crate::auth::reauthorize_session(&mut connection, &ctx.headers)
                    .await
                    .ok()?;
                if *principal.uid != *ctx.uid {
                    return None;
                }
            }
            match tokio::time::timeout(Duration::from_secs(30), ctx.receiver.recv()).await {
                Ok(Ok(signal)) => {
                    if &*signal.user == "*" || signal.user == ctx.uid {
                        let event = if &*signal.topic == "resync" {
                            Event::default().event("resync").data("{}")
                        } else {
                            event(&signal)
                        };
                        return Some((Ok(event), ctx));
                    }
                }
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => {
                    return Some((Ok(Event::default().event("resync").data("{}")), ctx));
                }
                Ok(Err(broadcast::error::RecvError::Closed)) => return None,
                Err(_) => {} // timeout: loop to recheck the session; keep-alive covers idle time
            }
        }
    });
    Ok(Sse::new(events).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(20))
            .text("ping"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn dispatch_rejects_unknown_topics_and_malformed_users() {
        let hub = Hub::new();
        let mut receiver = hub.subscribe();
        hub.dispatch("alice\u{1f}conversations\u{1f}c-1");
        hub.dispatch("alice\u{1f}secrets\u{1f}");
        hub.dispatch("bad user\u{1f}messages\u{1f}");
        hub.dispatch("no-separator");
        let signal = receiver.try_recv().unwrap();
        assert_eq!(&*signal.user, "alice");
        assert_eq!(&*signal.topic, "conversations");
        assert_eq!(signal.id.as_deref(), Some("c-1"));
        assert!(receiver.try_recv().is_err());
    }
}
