//! In-app inbox, push registrations and the transactional push outbox.
//!
//! Callers enqueue inside the transaction that created the event (a like, a
//! match, a message), so a rolled-back write never notifies anyone and a
//! retried request cannot notify twice (`dedupe_key`).
use std::time::Duration;

use axum::http::HeaderMap;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, PgPool, Row};
use uuid::Uuid;

use crate::{auth, error::ApiError, events, AppState};

pub const INBOX_DAYS: i64 = 90;
pub const EXPO_PROJECT_ID: &str = "5ca64c3a-3182-460f-87f6-2342aaba4e2f";
pub const ANDROID_MESSAGING_MODE: &str = "android-messaging-style-v1";
const MAX_TOKENS_PER_USER: i64 = 10;
const ENCRYPTED_BODY: &str = "คุณมีข้อความใหม่ แตะเพื่อเปิดแชต";

pub fn inbox_id(key: &str, uid: &str) -> String {
    hex::encode(Sha256::digest(format!("{key}:{uid}").as_bytes()))
}

fn clean(value: &str, max: usize) -> String {
    value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max)
        .collect()
}

pub fn profile_name(profile: &Value) -> String {
    let raw = profile["nickname"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| profile["name"].as_str())
        .unwrap_or("เพื่อนใหม่");
    let name = clean(raw, 80);
    if name.is_empty() {
        "เพื่อนใหม่".into()
    } else {
        name
    }
}

pub fn profile_avatar(profile: &Value) -> Option<String> {
    profile["avatarUri"]
        .as_str()
        .filter(|uri| uri.starts_with("https://") && uri.len() <= 2048)
        .map(str::to_owned)
}

/// Notification as built by the legacy `notificationLogic.js`.
#[derive(Clone, Debug)]
pub struct Notice {
    pub title: String,
    pub body: String,
    pub channel: &'static str,
    pub thread: Option<String>,
    pub avatar: Option<String>,
    pub data: Map<String, Value>,
    pub badge: Option<i64>,
    pub inbox_only: bool,
    pub high_priority_call: bool,
}

impl Notice {
    fn new(title: impl Into<String>, body: impl Into<String>, channel: &'static str) -> Self {
        Self {
            title: title.into(),
            body: body.into(),
            channel,
            thread: None,
            avatar: None,
            data: Map::new(),
            badge: None,
            inbox_only: false,
            high_priority_call: false,
        }
    }
    fn kind(&self) -> &str {
        self.data
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("system")
    }
}

/// Likes stay private: the recipient sees a count, never who liked them.
pub fn private_like() -> Notice {
    let mut notice = Notice::new("มีคนกดใจคุณ", "เปิด CampusMate เพื่อดูจำนวนคนที่ถูกใจคุณ", "social");
    notice.data.insert("type".into(), json!("like"));
    notice.data.insert("url".into(), json!("/likes"));
    notice
}

pub fn matched(other: &Value, conversation_id: &str) -> Notice {
    let name = profile_name(other);
    let avatar = profile_avatar(other);
    let mut notice = Notice::new(
        "แมตช์ใหม่! 🎉",
        format!("คุณกับ {name} แมตช์กันแล้ว เริ่มคุยกันได้เลย"),
        "social",
    );
    notice.avatar = avatar.clone();
    notice.data.insert("type".into(), json!("match"));
    notice
        .data
        .insert("conversationId".into(), json!(conversation_id));
    if let Some(avatar) = avatar {
        notice.data.insert("avatarUri".into(), json!(avatar));
    }
    notice.data.insert(
        "url".into(),
        json!(format!(
            "/chat-room?chatId={}",
            url_component(conversation_id)
        )),
    );
    notice
}

/// Encrypted messages never carry a preview or media URL.
pub fn message(sender: &Value, sender_id: &str, conversation_id: &str, message_id: &str) -> Notice {
    let name = profile_name(sender);
    let avatar = profile_avatar(sender);
    let mut notice = Notice::new(name.clone(), "ข้อความที่เข้ารหัส", "messages");
    notice.thread = Some(conversation_id.into());
    notice.avatar = avatar.clone();
    for (key, value) in [
        ("type", json!("message")),
        ("conversationId", json!(conversation_id)),
        ("messageId", json!(message_id)),
        ("senderId", json!(sender_id)),
        ("senderName", json!(name)),
        (
            "url",
            json!(format!(
                "/chat-room?chatId={}",
                url_component(conversation_id)
            )),
        ),
    ] {
        notice.data.insert(key.into(), value);
    }
    if let Some(avatar) = avatar {
        notice.data.insert("avatarUri".into(), json!(avatar));
    }
    notice
}

pub fn group_message(party_id: &str, message_id: &str, kind: &str) -> Notice {
    let mut notice = Notice::new(
        "ข้อความใหม่ในแชตกลุ่ม",
        match kind {
            "image" => "มีรูปภาพใหม่",
            "gif" => "มี GIF ใหม่",
            "audio" => "มีข้อความเสียงใหม่",
            "track" => "มีเพลงใหม่",
            _ => "มีข้อความใหม่",
        },
        "messages",
    );
    notice.thread = Some(format!("group-{party_id}"));
    notice.data.insert("type".into(), json!("group_message"));
    notice.data.insert("partyId".into(), json!(party_id));
    notice.data.insert("messageId".into(), json!(message_id));
    notice
}

