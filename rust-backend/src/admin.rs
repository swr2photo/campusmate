//! Admin console (legacy `adminConsole` callable, keyed by `op`) and role
//! switching. Admin rights come from `accounts.role` set by the server; the
//! super-admin address may grant/revoke roles. Every change is audited.
use axum::http::HeaderMap;
use chrono::Utc;
use serde_json::{json, Map, Value};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::{auth, error::ApiError, events, feedback, notify, service_status, AppState};

pub const SUPER_ADMIN_EMAILS: &[&str] = &["6710210317@psu.ac.th"];

pub fn is_super_admin(email: &str, verified: bool) -> bool {
    verified && SUPER_ADMIN_EMAILS.contains(&email.trim().to_ascii_lowercase().as_str())
}

struct Actor {
    uid: String,
    email: String,
    is_admin: bool,
    is_super: bool,
}

async fn actor(state: &AppState, headers: &HeaderMap) -> Result<Actor, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let is_super = is_super_admin(&user.email, user.email_verified);
    let is_admin = user.role == "admin";
    if !user.email_verified || (!is_admin && !is_super) {
        return Err(ApiError::new("permission-denied", "บัญชีนี้ไม่มีสิทธิ์ผู้ดูแล"));
    }
    Ok(Actor {
        uid: user.uid,
        email: user.email,
        is_admin,
        is_super,
    })
}

fn id(value: &Value) -> Result<String, ApiError> {
    value
        .as_str()
        .filter(|v| crate::chat::identifier(v, 128) && !v.contains(':') && !v.contains('.'))
        .map(str::to_owned)
        .ok_or_else(|| ApiError::invalid("รหัสไม่ถูกต้อง"))
}

