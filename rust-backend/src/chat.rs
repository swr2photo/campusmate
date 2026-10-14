//! Direct-room E2EE transport. The server stores public device keys and opaque
//! ciphertext only; room membership is independent of profile discovery.

use std::collections::HashSet;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row};

use crate::{auth::authenticate_session, cursor::RankKey, error::ApiError, AppState};

pub(crate) const ALGORITHM: &str = "x25519-xsalsa20-poly1305.v1";
pub(crate) const ENCRYPTED_PREVIEW: &str = "ข้อความที่เข้ารหัส";
const PAGE_SIZE: usize = 50;

pub(crate) fn identifier(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':'))
}
pub(crate) fn room_id(value: &str) -> Result<(), ApiError> {
    if !identifier(value, 259) {
        return Err(ApiError::invalid("Invalid conversation ID"));
    }
    Ok(())
}
pub(crate) fn denied() -> ApiError {
    ApiError::new("permission-denied", "Conversation access denied")
}
pub(crate) fn b64(value: &Value, min: usize, max: usize) -> bool {
    let Some(text) = value.as_str() else {
        return false;
    };
    if text.len() > max.div_ceil(3) * 4 {
        return false;
    }
    STANDARD
        .decode(text)
        .is_ok_and(|bytes| (min..=max).contains(&bytes.len()) && STANDARD.encode(bytes) == text)
}
fn exact_fields(raw: &Map<String, Value>, fields: &[&str]) -> bool {
    raw.len() == fields.len() && fields.iter().all(|field| raw.contains_key(*field))
}

pub(crate) struct Room {
    pub(crate) a: String,
    pub(crate) b: String,
    pub(crate) active: bool,
    pub(crate) encryption: Option<Value>,
    pub(crate) revision: i64,
}
impl Room {
    pub(crate) fn members(&self) -> [&str; 2] {
        [&self.a, &self.b]
    }
}

pub(crate) async fn member_room(
    db: &mut PgConnection,
    uid: &str,
    headers: &HeaderMap,
    id: &str,
    write: bool,
) -> Result<Room, ApiError> {
    room_id(id)?;
    if write {
        let pair = sqlx::query("SELECT member_a,member_b FROM conversations WHERE id=$1 AND ($2=member_a OR $2=member_b)")
            .bind(id).bind(uid).fetch_optional(&mut *db).await?.ok_or_else(denied)?;
        let a: String = pair.get("member_a");
        let b: String = pair.get("member_b");
        crate::matching::lock_pair(db, &a, &b).await?;
        let members = sqlx::query("SELECT id,NOT suspended AND deleted_at IS NULL AS active FROM accounts WHERE id=ANY($1) ORDER BY id FOR SHARE")
            .bind(vec![a,b]).fetch_all(&mut *db).await?;
        if members.len() != 2 || members.iter().any(|row| !row.get::<bool, _>("active")) {
            return Err(denied());
        }
    }
    // Lock the caller first, as native refresh/reset/restriction operations do.
    // This prevents suspension or password reset from crossing a room write.
    let allowed: Option<bool> = sqlx::query_scalar(
        "SELECT NOT suspended AND deleted_at IS NULL FROM accounts WHERE id=$1 FOR SHARE",
    )
    .bind(uid)
    .fetch_optional(&mut *db)
    .await?;
    if allowed != Some(true) {
        return Err(ApiError::unauthenticated());
    }
    if crate::auth::reauthorize_session(db, headers).await?.uid != uid {
        return Err(ApiError::unauthenticated());
    }
    let query = if write {
        "SELECT member_a,member_b,active,encryption,encryption_revision FROM conversations WHERE id=$1 AND ($2=member_a OR $2=member_b) FOR UPDATE"
    } else {
        "SELECT member_a,member_b,active,encryption,encryption_revision FROM conversations WHERE id=$1 AND ($2=member_a OR $2=member_b) FOR SHARE"
    };
    let row = sqlx::query(query)
        .bind(id)
        .bind(uid)
        .fetch_optional(&mut *db)
        .await?
        .ok_or_else(denied)?;
    let room = Room {
        a: row.get("member_a"),
        b: row.get("member_b"),
        active: row.get("active"),
        encryption: row.get("encryption"),
        revision: row.get("encryption_revision"),
    };
    if write {
        let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM blocks WHERE (actor_id=$1 AND target_id=$2) OR (actor_id=$2 AND target_id=$1))")
            .bind(&room.a).bind(&room.b).fetch_one(&mut *db).await?;
        let peer_active:bool=sqlx::query_scalar("SELECT count(*)=2 FROM accounts WHERE id=ANY($1) AND NOT suspended AND deleted_at IS NULL")
            .bind(room.members().to_vec()).fetch_one(&mut *db).await?;
        if !room.active || blocked || !peer_active {
            return Err(denied());
        }
    }
    Ok(room)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceRequest {
    public_key: String,
}

