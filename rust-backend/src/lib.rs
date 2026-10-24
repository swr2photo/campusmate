pub mod account;
pub mod activity;
pub mod admin;
pub mod auth;
pub mod auth_pages;
pub mod calls;
pub mod chat;
pub mod cursor;
pub mod database;
pub mod discovery;
pub mod distance;
pub mod error;
pub mod events;
pub mod feedback;
pub mod filters;
pub mod firebase_identity;
pub mod google_identity;
pub mod identity;
pub mod identity_provider;
pub mod matching;
pub mod media;
pub mod membership;
pub mod migrate_import;
pub mod model;
pub mod music;
pub mod notify;
pub mod parties;
pub mod policy;
pub mod profiles;
pub mod projection;
pub mod rooms;
pub mod rpc;
pub mod score;
pub mod service_status;
pub mod settings;
pub mod social;
pub mod value;

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderValue, StatusCode},
    routing::{get, post, put},
    Json, Router,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::{sync::Arc, time::Duration};
use tower::limit::ConcurrencyLimitLayer;
use tower_http::{
    limit::RequestBodyLimitLayer, set_header::SetResponseHeaderLayer, timeout::TimeoutLayer,
};

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub cursor: Arc<cursor::CursorSigner>,
    pub password_jobs: Arc<tokio::sync::Semaphore>,
    pub discovery_jobs: Arc<tokio::sync::Semaphore>,
    pub dummy_password_hash: Arc<String>,
    /// Photo verification; `None` keeps those routes unavailable.
    pub identity: Option<Arc<identity::IdentityServices>>,
    pub firebase_identity: Option<Arc<firebase_identity::FirebaseIdentity>>,
    pub google_identity: Option<Arc<google_identity::GoogleIdentity>>,
    /// Realtime change signals; `None` until a LISTEN connection is configured.
    pub events: Option<Arc<events::Hub>>,
    /// Profile/chat media storage; `None` keeps media routes unavailable.
    pub media: Option<Arc<media::MediaServices>>,
}

pub async fn new_state(db: PgPool, secret: Vec<u8>) -> anyhow::Result<AppState> {
    anyhow::ensure!(
        secret.len() >= 32,
        "cursor secret must contain at least 32 random bytes"
    );
    let dummy = tokio::task::spawn_blocking(|| {
        auth::hash_password("unused-dummy-auth-password-not-an-account")
    })
    .await?
    .map_err(|_| anyhow::anyhow!("password hasher initialization failed"))?;
    Ok(AppState {
        db,
        cursor: Arc::new(cursor::CursorSigner::new(secret)),
        password_jobs: Arc::new(tokio::sync::Semaphore::new(4)),
        discovery_jobs: Arc::new(tokio::sync::Semaphore::new(2)),
        dummy_password_hash: Arc::new(dummy),
        identity: None,
        firebase_identity: None,
        google_identity: None,
        events: None,
        media: None,
    })
}

pub async fn throttle(
    db: &PgPool,
    kind: &str,
    subject: &str,
    maximum: i32,
) -> Result<(), error::ApiError> {
    let digest = hex::encode(Sha256::digest(format!("{kind}:{subject}")));
    let count: i32 = sqlx::query_scalar("INSERT INTO rate_limits(key,window_start,count) VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.window_start=date_trunc('minute',now()) THEN rate_limits.count+1 ELSE 1 END,window_start=date_trunc('minute',now()) RETURNING count")
        .bind(digest).fetch_one(db).await?;
    if count > maximum {
        return Err(error::ApiError::new(
            "resource-exhausted",
            "คำขอมากเกินไป กรุณารอสักครู่",
        ));
    }
    Ok(())
}

/// Liveness for the platform health check. It never touches the database:
/// a probe every 30 seconds would keep a scale-to-zero database awake all
/// month. `/healthz` still reports database readiness for deploy checks.
async fn live() -> (StatusCode, Json<Value>) {
    (StatusCode::OK, Json(json!({"live":true})))
}

/// Marks API traffic for the background jobs and, after a successful write,
/// wakes the push worker: its outbox only grows inside requests like this one.
async fn track_activity(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let path = request.uri().path();
    let probe = path == "/healthz" || path == "/livez";
    let write = !matches!(
        *request.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    );
    if !probe {
        activity::touch();
    }
    let response = next.run(request).await;
    if write && !probe && response.status().is_success() {
        activity::wake_push();
    }
    response
}

async fn health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    let ready = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .is_ok();
    (
        if ready {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        Json(json!({"ready":ready})),
    )
}

