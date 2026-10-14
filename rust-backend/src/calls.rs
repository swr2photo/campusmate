//! Voice/video call sessions and LiveKit room tokens. Unlike the legacy
//! function, a room token is issued only to a participant of a live call
//! whose room is still open, and only between matched, unblocked accounts.
use axum::http::HeaderMap;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::{auth, error::ApiError, events, notify, AppState};

const LIVE: &[&str] = &["calling", "ringing", "connected"];

fn call_arg(data: &Value) -> Result<String, ApiError> {
    data["callId"]
        .as_str()
        .filter(|id| crate::chat::identifier(id, 128) && !id.contains(':') && !id.contains('.'))
        .map(str::to_owned)
        .ok_or_else(|| ApiError::invalid("ต้องระบุ callId"))
}

fn small_profile(profile: &Value, fallback: &str) -> Value {
    let name: String = profile["nickname"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| profile["name"].as_str())
        .unwrap_or(fallback)
        .chars()
        .take(100)
        .collect();
    json!({
        "name": name,
        "avatarUri": profile["avatarUri"].as_str().filter(|u| u.starts_with("https://") && u.len() <= 2048),
        "avatarColor": profile["avatarColor"].as_str().map(|s| s.chars().take(50).collect::<String>()),
        "avatar": profile["avatar"].as_str().map(|s| s.chars().take(100).collect::<String>()),
    })
}

fn call_json(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.get::<String,_>("id"), "callerId": row.get::<String,_>("caller_id"),
        "receiverId": row.get::<String,_>("receiver_id"), "conversationId": row.get::<Option<String>,_>("conversation_id"),
        "callType": row.get::<String,_>("call_type"), "status": row.get::<String,_>("status"),
        "callerProfile": row.get::<Value,_>("caller_profile"), "receiverProfile": row.get::<Value,_>("receiver_profile"),
        "createdAt": row.get::<i64,_>("created_ms"), "startedAt": row.get::<Option<i64>,_>("started_ms"),
        "endedAt": row.get::<Option<i64>,_>("ended_ms"), "durationSeconds": row.get::<i32,_>("duration_seconds"),
        "endReason": row.get::<Option<String>,_>("end_reason"), "offer": Value::Null, "answer": Value::Null,
    })
}
const COLUMNS: &str = "id,caller_id,receiver_id,conversation_id,call_type,status,caller_profile,receiver_profile,duration_seconds,end_reason,
    (extract(epoch FROM created_at)*1000)::bigint AS created_ms,(extract(epoch FROM started_at)*1000)::bigint AS started_ms,
    (extract(epoch FROM ended_at)*1000)::bigint AS ended_ms";

/// Starts a call to a matched peer in an active direct room.
pub async fn initiate(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let receiver = data["receiverId"]
        .as_str()
        .filter(|id| crate::chat::identifier(id, 128) && *id != user.uid)
        .ok_or_else(|| ApiError::invalid("ผู้รับสายไม่ถูกต้อง"))?
        .to_owned();
    let call_type = if data["callType"] == "video" {
        "video"
    } else {
        "voice"
    };
    crate::throttle(&state.db, "call-start", &user.uid, 20).await?;
    let (a, b) = if user.uid < receiver {
        (user.uid.as_str(), receiver.as_str())
    } else {
        (receiver.as_str(), user.uid.as_str())
    };
    let mut tx = state.db.begin().await?;
    crate::matching::lock_pair(&mut tx, a, b).await?;
    auth::lock_business_session(&mut tx, headers, &user.uid).await?;
    let room: Option<String> = sqlx::query_scalar(
        "SELECT c.id FROM conversations c JOIN accounts x ON x.id=$2 WHERE c.member_a=$1 AND c.member_b=$2 AND c.active
           AND NOT x.suspended AND x.deleted_at IS NULL AND (SELECT NOT suspended AND deleted_at IS NULL FROM accounts WHERE id=$1)
           AND NOT EXISTS(SELECT 1 FROM blocks WHERE (actor_id=$1 AND target_id=$2) OR (actor_id=$2 AND target_id=$1))",
    )
    .bind(a)
    .bind(b)
    .fetch_optional(&mut *tx)
    .await?;
    let room = room.ok_or_else(|| ApiError::new("permission-denied", "โทรหาผู้ใช้นี้ไม่ได้"))?;
    let profiles = sqlx::query("SELECT user_id,raw FROM profiles WHERE user_id=ANY($1)")
        .bind(vec![user.uid.clone(), receiver.clone()])
        .fetch_all(&mut *tx)
        .await?;
    let raw = |uid: &str| {
        profiles
            .iter()
            .find(|r| r.get::<String, _>("user_id") == uid)
            .map(|r| r.get::<Value, _>("raw"))
            .unwrap_or(Value::Null)
    };
    let caller_raw = raw(&user.uid);
    let id = Uuid::new_v4().simple().to_string();
    // A newer call between the same pair supersedes ringing ones.
    sqlx::query("UPDATE calls SET status='missed',ended_at=now(),end_reason='superseded',updated_at=now() WHERE caller_id=$1 AND receiver_id=$2 AND status IN ('calling','ringing')")
        .bind(&user.uid).bind(&receiver).execute(&mut *tx).await?;
    let row = sqlx::query(&format!("INSERT INTO calls(id,caller_id,receiver_id,conversation_id,call_type,status,caller_profile,receiver_profile) VALUES($1,$2,$3,$4,$5,'calling',$6,$7) RETURNING {COLUMNS}"))
        .bind(&id).bind(&user.uid).bind(&receiver).bind(&room).bind(call_type)
        .bind(small_profile(&caller_raw, "ผู้โทร")).bind(small_profile(&raw(&receiver), "ผู้รับสาย"))
        .fetch_one(&mut *tx).await?;
    let notice = notify::incoming_call(&caller_raw, &id, &user.uid, call_type, &room);
    notify::enqueue(&mut tx, &receiver, &format!("call:{id}"), &notice).await?;
    events::publish(&mut tx, &[&user.uid, &receiver], "calls", Some(&id)).await?;
    tx.commit().await?;
    let mut call = call_json(&row);
    call["callId"] = json!(id);
    Ok(call)
}