pub async fn publish_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<String>,
    Json(input): Json<DeviceRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate_session(&state, &headers).await?;
    if !identifier(&device_id, 128) || !b64(&json!(input.public_key), 32, 32) {
        return Err(ApiError::invalid("Invalid device public key"));
    }
    crate::throttle(&state.db, "publish-device", &actor.uid, 15).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "SELECT id FROM accounts WHERE id=$1 AND NOT suspended AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(&actor.uid)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::unauthenticated)?;
    crate::auth::reauthorize_session(&mut tx, &headers).await?;
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT public_key FROM encryption_devices WHERE user_id=$1 AND device_id=$2",
    )
    .bind(&actor.uid)
    .bind(&device_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(key) = existing {
        if key != input.public_key {
            return Err(ApiError::new(
                "already-exists",
                "Use a new device ID when rotating a key",
            ));
        }
    } else {
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM encryption_devices WHERE user_id=$1")
                .bind(&actor.uid)
                .fetch_one(&mut *tx)
                .await?;
        if count >= 5 {
            return Err(ApiError::new(
                "resource-exhausted",
                "Retire an old encryption device first",
            ));
        }
        sqlx::query(
            "INSERT INTO encryption_devices(user_id,device_id,public_key) VALUES($1,$2,$3)",
        )
        .bind(&actor.uid)
        .bind(&device_id)
        .bind(&input.public_key)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(
        json!({"deviceId":device_id,"publicKey":input.public_key}),
    ))
}
pub async fn remove_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate_session(&state, &headers).await?;
    if !identifier(&device_id, 128) {
        return Err(ApiError::invalid("Invalid device ID"));
    }
    crate::throttle(&state.db, "remove-device", &actor.uid, 15).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "SELECT id FROM accounts WHERE id=$1 AND NOT suspended AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(&actor.uid)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::unauthenticated)?;
    crate::auth::reauthorize_session(&mut tx, &headers).await?;
    sqlx::query("DELETE FROM encryption_devices WHERE user_id=$1 AND device_id=$2")
        .bind(&actor.uid)
        .bind(device_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeysRequest {
    #[serde(default)]
    user_ids: Vec<String>,
}
pub async fn encryption_profiles(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<KeysRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate_session(&state, &headers).await?;
    if input.user_ids.len() > 50 || input.user_ids.iter().any(|id| !identifier(id, 128)) {
        return Err(ApiError::invalid("Invalid user IDs"));
    }
    crate::throttle(&state.db, "room-keys", &actor.uid, 60).await?;
    let mut tx = state.db.begin().await?;
    let room = member_room(&mut tx, &actor.uid, &headers, &id, false).await?;
    if input
        .user_ids
        .iter()
        .any(|id| !room.members().contains(&id.as_str()))
    {
        return Err(denied());
    }
    let mut profiles = Vec::new();
    let mut seen = HashSet::new();
    for uid in input.user_ids {
        if !seen.insert(uid.clone()) {
            continue;
        }
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM accounts WHERE id=$1 AND deleted_at IS NULL)",
        )
        .bind(&uid)
        .fetch_one(&mut *tx)
        .await?;
        if !exists {
            continue;
        }
        let rows=sqlx::query("SELECT device_id,public_key FROM encryption_devices WHERE user_id=$1 ORDER BY device_id LIMIT 5").bind(&uid).fetch_all(&mut *tx).await?;
        let mut devices = Map::new();
        for row in rows {
            let device: String = row.get("device_id");
            let key: String = row.get("public_key");
            if identifier(&device, 128) && b64(&json!(key), 32, 32) {
                devices.insert(device, json!({"publicKey":key}));
            }
        }
        profiles.push(json!({"id":uid,"encryptionDevices":devices}));
    }
    tx.commit().await?;
    Ok(Json(json!({"profiles":profiles})))
}