fn note(data: &Value) -> String {
    data["note"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(2000)
        .collect()
}

async fn audit(
    tx: &mut PgConnection,
    actor: &str,
    action: &str,
    target: Option<&str>,
    details: Value,
) -> Result<(), ApiError> {
    sqlx::query("INSERT INTO admin_audit(actor_id,action,target_id,details) VALUES($1,$2,$3,$4)")
        .bind(actor)
        .bind(action)
        .bind(target)
        .bind(details)
        .execute(tx)
        .await?;
    Ok(())
}

async fn count(state: &AppState, sql: &str) -> Result<i64, ApiError> {
    Ok(sqlx::query_scalar(sql).fetch_one(&state.db).await?)
}

/// Legacy `switchAdminMode` (and console `switchMyRole`): only a verified
/// super admin or a current admin may toggle their own role.
pub async fn switch_mode(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let actor = actor(state, headers).await?;
    let next = data["isAdmin"].as_bool().unwrap_or(!actor.is_admin);
    if next && !actor.is_super && !actor.is_admin {
        return Err(ApiError::new(
            "permission-denied",
            "เฉพาะผู้ดูแลระบบหรือผู้ใช้ที่ได้รับอนุญาตเท่านั้น",
        ));
    }
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE accounts SET role=$2 WHERE id=$1")
        .bind(&actor.uid)
        .bind(if next { "admin" } else { "user" })
        .execute(&mut *tx)
        .await?;
    audit(
        &mut tx,
        &actor.uid,
        "switchMyRole",
        Some(&actor.uid),
        json!({"before":{"isAdmin":actor.is_admin},"after":{"isAdmin":next}}),
    )
    .await?;
    events::publish_one(&mut tx, &actor.uid, "account", None).await?;
    tx.commit().await?;
    Ok(json!({"success":true,"isAdmin":next}))
}

const REPORT: &str = "id::text AS id,reporter_id,reported_user_id,conversation_id,message_id,media_url,message_text,reason,details,status,resolution,reviewed_by,
    (extract(epoch FROM reviewed_at)*1000)::bigint AS reviewed_ms,(extract(epoch FROM created_at)*1000)::bigint AS created_ms,
    (extract(epoch FROM updated_at)*1000)::bigint AS updated_ms";

fn iso(ms: Option<i64>) -> Value {
    ms.and_then(chrono::DateTime::<Utc>::from_timestamp_millis)
        .map(|d| json!(d.to_rfc3339()))
        .unwrap_or(Value::Null)
}

fn report_json(row: &sqlx::postgres::PgRow) -> Value {
    let updated: i64 = row.get("updated_ms");
    json!({
        "id": row.get::<String,_>("id"), "reporterId": row.get::<String,_>("reporter_id"),
        "reportedUserId": row.get::<Option<String>,_>("reported_user_id"), "conversationId": row.get::<Option<String>,_>("conversation_id"),
        "messageId": row.get::<Option<String>,_>("message_id"), "mediaUrl": row.get::<Option<String>,_>("media_url"),
        "messageText": row.get::<Option<String>,_>("message_text"), "reason": row.get::<String,_>("reason"),
        "details": row.get::<String,_>("details"), "status": row.get::<String,_>("status"),
        "reviewNote": row.get::<Option<Value>,_>("resolution").and_then(|r| r["note"].as_str().map(str::to_owned)).unwrap_or_default(),
        "reviewedBy": row.get::<Option<String>,_>("reviewed_by"), "reviewedAt": iso(row.get("reviewed_ms")),
        "createdAt": iso(Some(row.get("created_ms"))), "updatedAt": iso(Some(updated)), "revision": updated.to_string(),
    })
}

async fn person(state: &AppState, uid: Option<String>) -> Result<Value, ApiError> {
    let Some(uid) = uid else {
        return Ok(Value::Null);
    };
    let row = sqlx::query("SELECT a.email,a.email_verified,a.suspended,a.role,a.deleted_at IS NOT NULL AS deleted,COALESCE(p.raw,'{}') AS raw,(extract(epoch FROM a.created_at)*1000)::bigint AS created_ms FROM accounts a LEFT JOIN profiles p ON p.user_id=a.id WHERE a.id=$1")
        .bind(&uid).fetch_optional(&state.db).await?;
    let Some(row) = row else {
        return Ok(json!({"uid":uid,"missing":true}));
    };
    let raw: Value = row.get("raw");
    let mut details = Map::new();
    for key in [
        "name",
        "nickname",
        "age",
        "gender",
        "faculty",
        "year",
        "studentId",
        "bio",
        "activity",
        "activityLabel",
    ] {
        if !raw[key].is_null() {
            details.insert(key.into(), raw[key].clone());
        }
    }
    details.insert("createdAt".into(), iso(Some(row.get("created_ms"))));
    Ok(
        json!({"uid":uid,"email":row.get::<String,_>("email"),"emailVerified":row.get::<bool,_>("email_verified"),
        "disabled":row.get::<bool,_>("suspended") || row.get::<bool,_>("deleted"),"isAdmin":row.get::<String,_>("role")=="admin",
        "avatarUrl":raw["avatarUri"].as_str().unwrap_or_default(),"name":raw["name"].as_str().unwrap_or_default(),"details":details}),
    )
}

fn valid_status(status: &str) -> bool {
    ["pending", "reviewing", "resolved", "dismissed"].contains(&status)
}

async fn suspend(tx: &mut PgConnection, uid: &str, suspended: bool) -> Result<(), ApiError> {
    sqlx::query("UPDATE accounts SET suspended=$2 WHERE id=$1")
        .bind(uid)
        .bind(suspended)
        .execute(&mut *tx)
        .await?;
    if suspended {
        sqlx::query("UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1")
            .bind(uid)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE push_tokens SET enabled=false,updated_at=now() WHERE user_id=$1")
            .bind(uid)
            .execute(&mut *tx)
            .await?;
    }
    events::publish_one(tx, uid, "account", None).await
}

fn operations(config: Option<&Value>) -> Value {
    let config = config.cloned().unwrap_or(json!({}));
    let number = |key: &str, default: i64, min: i64, max: i64| {
        config[key]
            .as_i64()
            .filter(|n| (min..=max).contains(n))
            .unwrap_or(default)
    };
    json!({
        "customNotificationsEnabled": config["customNotificationsEnabled"].as_bool().unwrap_or(true),
        "maxNotificationRecipients": number("maxNotificationRecipients", 500, 1, 5000),
        "notificationCooldownSeconds": number("notificationCooldownSeconds", 60, 0, 86_400),
        "adminEmailCooldownSeconds": number("adminEmailCooldownSeconds", 60, 0, 86_400),
    })
}

async fn config(state: &AppState, id: &str) -> Result<(Option<Value>, String), ApiError> {
    let row = sqlx::query("SELECT data,(extract(epoch FROM updated_at)*1000)::bigint AS ms FROM app_config WHERE id=$1")
        .bind(id).fetch_optional(&state.db).await?;
    Ok(match row {
        Some(row) => (Some(row.get("data")), row.get::<i64, _>("ms").to_string()),
        None => (None, "missing".into()),
    })
}

async fn save_config(
    state: &AppState,
    actor: &str,
    id: &str,
    revision: &Value,
    patch: Value,
    merge: bool,
) -> Result<Value, ApiError> {
    let mut tx = state.db.begin().await?;
    let row = sqlx::query("SELECT data,(extract(epoch FROM updated_at)*1000)::bigint AS ms FROM app_config WHERE id=$1 FOR UPDATE")
        .bind(id).fetch_optional(&mut *tx).await?;
    let current = row
        .as_ref()
        .map(|r| r.get::<i64, _>("ms").to_string())
        .unwrap_or_else(|| "missing".into());
    if revision.as_str() != Some(current.as_str()) {
        return Err(ApiError::new("aborted", "การตั้งค่าเปลี่ยนแล้ว กรุณาโหลดใหม่"));
    }
    let before = row
        .as_ref()
        .map(|r| r.get::<Value, _>("data"))
        .unwrap_or(json!({}));
    let mut next = if merge { before.clone() } else { json!({}) };
    for (key, value) in patch.as_object().cloned().unwrap_or_default() {
        next[key] = value;
    }
    sqlx::query("INSERT INTO app_config(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=clock_timestamp()")
        .bind(id).bind(&next).execute(&mut *tx).await?;
    audit(
        &mut tx,
        actor,
        &format!("save:{id}"),
        Some(id),
        json!({"before":before,"after":next}),
    )
    .await?;
    tx.commit().await?;
    Ok(json!({"success":true}))
}

fn validate_version(data: &Value) -> Result<Value, ApiError> {
    let raw = data
        .as_object()
        .ok_or_else(|| ApiError::invalid("การตั้งค่าไม่ถูกต้อง"))?;
    let allowed = [
        "enabled",
        "latestVersion",
        "minVersion",
        "forceUpdate",
        "playStorePublished",
        "snoozeHours",
        "title",
        "message",
        "releaseNotes",
        "playStoreUrl",
        "playStoreWebUrl",
        "appStoreUrl",
    ];
    let semver = |v: &str| {
        v.is_empty()
            || (v.split('.').count() == 3
                && v.split('.')
                    .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())))
    };
    for (key, value) in raw {
        let ok = match key.as_str() {
            "enabled" | "forceUpdate" | "playStorePublished" => value.is_boolean(),
            "snoozeHours" => value.as_f64().is_some_and(|h| (1.0..=720.0).contains(&h)),
            "latestVersion" | "minVersion" => value.as_str().is_some_and(semver),
            "playStoreUrl" => value
                .as_str()
                .is_some_and(|v| v.is_empty() || v == "market://details?id=com.campusmate.app"),
            "playStoreWebUrl" => value
                .as_str()
                .is_some_and(|v| v.is_empty() || v.starts_with("https://play.google.com/")),
            "appStoreUrl" => value
                .as_str()
                .is_some_and(|v| v.is_empty() || v.starts_with("https://apps.apple.com/")),
            k if allowed.contains(&k) => value.as_str().is_some_and(|v| v.len() <= 4000),
            _ => false,
        };
        if !ok {
            return Err(ApiError::invalid(format!("การตั้งค่า {key} ไม่ถูกต้อง")));
        }
    }
    if raw.get("forceUpdate") == Some(&Value::Bool(true))
        && (raw.get("enabled") != Some(&Value::Bool(true))
            || raw.get("playStorePublished") != Some(&Value::Bool(true))
            || raw
                .get("latestVersion")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .is_empty())
    {
        return Err(ApiError::invalid(
            "บังคับอัปเดตได้เมื่อเปิดแจ้งเตือนและเผยแพร่เวอร์ชันบน Play Store แล้ว",
        ));
    }
    Ok(Value::Object(raw.clone()))
}

