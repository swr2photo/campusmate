//! Direct-room inbox and message operations the legacy app performed with
//! Firestore writes: listing rooms, paging messages, unread counts, read
//! receipts, reactions, hide/unsend, per-member settings and meetup
//! acceptance with appointment history.
use axum::http::HeaderMap;
use chrono::{FixedOffset, NaiveDate, NaiveTime, TimeZone};
use serde_json::{json, Map, Value};
use sqlx::{PgConnection, Row};

use crate::{
    auth,
    chat::{self, Room, ENCRYPTED_PREVIEW},
    error::ApiError,
    events, notify, projection, AppState,
};

const PAGE: i64 = 40;

fn text<'a>(data: &'a Value, key: &str) -> Option<&'a str> {
    data.get(key).and_then(Value::as_str)
}
fn room_arg(data: &Value) -> Result<String, ApiError> {
    let id = text(data, "conversationId").ok_or_else(|| ApiError::invalid("ห้องสนทนาไม่ถูกต้อง"))?;
    chat::room_id(id)?;
    Ok(id.to_owned())
}
fn message_arg(data: &Value, key: &str) -> Result<String, ApiError> {
    let id = text(data, key).ok_or_else(|| ApiError::invalid("ข้อความไม่ถูกต้อง"))?;
    if !chat::identifier(id, 128) {
        return Err(ApiError::invalid("ข้อความไม่ถูกต้อง"));
    }
    Ok(id.to_owned())
}
fn other<'a>(room: &'a Room, uid: &str) -> &'a str {
    if room.a == uid {
        &room.b
    } else {
        &room.a
    }
}

/// Plaintext-free metadata the legacy encrypted record carried beside the
/// ciphertext. Unknown keys are rejected rather than silently stored.
pub fn message_meta(raw: Option<&Value>) -> Result<Value, ApiError> {
    let Some(raw) = raw.filter(|v| !v.is_null()) else {
        return Ok(json!({}));
    };
    let source = raw
        .as_object()
        .ok_or_else(|| ApiError::invalid("ข้อมูลข้อความไม่ถูกต้อง"))?;
    let bad = || ApiError::invalid("ข้อมูลข้อความไม่ถูกต้อง");
    let mut meta = Map::new();
    for (key, value) in source {
        let accepted = match key.as_str() {
            "videoMode" | "viewMode" => value
                .as_str()
                .is_some_and(|mode| ["once", "replay", "chat"].contains(&mode)),
            "videoDuration" => value.as_f64().is_some_and(|ms| ms > 0.0 && ms <= 60_000.0),
            "videoStartMs" | "videoEndMs" | "callDuration" => value
                .as_f64()
                .is_some_and(|n| (0.0..=86_400_000.0).contains(&n)),
            "callType" => value
                .as_str()
                .is_some_and(|kind| ["voice", "video"].contains(&kind)),
            "callStatus" => value.as_str().is_some_and(|s| s.len() <= 40),
            "callTime" => value.as_str().is_some_and(|s| s.len() <= 40) || value.as_f64().is_some(),
            "isSystem" | "forwarded" => value == &Value::Bool(true),
            "forwardedFrom" => value.as_object().is_some_and(|from| {
                from.len() == 2
                    && from
                        .get("conversationId")
                        .and_then(Value::as_str)
                        .is_some_and(|id| chat::identifier(id, 200))
                    && from
                        .get("messageId")
                        .and_then(Value::as_str)
                        .is_some_and(|id| chat::identifier(id, 128))
            }),
            _ => false,
        };
        if !accepted {
            return Err(bad());
        }
        meta.insert(key.clone(), value.clone());
    }
    Ok(Value::Object(meta))
}

fn ms(row: &sqlx::postgres::PgRow, column: &str) -> Value {
    row.try_get::<Option<i64>, _>(column)
        .ok()
        .flatten()
        .map(Value::from)
        .unwrap_or(Value::Null)
}

const MESSAGE_COLUMNS: &str =
    "id,sender_id,ciphertext,meta,reactions,reaction_times,hidden_for,sequence,
    (extract(epoch FROM COALESCE(client_sent_at,created_at))*1000)::bigint AS at";

/// Wire shape of a stored message as the legacy client read it from Firestore.
fn message_json(row: &sqlx::postgres::PgRow) -> Value {
    let stored: Value = row.get("ciphertext");
    let mut message = json!({
        "id": row.get::<String,_>("id"), "senderId": row.get::<String,_>("sender_id"),
        "createdAt": row.get::<i64,_>("at"), "time": row.get::<i64,_>("at"),
        "encrypted": stored["encrypted"], "encryptionVersion": stored["encryptionVersion"],
        "nonce": stored["nonce"], "ciphertext": stored["ciphertext"],
        "sequence": row.get::<i64,_>("sequence"),
    });
    if let Some(meta) = row.get::<Value, _>("meta").as_object() {
        for (key, value) in meta {
            message[key] = value.clone();
        }
    }
    let reactions: Value = row.get("reactions");
    if reactions.as_object().is_some_and(|r| !r.is_empty()) {
        message["reactions"] = reactions;
        message["reactionTimes"] = row.get("reaction_times");
    }
    let hidden: Vec<String> = row.get("hidden_for");
    if !hidden.is_empty() {
        message["hiddenFor"] = json!(hidden);
    }
    message
}

