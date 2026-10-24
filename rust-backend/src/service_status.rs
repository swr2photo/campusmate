//! Maintenance mode and incident protection for the app API.
//!
//! Admins switch maintenance on in the console (`app_config` id
//! `maintenance`). While it is on, app RPCs from everyone but admins are
//! refused with a `maintenance` notice that the app shows full screen, so
//! even old app versions stop writing. Every RPC outcome also feeds
//! per-minute counters for the console's status page. With auto-protect on,
//! a burst of server errors refuses users for a cool-down and then lets
//! traffic back in to see whether the fault is gone (a circuit breaker).
use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::http::HeaderMap;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};

use crate::{admin, auth, error::ApiError, AppState};

pub const CONFIG_ID: &str = "maintenance";
/// How long a read of the maintenance switch is trusted before re-reading.
const CONFIG_TTL: Duration = Duration::from_secs(5);
const KEPT_MINUTES: usize = 30;
/// RPCs that stay open: the app must read the notice, admins must lift it.
const OPEN: &[&str] = &[
    "getAppConfig",
    "getServiceStatus",
    "adminConsole",
    "switchAdminMode",
];
// Auto-protect trips when, over the last TRIP_WINDOW minutes, at least
// TRIP_MIN_REQUESTS calls ran and TRIP_ERROR_PERCENT of them failed on the
// server. It stays tripped for COOL_DOWN, then traffic is let back in.
const TRIP_WINDOW: usize = 2;
const TRIP_MIN_REQUESTS: u32 = 30;
const TRIP_ERROR_PERCENT: u32 = 50;
const COOL_DOWN: Duration = Duration::from_secs(180);
// Status levels for the console, over the last five minutes.
const LEVEL_WINDOW: usize = 5;
const DOWN_PERCENT: u32 = 25;
const DEGRADED_PERCENT: u32 = 5;
const SLOW_AVERAGE_MS: u64 = 1500;
/// Below this many calls a window says too little to judge.
const QUIET_REQUESTS: u32 = 10;

#[derive(Clone, Copy, Default)]
struct Minute {
    at: i64,
    total: u32,
    failed: u32,
    latency_ms: u64,
    slowest_ms: u32,
}

#[derive(Default)]
struct Tracker {
    minutes: VecDeque<Minute>,
    tripped_until: Option<Instant>,
    tripped_at: Option<DateTime<Utc>>,
    trips: u32,
}

struct Cached {
    read_at: Instant,
    config: Value,
}

static TRACKER: Mutex<Tracker> = Mutex::new(Tracker {
    minutes: VecDeque::new(),
    tripped_until: None,
    tripped_at: None,
    trips: 0,
});
static CONFIG: Mutex<Option<Cached>> = Mutex::new(None);

/// The maintenance switch, re-read at most every few seconds. When the
/// database cannot answer, the last known value stays in force.
async fn config(state: &AppState) -> Value {
    if let Some(cached) = CONFIG.lock().unwrap().as_ref() {
        if cached.read_at.elapsed() < CONFIG_TTL {
            return cached.config.clone();
        }
    }
    let read: Result<Option<Value>, _> =
        sqlx::query_scalar("SELECT data FROM app_config WHERE id=$1")
            .bind(CONFIG_ID)
            .fetch_optional(&state.db)
            .await;
    let mut cache = CONFIG.lock().unwrap();
    let config = match read {
        Ok(found) => found.unwrap_or_else(|| json!({})),
        Err(_) => cache
            .as_ref()
            .map(|cached| cached.config.clone())
            .unwrap_or_else(|| json!({})),
    };
    *cache = Some(Cached {
        read_at: Instant::now(),
        config: config.clone(),
    });
    config
}

/// Makes the next request read the switch again, right after an admin saved it.
pub fn invalidate() {
    *CONFIG.lock().unwrap() = None;
}

fn auto_protect() -> bool {
    CONFIG
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|cached| cached.config["autoProtect"].as_bool() == Some(true))
}

fn tripped() -> bool {
    TRACKER
        .lock()
        .unwrap()
        .tripped_until
        .is_some_and(|until| until > Instant::now())
}

/// What the app shows instead of its screens, or `None` when open.
fn notice(config: &Value) -> Option<Value> {
    let text = |key: &str| {
        config[key]
            .as_str()
            .map(str::trim)
            .filter(|v| !v.is_empty())
    };
    if config["enabled"].as_bool() == Some(true) {
        return Some(json!({
            "kind": "maintenance",
            "title": text("title").unwrap_or("กำลังปิดปรับปรุงระบบ"),
            "message": text("message").unwrap_or("CampusMate ปิดปรับปรุงชั่วคราวเพื่อให้ใช้งานได้ดีขึ้น กรุณากลับมาใหม่อีกครั้ง"),
            "endsAt": text("endsAt"),
        }));
    }
    tripped().then(|| {
        json!({
            "kind": "incident",
            "title": "ระบบขัดข้องชั่วคราว",
            "message": "ทีมงานกำลังแก้ไข ข้อมูลของคุณปลอดภัย แอปจะกลับมาใช้งานได้เองเมื่อระบบพร้อม",
            "endsAt": Value::Null,
        })
    })
}

