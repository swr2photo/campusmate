//! CampusMate matching service (Cloud Run).
//!
//! Ranked friend discovery behind Firebase Auth. Firestore is read through
//! the service account with read-only access; nothing here writes data.

mod auth;
mod cursor;
mod discover;
mod distance;
mod error;
mod filters;
mod model;
mod policy;
mod pool;
mod ratelimit;
mod score;
mod value;

use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context as _};
use axum::http::{header, HeaderValue, StatusCode};
use axum::routing::{get, post};
use axum::{extract::State, Router};
use firestore::FirestoreDb;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::timeout::TimeoutLayer;

#[derive(Clone)]
pub struct AppState {
    pub db: FirestoreDb,
    pub pool: Arc<pool::Pool>,
    pub verifier: Arc<auth::Verifier>,
    pub cursors: Arc<cursor::CursorSigner>,
    pub limiter: Arc<ratelimit::RateLimiter>,
}

async fn health(State(state): State<AppState>) -> (StatusCode, &'static str) {
    if state.pool.is_ready() { (StatusCode::OK, "ready") } else { (StatusCode::SERVICE_UNAVAILABLE, "warming") }
}

/// Cloud Run sends SIGTERM before stopping an instance.
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("SIGTERM handler");
        tokio::select! { _ = term.recv() => {}, _ = tokio::signal::ctrl_c() => {} }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|value| value.trim().to_owned()).filter(|value| !value.is_empty())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let project_id = env("FIREBASE_PROJECT_ID").or_else(|| env("GOOGLE_CLOUD_PROJECT")).context("FIREBASE_PROJECT_ID is required")?;
    // Shared by every instance so cursors survive load balancing.
    let cursor_secret = env("CURSOR_SECRET").context("CURSOR_SECRET is required (32+ random bytes, from Secret Manager)")?;
    if cursor_secret.len() < 32 {
        bail!("CURSOR_SECRET must be at least 32 characters");
    }
    let port: u16 = env("PORT").map_or(Ok(8080), |value| value.parse()).context("PORT must be a number")?;

    let http = reqwest::Client::builder().timeout(Duration::from_secs(10)).https_only(true).build()?;
    let db = FirestoreDb::new(&project_id).await.context("connect to Firestore")?;
    let pool = Arc::new(pool::Pool::default());
    pool::spawn_sync(db.clone(), pool.clone());

    let state = AppState {
        db,
        pool,
        verifier: Arc::new(auth::Verifier::new(project_id, env("APP_CHECK_PROJECT_NUMBER"), http)),
        cursors: Arc::new(cursor::CursorSigner::new(cursor_secret.into_bytes())),
        limiter: Arc::new(ratelimit::RateLimiter::default()),
    };

    let app = Router::new()
        .route("/healthz", get(health))
        .route("/v1/discover", post(discover::handler))
        .with_state(state)
        .layer(RequestBodyLimitLayer::new(16 * 1024))
        .layer(TimeoutLayer::new(Duration::from_secs(10)))
        .layer(SetResponseHeaderLayer::overriding(header::CACHE_CONTROL, HeaderValue::from_static("no-store")))
        .layer(SetResponseHeaderLayer::overriding(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::overriding(header::STRICT_TRANSPORT_SECURITY, HeaderValue::from_static("max-age=31536000")));

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!(port, "matching service listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}