pub fn incoming_call(
    caller: &Value,
    call_id: &str,
    caller_id: &str,
    call_type: &str,
    conversation_id: &str,
) -> Notice {
    let name = profile_name(caller);
    let avatar = profile_avatar(caller);
    let voice = call_type == "voice";
    let mut notice = Notice::new(
        if voice {
            "สายเรียกเข้า (โทรด้วยเสียง) 📞"
        } else {
            "สายเรียกเข้า (วิดีโอคอล) 📹"
        },
        format!("{name} กำลังโทรหาคุณ..."),
        "calls",
    );
    notice.avatar = avatar.clone();
    notice.high_priority_call = true;
    notice.inbox_only = false;
    for (key, value) in [
        ("type", json!("incoming_call")),
        ("callId", json!(call_id)),
        ("callerId", json!(caller_id)),
        ("callerName", json!(name)),
        ("callerAvatar", json!(avatar.unwrap_or_default())),
        ("callType", json!(if voice { "voice" } else { "video" })),
        ("conversationId", json!(conversation_id)),
        (
            "url",
            json!(if conversation_id.is_empty() {
                "/".to_string()
            } else {
                format!("/chat-room?chatId={}", url_component(conversation_id))
            }),
        ),
    ] {
        notice.data.insert(key.into(), value);
    }
    notice
}

pub fn system(kind: &str, title: &str, body: &str, target: Map<String, Value>) -> Notice {
    let mut notice = Notice::new(
        clean(title, 180),
        body.chars().take(2000).collect::<String>(),
        "social",
    );
    notice.data.insert("type".into(), json!(kind));
    for (key, value) in target {
        notice.data.insert(key, value);
    }
    notice
}