/// Fields of the conversation-card profile (legacy `toConversationProfile`).
fn conversation_profile(uid: &str, row: Option<&sqlx::postgres::PgRow>) -> Value {
    let Some(row) = row else {
        return json!({"id":uid,"name":"ผู้ใช้ CampusMate","isDiscoverable":false});
    };
    if row.get::<bool, _>("deleted") {
        return json!({"id":uid,"name":"บัญชีที่ถูกลบ","isDiscoverable":false});
    }
    let raw: Value = row.get("raw");
    let public = projection::discovery_profile(uid, &raw);
    let mut profile = json!({"id":uid,"isDiscoverable":row.get::<bool,_>("discoverable"),"isFaceVerified":row.get::<bool,_>("face_verified")});
    for (field, max) in [
        ("name", 100),
        ("nickname", 100),
        ("faculty", 100),
        ("year", 50),
        ("activity", 100),
        ("activityLabel", 100),
        ("availability", 100),
        ("bio", 1000),
        ("avatar", 100),
        ("avatarColor", 50),
        ("avatarUri", 2000),
        ("gender", 100),
    ] {
        if let Some(value) = public[field].as_str() {
            profile[field] = json!(value.chars().take(max).collect::<String>());
        }
    }
    if let Some(age) = public["age"]
        .as_u64()
        .filter(|age| (18..=100).contains(age))
    {
        profile["age"] = json!(age);
    }
    if let Some(revision) = raw["avatarRevision"].as_i64() {
        profile["avatarRevision"] = json!(revision);
    }
    profile
}

async fn rooms_json(
    connection: &mut PgConnection,
    uid: &str,
    only: Option<&str>,
) -> Result<Vec<Value>, ApiError> {
    let rows = sqlx::query(
        "SELECT c.id,c.member_a,c.member_b,c.active,c.encryption,c.encryption_revision,
            (extract(epoch FROM c.created_at)*1000)::bigint AS created_ms,
            (extract(epoch FROM c.updated_at)*1000)::bigint AS updated_ms,
            lm.id AS last_id,lm.sender_id AS last_sender,
            (extract(epoch FROM lm.at)*1000)::bigint AS last_ms
         FROM conversations c
         JOIN conversation_members me ON me.conversation_id=c.id AND me.user_id=$1
         LEFT JOIN LATERAL (
            SELECT e.id,e.sender_id,COALESCE(e.client_sent_at,e.created_at) AS at FROM encrypted_messages e
            WHERE e.conversation_id=c.id AND NOT ($1=ANY(e.hidden_for))
              AND (me.history_cleared_at IS NULL OR e.created_at>me.history_cleared_at)
            ORDER BY e.sequence DESC LIMIT 1) lm ON true
         WHERE ($2::text IS NULL OR c.id=$2)
         ORDER BY COALESCE(lm.at,c.updated_at) DESC LIMIT 500",
    )
    .bind(uid)
    .bind(only)
    .fetch_all(&mut *connection)
    .await?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<String> = rows.iter().map(|r| r.get("id")).collect();
    let members = sqlx::query(
        "SELECT conversation_id,user_id,hidden,muted,show_pinned_meetup,unread,meetup_accepted,pinned,marked_unread,
            (extract(epoch FROM history_cleared_at)*1000)::bigint AS cleared_ms,
            (extract(epoch FROM read_at)*1000)::bigint AS read_ms
         FROM conversation_members WHERE conversation_id=ANY($1)",
    )
    .bind(&ids)
    .fetch_all(&mut *connection)
    .await?;
    let peers: Vec<String> = rows
        .iter()
        .flat_map(|r| {
            [
                r.get::<String, _>("member_a"),
                r.get::<String, _>("member_b"),
            ]
        })
        .collect();
    let profiles = sqlx::query(
        "SELECT a.id,a.deleted_at IS NOT NULL AS deleted,COALESCE(p.raw,'{}'::jsonb) AS raw,
            COALESCE(p.discoverable,false) AS discoverable,COALESCE(p.face_verified,false) AS face_verified
         FROM accounts a LEFT JOIN profiles p ON p.user_id=a.id WHERE a.id=ANY($1)",
    )
    .bind(&peers)
    .fetch_all(&mut *connection)
    .await?;
    let mut out = Vec::new();
    for row in &rows {
        let id: String = row.get("id");
        let participants = [
            row.get::<String, _>("member_a"),
            row.get::<String, _>("member_b"),
        ];
        let mut settings = Map::new();
        let mut unread = Map::new();
        let mut receipts = Map::new();
        let mut accepted = Vec::new();
        let mut cleared = Value::Null;
        for member in members
            .iter()
            .filter(|m| m.get::<String, _>("conversation_id") == id)
        {
            let user: String = member.get("user_id");
            unread.insert(user.clone(), json!(member.get::<i32, _>("unread")));
            receipts.insert(user.clone(), ms(member, "read_ms"));
            if member.get::<bool, _>("meetup_accepted") {
                accepted.push(user.clone());
            }
            if user == uid {
                cleared = ms(member, "cleared_ms");
                settings.insert(user.clone(), json!({
                    "isHidden": member.get::<bool,_>("hidden"), "isMuted": member.get::<bool,_>("muted"),
                    "showPinnedMeetup": member.get::<bool,_>("show_pinned_meetup"),
                    "isPinned": member.get::<bool,_>("pinned"),
                    "markedUnread": member.get::<bool,_>("marked_unread"),
                    "historyClearedAt": cleared,
                }));
            }
        }
        let mut profiles_json = Map::new();
        for participant in &participants {
            let found = profiles
                .iter()
                .find(|p| p.get::<String, _>("id") == *participant);
            profiles_json.insert(
                participant.clone(),
                conversation_profile(participant, found),
            );
        }
        let last_id: Option<String> = row.get("last_id");
        out.push(json!({
            "id": id, "participants": participants, "active": row.get::<bool,_>("active"),
            "participantProfiles": profiles_json, "participantSettings": settings,
            "unreadCounts": unread, "readReceipts": receipts, "meetupAcceptedUsers": accepted,
            "encryption": row.get::<Option<Value>,_>("encryption"),
            "encryptionRevision": row.get::<i64,_>("encryption_revision"),
            "lastMessage": ENCRYPTED_PREVIEW, "lastMessageId": last_id,
            "lastMessageSenderId": row.get::<Option<String>,_>("last_sender"),
            "lastMessageAt": ms(row, "last_ms"), "historyClearedAt": cleared,
            "createdAt": row.get::<i64,_>("created_ms"), "updatedAt": row.get::<i64,_>("updated_ms"),
        }));
    }
    Ok(out)
}