async fn locked_call(
    tx: &mut PgConnection,
    id: &str,
    uid: &str,
) -> Result<sqlx::postgres::PgRow, ApiError> {
    sqlx::query(&format!(
        "SELECT {COLUMNS} FROM calls WHERE id=$1 AND $2 IN (caller_id,receiver_id) FOR UPDATE"
    ))
    .bind(id)
    .bind(uid)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::new("not-found", "ไม่พบสายนี้"))
}

/// One state transition. Ended states are final; only the receiver may
/// accept, ring or reject.
pub async fn update(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = call_arg(&data)?;
    let action = data["action"].as_str().unwrap_or_default();
    let mut tx = state.db.begin().await?;
    let call = locked_call(&mut tx, &id, &user.uid).await?;
    let status: String = call.get("status");
    let receiver: String = call.get("receiver_id");
    let caller: String = call.get("caller_id");
    let is_receiver = receiver == user.uid;
    if !LIVE.contains(&status.as_str()) {
        tx.commit().await?;
        return Ok(json!({"status":status,"changed":false}));
    }
    let reason: String = data["reason"]
        .as_str()
        .unwrap_or("hangup")
        .chars()
        .take(40)
        .collect();
    let changed = match action {
        "ringing" if is_receiver && status == "calling" => {
            sqlx::query("UPDATE calls SET status='ringing',updated_at=now() WHERE id=$1")
                .bind(&id)
                .execute(&mut *tx)
                .await?;
            true
        }
        "accept" if is_receiver => {
            sqlx::query("UPDATE calls SET status='connected',started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1").bind(&id).execute(&mut *tx).await?;
            true
        }
        "reject" if is_receiver && status != "connected" => {
            let next = if reason == "busy" { "busy" } else { "rejected" };
            sqlx::query("UPDATE calls SET status=$2,ended_at=now(),end_reason=$3,updated_at=now() WHERE id=$1").bind(&id).bind(next).bind(&reason).execute(&mut *tx).await?;
            true
        }
        "missed" if status != "connected" => {
            sqlx::query("UPDATE calls SET status='missed',ended_at=now(),end_reason='timeout',updated_at=now() WHERE id=$1").bind(&id).execute(&mut *tx).await?;
            true
        }
        "end" => {
            let duration = data["durationSeconds"]
                .as_f64()
                .unwrap_or(0.0)
                .clamp(0.0, 86_400.0) as i32;
            sqlx::query("UPDATE calls SET status='ended',ended_at=now(),duration_seconds=$2,end_reason=$3,updated_at=now() WHERE id=$1").bind(&id).bind(duration).bind(&reason).execute(&mut *tx).await?;
            true
        }
        _ => false,
    };
    if changed {
        events::publish(&mut tx, &[&caller, &receiver], "calls", Some(&id)).await?;
    }
    tx.commit().await?;
    Ok(json!({"changed":changed}))
}