fn url_component(value: &str) -> String {
    value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

/// Inbox row and push job for one recipient. Calls are push-only (they
/// expire in 45 seconds and would clutter the inbox).
pub async fn enqueue(
    connection: &mut PgConnection,
    user: &str,
    key: &str,
    notice: &Notice,
) -> Result<(), ApiError> {
    let mut data = notice.data.clone();
    let kind = notice.kind().to_owned();
    if kind != "incoming_call" {
        let id = inbox_id(key, user);
        let mut target = Map::new();
        for field in [
            "conversationId",
            "messageId",
            "partyId",
            "appointmentId",
            "route",
        ] {
            if let Some(value) = data.get(field).and_then(Value::as_str) {
                target.insert(
                    field.into(),
                    json!(value.chars().take(200).collect::<String>()),
                );
            }
        }
        let body = if matches!(kind.as_str(), "message" | "group_message") {
            ENCRYPTED_BODY.to_string()
        } else {
            notice.body.chars().take(2000).collect()
        };
        sqlx::query(
            "INSERT INTO notifications(user_id,id,type,title,body,target,expires_at)
             VALUES($1,$2,$3,$4,$5,$6,now()+make_interval(days=>$7)) ON CONFLICT DO NOTHING",
        )
        .bind(user)
        .bind(&id)
        .bind(kind.chars().take(60).collect::<String>())
        .bind(notice.title.chars().take(180).collect::<String>())
        .bind(body)
        .bind(Value::Object(target))
        .bind(INBOX_DAYS as i32)
        .execute(&mut *connection)
        .await?;
        data.insert("notificationId".into(), json!(id));
        events::publish_one(connection, user, "notifications", None).await?;
    }
    if notice.inbox_only {
        return Ok(());
    }
    let payload = json!({
        "title": notice.title, "body": notice.body, "channelId": notice.channel,
        "threadId": notice.thread, "avatarUri": notice.avatar, "badge": notice.badge,
        "call": notice.high_priority_call, "data": data,
    });
    sqlx::query(
        "INSERT INTO push_outbox(user_id,dedupe_key,payload) VALUES($1,$2,$3)
         ON CONFLICT(user_id,dedupe_key) DO NOTHING",
    )
    .bind(user)
    .bind(key.chars().take(300).collect::<String>())
    .bind(payload)
    .execute(connection)
    .await?;
    Ok(())
}

/// Badge for a new message: the recipient's unread total across rooms.
pub async fn unread_total(connection: &mut PgConnection, user: &str) -> Result<i64, ApiError> {
    Ok(sqlx::query_scalar(
        "SELECT COALESCE(sum(unread),0)::bigint FROM conversation_members WHERE user_id=$1 AND NOT hidden",
    )
    .bind(user)
    .fetch_one(connection)
    .await?)
}

/// One Expo push message for a registration, mirroring `pushMessage.js`.
pub fn expo_message(token: &str, platform: &str, mode: &str, payload: &Value, now_s: i64) -> Value {
    let data = payload["data"].as_object().cloned().unwrap_or_default();
    let is_message = data.get("type").and_then(Value::as_str) == Some("message");
    let messaging_style = platform == "android" && mode == ANDROID_MESSAGING_MODE && is_message;
    let mut wire = Map::new();
    let stringify = |value: &Value| match value {
        Value::String(s) => Some(s.clone()),
        Value::Null => None,
        other => Some(other.to_string()),
    };
    for (key, value) in &data {
        if let Some(text) = stringify(value).filter(|s| !s.is_empty()) {
            wire.insert(key.clone(), json!(text));
        }
    }
    if messaging_style {
        for (key, source) in [
            ("notificationTitle", "title"),
            ("notificationBody", "body"),
            ("notificationChannelId", "channelId"),
            ("notificationThreadId", "threadId"),
            ("notificationAvatarUri", "avatarUri"),
            ("notificationBadge", "badge"),
        ] {
            if let Some(text) = stringify(&payload[source]).filter(|s| !s.is_empty()) {
                wire.insert(key.into(), json!(text));
            }
        }
    }
    let mut message = json!({
        "to": token, "priority": "high", "data": wire, "sound": "default",
        "title": payload["title"], "body": payload["body"], "channelId": payload["channelId"],
    });
    if let Some(thread) = payload["threadId"].as_str() {
        message["threadId"] = json!(thread);
        if messaging_style {
            message["collapseId"] = json!(thread);
        }
    }
    if messaging_style {
        message["contentAvailable"] = json!(true);
        message["ttl"] = json!(3600);
    }
    if payload["call"] == true {
        message["ttl"] = json!(45);
        message["expiration"] = json!(now_s + 45);
        message["_displayInForeground"] = json!(true);
    }
    if let Some(badge) = payload["badge"].as_i64() {
        message["badge"] = json!(badge);
    }
    if platform == "android" {
        if let Some(image) = payload["avatarUri"].as_str() {
            message["richContent"] = json!({"image": image});
        }
    }
    message
}

pub fn valid_expo_token(token: &str) -> bool {
    let inner = token
        .strip_prefix("ExponentPushToken[")
        .or_else(|| token.strip_prefix("ExpoPushToken["))
        .and_then(|rest| rest.strip_suffix(']'));
    inner.is_some_and(|value| {
        !value.is_empty()
            && value.len() <= 256
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    })
}

fn text(data: &Value, key: &str, max: usize) -> String {
    data[key]
        .as_str()
        .map(|s| s.trim().chars().take(max).collect())
        .unwrap_or_default()
}

pub async fn register_push_token(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let token = text(&data, "expoPushToken", 300);
    let project = text(&data, "projectId", 100);
    let platform = text(&data, "platform", 20);
    if !valid_expo_token(&token) {
        return Err(ApiError::invalid("Expo push token ไม่ถูกต้อง"));
    }
    if project != EXPO_PROJECT_ID || !["android", "ios"].contains(&platform.as_str()) {
        return Err(ApiError::invalid(
            "Push notification project หรือ platform ไม่ถูกต้อง",
        ));
    }
    crate::throttle(&state.db, "push-register", &user.uid, 20).await?;
    let digest = Sha256::digest(token.as_bytes()).to_vec();
    let mut tx = state.db.begin().await?;
    auth::lock_business_session(&mut tx, headers, &user.uid).await?;
    let owner: Option<String> =
        sqlx::query_scalar("SELECT user_id FROM push_tokens WHERE token_hash=$1 FOR UPDATE")
            .bind(&digest)
            .fetch_optional(&mut *tx)
            .await?;
    match owner {
        // A leaked token must not move between accounts; the old account's
        // sign-out path releases it first.
        Some(owner) if owner != user.uid => {
            return Err(ApiError::new(
                "permission-denied",
                "Push token is already registered",
            ))
        }
        Some(_) => {}
        None => {
            let count: i64 =
                sqlx::query_scalar("SELECT count(*) FROM push_tokens WHERE user_id=$1 AND enabled")
                    .bind(&user.uid)
                    .fetch_one(&mut *tx)
                    .await?;
            if count >= MAX_TOKENS_PER_USER {
                return Err(ApiError::new(
                    "resource-exhausted",
                    "อุปกรณ์สำหรับการแจ้งเตือนมีจำนวนสูงสุดแล้ว",
                ));
            }
        }
    }
    sqlx::query(
        "INSERT INTO push_tokens(token_hash,user_id,token,platform,app_version,notification_mode)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(token_hash) DO UPDATE SET platform=excluded.platform,
         app_version=excluded.app_version,notification_mode=excluded.notification_mode,enabled=true,updated_at=now()",
    )
    .bind(&digest)
    .bind(&user.uid)
    .bind(&token)
    .bind(&platform)
    .bind(text(&data, "appVersion", 50))
    .bind(text(&data, "notificationMode", 80))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(json!({"registered":true}))
}

/// Works for unverified accounts too, so a signed-out device is released.
pub async fn unregister_push_token(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let token = text(&data, "expoPushToken", 300);
    if !valid_expo_token(&token) {
        return Ok(json!({"unregistered":false}));
    }
    let removed = sqlx::query("DELETE FROM push_tokens WHERE token_hash=$1 AND user_id=$2")
        .bind(Sha256::digest(token.as_bytes()).to_vec())
        .bind(&user.uid)
        .execute(&state.db)
        .await?
        .rows_affected();
    Ok(json!({"unregistered":removed>0}))
}

fn expected_uid(data: &Value, uid: &str) -> Result<(), ApiError> {
    if let Some(expected) = data["expectedUid"].as_str() {
        if expected != uid {
            return Err(ApiError::new("permission-denied", "บัญชีเปลี่ยนแล้ว"));
        }
    }
    Ok(())
}

/// Keeps the face-verification reminder in step with the account's badge.
pub async fn sync_face_inbox(connection: &mut PgConnection, uid: &str) -> Result<(), ApiError> {
    let verified: Option<bool> =
        sqlx::query_scalar("SELECT face_verified FROM profiles WHERE user_id=$1")
            .bind(uid)
            .fetch_optional(&mut *connection)
            .await?;
    let Some(verified) = verified else {
        return Ok(());
    };
    let current: Option<Option<String>> = sqlx::query_scalar(
        "SELECT status FROM notifications WHERE user_id=$1 AND id='face-verification' FOR UPDATE",
    )
    .bind(uid)
    .fetch_optional(&mut *connection)
    .await?;
    let wanted = if verified { "completed" } else { "required" };
    match current {
        None if verified => return Ok(()),
        None => {
            sqlx::query("INSERT INTO notifications(user_id,id,type,title,body,status) VALUES($1,'face-verification','face_verification',$2,$3,'required') ON CONFLICT DO NOTHING")
                .bind(uid)
                .bind("ยืนยันใบหน้าเพื่อเปิดโปรไฟล์")
                .bind("โปรไฟล์ของคุณจะแสดงให้คนอื่นเห็นหลังยืนยันใบหน้า เตรียมอยู่ในที่สว่างและทำตามคำแนะนำบนหน้าจอ ระหว่างนี้คุณยังคุยกับเพื่อนที่จับคู่ไว้แล้วได้")
                .execute(&mut *connection)
                .await?;
        }
        Some(status) if status.as_deref() == Some(wanted) => return Ok(()),
        Some(_) => {
            let (title, body) = if verified {
                (
                    "ยืนยันใบหน้าสำเร็จแล้ว",
                    "คุณยืนยันใบหน้าแล้ว โปรไฟล์พร้อมแสดงตามการตั้งค่าความเป็นส่วนตัวของคุณ",
                )
            } else {
                (
                    "ยืนยันใบหน้าเพื่อเปิดโปรไฟล์",
                    "ยืนยันใบหน้าอีกครั้งเพื่อให้โปรไฟล์ของคุณแสดงให้คนอื่นเห็น",
                )
            };
            sqlx::query("UPDATE notifications SET status=$2,title=$3,body=$4,read_at=CASE WHEN $5 THEN read_at ELSE NULL END,expires_at=CASE WHEN $5 THEN now()+make_interval(days=>$6) ELSE NULL END WHERE user_id=$1 AND id='face-verification'")
                .bind(uid)
                .bind(wanted)
                .bind(title)
                .bind(body)
                .bind(verified)
                .bind(INBOX_DAYS as i32)
                .execute(&mut *connection)
                .await?;
        }
    }
    events::publish_one(connection, uid, "notifications", None).await
}

pub async fn ensure_inbox(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    expected_uid(&data, &user.uid)?;
    let mut tx = state.db.begin().await?;
    sync_face_inbox(&mut tx, &user.uid).await?;
    tx.commit().await?;
    Ok(json!({"ok":true}))
}

pub async fn mark_all_read(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    expected_uid(&data, &user.uid)?;
    let mut tx = state.db.begin().await?;
    let count = sqlx::query(
        "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND created_at<=now()",
    )
    .bind(&user.uid)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    events::publish_one(&mut tx, &user.uid, "notifications", None).await?;
    tx.commit().await?;
    Ok(json!({"count":count}))
}

fn row_json(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.get::<String,_>("id"), "type": row.get::<String,_>("type"),
        "title": row.get::<String,_>("title"), "body": row.get::<String,_>("body"),
        "target": row.get::<Value,_>("target"), "status": row.get::<Option<String>,_>("status"),
        "readAt": row.get::<Option<i64>,_>("read_ms"), "createdAt": row.get::<i64,_>("created_ms"),
        "expiresAt": row.get::<Option<i64>,_>("expires_ms"),
    })
}