pub async fn room(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate_session(&state, &headers).await?;
    crate::throttle(&state.db, "room-read", &actor.uid, 120).await?;
    let mut tx = state.db.begin().await?;
    let room = member_room(&mut tx, &actor.uid, &headers, &id, false).await?;
    let last=sqlx::query("SELECT id,(extract(epoch FROM created_at)*1000)::bigint AS at FROM encrypted_messages WHERE conversation_id=$1 ORDER BY sequence DESC LIMIT 1").bind(&id).fetch_optional(&mut *tx).await?;
    let last_id = last.as_ref().map(|row| row.get::<String, _>("id"));
    let last_at = last.as_ref().map(|row| row.get::<i64, _>("at"));
    tx.commit().await?;
    Ok(Json(
        json!({"id":id,"participants":room.members(),"active":room.active,"encryption":room.encryption,"encryptionRevision":room.revision,"lastMessage":last_id.as_ref().map(|_|ENCRYPTED_PREVIEW),"lastMessageId":last_id,"lastMessageAt":last_at}),
    ))
}

pub(crate) fn valid_encryption(encryption: &Value, members: [&str; 2]) -> bool {
    let Some(raw) = encryption.as_object() else {
        return false;
    };
    if !exact_fields(raw, &["version", "algorithm", "keyEnvelopes"])
        || raw["version"] != 1
        || raw["algorithm"] != ALGORITHM
    {
        return false;
    }
    let Some(users) = raw["keyEnvelopes"].as_object() else {
        return false;
    };
    if users.is_empty() || users.len() > 2 {
        return false;
    }
    users.iter().all(|(uid, value)| {
        if !members.contains(&uid.as_str()) {
            return false;
        }
        let Some(devices) = value.as_object() else {
            return false;
        };
        !devices.is_empty()
            && devices.len() <= 5
            && devices.iter().all(|(device, value)| {
                let Some(envelope) = value.as_object() else {
                    return false;
                };
                identifier(device, 128)
                    && exact_fields(
                        envelope,
                        &["senderDeviceId", "senderPublicKey", "nonce", "ciphertext"],
                    )
                    && envelope["senderDeviceId"]
                        .as_str()
                        .is_some_and(|id| identifier(id, 128))
                    && b64(&envelope["senderPublicKey"], 32, 32)
                    && b64(&envelope["nonce"], 24, 24)
                    && b64(&envelope["ciphertext"], 48, 48)
            })
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EncryptionRequest {
    revision: i64,
    encryption: Value,
}
pub async fn save_encryption(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<EncryptionRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate_session(&state, &headers).await?;
    crate::throttle(&state.db, "room-encryption", &actor.uid, 30).await?;
    let mut tx = state.db.begin().await?;
    let room = member_room(&mut tx, &actor.uid, &headers, &id, true).await?;
    if input.revision != room.revision {
        return Err(ApiError::new("aborted", "Conversation encryption changed"));
    }
    if !valid_encryption(&input.encryption, room.members())
        || input.encryption["keyEnvelopes"].get(&actor.uid).is_none()
    {
        return Err(ApiError::invalid("Invalid conversation encryption"));
    }
    let has_messages: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM encrypted_messages WHERE conversation_id=$1)",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    // New or replaced envelopes must come from a currently published caller
    // device and address an existing participant device. Existing envelopes
    // remain usable when the sending device is later retired.
    let users = input.encryption["keyEnvelopes"]
        .as_object()
        .expect("validated");
    for (uid, devices) in users {
        for (device, envelope) in devices.as_object().expect("validated") {
            let previous = room
                .encryption
                .as_ref()
                .and_then(|old| old.get("keyEnvelopes"))
                .and_then(|old| old.get(uid))
                .and_then(|old| old.get(device));
            if previous == Some(envelope) {
                continue;
            }
            if has_messages && previous.is_some() {
                return Err(ApiError::new(
                    "failed-precondition",
                    "Existing message keys cannot be replaced",
                ));
            }
            let recipient: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM encryption_devices WHERE user_id=$1 AND device_id=$2)",
            )
            .bind(uid)
            .bind(device)
            .fetch_one(&mut *tx)
            .await?;
            let sender:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM encryption_devices WHERE user_id=$1 AND device_id=$2 AND public_key=$3)")
                .bind(&actor.uid).bind(envelope["senderDeviceId"].as_str().expect("validated")).bind(envelope["senderPublicKey"].as_str().expect("validated")).fetch_one(&mut *tx).await?;
            if !recipient || !sender {
                return Err(ApiError::invalid("Envelope devices are not published"));
            }
        }
    }
    if has_messages {
        if let Some(old) = room
            .encryption
            .as_ref()
            .and_then(|old| old.get("keyEnvelopes"))
            .and_then(Value::as_object)
        {
            for (uid, devices) in old {
                for (device, _) in devices.as_object().ok_or_else(ApiError::internal)? {
                    if users
                        .get(uid)
                        .and_then(|devices| devices.get(device))
                        .is_none()
                    {
                        let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM encryption_devices WHERE user_id=$1 AND device_id=$2)").bind(uid).bind(device).fetch_one(&mut *tx).await?;
                        if active {
                            return Err(ApiError::new(
                                "failed-precondition",
                                "Active recipient keys cannot be removed",
                            ));
                        }
                    }
                }
            }
        }
    }
    sqlx::query("UPDATE conversations SET encryption=$2,encryption_revision=encryption_revision+1,updated_at=now() WHERE id=$1").bind(&id).bind(&input.encryption).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"encryption":input.encryption,"encryptionRevision":room.revision+1}),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageRequest {
    pub(crate) encrypted: bool,
    pub(crate) encryption_version: u8,
    pub(crate) nonce: String,
    pub(crate) ciphertext: String,
}
impl MessageRequest {
    pub(crate) fn packet(&self) -> Result<Value, ApiError> {
        if !self.encrypted
            || self.encryption_version != 1
            || !b64(&json!(self.nonce), 24, 24)
            || !b64(&json!(self.ciphertext), 17, 32 * 1024)
        {
            return Err(ApiError::invalid("Invalid encrypted message"));
        }
        Ok(
            json!({"encrypted":true,"encryptionVersion":1,"nonce":self.nonce,"ciphertext":self.ciphertext}),
        )
    }
}
pub(crate) fn wire_message(row: &sqlx::postgres::PgRow) -> Value {
    let stored = row.get::<Value, _>("ciphertext");
    let mut packet = json!({"encrypted":stored["encrypted"],"encryptionVersion":stored["encryptionVersion"],"nonce":stored["nonce"],"ciphertext":stored["ciphertext"]});
    packet["id"] = json!(row.get::<String, _>("id"));
    packet["senderId"] = json!(row.get::<String, _>("sender_id"));
    packet["createdAt"] = json!(row.get::<i64, _>("at"));
    packet["time"] = packet["createdAt"].clone();
    packet
}
pub async fn send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, message_id)): Path<(String, String)>,
    Json(input): Json<MessageRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate_session(&state, &headers).await?;
    if !identifier(&message_id, 128) {
        return Err(ApiError::invalid("Invalid message ID"));
    }
    let packet = input.packet()?;
    crate::throttle(&state.db, "room-send", &actor.uid, 120).await?;
    let mut tx = state.db.begin().await?;
    let room = member_room(&mut tx, &actor.uid, &headers, &id, true).await?;
    let (message, duplicate) = store_message(
        &mut tx,
        &room,
        &id,
        &actor.uid,
        &message_id,
        packet,
        json!({}),
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"message":message,"duplicate":duplicate})))
}

