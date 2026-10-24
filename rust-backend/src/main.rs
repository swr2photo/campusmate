use anyhow::Context;
use campusmate_backend::activity::{recently_active, ACTIVE_WINDOW};
use std::time::Duration;
use tokio::time::{Instant, MissedTickBehavior};

/// Longest gap between expiry sweeps while nobody uses the app (retention
/// purges and stale calls only need to happen eventually).
const IDLE_SWEEP: Duration = Duration::from_secs(6 * 60 * 60);
/// Longest gap between row clean-ups while idle.
const IDLE_CLEANUP: Duration = Duration::from_secs(24 * 60 * 60);

/// A periodic job runs on its first tick, on every tick while the app is in
/// use, and otherwise once `idle_gap` has passed since its last run.
fn due(last_run: Option<Instant>, idle_gap: Duration) -> bool {
    match last_run {
        None => true,
        Some(at) => recently_active(ACTIVE_WINDOW) || at.elapsed() >= idle_gap,
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL required")?;
    let secret = std::env::var("CURSOR_SECRET").context("CURSOR_SECRET required")?;
    let mode = std::env::var("APP_ENV").unwrap_or_else(|_| "production".into());
    let pool = campusmate_backend::database::runtime_pool(&database_url, false).await?;
    // Production runs migrations separately using a privileged deployment identity.
    if mode == "development" || mode == "test" {
        // Development auto-migration still needs a direct endpoint: SQLx's
        // session advisory migration lock cannot run through PgBouncer.
        campusmate_backend::database::configured_migration_options(&database_url)?;
        sqlx::migrate!().run(&pool).await?;
    }
    let mut state = campusmate_backend::new_state(pool.clone(), secret.into_bytes()).await?;
    state.firebase_identity = campusmate_backend::firebase_identity::FirebaseIdentity::from_env()?
        .map(std::sync::Arc::new);
    state.google_identity =
        campusmate_backend::google_identity::GoogleIdentity::from_env()?.map(std::sync::Arc::new);
    // LISTEN needs a session-mode connection; a Neon pooler endpoint is
    // rejected. Without one, `/v1/events` answers 503 and clients poll.
    if let Some(listen_url) = campusmate_backend::database::listen_url(&database_url) {
        let options = campusmate_backend::database::configured_migration_options(&listen_url)?;
        let listen_pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .min_connections(0)
            .acquire_timeout(Duration::from_secs(10))
            .connect_lazy_with(options);
        let hub = campusmate_backend::events::Hub::new();
        state.events = Some(hub.clone());
        tokio::spawn(campusmate_backend::events::listen(listen_pool, hub));
    }
    state.media = campusmate_backend::media::MediaServices::from_env()
        .await?
        .map(std::sync::Arc::new);
    // Push delivery runs in the API process; PUSH_WORKER=off moves it elsewhere.
    if std::env::var("PUSH_WORKER").as_deref() != Ok("off") {
        let sender = std::sync::Arc::new(campusmate_backend::notify::PushSender::from_env()?);
        tokio::spawn(campusmate_backend::notify::run_worker(pool.clone(), sender));
    }
    // Background jobs query the database only while the app is in use (or on
    // a long idle timer), so Neon can suspend an idle compute. See `activity`.
    {
        let pool = pool.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
            let mut last_run: Option<Instant> = None;
            // Open parties expire at their start time even while nobody is
            // online; the next start is remembered so the idle check needs no
            // query.
            let mut next_party: Option<Instant> = None;
            loop {
                interval.tick().await;
                let party_due = next_party.is_some_and(|at| at <= Instant::now());
                if !(party_due || due(last_run, IDLE_SWEEP)) {
                    continue;
                }
                last_run = Some(Instant::now());
                if campusmate_backend::parties::expire(&pool).await.is_err() {
                    tracing::warn!("party expiry sweep failed");
                }
                if campusmate_backend::calls::sweep(&pool).await.is_err() {
                    tracing::warn!("call sweep failed");
                }
                next_party = sqlx::query_scalar::<_, Option<f64>>(
                    "SELECT EXTRACT(EPOCH FROM min(starts_at)-now())::float8 FROM parties WHERE status='open'",
                )
                .fetch_one(&pool)
                .await
                .ok()
                .flatten()
                .map(|seconds| Instant::now() + Duration::from_secs_f64(seconds.clamp(60.0, 86_400.0)));
                // Expiry notices are queued by the sweep itself.
                campusmate_backend::activity::wake_push();
            }
        });
    }
    // Photo verification stays off (routes answer 503) unless fully configured.
    state.identity = campusmate_backend::identity::IdentityServices::from_env()
        .await?
        .map(std::sync::Arc::new);
    if let Some(services) = state.identity.clone() {
        let pool = pool.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
            let mut last_run: Option<Instant> = None;
            loop {
                interval.tick().await;
                if !due(last_run, IDLE_SWEEP) {
                    continue;
                }
                last_run = Some(Instant::now());
                if campusmate_backend::identity::sweep(&pool, &services)
                    .await
                    .is_err()
                {
                    tracing::warn!("photo verification sweep failed");
                }
            }
        });
    }
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300));
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut last_run: Option<Instant> = None;
        loop {
            interval.tick().await;
            if !due(last_run, IDLE_CLEANUP) {
                continue;
            }
            last_run = Some(Instant::now());
            let _ = campusmate_backend::auth::scrub_auth_outbox(&pool).await;
            for sql in [
                "DELETE FROM discovery_snapshots WHERE expires_at < now()",
                "DELETE FROM rate_limits WHERE window_start < now()-interval '1 hour'",
                "DELETE FROM sessions WHERE refresh_expires_at < now()-interval '7 days'",
                "DELETE FROM auth_challenges WHERE expires_at < now()-interval '1 day'",
                "DELETE FROM account_otps WHERE expires_at < now()-interval '1 day'",
                "DELETE FROM notifications WHERE expires_at <= now()",
                "DELETE FROM revenuecat_events WHERE processed_at < now()-interval '90 days'",
            ] {
                let _ = sqlx::query(sql).execute(&pool).await;
            }
        }
    });
    let host = std::env::var("BIND_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse()?;
    let listener = tokio::net::TcpListener::bind((host.as_str(), port)).await?;
    tracing::info!(port, "native backend listening");
    axum::serve(listener, campusmate_backend::router(state))
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("signal registration");
        tokio::select! { _=term.recv()=>{}, _=tokio::signal::ctrl_c()=>{} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