pub async fn get(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = call_arg(&data)?;
    let row = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM calls WHERE id=$1 AND $2 IN (caller_id,receiver_id)"
    ))
    .bind(&id)
    .bind(&user.uid)
    .fetch_optional(&state.db)
    .await?;
    Ok(json!({"call": row.as_ref().map(call_json)}))
}

/// Newest ringing call addressed to me from the last 60 seconds.
pub async fn incoming(state: &AppState, headers: &HeaderMap, _: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let row = sqlx::query(&format!("SELECT {COLUMNS} FROM calls WHERE receiver_id=$1 AND status IN ('calling','ringing') AND created_at>now()-interval '60 seconds' ORDER BY created_at DESC LIMIT 1"))
        .bind(&user.uid).fetch_optional(&state.db).await?;
    Ok(json!({"call": row.as_ref().map(call_json)}))
}

/// HS256 LiveKit access token (the format of livekit-server-sdk AccessToken).
pub fn livekit_token(
    key: &str,
    secret: &str,
    identity: &str,
    name: &str,
    room: &str,
    now_s: i64,
) -> Result<String, ApiError> {
    let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
    let claims = json!({
        "iss": key, "sub": identity, "name": name, "nbf": now_s - 10, "exp": now_s + 2 * 3600, "jti": Uuid::new_v4().to_string(),
        "video": {"roomJoin": true, "room": room, "canPublish": true, "canSubscribe": true, "canPublishData": true},
    });
    let payload =
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).map_err(|_| ApiError::internal())?);
    let signed = format!("{header}.{payload}");
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(|_| ApiError::internal())?;
    mac.update(signed.as_bytes());
    Ok(format!(
        "{signed}.{}",
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    ))
}

pub async fn livekit(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = call_arg(&data)?;
    crate::throttle(&state.db, "livekit-token", &user.uid, 30).await?;
    let (Ok(key), Ok(secret)) = (
        std::env::var("LIVEKIT_API_KEY"),
        std::env::var("LIVEKIT_API_SECRET"),
    ) else {
        return Err(ApiError::new(
            "internal",
            "ระบบโทรยังไม่ได้ตั้งค่า LiveKit API Keys",
        ));
    };
    let url = std::env::var("LIVEKIT_URL")
        .unwrap_or_else(|_| "wss://campusmate-jmt5sy3c.livekit.cloud".into());
    let live: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM calls WHERE id=$1 AND $2 IN (caller_id,receiver_id) AND status IN ('calling','ringing','connected') AND created_at>now()-interval '6 hours')")
        .bind(&id).bind(&user.uid).fetch_one(&state.db).await?;
    if !live {
        return Err(ApiError::new("permission-denied", "สายนี้สิ้นสุดแล้ว"));
    }
    let name: String = data["participantName"]
        .as_str()
        .unwrap_or(&user.uid)
        .chars()
        .filter(|c| !c.is_control())
        .take(100)
        .collect();
    let token = livekit_token(
        &key,
        &secret,
        &user.uid,
        &name,
        &id,
        chrono::Utc::now().timestamp(),
    )?;
    Ok(json!({"token":token,"url":url,"room":id}))
}

/// Calls left ringing past a minute are missed; connected calls are closed
/// after six hours.
pub async fn sweep(pool: &sqlx::PgPool) -> Result<(), ApiError> {
    sqlx::query("UPDATE calls SET status='missed',ended_at=now(),end_reason='timeout',updated_at=now() WHERE status IN ('calling','ringing') AND created_at<now()-interval '90 seconds'")
        .execute(pool).await?;
    sqlx::query("UPDATE calls SET status='ended',ended_at=now(),end_reason='expired',updated_at=now() WHERE status='connected' AND created_at<now()-interval '6 hours'")
        .execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn livekit_tokens_carry_the_room_grant() {
        let token = livekit_token("key", "secret", "alice", "Alice", "call1", 1_000).unwrap();
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);
        let claims: Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["video"]["room"], "call1");
        assert_eq!(claims["sub"], "alice");
        assert_eq!(claims["exp"], 1_000 + 7200);
        let mut mac = Hmac::<Sha256>::new_from_slice(b"secret").unwrap();
        mac.update(format!("{}.{}", parts[0], parts[1]).as_bytes());
        assert_eq!(
            URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()),
            parts[2]
        );
    }
}