/// Browser access is limited to the admin console origins listed in
/// `ADMIN_CONSOLE_ORIGINS` (comma separated, https only). The mobile app does
/// not use CORS.
fn admin_cors() -> tower_http::cors::CorsLayer {
    use axum::http::{header, Method};
    let origins: Vec<HeaderValue> = std::env::var("ADMIN_CONSOLE_ORIGINS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|origin| origin.starts_with("https://") && !origin[8..].contains('/'))
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect();
    tower_http::cors::CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .max_age(Duration::from_secs(600))
}

pub fn router(state: AppState) -> Router {
    // Raw image uploads have their own size limit and never share the small
    // JSON limit below.
    let uploads = Router::new()
        .route("/v1/media/avatar", put(media::avatar))
        .route("/v1/media/gallery", put(media::gallery))
        .route("/v1/media/moderate", post(media::check))
        .layer(DefaultBodyLimit::max(media::MAX_IMAGE_BYTES))
        .layer(RequestBodyLimitLayer::new(media::MAX_IMAGE_BYTES))
        .layer(ConcurrencyLimitLayer::new(8));
    // Gesture frames (base64 JPEG) are larger than ordinary JSON calls.
    let gestures = Router::new()
        .route(
            "/v1/identity/photo-verifications/{id}/gestures",
            post(identity::gesture),
        )
        .layer(DefaultBodyLimit::max(identity::MAX_GESTURE_BODY_BYTES))
        .layer(RequestBodyLimitLayer::new(identity::MAX_GESTURE_BODY_BYTES))
        .layer(ConcurrencyLimitLayer::new(16));
    let rpc = Router::new()
        .route("/v1/rpc/{name}", post(rpc::call))
        .route("/v1/webhooks/revenuecat", post(membership::webhook))
        .layer(RequestBodyLimitLayer::new(256 * 1024));
    Router::new()
        .route("/healthz", get(health))
        .route("/livez", get(live))
        .route("/auth/verify-email", get(auth_pages::verify))
        .route("/auth/reset-password", get(auth_pages::reset))
        .route("/auth/assets/action.js", get(auth_pages::script))
        .route("/auth/assets/action.css", get(auth_pages::styles))
        .route("/v1/auth/signup", post(auth::signup))
        .route("/v1/auth/login", post(auth::login))
        .route("/v1/auth/refresh", post(auth::refresh))
        .route("/v1/auth/logout", post(auth::logout))
        .route("/v1/auth/me", get(auth::me))
        .route("/v1/auth/verify-email", post(auth::verify_email))
        .route(
            "/v1/auth/request-verification",
            post(auth::request_verification),
        )
        .route("/v1/auth/forgot-password", post(auth::forgot_password))
        .route("/v1/auth/reset-password", post(auth::reset_password))
        .route(
            "/v1/auth/firebase-exchange",
            post(account::firebase_exchange),
        )
        .route("/v1/auth/google", post(account::google))
        .route("/v1/events", get(events::stream))
        .route("/v1/me/profile", get(profiles::me).put(profiles::save))
        .route("/v1/me/visibility", put(profiles::visibility))
        .route(
            "/v1/me/blocks/{id}",
            put(profiles::block).delete(profiles::unblock),
        )
        .route("/v1/me/membership", get(profiles::membership))
        .route("/v1/profiles/visible", post(discovery::visible))
        .route("/v1/discover", post(discovery::discover))
        .route("/v1/matching/actions", post(matching::record))
        .route("/v1/matching/respond", post(matching::respond))
        .route("/v1/matching/cancel", post(matching::cancel))
        .route("/v1/matching/unmatch", post(matching::unmatch))
        .route("/v1/matching/rewind", post(matching::rewind))
        .route(
            "/v1/identity/photo-verification",
            get(identity::status).delete(identity::revoke),
        )
        .route("/v1/identity/photo-verifications", post(identity::create))
        .route(
            "/v1/identity/photo-verifications/{id}",
            get(identity::attempt),
        )
        .route(
            "/v1/identity/photo-verifications/{id}/complete",
            post(identity::complete),
        )
        .route(
            "/v1/identity/photo-verifications/{id}/appeal",
            post(identity::appeal),
        )
        .route(
            "/v1/identity/photo-verification/alternative",
            post(identity::request_alternative),
        )
        .route("/v1/admin/identity-reviews", get(identity::admin_queue))
        .route(
            "/v1/admin/identity-reviews/{id}/evidence",
            get(identity::admin_evidence),
        )
        .route(
            "/v1/admin/identity-reviews/{id}/decision",
            post(identity::admin_decision),
        )
        .route(
            "/v1/admin/identity-alternatives/{id}/decision",
            post(identity::admin_alternative_decision),
        )
        .route(
            "/v1/me/encryption-devices/{device_id}",
            put(chat::publish_device).delete(chat::remove_device),
        )
        .route(
            "/v1/conversations/{id}/encryption-profiles",
            post(chat::encryption_profiles),
        )
        .route("/v1/conversations/{id}", get(chat::room))
        .route(
            "/v1/conversations/{id}/encryption",
            put(chat::save_encryption),
        )
        .route(
            "/v1/conversations/{id}/messages/{message_id}",
            put(chat::send_message),
        )
        .route("/v1/conversations/{id}/messages/page", post(chat::messages))
        .layer(RequestBodyLimitLayer::new(64 * 1024))
        .merge(rpc)
        .merge(uploads)
        .merge(gestures)
        .fallback(|| async {
            error::ApiError::new("unimplemented", "บริการนี้ยังไม่พร้อมสำหรับ backend ใหม่")
        })
        .with_state(state)
        .layer(axum::middleware::from_fn(track_activity))
        .layer(admin_cors())
        .layer(ConcurrencyLimitLayer::new(128))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(20),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000"),
        ))
}