const ROW: &str = "id,type,title,body,target,status,(extract(epoch FROM read_at)*1000)::bigint AS read_ms,(extract(epoch FROM created_at)*1000)::bigint AS created_ms,(extract(epoch FROM expires_at)*1000)::bigint AS expires_ms";

/// Inbox page (newest first), unread count and the face reminder row.
pub async fn list_notifications(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let limit = data["limit"].as_i64().unwrap_or(30).clamp(1, 50);
    let before = data["before"].as_object();
    let (before_ms, before_id) = match before {
        Some(cursor) => (
            cursor.get("createdAt").and_then(Value::as_i64),
            cursor
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| id.len() <= 128)
                .map(str::to_owned),
        ),
        None => (None, None),
    };
    let rows = sqlx::query(&format!(
        "SELECT {ROW} FROM notifications WHERE user_id=$1 AND id<>'face-verification'
         AND (expires_at IS NULL OR expires_at>now())
         AND ($2::bigint IS NULL OR (created_at,id)<(to_timestamp($2::double precision/1000),$3))
         ORDER BY created_at DESC,id DESC LIMIT $4"
    ))
    .bind(&user.uid)
    .bind(before_ms)
    .bind(before_id.unwrap_or_default())
    .bind(limit + 1)
    .fetch_all(&state.db)
    .await?;
    let has_more = rows.len() as i64 > limit;
    let items: Vec<Value> = rows.iter().take(limit as usize).map(row_json).collect();
    let unread: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notifications WHERE user_id=$1 AND read_at IS NULL AND (expires_at IS NULL OR expires_at>now())",
    )
    .bind(&user.uid)
    .fetch_one(&state.db)
    .await?;
    let face = sqlx::query(&format!(
        "SELECT {ROW} FROM notifications WHERE user_id=$1 AND id='face-verification'"
    ))
    .bind(&user.uid)
    .fetch_optional(&state.db)
    .await?;
    Ok(
        json!({"notifications":items,"hasMore":has_more,"unreadCount":unread,"face":face.as_ref().map(row_json)}),
    )
}

pub async fn mark_read(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let id = data["id"]
        .as_str()
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
        .ok_or_else(|| ApiError::invalid("การแจ้งเตือนไม่ถูกต้อง"))?;
    let mut tx = state.db.begin().await?;
    let updated = sqlx::query(
        "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id=$2 AND read_at IS NULL",
    )
    .bind(&user.uid)
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if updated > 0 {
        events::publish_one(&mut tx, &user.uid, "notifications", None).await?;
    }
    tx.commit().await?;
    Ok(json!({"ok":true}))
}

/// Push delivery worker: claims queued jobs with a lease, sends one batch to
/// Expo per job, stores tickets for the receipt sweep, and disables tokens
/// Expo reports as no longer registered.
pub struct PushSender {
    http: reqwest::Client,
    access_token: Option<String>,
    send_url: String,
    receipts_url: String,
}

