//! In-app bug reports and feedback (shake to report). A report carries the
//! person's words, the app and OS version, the screen it came from and, only
//! when the person chose to attach it, a re-encoded screenshot kept privately
//! in the row for the admin console.
use axum::http::HeaderMap;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use crate::{auth, error::ApiError, media, AppState};

/// Reports per person per minute.
const RATE: i32 = 4;
const MESSAGE_MIN: usize = 5;
const MESSAGE_MAX: usize = 2000;
/// Largest screenshot the app may send, before re-encoding.
const SCREENSHOT_MAX_BYTES: usize = 3 * 1024 * 1024;
/// Largest stored screenshot (matches the table's CHECK).
const STORED_MAX_BYTES: usize = 400 * 1024;

fn short(data: &Value, key: &str, limit: usize) -> String {
    data[key]
        .as_str()
        .unwrap_or_default()
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(limit)
        .collect()
}

/// Decodes, re-encodes (dropping metadata) and shrinks until it fits.
fn screenshot(encoded: &str) -> Result<Vec<u8>, ApiError> {
    let bad = || ApiError::invalid("ภาพหน้าจอใช้ไม่ได้ กรุณาลองใหม่หรือส่งโดยไม่แนบภาพ");
    if encoded.len() > SCREENSHOT_MAX_BYTES.div_ceil(3) * 4 {
        return Err(bad());
    }
    let raw = BASE64.decode(encoded.as_bytes()).map_err(|_| bad())?;
    for edge in [1280, 960, 720] {
        let jpeg = media::normalize_image(&raw, edge).map_err(|_| bad())?;
        if jpeg.len() <= STORED_MAX_BYTES {
            return Ok(jpeg);
        }
    }
    Err(bad())
}

/// `submitAppFeedback`: files a bug report or a suggestion from the app.
pub async fn submit(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let kind = match data["kind"].as_str() {
        Some(kind @ ("bug" | "feedback")) => kind,
        _ => return Err(ApiError::invalid("กรุณาเลือกประเภทรายงาน")),
    };
    // Line breaks are part of a report; other control characters are not.
    let message: String = data["message"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .chars()
        .filter(|c| *c == '\n' || !c.is_control())
        .take(MESSAGE_MAX + 1)
        .collect();
    let length = message.chars().count();
    if length < MESSAGE_MIN {
        return Err(ApiError::invalid("กรุณาเล่ารายละเอียดอย่างน้อย 5 ตัวอักษร"));
    }
    if length > MESSAGE_MAX {
        return Err(ApiError::invalid("รายละเอียดยาวเกิน 2,000 ตัวอักษร"));
    }
    // After the quick checks, so a typo does not cost a report; before the
    // screenshot, which is the expensive part.
    crate::throttle(&state.db, "app-feedback", &user.uid, RATE).await?;
    let platform = data["platform"]
        .as_str()
        .filter(|platform| matches!(*platform, "ios" | "android" | "web"))
        .unwrap_or_default();
    let image = match data["screenshot"]
        .as_str()
        .filter(|value| !value.is_empty())
    {
        Some(encoded) => {
            let encoded = encoded.to_owned();
            Some(
                tokio::task::spawn_blocking(move || screenshot(&encoded))
                    .await
                    .map_err(|_| ApiError::internal())??,
            )
        }
        None => None,
    };
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO app_feedback(id,user_id,kind,message,app_version,app_build,platform,os_version,screen,screenshot)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(id)
    .bind(&user.uid)
    .bind(kind)
    .bind(&message)
    .bind(short(&data, "appVersion", 32))
    .bind(short(&data, "appBuild", 32))
    .bind(platform)
    .bind(short(&data, "osVersion", 32))
    .bind(short(&data, "screen", 120))
    .bind(image)
    .execute(&state.db)
    .await?;
    Ok(json!({ "id": id }))
}

pub const STATUSES: [&str; 4] = ["new", "triaged", "resolved", "dismissed"];

/// One report as the console lists it; the screenshot only in `detail`.
pub fn row_json(row: &sqlx::postgres::PgRow, with_screenshot: bool) -> Value {
    let mut value = json!({
        "id": row.get::<Uuid, _>("id"),
        "userId": row.get::<String, _>("user_id"),
        "kind": row.get::<String, _>("kind"),
        "message": row.get::<String, _>("message"),
        "appVersion": row.get::<String, _>("app_version"),
        "appBuild": row.get::<String, _>("app_build"),
        "platform": row.get::<String, _>("platform"),
        "osVersion": row.get::<String, _>("os_version"),
        "screen": row.get::<String, _>("screen"),
        "status": row.get::<String, _>("status"),
        "adminNote": row.get::<String, _>("admin_note"),
        "hasScreenshot": row.get::<bool, _>("has_screenshot"),
        "createdAt": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "updatedAt": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
    });
    if with_screenshot {
        let image: Option<Vec<u8>> = row.get("screenshot");
        value["screenshot"] = image
            .map(|bytes| json!(format!("data:image/jpeg;base64,{}", BASE64.encode(bytes))))
            .unwrap_or(Value::Null);
    }
    value
}