fn refusal(notice: Value) -> ApiError {
    let mut error = ApiError::unavailable(
        notice["message"]
            .as_str()
            .unwrap_or("ระบบไม่พร้อมใช้งานชั่วคราว")
            .to_owned(),
    );
    error.details = Some(json!({ "maintenance": notice }));
    error
}

/// Refuses app RPCs during maintenance or a tripped incident. Admins keep
/// working so they can check the fix and lift maintenance.
pub async fn gate(state: &AppState, headers: &HeaderMap, name: &str) -> Result<(), ApiError> {
    if OPEN.contains(&name) {
        return Ok(());
    }
    let Some(notice) = notice(&config(state).await) else {
        return Ok(());
    };
    if is_admin(state, headers).await {
        return Ok(());
    }
    Err(refusal(notice))
}

async fn is_admin(state: &AppState, headers: &HeaderMap) -> bool {
    auth::authenticate_session(state, headers)
        .await
        .is_ok_and(|user| {
            user.role == "admin" || admin::is_super_admin(&user.email, user.email_verified)
        })
}

/// `getServiceStatus`: the notice the app should show, readable signed out.
/// Admins, who are let through, get it as `bypassed` instead.
pub async fn public_status(state: &AppState, headers: &HeaderMap) -> Value {
    match notice(&config(state).await) {
        Some(notice) if is_admin(state, headers).await => {
            json!({ "notice": null, "bypassed": notice })
        }
        notice => json!({ "notice": notice }),
    }
}

/// Server-side failures; a refused or invalid request is not an outage.
fn server_fault(error: &ApiError) -> bool {
    matches!(
        error.code,
        "internal" | "unknown" | "data-loss" | "deadline-exceeded" | "unavailable"
    )
}

fn minute_now() -> i64 {
    Utc::now().timestamp() / 60
}

/// Counts one RPC outcome and trips auto-protect on a burst of failures.
pub fn record(error: Option<&ApiError>, elapsed: Duration) {
    let failed = error.is_some_and(server_fault);
    let protect = auto_protect();
    let now = minute_now();
    let ms = u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX);
    let mut tracker = TRACKER.lock().unwrap();
    if tracker.minutes.back().map(|minute| minute.at) != Some(now) {
        tracker.minutes.push_back(Minute {
            at: now,
            ..Minute::default()
        });
        while tracker.minutes.len() > KEPT_MINUTES {
            tracker.minutes.pop_front();
        }
    }
    if let Some(minute) = tracker.minutes.back_mut() {
        minute.total += 1;
        minute.failed += u32::from(failed);
        minute.latency_ms = minute.latency_ms.saturating_add(ms);
        minute.slowest_ms = minute.slowest_ms.max(u32::try_from(ms).unwrap_or(u32::MAX));
    }
    if !failed
        || !protect
        || tracker
            .tripped_until
            .is_some_and(|until| until > Instant::now())
    {
        return;
    }
    let (total, failures) = window(&tracker.minutes, now, TRIP_WINDOW);
    if total >= TRIP_MIN_REQUESTS && failures * 100 >= total * TRIP_ERROR_PERCENT {
        tracker.tripped_until = Some(Instant::now() + COOL_DOWN);
        tracker.tripped_at = Some(Utc::now());
        tracker.trips += 1;
        tracing::warn!(
            total,
            failures,
            "auto-protect tripped: app requests refused for the cool-down"
        );
    }
}

/// Calls and server failures over the last `minutes` minutes.
fn window(minutes: &VecDeque<Minute>, now: i64, span: usize) -> (u32, u32) {
    let since = now - span as i64 + 1;
    minutes
        .iter()
        .filter(|minute| minute.at >= since)
        .fold((0, 0), |(total, failed), minute| {
            (total + minute.total, failed + minute.failed)
        })
}

/// `ok`, `degraded`, `down` or `quiet` (too little traffic to judge).
fn level(total: u32, failed: u32, average_ms: u64, tripped: bool) -> &'static str {
    if tripped {
        return "down";
    }
    if total < QUIET_REQUESTS {
        return "quiet";
    }
    if failed * 100 >= total * DOWN_PERCENT {
        "down"
    } else if failed * 100 >= total * DEGRADED_PERCENT || average_ms >= SLOW_AVERAGE_MS {
        "degraded"
    } else {
        "ok"
    }
}