impl PushSender {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            access_token: std::env::var("EXPO_ACCESS_TOKEN")
                .ok()
                .filter(|t| !t.is_empty()),
            send_url: "https://exp.host/--/api/v2/push/send".into(),
            receipts_url: "https://exp.host/--/api/v2/push/getReceipts".into(),
        })
    }

    async fn post(&self, url: &str, body: &Value) -> Result<Value, &'static str> {
        let mut request = self.http.post(url).json(body);
        if let Some(token) = &self.access_token {
            request = request.bearer_auth(token);
        }
        let response = request.send().await.map_err(|_| "network")?;
        if response.status().as_u16() == 429 || response.status().is_server_error() {
            return Err("provider-unavailable");
        }
        if !response.status().is_success() {
            return Err("provider-rejected");
        }
        let bytes = response.bytes().await.map_err(|_| "network")?;
        if bytes.len() > 1_000_000 {
            return Err("response-too-large");
        }
        let data: Value = serde_json::from_slice(&bytes).map_err(|_| "invalid-response")?;
        if data
            .get("errors")
            .is_some_and(|errors| !errors.is_null() && errors != &json!([]))
        {
            return Err("provider-rejected");
        }
        Ok(data)
    }

    async fn send(&self, messages: &[Value]) -> Result<Vec<Value>, &'static str> {
        let response = self.post(&self.send_url, &json!(messages)).await?;
        let tickets = response["data"].as_array().ok_or("invalid-response")?;
        if tickets.len() != messages.len()
            || tickets
                .iter()
                .any(|ticket| match ticket["status"].as_str() {
                    Some("ok") => !ticket["id"].as_str().is_some_and(|id| !id.is_empty()),
                    Some("error") => !ticket["details"]["error"]
                        .as_str()
                        .is_some_and(|code| !code.is_empty()),
                    _ => true,
                })
        {
            return Err("invalid-response");
        }
        Ok(tickets.clone())
    }
}