pub async fn list(state: &AppState, headers: &HeaderMap, _: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    crate::throttle(&state.db, "rooms-list", &user.uid, 120).await?;
    let mut connection = state.db.acquire().await?;
    Ok(json!({"conversations": rooms_json(&mut connection, &user.uid, None).await?}))
}

pub async fn get(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = room_arg(&data)?;
    let mut connection = state.db.acquire().await?;
    let room = rooms_json(&mut connection, &user.uid, Some(&id))
        .await?
        .into_iter()
        .next()
        .ok_or_else(chat::denied)?;
    Ok(json!({"conversation": room}))
}

/// Newest page (or the page before `beforeSequence`), oldest first. History
/// cleared by unmatch and messages the caller hid are not returned.
pub async fn messages(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = room_arg(&data)?;
    crate::throttle(&state.db, "room-messages", &user.uid, 240).await?;
    let before = data["beforeSequence"].as_i64().filter(|n| *n > 0);
    let limit = data["limit"].as_i64().unwrap_or(PAGE).clamp(1, 100);
    let mut tx = state.db.begin().await?;
    chat::member_room(&mut tx, &user.uid, headers, &id, false).await?;
    let cutoff: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        "SELECT history_cleared_at FROM conversation_members WHERE conversation_id=$1 AND user_id=$2",
    )
    .bind(&id)
    .bind(&user.uid)
    .fetch_optional(&mut *tx)
    .await?
    .flatten();
    let mut rows = sqlx::query(&format!(
        "SELECT {MESSAGE_COLUMNS} FROM encrypted_messages WHERE conversation_id=$1
         AND ($2::bigint IS NULL OR sequence<$2) AND ($3::timestamptz IS NULL OR created_at>$3)
         AND NOT ($4=ANY(hidden_for)) ORDER BY sequence DESC LIMIT $5"
    ))
    .bind(&id)
    .bind(before)
    .bind(cutoff)
    .bind(&user.uid)
    .bind(limit + 1)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    let has_more = rows.len() as i64 > limit;
    rows.truncate(limit as usize);
    let oldest = rows.last().map(|row| row.get::<i64, _>("sequence"));
    let mut messages: Vec<Value> = rows.iter().map(message_json).collect();
    messages.reverse();
    Ok(json!({"messages":messages,"hasMore":has_more,"beforeSequence":oldest}))
}

async fn after_send(
    tx: &mut PgConnection,
    room: &Room,
    id: &str,
    sender: &str,
    message_id: &str,
    system: bool,
) -> Result<(), ApiError> {
    let recipient = other(room, sender).to_owned();
    if !system {
        sqlx::query("UPDATE conversation_members SET unread=unread+1 WHERE conversation_id=$1 AND user_id=$2")
            .bind(id)
            .bind(&recipient)
            .execute(&mut *tx)
            .await?;
        let muted: bool = sqlx::query_scalar(
            "SELECT muted OR hidden FROM conversation_members WHERE conversation_id=$1 AND user_id=$2",
        )
        .bind(id)
        .bind(&recipient)
        .fetch_optional(&mut *tx)
        .await?
        .unwrap_or(false);
        let sender_profile: Value = sqlx::query_scalar("SELECT raw FROM profiles WHERE user_id=$1")
            .bind(sender)
            .fetch_optional(&mut *tx)
            .await?
            .unwrap_or(Value::Null);
        let mut notice = notify::message(&sender_profile, sender, id, message_id);
        notice.inbox_only = muted;
        notice.badge = Some(notify::unread_total(tx, &recipient).await?);
        notify::enqueue(
            tx,
            &recipient,
            &format!("message:{id}:{message_id}"),
            &notice,
        )
        .await?;
    }
    events::publish(tx, &[&room.a, &room.b], "messages", Some(id)).await?;
    events::publish(tx, &[&room.a, &room.b], "conversations", Some(id)).await
}

fn packet(data: &Value) -> Result<Value, ApiError> {
    chat::MessageRequest {
        encrypted: data["encrypted"] == true,
        encryption_version: data["encryptionVersion"].as_u64().unwrap_or(0).min(255) as u8,
        nonce: text(data, "nonce").unwrap_or_default().to_owned(),
        ciphertext: text(data, "ciphertext").unwrap_or_default().to_owned(),
    }
    .packet()
}