/// Stores one encrypted message in a locked, writable room. Returns the wire
/// message and whether it was an idempotent retry of an identical send.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn store_message(
    tx: &mut PgConnection,
    room: &Room,
    id: &str,
    sender: &str,
    message_id: &str,
    packet: Value,
    meta: Value,
    client_sent_at: Option<i64>,
) -> Result<(Value, bool), ApiError> {
    let previous=sqlx::query("SELECT id,sender_id,ciphertext,(extract(epoch FROM created_at)*1000)::bigint AS at FROM encrypted_messages WHERE conversation_id=$1 AND id=$2")
        .bind(id).bind(message_id).fetch_optional(&mut *tx).await?;
    if let Some(row) = previous {
        if row.get::<String, _>("sender_id") != sender
            || row.get::<Value, _>("ciphertext") != packet
        {
            return Err(ApiError::new("already-exists", "Message ID already used"));
        }
        return Ok((wire_message(&row), true));
    }
    let encryption = room
        .encryption
        .as_ref()
        .filter(|value| valid_encryption(value, room.members()))
        .ok_or_else(|| {
            ApiError::new(
                "failed-precondition",
                "Conversation encryption is not initialized",
            )
        })?;
    for uid in room.members() {
        let devices = encryption["keyEnvelopes"]
            .get(uid)
            .and_then(Value::as_object)
            .ok_or_else(|| {
                ApiError::new(
                    "failed-precondition",
                    "A recipient encryption key is missing",
                )
            })?;
        let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM encryption_devices WHERE user_id=$1 AND device_id=ANY($2))").bind(uid).bind(devices.keys().cloned().collect::<Vec<_>>()).fetch_one(&mut *tx).await?;
        if !active {
            return Err(ApiError::new(
                "failed-precondition",
                "A recipient encryption device is unavailable",
            ));
        }
    }
    // A client clock is kept for display order only when it is close to ours.
    let row=sqlx::query("INSERT INTO encrypted_messages(conversation_id,id,sender_id,ciphertext,meta,client_sent_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $6::bigint IS NOT NULL AND abs($6::bigint-(extract(epoch FROM now())*1000)::bigint)<300000 THEN to_timestamp($6::double precision/1000) END) RETURNING id,sender_id,ciphertext,(extract(epoch FROM created_at)*1000)::bigint AS at")
        .bind(id).bind(message_id).bind(sender).bind(packet).bind(meta).bind(client_sent_at).fetch_one(&mut *tx).await?;
    sqlx::query("UPDATE conversations SET updated_at=now() WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    Ok((wire_message(&row), false))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MessagesRequest {
    #[serde(default)]
    cursor: Option<String>,
}
pub async fn messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<MessagesRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate_session(&state, &headers).await?;
    crate::throttle(&state.db, "room-messages", &actor.uid, 120).await?;
    let mut tx = state.db.begin().await?;
    member_room(&mut tx, &actor.uid, &headers, &id, false).await?;
    let now = Utc::now().timestamp_millis();
    let scope = format!(
        "chat-messages:v1:{}",
        hex::encode(Sha256::digest(id.as_bytes()))
    );
    let (upper, before) = if let Some(cursor) = input.cursor.as_deref() {
        let key = state.cursor.verify(cursor, &actor.uid, &scope, now)?;
        let upper: i64 = key
            .id
            .parse()
            .map_err(|_| ApiError::invalid("Invalid message page"))?;
        let before: i64 = key
            .tie
            .parse()
            .map_err(|_| ApiError::invalid("Invalid message page"))?;
        if key.score != 0 || upper < 0 || before < 0 || before > upper.saturating_add(1) {
            return Err(ApiError::invalid("Invalid message page"));
        }
        (upper, before)
    } else {
        let upper: i64 = sqlx::query_scalar(
            "SELECT COALESCE(max(sequence),0) FROM encrypted_messages WHERE conversation_id=$1",
        )
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
        (upper, upper.saturating_add(1))
    };
    let mut rows=sqlx::query("SELECT id,sender_id,ciphertext,sequence,(extract(epoch FROM created_at)*1000)::bigint AS at FROM encrypted_messages WHERE conversation_id=$1 AND sequence<=$2 AND sequence<$3 ORDER BY sequence DESC LIMIT 51")
        .bind(&id).bind(upper).bind(before).fetch_all(&mut *tx).await?;
    let has_more = rows.len() > PAGE_SIZE;
    rows.truncate(PAGE_SIZE);
    let cursor = if has_more {
        rows.last().map(|row| {
            state.cursor.sign(
                &actor.uid,
                &scope,
                RankKey {
                    score: 0,
                    tie: row.get::<i64, _>("sequence").to_string(),
                    id: upper.to_string(),
                },
                now,
            )
        })
    } else {
        None
    };
    let messages: Vec<Value> = rows.iter().map(wire_message).collect();
    tx.commit().await?;
    Ok(Json(
        json!({"messages":messages,"hasMore":has_more,"nextCursor":cursor}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn envelopes_reject_extra_fields_wrong_participants_and_invalid_base64() {
        let key = STANDARD.encode([7; 32]);
        let nonce = STANDARD.encode([7; 24]);
        let ciphertext = STANDARD.encode([7; 48]);
        let envelope = json!({"senderDeviceId":"phone","senderPublicKey":key,"nonce":nonce,"ciphertext":ciphertext});
        let mut encryption =
            json!({"version":1,"algorithm":ALGORITHM,"keyEnvelopes":{"alice":{"phone":envelope}}});
        assert!(valid_encryption(&encryption, ["alice", "bob"]));
        encryption["keyEnvelopes"]["alice"]["phone"]["secretKey"] = json!("never-accepted");
        assert!(!valid_encryption(&encryption, ["alice", "bob"]));
        assert!(!b64(&json!("invalid!"), 24, 24));
        assert!(!valid_encryption(
            &json!({"version":1,"algorithm":ALGORITHM,"keyEnvelopes":{"mallory":{}}}),
            ["alice", "bob"]
        ));
    }
    #[test]
    fn message_packet_accepts_only_version_one_ciphertext() {
        let mut packet = MessageRequest {
            encrypted: true,
            encryption_version: 1,
            nonce: STANDARD.encode([0; 24]),
            ciphertext: STANDARD.encode([0; 17]),
        };
        assert!(packet.packet().is_ok());
        packet.encrypted = false;
        assert!(packet.packet().is_err());
        packet.encrypted = true;
        packet.ciphertext = "plain message".into();
        assert!(packet.packet().is_err());
    }
}