pub async fn deliver_once(pool: &PgPool, sender: &PushSender) -> Result<bool, sqlx::Error> {
    let lease = Uuid::new_v4();
    sqlx::query("UPDATE push_outbox SET finished_at=now(),last_error_code='attempt-limit',lease_id=NULL,locked_until=NULL WHERE finished_at IS NULL AND sent_at IS NULL AND attempts>=6 AND (locked_until IS NULL OR locked_until<now())")
        .execute(pool).await?;
    // Stale jobs (for example an expired call) are not worth sending.
    sqlx::query("UPDATE push_outbox SET finished_at=now(),last_error_code='stale' WHERE finished_at IS NULL AND sent_at IS NULL AND (created_at<now()-interval '1 hour' OR (payload->>'call'='true' AND created_at<now()-interval '45 seconds'))")
        .execute(pool).await?;
    let job = sqlx::query(
        "WITH c AS (SELECT id FROM push_outbox WHERE finished_at IS NULL AND sent_at IS NULL AND attempts<6
           AND next_attempt_at<=now() AND (locked_until IS NULL OR locked_until<now())
           ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1)
         UPDATE push_outbox p SET lease_id=$1,locked_until=now()+interval '60 seconds',attempts=p.attempts+1
         FROM c WHERE p.id=c.id RETURNING p.id,p.user_id,p.payload,p.attempts",
    )
    .bind(lease)
    .fetch_optional(pool)
    .await?;
    let Some(job) = job else { return Ok(false) };
    let id: Uuid = job.get("id");
    let user: String = job.get("user_id");
    let payload: Value = job.get("payload");
    let attempts: i32 = job.get("attempts");
    // Respect the account state and the owner's notification switch at send time.
    let allowed: Option<bool> = sqlx::query_scalar(
        "SELECT NOT a.suspended AND a.deleted_at IS NULL AND COALESCE((s.settings#>>'{notifications,push}')::boolean,(p.raw->>'notificationsEnabled')::boolean,true)
         AND ($2 <> 'admin_announcement' OR COALESCE((s.settings#>>'{notifications,team}')::boolean,true))
         FROM accounts a LEFT JOIN profiles p ON p.user_id=a.id LEFT JOIN user_app_settings s ON s.user_id=a.id WHERE a.id=$1",
    )
    .bind(&user)
    .bind(payload.get("type").or_else(|| payload.get("data").and_then(|data| data.get("type"))).and_then(Value::as_str).unwrap_or_default())
    .fetch_optional(pool)
    .await?;
    let registrations = if allowed == Some(true) {
        sqlx::query("SELECT token_hash,token,platform,notification_mode FROM push_tokens WHERE user_id=$1 AND enabled LIMIT 10")
            .bind(&user).fetch_all(pool).await?
    } else {
        Vec::new()
    };
    if registrations.is_empty() {
        sqlx::query("UPDATE push_outbox SET finished_at=now(),last_error_code='no-devices',lease_id=NULL,locked_until=NULL WHERE id=$1 AND lease_id=$2")
            .bind(id).bind(lease).execute(pool).await?;
        return Ok(true);
    }
    let now = chrono::Utc::now().timestamp();
    let messages: Vec<Value> = registrations
        .iter()
        .map(|r| {
            expo_message(
                &r.get::<String, _>("token"),
                &r.get::<String, _>("platform"),
                &r.get::<String, _>("notification_mode"),
                &payload,
                now,
            )
        })
        .collect();
    match sender.send(&messages).await {
        Ok(tickets) => {
            let mut stored = Vec::new();
            for (index, ticket) in tickets.iter().enumerate() {
                let Some(registration) = registrations.get(index) else {
                    break;
                };
                let digest: Vec<u8> = registration.get("token_hash");
                if ticket["status"] == "error" {
                    if ticket["details"]["error"] == "DeviceNotRegistered" {
                        sqlx::query("UPDATE push_tokens SET enabled=false,updated_at=now() WHERE token_hash=$1")
                            .bind(&digest).execute(pool).await?;
                    }
                } else if let Some(ticket_id) = ticket["id"].as_str() {
                    stored.push(json!({"id":ticket_id,"token":hex::encode(&digest)}));
                }
            }
            sqlx::query("UPDATE push_outbox SET sent_at=now(),tickets=$3,lease_id=NULL,locked_until=NULL,payload='{}'::jsonb,last_error_code=NULL WHERE id=$1 AND lease_id=$2")
                .bind(id).bind(lease).bind(Value::Array(stored)).execute(pool).await?;
        }
        Err(code) => {
            let delay = (2_i32.pow(attempts.clamp(0, 6) as u32) * 5).min(600);
            sqlx::query("UPDATE push_outbox SET last_error_code=$3,next_attempt_at=now()+make_interval(secs=>$4),lease_id=NULL,locked_until=NULL WHERE id=$1 AND lease_id=$2")
                .bind(id).bind(lease).bind(code).bind(delay as f64).execute(pool).await?;
        }
    }
    Ok(true)
}

/// Receipt sweep (legacy `checkPushReceipts`): disables unregistered devices
/// and trims delivered jobs after seven days.
pub async fn check_receipts(pool: &PgPool, sender: &PushSender) -> Result<(), sqlx::Error> {
    // Expo removes receipts after 24 hours. Finish an unresolved job explicitly
    // rather than retrying forever or silently treating it as delivered.
    sqlx::query("UPDATE push_outbox SET receipts_checked_at=now(),finished_at=COALESCE(finished_at,now()),tickets=NULL,last_error_code='receipt-timeout' WHERE sent_at<now()-interval '24 hours' AND receipts_checked_at IS NULL")
        .execute(pool).await?;
    let rows = sqlx::query("SELECT id,tickets FROM push_outbox WHERE sent_at IS NOT NULL AND receipts_checked_at IS NULL AND sent_at<now()-interval '15 minutes' ORDER BY sent_at LIMIT 300")
        .fetch_all(pool).await?;
    let mut tokens = std::collections::HashMap::new();
    let mut ids = Vec::new();
    for row in &rows {
        for ticket in row
            .get::<Option<Value>, _>("tickets")
            .unwrap_or_default()
            .as_array()
            .cloned()
            .unwrap_or_default()
        {
            if let (Some(id), Some(token)) = (ticket["id"].as_str(), ticket["token"].as_str()) {
                tokens.insert(id.to_owned(), token.to_owned());
                ids.push(id.to_owned());
            }
        }
    }
    let mut resolved = std::collections::HashSet::new();
    for chunk in ids.chunks(300) {
        if let Ok(response) = sender
            .post(&sender.receipts_url, &json!({"ids":chunk}))
            .await
        {
            if let Some(receipts) = response["data"].as_object() {
                for id in chunk {
                    let Some(receipt) = receipts.get(id) else {
                        continue;
                    };
                    if !matches!(receipt["status"].as_str(), Some("ok" | "error"))
                        || (receipt["status"] == "error"
                            && !receipt["details"]["error"]
                                .as_str()
                                .is_some_and(|code| !code.is_empty()))
                    {
                        continue;
                    }
                    resolved.insert(id.clone());
                    if receipt["status"] == "error"
                        && receipt["details"]["error"] == "DeviceNotRegistered"
                    {
                        if let Some(digest) = tokens.get(id).and_then(|t| hex::decode(t).ok()) {
                            sqlx::query("UPDATE push_tokens SET enabled=false,updated_at=now() WHERE token_hash=$1")
                                .bind(digest).execute(pool).await?;
                        }
                    }
                }
            }
        }
    }
    for row in rows {
        let id: Uuid = row.get("id");
        let original: Value = row.get::<Option<Value>, _>("tickets").unwrap_or_default();
        let Some(tickets) = original.as_array() else {
            continue;
        };
        let pending: Vec<Value> = tickets
            .iter()
            .filter(|ticket| {
                !ticket["id"]
                    .as_str()
                    .is_some_and(|id| resolved.contains(id))
            })
            .cloned()
            .collect();
        // Do not overwrite another sweep's progress from a stale snapshot.
        if pending.is_empty() {
            sqlx::query("UPDATE push_outbox SET receipts_checked_at=now(),finished_at=COALESCE(finished_at,now()),tickets=NULL WHERE id=$1 AND tickets=$2")
                .bind(id).bind(&original).execute(pool).await?;
        } else if pending.len() != tickets.len() {
            sqlx::query("UPDATE push_outbox SET tickets=$2 WHERE id=$1 AND tickets=$3")
                .bind(id)
                .bind(Value::Array(pending))
                .bind(&original)
                .execute(pool)
                .await?;
        }
    }
    sqlx::query("DELETE FROM push_outbox WHERE finished_at<now()-interval '7 days'")
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM notifications WHERE expires_at<=now()")
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::StatusCode, routing::post, Json, Router};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };

    // All provider traffic stays on loopback. No Expo credentials or devices
    // are used, and PostgreSQL tests use SQLx's disposable migrated databases.
    struct MockExpo {
        sender: PushSender,
        reply: Arc<Mutex<(StatusCode, Value)>>,
        requests: Arc<AtomicUsize>,
        task: tokio::task::JoinHandle<()>,
    }

    impl MockExpo {
        async fn new(status: StatusCode, body: Value) -> Self {
            let reply = Arc::new(Mutex::new((status, body)));
            let response = reply.clone();
            let requests = Arc::new(AtomicUsize::new(0));
            let count = requests.clone();
            let app = Router::new().route(
                "/{operation}",
                post(move || {
                    let reply = response.clone();
                    let count = count.clone();
                    async move {
                        count.fetch_add(1, Ordering::SeqCst);
                        let (status, body) = reply.lock().unwrap().clone();
                        (status, Json(body))
                    }
                }),
            );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let origin = format!("http://{}", listener.local_addr().unwrap());
            let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            Self {
                sender: PushSender {
                    http: reqwest::Client::builder().no_proxy().build().unwrap(),
                    access_token: None,
                    send_url: format!("{origin}/send"),
                    receipts_url: format!("{origin}/receipts"),
                },
                reply,
                requests,
                task,
            }
        }

        fn respond(&self, status: StatusCode, body: Value) {
            *self.reply.lock().unwrap() = (status, body);
        }
    }

    impl Drop for MockExpo {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    async fn push_fixture(pool: &PgPool) -> (Uuid, Value, Vec<u8>) {
        sqlx::query("INSERT INTO accounts(id,email,email_verified) VALUES('push-test','push-test@psu.ac.th',true)")
            .execute(pool).await.unwrap();
        let token = "ExponentPushToken[loopbackOnly]";
        let digest = Sha256::digest(token.as_bytes()).to_vec();
        sqlx::query("INSERT INTO push_tokens(token_hash,user_id,token,platform) VALUES($1,'push-test',$2,'android')")
            .bind(&digest).bind(token).execute(pool).await.unwrap();
        let payload = json!({"title":"Test","body":"Loopback only","data":{"type":"system"}});
        let id = sqlx::query_scalar("INSERT INTO push_outbox(user_id,dedupe_key,payload) VALUES('push-test','mock-provider',$1) RETURNING id")
            .bind(&payload).fetch_one(pool).await.unwrap();
        (id, payload, digest)
    }

    #[tokio::test]
    async fn whole_request_errors_and_invalid_tickets_are_rejected() {
        let mock =
            MockExpo::new(StatusCode::BAD_REQUEST, json!({"errors":[{"code":"TEST"}]})).await;
        let messages = [json!({"to":"ExponentPushToken[loopbackOnly]"})];
        for status in [
            StatusCode::BAD_REQUEST,
            StatusCode::UNAUTHORIZED,
            StatusCode::FORBIDDEN,
        ] {
            mock.respond(status, json!({"errors":[{"code":"TEST"}]}));
            assert_eq!(mock.sender.send(&messages).await, Err("provider-rejected"));
        }
        for status in [
            StatusCode::TOO_MANY_REQUESTS,
            StatusCode::SERVICE_UNAVAILABLE,
        ] {
            mock.respond(status, json!({"errors":[{"code":"TEST"}]}));
            assert_eq!(
                mock.sender.send(&messages).await,
                Err("provider-unavailable")
            );
        }
        mock.respond(StatusCode::OK, json!({"errors":[{"code":"TEST"}]}));
        assert_eq!(mock.sender.send(&messages).await, Err("provider-rejected"));
        for body in [
            json!({}),
            json!({"data":null}),
            json!({"data":[]}),
            json!({"data":[{"status":"ok","id":"one"},{"status":"ok","id":"two"}]}),
            json!({"data":[{"status":"ok"}]}),
            json!({"data":[{"status":"error"}]}),
            json!({"data":[{"status":"unknown","id":"one"}]}),
        ] {
            mock.respond(StatusCode::OK, body);
            assert_eq!(mock.sender.send(&messages).await, Err("invalid-response"));
        }
        mock.respond(
            StatusCode::OK,
            json!({"data":[{"status":"error","details":{"error":"DeviceNotRegistered"}}]}),
        );
        assert!(mock.sender.send(&messages).await.is_ok());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn rejected_delivery_keeps_payload_and_retries_before_acceptance(pool: PgPool) {
        let (id, payload, digest) = push_fixture(&pool).await;
        let mock = MockExpo::new(
            StatusCode::UNAUTHORIZED,
            json!({"errors":[{"code":"TEST"}]}),
        )
        .await;
        for (status, body, code) in [
            (
                StatusCode::UNAUTHORIZED,
                json!({"errors":[{"code":"TEST"}]}),
                "provider-rejected",
            ),
            (StatusCode::OK, json!({}), "invalid-response"),
            (StatusCode::OK, json!({"data":[]}), "invalid-response"),
        ] {
            mock.respond(status, body);
            assert!(deliver_once(&pool, &mock.sender).await.unwrap());
            let row = sqlx::query("SELECT payload,sent_at IS NULL AS pending,lease_id IS NULL AS released,last_error_code,next_attempt_at>now() AS delayed FROM push_outbox WHERE id=$1")
                .bind(id).fetch_one(&pool).await.unwrap();
            assert_eq!(row.get::<Value, _>("payload"), payload);
            assert!(row.get::<bool, _>("pending"));
            assert!(row.get::<bool, _>("released"));
            assert!(row.get::<bool, _>("delayed"));
            assert_eq!(row.get::<String, _>("last_error_code"), code);
            sqlx::query("UPDATE push_outbox SET next_attempt_at=now() WHERE id=$1")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
        }
        mock.respond(
            StatusCode::OK,
            json!({"data":[{"status":"ok","id":"accepted-ticket"}]}),
        );
        assert!(deliver_once(&pool, &mock.sender).await.unwrap());
        let row = sqlx::query("SELECT payload,tickets,sent_at IS NOT NULL AS sent,last_error_code IS NULL AS error_cleared FROM push_outbox WHERE id=$1")
            .bind(id).fetch_one(&pool).await.unwrap();
        assert!(row.get::<bool, _>("sent"));
        assert!(row.get::<bool, _>("error_cleared"));
        assert_eq!(row.get::<Value, _>("payload"), json!({}));
        assert_eq!(
            row.get::<Value, _>("tickets"),
            json!([{"id":"accepted-ticket","token":hex::encode(digest)}])
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn failed_and_partial_receipt_checks_preserve_unresolved_tickets(pool: PgPool) {
        let (id, _, digest) = push_fixture(&pool).await;
        let tickets = json!([
            {"id":"first","token":hex::encode(&digest)},
            {"id":"second","token":hex::encode(&digest)},
        ]);
        sqlx::query("UPDATE push_outbox SET sent_at=now()-interval '20 minutes',payload='{}',tickets=$2 WHERE id=$1")
            .bind(id).bind(&tickets).execute(&pool).await.unwrap();
        let mock = MockExpo::new(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"errors":[{"code":"TEST"}]}),
        )
        .await;
        for (status, body) in [
            (
                StatusCode::SERVICE_UNAVAILABLE,
                json!({"errors":[{"code":"TEST"}]}),
            ),
            (StatusCode::OK, json!({})),
            (StatusCode::OK, json!({"data":{}})),
        ] {
            mock.respond(status, body);
            check_receipts(&pool, &mock.sender).await.unwrap();
            let row = sqlx::query("SELECT tickets,receipts_checked_at IS NULL AS pending FROM push_outbox WHERE id=$1")
                .bind(id).fetch_one(&pool).await.unwrap();
            assert!(row.get::<bool, _>("pending"));
            assert_eq!(row.get::<Value, _>("tickets"), tickets);
        }
        mock.respond(StatusCode::OK, json!({"data":{"first":{"status":"ok"}}}));
        check_receipts(&pool, &mock.sender).await.unwrap();
        let pending: Value = sqlx::query_scalar("SELECT tickets FROM push_outbox WHERE id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            pending,
            json!([{"id":"second","token":hex::encode(&digest)}])
        );
        mock.respond(
            StatusCode::OK,
            json!({"data":{"second":{"status":"error"}}}),
        );
        check_receipts(&pool, &mock.sender).await.unwrap();
        let pending: Value = sqlx::query_scalar("SELECT tickets FROM push_outbox WHERE id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            pending,
            json!([{"id":"second","token":hex::encode(&digest)}])
        );
        mock.respond(
            StatusCode::OK,
            json!({"data":{"second":{"status":"error","details":{"error":"DeviceNotRegistered"}}}}),
        );
        check_receipts(&pool, &mock.sender).await.unwrap();
        let row = sqlx::query("SELECT tickets IS NULL AS scrubbed,receipts_checked_at IS NOT NULL AS checked,finished_at IS NOT NULL AS finished FROM push_outbox WHERE id=$1")
            .bind(id).fetch_one(&pool).await.unwrap();
        assert!(row.get::<bool, _>("scrubbed"));
        assert!(row.get::<bool, _>("checked"));
        assert!(row.get::<bool, _>("finished"));
        let enabled: bool =
            sqlx::query_scalar("SELECT enabled FROM push_tokens WHERE token_hash=$1")
                .bind(digest)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(!enabled);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn expired_receipt_window_finishes_with_an_explicit_error(pool: PgPool) {
        let (id, _, digest) = push_fixture(&pool).await;
        sqlx::query("UPDATE push_outbox SET sent_at=now()-interval '25 hours',payload='{}',tickets=$2 WHERE id=$1")
            .bind(id).bind(json!([{"id":"expired","token":hex::encode(digest)}])).execute(&pool).await.unwrap();
        let mock = MockExpo::new(StatusCode::SERVICE_UNAVAILABLE, json!({"errors":[]})).await;
        check_receipts(&pool, &mock.sender).await.unwrap();
        assert_eq!(mock.requests.load(Ordering::SeqCst), 0);
        let row = sqlx::query("SELECT tickets IS NULL AS scrubbed,finished_at IS NOT NULL AS finished,last_error_code FROM push_outbox WHERE id=$1")
            .bind(id).fetch_one(&pool).await.unwrap();
        assert!(row.get::<bool, _>("scrubbed"));
        assert!(row.get::<bool, _>("finished"));
        assert_eq!(row.get::<String, _>("last_error_code"), "receipt-timeout");
    }

    #[test]
    fn expo_tokens_are_validated_strictly() {
        assert!(valid_expo_token("ExponentPushToken[abcDEF123-_]"));
        assert!(valid_expo_token("ExpoPushToken[abc]"));
        for token in [
            "",
            "ExponentPushToken[]",
            "ExponentPushToken[a b]",
            "token",
            "ExponentPushToken[abc",
        ] {
            assert!(!valid_expo_token(token), "{token}");
        }
    }

    #[test]
    fn message_push_never_contains_plaintext() {
        let notice = message(
            &json!({"name":"Alice\u{0007}","avatarUri":"http://insecure"}),
            "alice",
            "c-1",
            "m-1",
        );
        assert_eq!(notice.body, "ข้อความที่เข้ารหัส");
        assert_eq!(notice.title, "Alice");
        assert!(notice.avatar.is_none());
        let payload = json!({"title":notice.title,"body":notice.body,"channelId":"messages","threadId":"c-1","data":notice.data,"badge":3});
        let android = expo_message(
            "ExponentPushToken[x]",
            "android",
            ANDROID_MESSAGING_MODE,
            &payload,
            0,
        );
        assert_eq!(android["collapseId"], "c-1");
        assert_eq!(android["data"]["notificationBadge"], "3");
        let ios = expo_message(
            "ExponentPushToken[x]",
            "ios",
            ANDROID_MESSAGING_MODE,
            &payload,
            0,
        );
        assert!(ios.get("collapseId").is_none());
        assert_eq!(ios["badge"], 3);
    }

    #[test]
    fn inbox_ids_are_stable_per_recipient() {
        assert_eq!(inbox_id("k", "a"), inbox_id("k", "a"));
        assert_ne!(inbox_id("k", "a"), inbox_id("k", "b"));
        assert_eq!(inbox_id("k", "a").len(), 64);
        assert_eq!(url_component("c-a b"), "c-a%20b");
    }
}