/// Console status page: traffic, failures and latency per minute, the
/// switch and the breaker.
pub async fn snapshot(state: &AppState) -> Value {
    let started = Instant::now();
    let database = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await;
    let database_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let config = config(state).await;
    // Before taking the tracker: `notice` reads the breaker through it too.
    let notice = notice(&config);
    let now = minute_now();
    let (kept, tripped, tripped_at, trips) = {
        let tracker = TRACKER.lock().unwrap();
        (
            tracker.minutes.clone(),
            tracker
                .tripped_until
                .is_some_and(|until| until > Instant::now()),
            tracker.tripped_at,
            tracker.trips,
        )
    };
    let recent: Vec<&Minute> = kept
        .iter()
        .filter(|m| m.at > now - LEVEL_WINDOW as i64)
        .collect();
    let total: u32 = recent.iter().map(|m| m.total).sum();
    let failed: u32 = recent.iter().map(|m| m.failed).sum();
    let latency: u64 = recent.iter().map(|m| m.latency_ms).sum();
    let average_ms = if total > 0 {
        latency / u64::from(total)
    } else {
        0
    };
    let minutes: Vec<Value> = kept
        .iter()
        .map(|m| {
            json!({
                "at": DateTime::<Utc>::from_timestamp(m.at * 60, 0),
                "total": m.total,
                "failed": m.failed,
                "averageMs": if m.total > 0 { m.latency_ms / u64::from(m.total) } else { 0 },
                "slowestMs": m.slowest_ms,
            })
        })
        .collect();
    json!({
        "level": level(total, failed, average_ms, tripped || database.is_err()),
        "lastFiveMinutes": {"total": total, "failed": failed, "averageMs": average_ms},
        "minutes": minutes,
        "database": {"ok": database.is_ok(), "latencyMs": database_ms},
        "notice": notice,
        "autoProtect": {
            "enabled": config["autoProtect"].as_bool() == Some(true),
            "tripped": tripped,
            "trippedAt": tripped_at,
            "trips": trips,
            "rule": {"windowMinutes": TRIP_WINDOW, "minRequests": TRIP_MIN_REQUESTS,
                "errorPercent": TRIP_ERROR_PERCENT, "coolDownSeconds": COOL_DOWN.as_secs()},
        },
    })
}

/// Lets users back in at once after an admin fixed the cause.
pub fn reset_breaker() {
    let mut tracker = TRACKER.lock().unwrap();
    tracker.tripped_until = None;
}

/// Validates an admin's maintenance settings; unknown keys are refused.
pub fn validate(data: &Value) -> Result<Value, ApiError> {
    let raw = data
        .as_object()
        .ok_or_else(|| ApiError::invalid("การตั้งค่าไม่ถูกต้อง"))?;
    for (key, value) in raw {
        let ok = match key.as_str() {
            "enabled" | "autoProtect" => value.is_boolean(),
            "title" => value.as_str().is_some_and(|v| v.chars().count() <= 80),
            "message" => value.as_str().is_some_and(|v| v.chars().count() <= 600),
            "endsAt" => value
                .as_str()
                .is_some_and(|v| v.is_empty() || DateTime::parse_from_rfc3339(v).is_ok()),
            _ => false,
        };
        if !ok {
            return Err(ApiError::invalid(format!("การตั้งค่า {key} ไม่ถูกต้อง")));
        }
    }
    Ok(Value::Object(raw.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_judge_failures_and_latency_but_not_quiet_traffic() {
        assert_eq!(level(4, 4, 0, false), "quiet");
        assert_eq!(level(100, 0, 120, false), "ok");
        assert_eq!(level(100, 6, 120, false), "degraded");
        assert_eq!(level(100, 0, 2000, false), "degraded");
        assert_eq!(level(100, 30, 120, false), "down");
        assert_eq!(level(0, 0, 0, true), "down");
    }

    #[test]
    fn the_window_counts_only_recent_minutes() {
        let minutes: VecDeque<Minute> = [
            Minute {
                at: 7,
                total: 50,
                failed: 50,
                ..Minute::default()
            },
            Minute {
                at: 9,
                total: 10,
                failed: 2,
                ..Minute::default()
            },
            Minute {
                at: 10,
                total: 5,
                failed: 1,
                ..Minute::default()
            },
        ]
        .into();
        assert_eq!(window(&minutes, 10, 2), (15, 3));
    }

    #[test]
    fn maintenance_settings_are_strict() {
        assert!(validate(
            &json!({"enabled": true, "title": "ปิดปรับปรุง", "endsAt": "2026-10-24T09:00:00+07:00"})
        )
        .is_ok());
        assert!(validate(&json!({"enabled": "yes"})).is_err());
        assert!(validate(&json!({"endsAt": "tomorrow"})).is_err());
        assert!(validate(&json!({"script": "<b>"})).is_err());
        assert!(validate(&json!({"title": "x".repeat(81)})).is_err());
        assert!(notice(&json!({"enabled": false})).is_none() || tripped());
        let maintenance = notice(&json!({"enabled": true})).unwrap();
        assert_eq!(maintenance["kind"], "maintenance");
        assert!(maintenance["title"]
            .as_str()
            .is_some_and(|title| !title.is_empty()));
    }
}