pub async fn console(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let actor = actor(state, headers).await?;
    let op = data["op"].as_str().unwrap_or_default().to_owned();
    match op.as_str() {
        "overview" => {
            let mut counts = Vec::new();
            for status in ["pending", "reviewing", "resolved", "dismissed"] {
                let n: i64 = sqlx::query_scalar("SELECT count(*) FROM reports WHERE status=$1")
                    .bind(status)
                    .fetch_one(&state.db)
                    .await?;
                counts.push(json!({"status":status,"count":n}));
            }
            Ok(json!({"counts":counts,
                "userCount": count(state, "SELECT count(*) FROM accounts WHERE deleted_at IS NULL").await?,
                "spotCount": count(state, "SELECT count(*) FROM spots").await?,
                "openPartiesCount": count(state, "SELECT count(*) FROM parties WHERE status='open'").await?,
                "adminEmail": actor.email, "actorIsAdmin": actor.is_admin, "isSuperAdmin": actor.is_super}))
        }
        "metrics" => {
            let started = std::time::Instant::now();
            let users = count(
                state,
                "SELECT count(*) FROM accounts WHERE deleted_at IS NULL",
            )
            .await?;
            let verified =
                count(state, "SELECT count(*) FROM profiles WHERE face_verified").await?;
            Ok(json!({
                "users": users, "faceVerifiedUsers": verified,
                "faceVerificationRate": if users > 0 { verified * 100 / users } else { 0 },
                "spots": count(state, "SELECT count(*) FROM spots").await?,
                "parties": count(state, "SELECT count(*) FROM parties").await?,
                "openParties": count(state, "SELECT count(*) FROM parties WHERE status='open'").await?,
                "conversations": count(state, "SELECT count(*) FROM conversations").await?,
                "reports": count(state, "SELECT count(*) FROM reports").await?,
                "pendingReports": count(state, "SELECT count(*) FROM reports WHERE status='pending'").await?,
                "plusSubscribers": count(state, "SELECT count(*) FROM entitlements WHERE (record->>'activeUntil')::bigint>(extract(epoch FROM now())*1000)::bigint").await?,
                "databaseLatencyMs": started.elapsed().as_millis() as i64, "database": "postgresql",
            }))
        }
        "reports" => {
            let after = data["cursor"]
                .as_str()
                .and_then(|c| Uuid::parse_str(c).ok());
            let rows = sqlx::query(&format!("SELECT {REPORT} FROM reports WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 30"))
                .bind(after).fetch_all(&state.db).await?;
            let cursor = (rows.len() == 30)
                .then(|| rows.last().map(|r| r.get::<String, _>("id")))
                .flatten();
            Ok(json!({"rows": rows.iter().map(report_json).collect::<Vec<_>>(), "cursor": cursor}))
        }
        "review" => {
            let report = data["id"]
                .as_str()
                .and_then(|v| Uuid::parse_str(v).ok())
                .ok_or_else(|| ApiError::invalid("รหัสไม่ถูกต้อง"))?;
            let status = data["status"]
                .as_str()
                .filter(|s| valid_status(s))
                .ok_or_else(|| ApiError::invalid("สถานะไม่ถูกต้อง"))?;
            let review = note(&data);
            if ["resolved", "dismissed"].contains(&status) && review.is_empty() {
                return Err(ApiError::invalid("กรุณาระบุผลการตรวจสอบ"));
            }
            let mut tx = state.db.begin().await?;
            let row = sqlx::query(&format!(
                "SELECT {REPORT} FROM reports WHERE id=$1 FOR UPDATE"
            ))
            .bind(report)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| ApiError::new("not-found", "ไม่พบรายงาน"))?;
            if data["revision"].as_str()
                != Some(row.get::<i64, _>("updated_ms").to_string().as_str())
            {
                return Err(ApiError::new("aborted", "รายงานเปลี่ยนแล้ว กรุณาโหลดใหม่"));
            }
            sqlx::query("UPDATE reports SET status=$2,resolution=jsonb_build_object('note',$3::text),reviewed_by=$4,reviewed_at=now(),updated_at=clock_timestamp() WHERE id=$1")
                .bind(report).bind(status).bind(&review).bind(&actor.uid).execute(&mut *tx).await?;
            audit(&mut tx, &actor.uid, "review", Some(&report.to_string()), json!({"before":{"status":row.get::<String,_>("status")},"after":{"status":status,"reviewNote":review}})).await?;
            tx.commit().await?;
            Ok(json!({"success":true}))
        }
        "reportDetail" => {
            let report = data["id"]
                .as_str()
                .and_then(|v| Uuid::parse_str(v).ok())
                .ok_or_else(|| ApiError::invalid("รหัสไม่ถูกต้อง"))?;
            let row = sqlx::query(&format!("SELECT {REPORT} FROM reports WHERE id=$1"))
                .bind(report)
                .fetch_optional(&state.db)
                .await?
                .ok_or_else(|| ApiError::new("not-found", "ไม่พบรายงาน"))?;
            let json = report_json(&row);
            let message = match (json["conversationId"].as_str(), json["messageId"].as_str()) {
                (Some(room), Some(message)) => sqlx::query("SELECT sender_id,(extract(epoch FROM created_at)*1000)::bigint AS ms FROM encrypted_messages WHERE conversation_id=$1 AND id=$2")
                    .bind(room).bind(message).fetch_optional(&state.db).await?
                    .map(|m| json!({"id":message,"senderId":m.get::<String,_>("sender_id"),"encrypted":true,
                        "text":"ข้อความเข้ารหัส — ดูได้เฉพาะข้อความที่แนบมาในรายงาน","createdAt":iso(Some(m.get("ms"))),"source":"messages"})),
                _ => None,
            };
            let can_remove = message
                .as_ref()
                .is_some_and(|m| m["senderId"] == json["reportedUserId"]);
            Ok(
                json!({"report":json,"reporter":person(state, row.get("reporter_id")).await?,"reported":person(state, row.get("reported_user_id")).await?,
                "message":message,"conversation":Value::Null,"canRemoveMessage":can_remove,"canRemoveMedia":false}),
            )
        }
        "moderateReport" => {
            let report = data["id"]
                .as_str()
                .and_then(|v| Uuid::parse_str(v).ok())
                .ok_or_else(|| ApiError::invalid("รหัสไม่ถูกต้อง"))?;
            let action = data["action"].as_str().unwrap_or_default();
            let mut tx = state.db.begin().await?;
            let row = sqlx::query("SELECT reported_user_id,conversation_id,message_id FROM reports WHERE id=$1 FOR UPDATE").bind(report).fetch_optional(&mut *tx).await?
                .ok_or_else(|| ApiError::new("not-found", "ไม่พบรายงาน"))?;
            let reported: Option<String> = row.get("reported_user_id");
            match action {
                "removeMessage" => {
                    let (Some(room), Some(message)) = (
                        row.get::<Option<String>, _>("conversation_id"),
                        row.get::<Option<String>, _>("message_id"),
                    ) else {
                        return Err(ApiError::new("failed-precondition", "รายงานนี้ไม่มีข้อความ"));
                    };
                    let removed = sqlx::query("DELETE FROM encrypted_messages WHERE conversation_id=$1 AND id=$2 AND sender_id=$3 RETURNING (SELECT array[member_a,member_b] FROM conversations WHERE id=$1)")
                        .bind(&room).bind(&message).bind(&reported).fetch_optional(&mut *tx).await?;
                    if let Some(members) = removed.and_then(|r| r.try_get::<Vec<String>, _>(0).ok())
                    {
                        let users: Vec<&str> = members.iter().map(String::as_str).collect();
                        events::publish(&mut tx, &users, "messages", Some(&room)).await?;
                    }
                }
                "suspendUser" => {
                    let target = reported.clone().ok_or_else(|| {
                        ApiError::new("failed-precondition", "รายงานนี้ไม่มีผู้ถูกรายงาน")
                    })?;
                    suspend(&mut tx, &target, true).await?;
                }
                _ => return Err(ApiError::invalid("การดำเนินการไม่รองรับ")),
            }
            sqlx::query("UPDATE reports SET status='resolved',resolution=jsonb_build_object('note',$2::text,'action',$3::text),reviewed_by=$4,reviewed_at=now(),updated_at=clock_timestamp() WHERE id=$1")
                .bind(report).bind(note(&data)).bind(action).bind(&actor.uid).execute(&mut *tx).await?;
            audit(
                &mut tx,
                &actor.uid,
                "moderateReport",
                Some(&report.to_string()),
                json!({"action":action,"target":reported}),
            )
            .await?;
            tx.commit().await?;
            Ok(json!({"success":true}))
        }
        "users" => {
            let after = data["cursor"].as_str().unwrap_or_default();
            let rows = sqlx::query("SELECT a.id,a.email,a.email_verified,a.suspended,a.role,a.deleted_at IS NOT NULL AS deleted,COALESCE(p.raw,'{}') AS raw,p.face_verified,(extract(epoch FROM a.created_at)*1000)::bigint AS created_ms,(extract(epoch FROM a.last_sign_in_at)*1000)::bigint AS signed_ms FROM accounts a LEFT JOIN profiles p ON p.user_id=a.id WHERE a.id>$1 ORDER BY a.id LIMIT 100")
                .bind(after).fetch_all(&state.db).await?;
            let cursor = (rows.len() == 100)
                .then(|| rows.last().map(|r| r.get::<String, _>("id")))
                .flatten();
            Ok(
                json!({"rows": rows.iter().map(|r| { let raw: Value = r.get("raw"); json!({
                "uid": r.get::<String,_>("id"), "email": r.get::<String,_>("email"), "emailVerified": r.get::<bool,_>("email_verified"),
                "disabled": r.get::<bool,_>("suspended") || r.get::<bool,_>("deleted"), "isAdmin": r.get::<String,_>("role")=="admin",
                "name": raw["name"].as_str().unwrap_or_default(), "avatarUrl": raw["avatarUri"].as_str().unwrap_or_default(),
                "isFaceVerified": r.get::<Option<bool>,_>("face_verified").unwrap_or(false),
                "createdAt": iso(r.get("created_ms")), "lastSignIn": iso(r.get("signed_ms"))})}).collect::<Vec<_>>(), "cursor": cursor}),
            )
        }
        "user" => {
            let term = data["query"]
                .as_str()
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase();
            if term.is_empty() || term.len() > 254 {
                return Err(ApiError::invalid("กรุณาระบุอีเมลหรือ UID"));
            }
            let uid: String =
                sqlx::query_scalar("SELECT id FROM accounts WHERE email=$1 OR id=$1 LIMIT 1")
                    .bind(&term)
                    .fetch_optional(&state.db)
                    .await?
                    .ok_or_else(|| ApiError::new("not-found", "ไม่พบบัญชี"))?;
            let row = sqlx::query("SELECT a.email,a.email_verified,a.suspended,a.role,a.google_subject IS NOT NULL AS google,a.password_hash IS NOT NULL OR a.legacy_password AS password,
                    (extract(epoch FROM a.created_at)*1000)::bigint AS created_ms,(extract(epoch FROM a.last_sign_in_at)*1000)::bigint AS signed_ms,
                    p.raw,p.face_verified,p.visibility,e.record FROM accounts a JOIN profiles p ON p.user_id=a.id LEFT JOIN entitlements e ON e.user_id=a.id WHERE a.id=$1")
                .bind(&uid).fetch_one(&state.db).await?;
            let raw: Value = row.get("raw");
            let audits = sqlx::query("SELECT id::text AS id,actor_id,action,details,(extract(epoch FROM created_at)*1000)::bigint AS ms FROM admin_audit WHERE target_id=$1 ORDER BY created_at DESC LIMIT 25")
                .bind(&uid).fetch_all(&state.db).await?;
            let mut providers = Vec::new();
            if row.get::<bool, _>("password") {
                providers.push("password");
            }
            if row.get::<bool, _>("google") {
                providers.push("google.com");
            }
            let record: Option<Value> = row.get("record");
            let email: String = row.get("email");
            Ok(json!({
                "uid": uid, "email": email, "emailVerified": row.get::<bool,_>("email_verified"), "disabled": row.get::<bool,_>("suspended"),
                "isAdmin": row.get::<String,_>("role")=="admin", "isSuperAdmin": is_super_admin(&email, true),
                "createdAt": iso(row.get("created_ms")), "lastSignIn": iso(row.get("signed_ms")),
                "name": raw["name"], "nickname": raw["nickname"], "avatarUrl": raw["avatarUri"], "avatarRevision": raw["avatarRevision"],
                "providers": providers, "profile": raw, "profileExists": true, "publicProfileExists": true,
                "isFaceVerified": row.get::<bool,_>("face_verified"),
                "faceVerificationStatus": if row.get::<bool,_>("face_verified") {"verified"} else {"unverified"},
                "auditLogs": audits.iter().map(|a| json!({"id":a.get::<String,_>("id"),"actor":a.get::<String,_>("actor_id"),"action":a.get::<String,_>("action"),"details":a.get::<Value,_>("details"),"createdAt":iso(a.get("ms"))})).collect::<Vec<_>>(),
                "faceSessions": [], "membership": record.unwrap_or(json!({})), "visibility": {"mode": row.get::<String,_>("visibility")},
                "stats": {
                    "reportsMade": sqlx::query_scalar::<_,i64>("SELECT count(*) FROM reports WHERE reporter_id=$1").bind(&uid).fetch_one(&state.db).await?,
                    "reportsReceived": sqlx::query_scalar::<_,i64>("SELECT count(*) FROM reports WHERE reported_user_id=$1").bind(&uid).fetch_one(&state.db).await?,
                    "conversations": sqlx::query_scalar::<_,i64>("SELECT count(*) FROM conversation_members WHERE user_id=$1").bind(&uid).fetch_one(&state.db).await?,
                    "auditLogsCount": audits.len(), "faceSessionsCount": 0},
                "restriction": {"suspended": row.get::<bool,_>("suspended")}, "emails": {"verificationStatus": if row.get::<bool,_>("email_verified") {"verified"} else {"pending"}},
            }))
        }
        "accountStatus" => {
            let uid = id(&data["uid"])?;
            let disabled = data["disabled"]
                .as_bool()
                .ok_or_else(|| ApiError::invalid("กรุณาระบุเหตุผล"))?;
            let reason = note(&data);
            if reason.is_empty() {
                return Err(ApiError::invalid("กรุณาระบุเหตุผล"));
            }
            let mut tx = state.db.begin().await?;
            let role: String =
                sqlx::query_scalar("SELECT role FROM accounts WHERE id=$1 FOR UPDATE")
                    .bind(&uid)
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or_else(|| ApiError::new("not-found", "ไม่พบบัญชี"))?;
            if uid == actor.uid || role == "admin" {
                return Err(ApiError::new(
                    "failed-precondition",
                    "ไม่สามารถระงับบัญชีผู้ดูแลจากหน้านี้",
                ));
            }
            suspend(&mut tx, &uid, disabled).await?;
            audit(
                &mut tx,
                &actor.uid,
                "accountStatus",
                Some(&uid),
                json!({"after":{"disabled":disabled},"note":reason}),
            )
            .await?;
            tx.commit().await?;
            Ok(json!({"success":true}))
        }
        "setAdminRole" => {
            if !actor.is_super {
                return Err(ApiError::new("permission-denied", "เฉพาะผู้ดูแลสูงสุดเท่านั้น"));
            }
            let uid = id(&data["uid"])?;
            let next = data["isAdmin"]
                .as_bool()
                .ok_or_else(|| ApiError::invalid("ต้องระบุค่าสิทธิ์แอดมิน (true/false)"))?;
            let mut tx = state.db.begin().await?;
            let before: String =
                sqlx::query_scalar("SELECT role FROM accounts WHERE id=$1 FOR UPDATE")
                    .bind(&uid)
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or_else(|| ApiError::new("not-found", "ไม่พบบัญชี"))?;
            sqlx::query("UPDATE accounts SET role=$2 WHERE id=$1")
                .bind(&uid)
                .bind(if next { "admin" } else { "user" })
                .execute(&mut *tx)
                .await?;
            audit(&mut tx, &actor.uid, "setAdminRole", Some(&uid), json!({"before":{"isAdmin":before=="admin"},"after":{"isAdmin":next},"note":note(&data)})).await?;
            events::publish_one(&mut tx, &uid, "account", None).await?;
            tx.commit().await?;
            Ok(json!({"success":true,"uid":uid,"isAdmin":next}))
        }
        "setFaceVerification" => {
            let uid = id(&data["uid"])?;
            let verified = data["isVerified"]
                .as_bool()
                .ok_or_else(|| ApiError::invalid("ต้องระบุค่าการยืนยันใบหน้า (true/false)"))?;
            let mut tx = state.db.begin().await?;
            if verified {
                sqlx::query("UPDATE profiles SET face_verified=true,revision=revision+1,updated_at=now() WHERE user_id=$1").bind(&uid).execute(&mut *tx).await?;
            } else {
                crate::identity::revoke_in(
                    &mut tx,
                    &uid,
                    "ADMIN_REVOKED",
                    ("admin", Some(&actor.uid)),
                )
                .await?;
            }
            notify::sync_face_inbox(&mut tx, &uid).await?;
            audit(
                &mut tx,
                &actor.uid,
                "setFaceVerification",
                Some(&uid),
                json!({"after":{"isFaceVerified":verified},"note":note(&data)}),
            )
            .await?;
            events::publish_one(&mut tx, &uid, "profile", Some(&uid)).await?;
            tx.commit().await?;
            Ok(
                json!({"success":true,"uid":uid,"isFaceVerified":verified,"faceMatchScore":Value::Null}),
            )
        }
        "switchMyRole" => switch_mode(state, headers, data).await,
        "audit" => {
            let before = data["cursor"]
                .as_str()
                .and_then(|c| Uuid::parse_str(c).ok());
            let rows = sqlx::query("SELECT id::text AS id,actor_id,action,target_id,details,(extract(epoch FROM created_at)*1000)::bigint AS ms FROM admin_audit WHERE ($1::uuid IS NULL OR created_at<(SELECT created_at FROM admin_audit WHERE id=$1)) ORDER BY created_at DESC LIMIT 30")
                .bind(before).fetch_all(&state.db).await?;
            let cursor = (rows.len() == 30)
                .then(|| rows.last().map(|r| r.get::<String, _>("id")))
                .flatten();
            Ok(
                json!({"rows": rows.iter().map(|r| json!({"id":r.get::<String,_>("id"),"actor":r.get::<String,_>("actor_id"),"action":r.get::<String,_>("action"),
                "target":r.get::<Option<String>,_>("target_id"),"details":r.get::<Value,_>("details"),"createdAt":iso(r.get("ms"))})).collect::<Vec<_>>(), "cursor": cursor}),
            )
        }
        "spots" => {
            let spots = crate::social::spots(state, headers, json!({})).await?;
            Ok(json!({"rows": spots["spots"]}))
        }
        "saveSpot" => {
            let spot = id(&data["id"])?;
            let mut patch = Map::new();
            for (key, max) in [
                ("name", 200),
                ("description", 2000),
                ("category", 50),
                ("categoryLabel", 50),
                ("group", 100),
                ("emoji", 10),
                ("rating", 10),
                ("busyTime", 100),
            ] {
                if let Some(value) = data[key].as_str() {
                    let value: String = value.trim().chars().take(max).collect();
                    if !value.is_empty() || key == "description" {
                        patch.insert(key.into(), json!(value));
                    }
                }
            }
            for key in ["latitude", "longitude"] {
                if let Some(value) = data[key].as_f64().filter(|v| v.is_finite()) {
                    patch.insert(key.into(), json!(value));
                }
            }
            if let Some(photo) = data["placePhoto"].as_object() {
                let url = photo
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim();
                let thumb = photo
                    .get("thumbnailUrl")
                    .and_then(Value::as_str)
                    .unwrap_or(url)
                    .trim();
                if !url.starts_with("https://")
                    || url.len() > 2048
                    || url.contains(char::is_whitespace)
                    || !thumb.starts_with("https://")
                    || thumb.len() > 2048
                {
                    return Err(ApiError::invalid("URL ของรูปภาพต้องเป็นลิงก์ HTTPS ที่ถูกต้อง"));
                }
                patch.insert("placePhoto".into(), json!({"spotId":spot,"url":url,"thumbnailUrl":thumb,
                    "credit": photo.get("credit").and_then(Value::as_str).map(|s| s.chars().take(200).collect::<String>()).unwrap_or_else(|| "CampusMate".into()),
                    "sourceUrl": photo.get("sourceUrl").and_then(Value::as_str).unwrap_or("https://getcampusmate.app"),
                    "license": photo.get("license").and_then(Value::as_str).unwrap_or("owned"), "licenseUrl": photo.get("licenseUrl").cloned().unwrap_or(Value::Null),
                    "modifications": "Updated via Admin Console", "revision": Uuid::new_v4().simple().to_string()}));
            }
            let mut tx = state.db.begin().await?;
            let before: Value = sqlx::query_scalar("SELECT data FROM spots WHERE id=$1 FOR UPDATE")
                .bind(&spot)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| ApiError::new("not-found", "ไม่พบสถานที่"))?;
            let updated: Value = sqlx::query_scalar(
                "UPDATE spots SET data=data||$2,updated_at=now() WHERE id=$1 RETURNING data",
            )
            .bind(&spot)
            .bind(Value::Object(patch.clone()))
            .fetch_one(&mut *tx)
            .await?;
            audit(
                &mut tx,
                &actor.uid,
                "saveSpot",
                Some(&spot),
                json!({"before":before,"after":patch}),
            )
            .await?;
            tx.commit().await?;
            let mut spot_json = updated;
            spot_json["id"] = json!(spot);
            Ok(json!({"success":true,"spot":spot_json}))
        }
        "parties" => {
            let status = data["status"].as_str().filter(|s| *s != "all");
            let rows = sqlx::query("SELECT id,host_id,host,location,schedule,status,max_people,(SELECT count(*) FROM party_members m WHERE m.party_id=p.id) AS members,(extract(epoch FROM created_at)*1000)::bigint AS ms FROM parties p WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT 50")
                .bind(status).fetch_all(&state.db).await?;
            Ok(
                json!({"rows": rows.iter().map(|r| json!({"id":r.get::<String,_>("id"),"hostId":r.get::<String,_>("host_id"),"host":r.get::<Value,_>("host"),
                "location":r.get::<Value,_>("location"),"schedule":r.get::<Value,_>("schedule"),"status":r.get::<String,_>("status"),
                "maxPeople":r.get::<i32,_>("max_people"),"memberCount":r.get::<i64,_>("members"),"createdAt":iso(r.get("ms"))})).collect::<Vec<_>>()}),
            )
        }
        "cancelParty" => {
            let party = id(&data["id"])?;
            let reason = note(&data);
            if reason.is_empty() {
                return Err(ApiError::invalid("กรุณาระบุเหตุผลการยกเลิก"));
            }
            let mut tx = state.db.begin().await?;
            let status: String =
                sqlx::query_scalar("SELECT status FROM parties WHERE id=$1 FOR UPDATE")
                    .bind(&party)
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or_else(|| ApiError::new("not-found", "ไม่พบข้อมูลตี้"))?;
            if status == "cancelled" {
                return Err(ApiError::new("failed-precondition", "ตี้นี้ถูกยกเลิกไปแล้ว"));
            }
            sqlx::query("UPDATE parties SET status='cancelled',cancelled_at=now(),updated_at=now() WHERE id=$1").bind(&party).execute(&mut *tx).await?;
            let members: Vec<String> =
                sqlx::query_scalar("SELECT user_id FROM party_members WHERE party_id=$1")
                    .bind(&party)
                    .fetch_all(&mut *tx)
                    .await?;
            let users: Vec<&str> = members.iter().map(String::as_str).collect();
            events::publish(&mut tx, &users, "parties", Some(&party)).await?;
            audit(
                &mut tx,
                &actor.uid,
                "cancelParty",
                Some(&party),
                json!({"before":{"status":status},"note":reason}),
            )
            .await?;
            tx.commit().await?;
            Ok(json!({"success":true}))
        }
        "serviceStatus" => {
            let (maintenance, revision) = config(state, service_status::CONFIG_ID).await?;
            Ok(json!({
                "status": service_status::snapshot(state).await,
                "maintenance": maintenance.unwrap_or(json!({})),
                "revision": revision,
                "feedback": {
                    "new": count(state, "SELECT count(*) FROM app_feedback WHERE status='new'").await?,
                    "bugsLastHour": count(state, "SELECT count(*) FROM app_feedback WHERE kind='bug' AND created_at>now()-interval '1 hour'").await?,
                },
            }))
        }
        "saveMaintenance" => {
            let saved = save_config(
                state,
                &actor.uid,
                service_status::CONFIG_ID,
                &data["revision"],
                service_status::validate(&data["maintenance"])?,
                false,
            )
            .await?;
            // Takes effect on the next request, not after the cache expires.
            service_status::invalidate();
            Ok(saved)
        }
        "resetAutoProtect" => {
            let mut tx = state.db.begin().await?;
            audit(&mut tx, &actor.uid, "resetAutoProtect", None, json!({})).await?;
            tx.commit().await?;
            service_status::reset_breaker();
            Ok(json!({"success":true}))
        }
        "feedback" => {
            let status = data["status"]
                .as_str()
                .filter(|s| feedback::STATUSES.contains(s))
                .unwrap_or("all");
            let kind = data["kind"]
                .as_str()
                .filter(|k| matches!(*k, "bug" | "feedback"))
                .unwrap_or("all");
            // Cursor: `<created ms>:<id>` of the last row already shown.
            let cursor = data["cursor"]
                .as_str()
                .and_then(|c| c.split_once(':'))
                .and_then(|(ms, id)| {
                    Some((
                        chrono::DateTime::<Utc>::from_timestamp_millis(ms.parse().ok()?)?,
                        Uuid::parse_str(id).ok()?,
                    ))
                });
            let rows = sqlx::query(
                "SELECT id,user_id,kind,message,app_version,app_build,platform,os_version,screen,status,admin_note,
                   created_at,updated_at,screenshot IS NOT NULL AS has_screenshot
                 FROM app_feedback WHERE ($1='all' OR status=$1) AND ($2='all' OR kind=$2)
                   AND ($3::timestamptz IS NULL OR (created_at,id)<($3,$4))
                 ORDER BY created_at DESC,id DESC LIMIT 31",
            )
            .bind(status)
            .bind(kind)
            .bind(cursor.map(|(at, _)| at))
            .bind(cursor.map(|(_, id)| id).unwrap_or_default())
            .fetch_all(&state.db)
            .await?;
            let next = (rows.len() > 30).then(|| {
                let last = &rows[29];
                format!(
                    "{}:{}",
                    last.get::<chrono::DateTime<Utc>, _>("created_at")
                        .timestamp_millis(),
                    last.get::<Uuid, _>("id")
                )
            });
            Ok(
                json!({"rows": rows.iter().take(30).map(|row| feedback::row_json(row, false)).collect::<Vec<_>>(), "cursor": next}),
            )
        }
        "feedbackDetail" => {
            let id = Uuid::parse_str(data["id"].as_str().unwrap_or_default())
                .map_err(|_| ApiError::invalid("รหัสไม่ถูกต้อง"))?;
            let row = sqlx::query(
                "SELECT *,screenshot IS NOT NULL AS has_screenshot FROM app_feedback WHERE id=$1",
            )
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| ApiError::new("not-found", "ไม่พบรายงานนี้"))?;
            let reporter = person(state, Some(row.get::<String, _>("user_id"))).await?;
            Ok(json!({"feedback": feedback::row_json(&row, true), "reporter": reporter}))
        }
        "updateFeedback" => {
            let id = Uuid::parse_str(data["id"].as_str().unwrap_or_default())
                .map_err(|_| ApiError::invalid("รหัสไม่ถูกต้อง"))?;
            let status = data["status"]
                .as_str()
                .filter(|s| feedback::STATUSES.contains(s))
                .ok_or_else(|| ApiError::invalid("สถานะไม่ถูกต้อง"))?;
            let note = note(&data);
            let mut tx = state.db.begin().await?;
            let before: Option<String> =
                sqlx::query_scalar("SELECT status FROM app_feedback WHERE id=$1 FOR UPDATE")
                    .bind(id)
                    .fetch_optional(&mut *tx)
                    .await?;
            let before = before.ok_or_else(|| ApiError::new("not-found", "ไม่พบรายงานนี้"))?;
            // A closed report no longer needs its screenshot.
            sqlx::query(
                "UPDATE app_feedback SET status=$2,admin_note=$3,updated_at=now(),
                   screenshot=CASE WHEN $2 IN ('resolved','dismissed') THEN NULL ELSE screenshot END
                 WHERE id=$1",
            )
            .bind(id)
            .bind(status)
            .bind(&note)
            .execute(&mut *tx)
            .await?;
            audit(
                &mut tx,
                &actor.uid,
                "updateFeedback",
                Some(&id.to_string()),
                json!({"before":{"status":before},"after":{"status":status},"note":note}),
            )
            .await?;
            tx.commit().await?;
            Ok(json!({"success":true}))
        }
        "settings" => {
            let (version, revision) = config(state, "version").await?;
            let (remote, etag) = config(state, "remoteConfig").await?;
            let (ops, ops_revision) = config(state, "adminOperations").await?;
            Ok(
                json!({"version":version.unwrap_or(json!({})),"revision":revision,"features":remote.clone().unwrap_or(json!({})),"etag":etag,
                "remoteParameters":remote.unwrap_or(json!({})),"remoteConditions":[],"opsConfig":operations(ops.as_ref()),"opsRevision":ops_revision,
                "systemInfo":{"projectId":"campusmate-rust","region":"sin","emailSenderConfigured":true,"mediaSigningConfigured":state.media.is_some(),
                    "notificationProvider":"Expo Push","encryption":"E2EE","configRefreshMinutes":60}}),
            )
        }
        "saveVersion" => {
            save_config(
                state,
                &actor.uid,
                "version",
                &data["revision"],
                validate_version(&data["version"])?,
                true,
            )
            .await
        }
        "saveOperations" => {
            let ops = operations(Some(&data["config"]));
            save_config(
                state,
                &actor.uid,
                "adminOperations",
                &data["revision"],
                ops,
                false,
            )
            .await
        }
        "saveFeatures" | "saveRemoteParameters" | "validateRemoteParameters" => {
            let values = if op == "saveFeatures" {
                &data["features"]
            } else {
                &data["parameters"]
            };
            let values = values
                .as_object()
                .filter(|v| v.len() <= 100)
                .ok_or_else(|| ApiError::invalid("ค่าฟีเจอร์ไม่ถูกต้อง"))?;
            if values.iter().any(|(k, v)| {
                k.len() > 100
                    || !k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
                    || v.as_str().is_none_or(|s| s.len() > 5000)
            }) {
                return Err(ApiError::invalid("ค่าฟีเจอร์ไม่ถูกต้อง"));
            }
            if op == "validateRemoteParameters" {
                return Ok(json!({"valid":true,"changed":values.len()}));
            }
            save_config(
                state,
                &actor.uid,
                "remoteConfig",
                &data["etag"],
                Value::Object(values.clone()),
                true,
            )
            .await
        }
        "previewNotification" | "sendNotification" => announcement(state, &actor, &op, &data).await,
        "notificationHistory" => {
            let rows = sqlx::query("SELECT id::text AS id,details,(extract(epoch FROM created_at)*1000)::bigint AS ms FROM admin_audit WHERE action='sendNotification' ORDER BY created_at DESC LIMIT 50")
                .fetch_all(&state.db).await?;
            Ok(
                json!({"rows": rows.iter().map(|r| { let mut d: Value = r.get("details"); d["id"] = json!(r.get::<String,_>("id")); d["createdAt"] = iso(r.get("ms")); d }).collect::<Vec<_>>()}),
            )
        }
        "notificationReceipts" => Ok(json!({"handedOff":0,"error":0,"pending":0})),
        "previewAccountDeletion" => {
            let uid = id(&data["uid"])?;
            let p = person(state, Some(uid.clone())).await?;
            Ok(
                json!({"uid":uid,"account":p,"conversations":sqlx::query_scalar::<_,i64>("SELECT count(*) FROM conversation_members WHERE user_id=$1").bind(&uid).fetch_one(&state.db).await?}),
            )
        }
        "deleteAccount" => Err(ApiError::new(
            "failed-precondition",
            "การลบบัญชีต้องให้เจ้าของยืนยันด้วยรหัสจากอีเมล หรือระงับบัญชีแทน",
        )),
        "emailHealth" | "sendEmail" => Err(ApiError::new(
            "unimplemented",
            "ส่งอีเมลจากระบบงานอีเมลแยก (email-worker)",
        )),
        _ => Err(ApiError::invalid("คำสั่งไม่รองรับ")),
    }
}