pub async fn send(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = room_arg(&data)?;
    let message_id = message_arg(&data, "messageId")?;
    let packet = packet(&data)?;
    let meta = message_meta(data.get("meta"))?;
    let system = meta["isSystem"] == true;
    crate::throttle(&state.db, "room-send", &user.uid, 120).await?;
    let mut tx = state.db.begin().await?;
    let room = chat::member_room(&mut tx, &user.uid, headers, &id, true).await?;
    let (message, duplicate) = chat::store_message(
        &mut tx,
        &room,
        &id,
        &user.uid,
        &message_id,
        packet,
        meta,
        data["clientSentAt"].as_i64(),
    )
    .await?;
    if !duplicate {
        after_send(&mut tx, &room, &id, &user.uid, &message_id, system).await?;
    }
    tx.commit().await?;
    Ok(json!({"message":message,"duplicate":duplicate,"created":!duplicate}))
}

pub async fn mark_read(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = room_arg(&data)?;
    crate::throttle(&state.db, "room-read-receipt", &user.uid, 240).await?;
    let mut tx = state.db.begin().await?;
    let room = chat::member_room(&mut tx, &user.uid, headers, &id, true).await?;
    sqlx::query("UPDATE conversation_members SET unread=0,marked_unread=false,read_at=now() WHERE conversation_id=$1 AND user_id=$2")
        .bind(&id)
        .bind(&user.uid)
        .execute(&mut *tx)
        .await?;
    events::publish(&mut tx, &[&room.a, &room.b], "conversations", Some(&id)).await?;
    tx.commit().await?;
    Ok(json!({"ok":true}))
}

pub async fn settings(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = room_arg(&data)?;
    let settings = data["settings"]
        .as_object()
        .filter(|s| !s.is_empty() && s.len() <= 6)
        .ok_or_else(|| ApiError::invalid("Invalid chat setting"))?;
    let mut hidden = None;
    let mut muted = None;
    let mut pinned = None;
    let mut clear = false;
    let mut inbox_pinned = None;
    let mut marked_unread = None;
    for (key, value) in settings {
        let value = value
            .as_bool()
            .ok_or_else(|| ApiError::invalid("Invalid chat setting"))?;
        match key.as_str() {
            "isHidden" => hidden = Some(value),
            "isMuted" => muted = Some(value),
            "showPinnedMeetup" => pinned = Some(value),
            "clearHistory" => clear = value,
            "isPinned" => inbox_pinned = Some(value),
            "markedUnread" => marked_unread = Some(value),
            _ => return Err(ApiError::invalid("Invalid chat setting")),
        }
    }
    let mut tx = state.db.begin().await?;
    chat::member_room(&mut tx, &user.uid, headers, &id, false).await?;
    sqlx::query("UPDATE conversation_members SET hidden=COALESCE($3,hidden),muted=COALESCE($4,muted),show_pinned_meetup=COALESCE($5,show_pinned_meetup),history_cleared_at=CASE WHEN $6 THEN now() ELSE history_cleared_at END,unread=CASE WHEN $6 THEN 0 ELSE unread END,pinned=COALESCE($7,pinned),marked_unread=CASE WHEN $6 THEN false ELSE COALESCE($8,marked_unread) END WHERE conversation_id=$1 AND user_id=$2")
        .bind(&id)
        .bind(&user.uid)
        .bind(hidden)
        .bind(muted)
        .bind(pinned)
        .bind(clear)
        .bind(inbox_pinned)
        .bind(marked_unread)
        .execute(&mut *tx)
        .await?;
    events::publish_one(&mut tx, &user.uid, "conversations", Some(&id)).await?;
    tx.commit().await?;
    Ok(json!({"ok":true}))
}

/// Re-opens the caller's view of an established room (legacy createConversation).
pub async fn open(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let peer = text(&data, "otherUserId")
        .filter(|id| chat::identifier(id, 128) && *id != user.uid)
        .ok_or_else(|| ApiError::invalid("ข้อมูลผู้ร่วมสนทนาไม่ถูกต้อง"))?;
    let (a, b) = if user.uid.as_str() < peer {
        (user.uid.as_str(), peer)
    } else {
        (peer, user.uid.as_str())
    };
    let mut tx = state.db.begin().await?;
    let id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM conversations WHERE member_a=$1 AND member_b=$2 AND active",
    )
    .bind(a)
    .bind(b)
    .fetch_optional(&mut *tx)
    .await?;
    let id = id.ok_or_else(|| ApiError::new("failed-precondition", "ยังไม่ได้จับคู่กับผู้ใช้นี้"))?;
    chat::member_room(&mut tx, &user.uid, headers, &id, false).await?;
    sqlx::query(
        "UPDATE conversation_members SET hidden=false WHERE conversation_id=$1 AND user_id=$2",
    )
    .bind(&id)
    .bind(&user.uid)
    .execute(&mut *tx)
    .await?;
    events::publish_one(&mut tx, &user.uid, "conversations", Some(&id)).await?;
    tx.commit().await?;
    Ok(json!({"conversationId":id}))
}

async fn locked_message(
    tx: &mut PgConnection,
    id: &str,
    message_id: &str,
) -> Result<Option<sqlx::postgres::PgRow>, ApiError> {
    Ok(sqlx::query("SELECT sender_id,reactions,reaction_times,hidden_for FROM encrypted_messages WHERE conversation_id=$1 AND id=$2 FOR UPDATE")
        .bind(id).bind(message_id).fetch_optional(tx).await?)
}

pub async fn unsend(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = room_arg(&data)?;
    let message_id = message_arg(&data, "messageId")?;
    let mut tx = state.db.begin().await?;
    let room = chat::member_room(&mut tx, &user.uid, headers, &id, true).await?;
    let Some(row) = locked_message(&mut tx, &id, &message_id).await? else {
        return Ok(json!({"removed":false}));
    };
    if row.get::<String, _>("sender_id") != user.uid {
        return Ok(json!({"removed":false}));
    }
    sqlx::query("DELETE FROM encrypted_messages WHERE conversation_id=$1 AND id=$2")
        .bind(&id)
        .bind(&message_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE conversations SET updated_at=now() WHERE id=$1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    events::publish(&mut tx, &[&room.a, &room.b], "messages", Some(&id)).await?;
    events::publish(&mut tx, &[&room.a, &room.b], "conversations", Some(&id)).await?;
    tx.commit().await?;
    Ok(json!({"removed":true}))
}

pub async fn react(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = room_arg(&data)?;
    let message_id = message_arg(&data, "messageId")?;
    let emoji: String = text(&data, "emoji")
        .unwrap_or_default()
        .trim()
        .chars()
        .take(16)
        .collect();
    if emoji.is_empty() && !data.get("desiredReaction").is_some_and(Value::is_null) {
        return Ok(json!({"changed":false}));
    }
    crate::throttle(&state.db, "room-react", &user.uid, 120).await?;
    let mut tx = state.db.begin().await?;
    let room = chat::member_room(&mut tx, &user.uid, headers, &id, true).await?;
    let Some(row) = locked_message(&mut tx, &id, &message_id).await? else {
        return Ok(json!({"changed":false}));
    };
    let mut reactions = row
        .get::<Value, _>("reactions")
        .as_object()
        .cloned()
        .unwrap_or_default();
    let mut times = row
        .get::<Value, _>("reaction_times")
        .as_object()
        .cloned()
        .unwrap_or_default();
    let current = reactions
        .get(&user.uid)
        .and_then(Value::as_str)
        .map(str::to_owned);
    let next = match data.get("desiredReaction") {
        Some(Value::Null) => None,
        Some(Value::String(value)) => {
            Some(value.trim().chars().take(16).collect::<String>()).filter(|v| !v.is_empty())
        }
        _ => {
            if current.as_deref() == Some(emoji.as_str()) {
                None
            } else {
                Some(emoji)
            }
        }
    };
    if current == next {
        tx.commit().await?;
        return Ok(json!({"changed":true}));
    }
    match &next {
        Some(value) => {
            reactions.insert(user.uid.clone(), json!(value));
            times.insert(
                user.uid.clone(),
                json!(chrono::Utc::now().timestamp_millis()),
            );
        }
        None => {
            reactions.remove(&user.uid);
            times.remove(&user.uid);
        }
    }
    sqlx::query("UPDATE encrypted_messages SET reactions=$3,reaction_times=$4,updated_at=now() WHERE conversation_id=$1 AND id=$2")
        .bind(&id).bind(&message_id).bind(Value::Object(reactions)).bind(Value::Object(times)).execute(&mut *tx).await?;
    events::publish(&mut tx, &[&room.a, &room.b], "messages", Some(&id)).await?;
    tx.commit().await?;
    Ok(json!({"changed":true}))
}

pub async fn hide_message(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = room_arg(&data)?;
    let message_id = message_arg(&data, "messageId")?;
    let mut tx = state.db.begin().await?;
    chat::member_room(&mut tx, &user.uid, headers, &id, true).await?;
    sqlx::query("UPDATE encrypted_messages SET hidden_for=array_append(hidden_for,$3::text),updated_at=now() WHERE conversation_id=$1 AND id=$2 AND NOT ($3::text=ANY(hidden_for))")
        .bind(&id).bind(&message_id).bind(&user.uid).execute(&mut *tx).await?;
    events::publish_one(&mut tx, &user.uid, "messages", Some(&id)).await?;
    tx.commit().await?;
    Ok(json!({"changed":true}))
}

/// Records that the caller opened protected media. `once` media (and any
/// `exclusive` claim) may be opened a single time; `replay` media records the
/// first view and stays viewable. The sender is never counted.
pub async fn record_view(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = room_arg(&data)?;
    let message_id = message_arg(&data, "messageId")?;
    let exclusive = data["exclusive"] == true;
    let mut tx = state.db.begin().await?;
    let room = chat::member_room(&mut tx, &user.uid, headers, &id, true).await?;
    let row = sqlx::query(
        "SELECT sender_id,meta FROM encrypted_messages WHERE conversation_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(&id)
    .bind(&message_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::new("failed-precondition", "สื่อนี้ไม่พร้อมใช้งาน"))?;
    let meta: Value = row.get("meta");
    let mode = meta["videoMode"]
        .as_str()
        .or_else(|| meta["viewMode"].as_str())
        .unwrap_or("chat");
    if !["once", "replay"].contains(&mode) {
        return Err(ApiError::new("failed-precondition", "สื่อนี้ไม่พร้อมใช้งาน"));
    }
    if row.get::<String, _>("sender_id") == user.uid {
        tx.commit().await?;
        return Ok(json!({"viewed":false}));
    }
    let views: Option<i32> = sqlx::query_scalar(
        "SELECT views FROM message_views WHERE conversation_id=$1 AND message_id=$2 AND viewer_id=$3",
    )
    .bind(&id)
    .bind(&message_id)
    .bind(&user.uid)
    .fetch_optional(&mut *tx)
    .await?;
    if views.is_some() {
        if exclusive || mode == "once" {
            return Err(ApiError::new("failed-precondition", "สื่อนี้ถูกเปิดดูแล้ว"));
        }
        tx.commit().await?;
        return Ok(json!({"viewed":true}));
    }
    sqlx::query(
        "INSERT INTO message_views(conversation_id,message_id,viewer_id,views) VALUES($1,$2,$3,1)",
    )
    .bind(&id)
    .bind(&message_id)
    .bind(&user.uid)
    .execute(&mut *tx)
    .await?;
    events::publish(&mut tx, &[&room.a, &room.b], "messages", Some(&id)).await?;
    tx.commit().await?;
    Ok(json!({"viewed":true}))
}

pub async fn view_state(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = room_arg(&data)?;
    let message_id = message_arg(&data, "messageId")?;
    let mut tx = state.db.begin().await?;
    chat::member_room(&mut tx, &user.uid, headers, &id, false).await?;
    let rows = sqlx::query(
        "SELECT viewer_id,views FROM message_views WHERE conversation_id=$1 AND message_id=$2",
    )
    .bind(&id)
    .bind(&message_id)
    .fetch_all(&mut *tx)
    .await?;
    let renditions = sqlx::query(
        "SELECT quality,data FROM message_renditions WHERE conversation_id=$1 AND message_id=$2",
    )
    .bind(&id)
    .bind(&message_id)
    .fetch_all(&mut *tx)
    .await?;
    let sender: Option<String> = sqlx::query_scalar(
        "SELECT sender_id FROM encrypted_messages WHERE conversation_id=$1 AND id=$2",
    )
    .bind(&id)
    .bind(&message_id)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    let views: Map<String, Value> = rows
        .iter()
        .map(|r| {
            (
                r.get::<String, _>("viewer_id"),
                json!(r.get::<i32, _>("views")),
            )
        })
        .collect();
    let renditions: Map<String, Value> = renditions
        .iter()
        .map(|r| (r.get::<String, _>("quality"), r.get::<Value, _>("data")))
        .collect();
    Ok(json!({"exists":sender.is_some(),"senderId":sender,"views":views,"renditions":renditions}))
}

/// The sender attaches an encrypted higher-quality rendition after upload.
/// The record is a client-encrypted message record; its media URL is inside
/// the ciphertext, so the server stores only bounded opaque fields.
pub async fn save_rendition(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = room_arg(&data)?;
    let message_id = message_arg(&data, "messageId")?;
    let quality = text(&data, "quality")
        .filter(|q| ["high", "medium"].contains(q))
        .ok_or_else(|| ApiError::invalid("คุณภาพวิดีโอไม่ถูกต้อง"))?;
    let rendition = data["rendition"]
        .as_object()
        .filter(|r| {
            r.get("encrypted") == Some(&Value::Bool(true))
                && r.get("nonce").is_some_and(|n| chat::b64(n, 24, 24))
                && r.get("ciphertext")
                    .is_some_and(|c| chat::b64(c, 17, 16 * 1024))
                && r.len() <= 12
                && r.iter().all(|(k, v)| {
                    k.len() <= 40
                        && (v.is_number()
                            || v.is_boolean()
                            || v.as_str().is_some_and(|s| s.len() <= 24 * 1024))
                })
        })
        .ok_or_else(|| ApiError::invalid("ข้อมูลวิดีโอไม่ถูกต้อง"))?;
    let mut tx = state.db.begin().await?;
    let room = chat::member_room(&mut tx, &user.uid, headers, &id, true).await?;
    let sender: Option<String> = sqlx::query_scalar(
        "SELECT sender_id FROM encrypted_messages WHERE conversation_id=$1 AND id=$2",
    )
    .bind(&id)
    .bind(&message_id)
    .fetch_optional(&mut *tx)
    .await?;
    if sender.as_deref() != Some(user.uid.as_str()) {
        return Err(chat::denied());
    }
    let mut stored = rendition.clone();
    stored.insert("id".into(), json!(message_id));
    stored.insert("senderId".into(), json!(user.uid));
    sqlx::query("INSERT INTO message_renditions(conversation_id,message_id,quality,data) VALUES($1,$2,$3,$4) ON CONFLICT(conversation_id,message_id,quality) DO UPDATE SET data=excluded.data")
        .bind(&id)
        .bind(&message_id)
        .bind(quality)
        .bind(Value::Object(stored))
        .execute(&mut *tx)
        .await?;
    events::publish(&mut tx, &[&room.a, &room.b], "messages", Some(&id)).await?;
    tx.commit().await?;
    Ok(json!({"ok":true}))
}

/// Bangkok wall-clock date/time from a meetup schedule.
pub fn scheduled_for(meetup: &Value) -> Option<i64> {
    let schedule = &meetup["schedule"];
    if let Some(ms) = schedule["scheduledFor"].as_i64() {
        return Some(ms);
    }
    let date = NaiveDate::parse_from_str(schedule["date"].as_str()?, "%Y-%m-%d").ok()?;
    let time =
        NaiveTime::parse_from_str(schedule["startTime"].as_str().unwrap_or("00:00"), "%H:%M")
            .unwrap_or(NaiveTime::MIN);
    let bangkok = FixedOffset::east_opt(7 * 3600)?;
    bangkok
        .from_local_datetime(&date.and_time(time))
        .single()
        .map(|at| at.timestamp_millis())
}

fn appointment_snapshot(meetup: &Value) -> Option<(Value, i64)> {
    let object = meetup.as_object()?;
    if serde_json::to_vec(meetup).ok()?.len() > 16_384 {
        return None;
    }
    object.get("schedule")?.get("date")?.as_str()?;
    let at = scheduled_for(meetup)?;
    let mut snapshot = meetup.clone();
    if snapshot["id"].as_str().is_none() {
        snapshot["id"] = json!("meetup-spot");
    }
    snapshot["schedule"]["scheduledFor"] = json!(at);
    Some((snapshot, at))
}

fn appointment_json(row: &sqlx::postgres::PgRow) -> Value {
    let host: String = row.get("host_id");
    let guest: String = row.get("guest_id");
    let mut participants = [host.clone(), guest.clone()];
    participants.sort();
    json!({
        "id": row.get::<String,_>("id"), "conversationId": row.get::<String,_>("conversation_id"),
        "participants": participants, "hostId": host, "guestId": guest,
        "meetup": row.get::<Value,_>("meetup"), "scheduledFor": ms(row, "scheduled_ms"),
        "status": row.get::<String,_>("status"), "cancelledBy": row.get::<Option<String>,_>("cancelled_by"),
        "cancelledAt": ms(row, "cancelled_ms"), "createdAt": ms(row, "created_ms"), "updatedAt": ms(row, "updated_ms"),
    })
}
const APPOINTMENT: &str = "id,conversation_id,host_id,guest_id,meetup,status,cancelled_by,
    (extract(epoch FROM scheduled_for)*1000)::bigint AS scheduled_ms,(extract(epoch FROM cancelled_at)*1000)::bigint AS cancelled_ms,
    (extract(epoch FROM created_at)*1000)::bigint AS created_ms,(extract(epoch FROM updated_at)*1000)::bigint AS updated_ms";

async fn appointment_changed(
    tx: &mut PgConnection,
    id: &str,
    users: [&str; 2],
    cancelled: bool,
) -> Result<(), ApiError> {
    let mut target = Map::new();
    target.insert("appointmentId".into(), json!(id));
    let notice = notify::system(
        "appointment",
        if cancelled {
            "นัดหมายถูกยกเลิก"
        } else {
            "มีนัดหมายใหม่"
        },
        "แตะเพื่อดูประวัติและรายละเอียดนัดหมาย",
        target,
    );
    let key = format!("appointment:{id}:{}", uuid::Uuid::new_v4());
    for user in users {
        notify::enqueue(tx, user, &key, &notice).await?;
    }
    events::publish(tx, &users, "appointments", Some(id)).await
}

pub async fn appointments(
    state: &AppState,
    headers: &HeaderMap,
    _: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let rows = sqlx::query(&format!("SELECT {APPOINTMENT} FROM appointments WHERE host_id=$1 OR guest_id=$1 ORDER BY scheduled_for DESC NULLS LAST LIMIT 300"))
        .bind(&user.uid).fetch_all(&state.db).await?;
    Ok(json!({"appointments": rows.iter().map(appointment_json).collect::<Vec<_>>()}))
}

pub async fn cancel_appointment(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let id = text(&data, "appointmentId")
        .filter(|id| !id.is_empty() && id.len() <= 400)
        .ok_or_else(|| ApiError::invalid("นัดหมายไม่ถูกต้อง"))?;
    let mut tx = state.db.begin().await?;
    auth::lock_business_session(&mut tx, headers, &user.uid).await?;
    let row = sqlx::query("UPDATE appointments SET status='cancelled',cancelled_by=$2,cancelled_at=now(),updated_at=now() WHERE id=$1 AND status='active' AND $2 IN (host_id,guest_id) RETURNING host_id,guest_id")
        .bind(id).bind(&user.uid).fetch_optional(&mut *tx).await?;
    let cancelled = row.is_some();
    if let Some(row) = row {
        let host: String = row.get("host_id");
        let guest: String = row.get("guest_id");
        appointment_changed(&mut tx, id, [&host, &guest], true).await?;
    }
    tx.commit().await?;
    Ok(json!({"cancelled":cancelled}))
}

async fn host_meetup(tx: &mut PgConnection, host: &str) -> Result<Option<(Value, i64)>, ApiError> {
    let meetup: Option<Value> =
        sqlx::query_scalar("SELECT raw->'meetup' FROM profiles WHERE user_id=$1")
            .bind(host)
            .fetch_optional(&mut *tx)
            .await?
            .flatten();
    Ok(meetup.as_ref().and_then(appointment_snapshot))
}

/// Accept or withdraw the host's meetup. The notice is client-encrypted; the
/// appointment snapshot comes from the host's saved profile, never the client.
pub async fn toggle_meetup(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let id = room_arg(&data)?;
    let message_id = message_arg(&data, "messageId")?;
    let packet = packet(&data)?;
    crate::throttle(&state.db, "room-meetup", &user.uid, 60).await?;
    let mut tx = state.db.begin().await?;
    let room = chat::member_room(&mut tx, &user.uid, headers, &id, true).await?;
    let requested_host = text(&data, "hostUserId").unwrap_or_default();
    let host = if room.members().contains(&requested_host) && requested_host != user.uid {
        requested_host.to_owned()
    } else {
        other(&room, &user.uid).to_owned()
    };
    let accepted: bool = sqlx::query_scalar("SELECT meetup_accepted FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 FOR UPDATE")
        .bind(&id).bind(&user.uid).fetch_one(&mut *tx).await?;
    let wanted = data["shouldAccept"].as_bool().unwrap_or(!accepted);
    if accepted != wanted {
        sqlx::query("UPDATE conversation_members SET meetup_accepted=$3 WHERE conversation_id=$1 AND user_id=$2")
            .bind(&id).bind(&user.uid).bind(wanted).execute(&mut *tx).await?;
        let (_, duplicate) = chat::store_message(
            &mut tx,
            &room,
            &id,
            &user.uid,
            &message_id,
            packet,
            json!({"isSystem":true}),
            data["clientSentAt"].as_i64(),
        )
        .await?;
        if !duplicate {
            after_send(&mut tx, &room, &id, &user.uid, &message_id, true).await?;
        }
    }
    let appointment_id = format!("a-{id}-{host}");
    let existing = sqlx::query("SELECT status FROM appointments WHERE id=$1 FOR UPDATE")
        .bind(&appointment_id)
        .fetch_optional(&mut *tx)
        .await?;
    if wanted {
        match existing {
            Some(row) if row.get::<String, _>("status") != "active" => {
                sqlx::query("UPDATE appointments SET status='active',cancelled_by=NULL,cancelled_at=NULL,updated_at=now() WHERE id=$1")
                    .bind(&appointment_id).execute(&mut *tx).await?;
                appointment_changed(&mut tx, &appointment_id, [&host, &user.uid], false).await?;
            }
            Some(_) => {}
            None => {
                if let Some((meetup, at)) = host_meetup(&mut tx, &host).await? {
                    sqlx::query("INSERT INTO appointments(id,conversation_id,host_id,guest_id,meetup,scheduled_for) VALUES($1,$2,$3,$4,$5,to_timestamp($6::double precision/1000))")
                        .bind(&appointment_id).bind(&id).bind(&host).bind(&user.uid).bind(meetup).bind(at).execute(&mut *tx).await?;
                    appointment_changed(&mut tx, &appointment_id, [&host, &user.uid], false)
                        .await?;
                }
            }
        }
    } else if existing.is_some_and(|row| row.get::<String, _>("status") == "active") {
        sqlx::query("UPDATE appointments SET status='cancelled',cancelled_by=$2,cancelled_at=now(),updated_at=now() WHERE id=$1")
            .bind(&appointment_id).bind(&user.uid).execute(&mut *tx).await?;
        appointment_changed(&mut tx, &appointment_id, [&host, &user.uid], true).await?;
    }
    events::publish(&mut tx, &[&room.a, &room.b], "conversations", Some(&id)).await?;
    tx.commit().await?;
    Ok(json!({"accepted":wanted}))
}

/// Repairs an acceptance saved before appointment history existed (guest only).
pub async fn ensure_appointment(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let id = room_arg(&data)?;
    let mut tx = state.db.begin().await?;
    let room = chat::member_room(&mut tx, &user.uid, headers, &id, true).await?;
    let requested_host = text(&data, "hostUserId").unwrap_or_default();
    let host = if room.members().contains(&requested_host) && requested_host != user.uid {
        requested_host.to_owned()
    } else {
        other(&room, &user.uid).to_owned()
    };
    let accepted: bool = sqlx::query_scalar(
        "SELECT meetup_accepted FROM conversation_members WHERE conversation_id=$1 AND user_id=$2",
    )
    .bind(&id)
    .bind(&user.uid)
    .fetch_one(&mut *tx)
    .await?;
    let appointment_id = format!("a-{id}-{host}");
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM appointments WHERE id=$1)")
        .bind(&appointment_id)
        .fetch_one(&mut *tx)
        .await?;
    let mut created = false;
    if accepted && !exists {
        if let Some((meetup, at)) = host_meetup(&mut tx, &host).await? {
            sqlx::query("INSERT INTO appointments(id,conversation_id,host_id,guest_id,meetup,scheduled_for) VALUES($1,$2,$3,$4,$5,to_timestamp($6::double precision/1000)) ON CONFLICT DO NOTHING")
                .bind(&appointment_id).bind(&id).bind(&host).bind(&user.uid).bind(meetup).bind(at).execute(&mut *tx).await?;
            appointment_changed(&mut tx, &appointment_id, [&host, &user.uid], false).await?;
            created = true;
        }
    }
    tx.commit().await?;
    Ok(json!({"created":created}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_allowlist_rejects_text_and_unknown_fields() {
        assert!(message_meta(Some(&json!({"videoMode":"once","videoDuration":1000}))).is_ok());
        assert!(message_meta(Some(&json!({"isSystem":true,"forwarded":true,"forwardedFrom":{"conversationId":"c-1","messageId":"m-1"}}))).is_ok());
        for bad in [
            json!({"text":"hello"}),
            json!({"preview":"hello"}),
            json!({"videoDuration":120000}),
            json!({"isSystem":false}),
            json!({"forwardedFrom":{"conversationId":"c 1","messageId":"m"}}),
            json!("string"),
        ] {
            assert!(message_meta(Some(&bad)).is_err(), "{bad}");
        }
        assert_eq!(message_meta(None).unwrap(), json!({}));
    }

    #[test]
    fn meetup_dates_are_bangkok_wall_clock() {
        let at =
            scheduled_for(&json!({"schedule":{"date":"2026-10-13","startTime":"09:30"}})).unwrap();
        assert_eq!(at, 1_791_858_600_000);
        assert!(scheduled_for(&json!({"schedule":{"date":"13/10/2026"}})).is_none());
        let (snapshot, _) =
            appointment_snapshot(&json!({"name":"Library","schedule":{"date":"2026-10-13"}}))
                .unwrap();
        assert_eq!(snapshot["id"], "meetup-spot");
        assert!(snapshot["schedule"]["scheduledFor"].is_i64());
    }
}