/// Admin announcements: preview counts recipients; send enqueues one inbox
/// row and push job per active recipient (respecting notification switches).
async fn announcement(
    state: &AppState,
    actor: &Actor,
    op: &str,
    data: &Value,
) -> Result<Value, ApiError> {
    let (ops, _) = config(state, "adminOperations").await?;
    let policy = operations(ops.as_ref());
    if policy["customNotificationsEnabled"] != true {
        return Err(ApiError::new(
            "failed-precondition",
            "การส่งแจ้งเตือนถูกปิดในหน้าตั้งค่า",
        ));
    }
    let max = policy["maxNotificationRecipients"].as_i64().unwrap_or(500);
    if op == "sendNotification" {
        let preview = data["id"]
            .as_str()
            .and_then(|v| Uuid::parse_str(v).ok())
            .ok_or_else(|| ApiError::invalid("คำขอส่งไม่ถูกต้อง"))?;
        let mut tx = state.db.begin().await?;
        let details: Value = sqlx::query_scalar("SELECT details FROM admin_audit WHERE id=$1 AND actor_id=$2 AND action='previewNotification' AND created_at>now()-interval '5 minutes' FOR UPDATE")
            .bind(preview).bind(&actor.uid).fetch_optional(&mut *tx).await?
            .ok_or_else(|| ApiError::new("failed-precondition", "ตัวอย่างหมดอายุ กรุณาตรวจผู้รับใหม่"))?;
        let already: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM admin_audit WHERE action='sendNotification' AND target_id=$1)")
            .bind(preview.to_string()).fetch_one(&mut *tx).await?;
        if already {
            return Err(ApiError::new("failed-precondition", "คำขอนี้ส่งแล้ว"));
        }
        let uids: Vec<String> = serde_json::from_value(details["uids"].clone()).unwrap_or_default();
        let mut target = Map::new();
        if let Some(route) = details["route"].as_str() {
            target.insert("route".into(), json!(route));
        }
        let notice = notify::system(
            "admin_announcement",
            details["title"].as_str().unwrap_or("CampusMate"),
            details["body"].as_str().unwrap_or_default(),
            target,
        );
        let mut sent = 0;
        for uid in &uids {
            let active: bool = sqlx::query_scalar(
                "SELECT NOT suspended AND deleted_at IS NULL FROM accounts WHERE id=$1",
            )
            .bind(uid)
            .fetch_optional(&mut *tx)
            .await?
            .unwrap_or(false);
            if active {
                notify::enqueue(&mut tx, uid, &format!("announcement:{preview}"), &notice).await?;
                sent += 1;
            }
        }
        let result = json!({"persisted":sent,"accepted":sent,"failed":0,"devices":Value::Null,"skipped":uids.len()-sent,"state":"accepted",
            "title":details["title"],"body":details["body"],"audience":details["audience"],"recipients":uids.len()});
        audit(
            &mut tx,
            &actor.uid,
            "sendNotification",
            Some(&preview.to_string()),
            result.clone(),
        )
        .await?;
        tx.commit().await?;
        return Ok(result);
    }
    let title: String = data["title"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(120)
        .collect();
    let body: String = data["body"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(500)
        .collect();
    if title.is_empty() || body.is_empty() {
        return Err(ApiError::invalid("กรุณาระบุหัวข้อและข้อความ"));
    }
    let route = data["route"]
        .as_str()
        .filter(|r| r.starts_with('/') && r.len() <= 200 && !r.contains("//"));
    let uids: Vec<String> = if data["audience"] == "all" {
        sqlx::query_scalar("SELECT id FROM accounts WHERE NOT suspended AND deleted_at IS NULL ORDER BY id LIMIT $1").bind(max + 1).fetch_all(&state.db).await?
    } else {
        let wanted: Vec<String> = data["uids"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect();
        sqlx::query_scalar(
            "SELECT id FROM accounts WHERE id=ANY($1) AND NOT suspended AND deleted_at IS NULL",
        )
        .bind(&wanted)
        .fetch_all(&state.db)
        .await?
    };
    if uids.len() as i64 > max {
        return Err(ApiError::new("resource-exhausted", "จำนวนผู้รับเกินเพดานต่อครั้ง"));
    }
    if uids.is_empty() {
        return Err(ApiError::new("failed-precondition", "ไม่มีบัญชีที่รับแจ้งเตือนได้"));
    }
    let mut tx = state.db.begin().await?;
    let preview: Uuid = sqlx::query_scalar("INSERT INTO admin_audit(actor_id,action,details) VALUES($1,'previewNotification',$2) RETURNING id")
        .bind(&actor.uid).bind(json!({"title":title,"body":body,"route":route,"audience":data["audience"],"uids":uids})).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(
        json!({"id":preview,"title":title,"body":body,"route":route,"audience":data["audience"],"recipients":uids.len(),"devices":Value::Null,"excluded":0,
        "expiresAt":(Utc::now()+chrono::Duration::minutes(5)).to_rfc3339()}),
    )
}

/// Legacy `uploadPlacePhoto` is replaced by `saveSpot` with an HTTPS photo URL.
pub async fn upload_place_photo(
    state: &AppState,
    headers: &HeaderMap,
    _: Value,
) -> Result<Value, ApiError> {
    actor(state, headers).await?;
    Err(ApiError::new(
        "unimplemented",
        "ใช้ saveSpot พร้อมลิงก์รูปภาพ HTTPS แทน",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn super_admin_requires_verified_exact_email() {
        assert!(is_super_admin("6710210317@psu.ac.th", true));
        assert!(is_super_admin(" 6710210317@PSU.AC.TH", true));
        assert!(!is_super_admin("6710210317@psu.ac.th", false));
        assert!(!is_super_admin("6710210318@psu.ac.th", true));
    }

    #[test]
    fn version_settings_are_validated() {
        assert!(validate_version(&json!({"enabled":true,"latestVersion":"1.2.3"})).is_ok());
        assert!(validate_version(&json!({"latestVersion":"1.2"})).is_err());
        assert!(validate_version(&json!({"appStoreUrl":"https://evil.example"})).is_err());
        assert!(validate_version(&json!({"forceUpdate":true})).is_err());
        assert!(validate_version(&json!({"unknown":true})).is_err());
    }
}
