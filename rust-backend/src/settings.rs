//! Private account preferences and session-bound, expiring chat presence.
use axum::http::HeaderMap;
use serde_json::{json, Map, Value};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::{auth, error::ApiError, events, AppState};

fn defaults() -> Value {
    json!({"theme":"system","autoplay":"always","muteAutoplayVideo":true,
        "recommendation":"balanced","publicUsername":"","showOnlineStatus":true,
        "notifications":{"push":true,"email":false,"sms":false,"team":true}})
}

async fn read(db: &mut PgConnection, uid: &str) -> Result<(Value, i64), ApiError> {
    let row = sqlx::query("SELECT COALESCE(s.settings,'{}'::jsonb) AS settings,COALESCE(s.revision,-1) AS revision,
        COALESCE((p.raw->>'notificationsEnabled')::boolean,true) AS legacy_push
        FROM accounts a LEFT JOIN user_app_settings s ON s.user_id=a.id LEFT JOIN profiles p ON p.user_id=a.id WHERE a.id=$1")
        .bind(uid).fetch_one(db).await?;
    let stored: Value = row.get("settings");
    let mut preferences = defaults();
    preferences["notifications"]["push"] = json!(row.get::<bool, _>("legacy_push"));
    if let Some(map) = stored.as_object() {
        for (key, value) in map {
            if key == "notifications" {
                for channel in ["push", "team"] {
                    if let Some(flag) = value.get(channel).and_then(Value::as_bool) {
                        preferences["notifications"][channel] = json!(flag);
                    }
                }
            } else if preferences.get(key).is_some() {
                preferences[key] = value.clone();
            }
        }
    }
    Ok((preferences, row.get("revision")))
}

fn response(preferences: Value, revision: i64) -> Value {
    json!({"preferences":preferences,"revision":revision,
        "capabilities":{"presence":true,"push":true,"email":false,"sms":false,"team":true,
            "publicUsername":true}})
}

pub async fn get(state: &AppState, headers: &HeaderMap) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let mut db = state.db.acquire().await?;
    let (preferences, revision) = read(&mut db, &user.uid).await?;
    Ok(response(preferences, revision))
}

fn merge(preferences: &mut Value, patch: &Map<String, Value>) -> Result<(), ApiError> {
    if patch.is_empty() || patch.len() > 7 {
        return Err(ApiError::invalid("การตั้งค่าไม่ถูกต้อง"));
    }
    for (key, value) in patch {
        let valid = match key.as_str() {
            "theme" => value
                .as_str()
                .is_some_and(|v| ["system", "light", "dark"].contains(&v)),
            "autoplay" => value
                .as_str()
                .is_some_and(|v| ["always", "wifi", "never"].contains(&v)),
            "recommendation" => value
                .as_str()
                .is_some_and(|v| ["balanced", "recent"].contains(&v)),
            "muteAutoplayVideo" | "showOnlineStatus" => value.is_boolean(),
            "publicUsername" => value.as_str().is_some_and(|v| {
                v.is_empty()
                    || ((3..=30).contains(&v.len())
                        && v.bytes().all(|b| {
                            b.is_ascii_lowercase() || b.is_ascii_digit() || b"_.".contains(&b)
                        }))
            }),
            "notifications" => value.as_object().is_some_and(|flags| {
                !flags.is_empty()
                    && flags.len() <= 4
                    && flags.iter().all(|(k, v)| {
                        ["push", "email", "sms", "team"].contains(&k.as_str())
                            && v.is_boolean()
                            && (["push", "team"].contains(&k.as_str()) || v == &Value::Bool(false))
                    })
            }),
            _ => false,
        };
        if !valid {
            return Err(ApiError::invalid("การตั้งค่าไม่ถูกต้อง หรือช่องทางนี้ยังไม่เปิดให้บริการ"));
        }
        if key == "notifications" {
            for (name, flag) in value.as_object().expect("validated flags") {
                preferences["notifications"][name] = flag.clone();
            }
        } else {
            preferences[key] = value.clone();
        }
    }
    Ok(())
}

async fn signal_peers(db: &mut PgConnection, uid: &str) -> Result<(), ApiError> {
    let rows = sqlx::query("SELECT c.id,CASE WHEN c.member_a=$1 THEN c.member_b ELSE c.member_a END AS peer
        FROM conversations c WHERE (c.member_a=$1 OR c.member_b=$1) AND c.active
        AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.actor_id=c.member_a AND b.target_id=c.member_b)
            OR (b.actor_id=c.member_b AND b.target_id=c.member_a)) LIMIT 500")
        .bind(uid).fetch_all(&mut *db).await?;
    for row in rows {
        events::publish_one(
            db,
            &row.get::<String, _>("peer"),
            "presence",
            Some(&row.get::<String, _>("id")),
        )
        .await?;
    }
    Ok(())
}

pub async fn save(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    crate::throttle(&state.db, "app-settings", &user.uid, 60).await?;
    let patch = data["settings"]
        .as_object()
        .ok_or_else(|| ApiError::invalid("การตั้งค่าไม่ถูกต้อง"))?;
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE")
        .bind(&user.uid)
        .fetch_one(&mut *tx)
        .await?;
    auth::reauthorize_session(&mut tx, headers).await?;
    let (mut preferences, revision) = read(&mut tx, &user.uid).await?;
    if data["expectedRevision"]
        .as_i64()
        .is_some_and(|expected| expected != revision)
    {
        return Err(ApiError::new(
            "aborted",
            "การตั้งค่าเปลี่ยนจากอีกอุปกรณ์ กรุณาโหลดใหม่",
        ));
    }
    merge(&mut preferences, patch)?;
    let username = preferences["publicUsername"]
        .as_str()
        .filter(|v| !v.is_empty());
    let revision: i64 = sqlx::query_scalar("INSERT INTO user_app_settings(user_id,settings,public_username) VALUES($1,$2,$3)
        ON CONFLICT(user_id) DO UPDATE SET settings=excluded.settings,public_username=excluded.public_username,
        revision=user_app_settings.revision+1,updated_at=now() RETURNING revision")
        .bind(&user.uid).bind(&preferences).bind(username).fetch_one(&mut *tx).await
        .map_err(|error| if error.as_database_error().is_some_and(|e| e.code().as_deref()==Some("23505")) {
            ApiError::new("already-exists", "ชื่อผู้ใช้นี้มีคนใช้แล้ว กรุณาเลือกชื่ออื่น")
        } else { ApiError::from(error) })?;
    if patch
        .get("notifications")
        .and_then(|n| n.get("push"))
        .is_some()
    {
        sqlx::query("UPDATE profiles SET raw=jsonb_set(raw,'{notificationsEnabled}',$2),revision=revision+1 WHERE user_id=$1")
            .bind(&user.uid).bind(&preferences["notifications"]["push"]).execute(&mut *tx).await?;
        events::publish_one(&mut tx, &user.uid, "profile", Some(&user.uid)).await?;
    }
    events::publish_one(&mut tx, &user.uid, "preferences", Some(&user.uid)).await?;
    if patch.contains_key("showOnlineStatus") {
        signal_peers(&mut tx, &user.uid).await?;
    }
    tx.commit().await?;
    Ok(response(preferences, revision))
}

pub async fn heartbeat(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let active = data["active"]
        .as_bool()
        .ok_or_else(|| ApiError::invalid("สถานะไม่ถูกต้อง"))?;
    crate::throttle(&state.db, "presence", &user.uid, 20).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE")
        .bind(&user.uid)
        .fetch_one(&mut *tx)
        .await?;
    auth::reauthorize_session(&mut tx, headers).await?;
    let family: Uuid =
        sqlx::query_scalar("SELECT family_id FROM sessions WHERE access_hash=$1 AND user_id=$2")
            .bind(auth::bearer_hash(headers)?)
            .bind(&user.uid)
            .fetch_one(&mut *tx)
            .await?;
    sqlx::query("INSERT INTO user_presence(user_id,family_id,online_until,last_active_at)
        VALUES($1,$2,CASE WHEN $3 THEN now()+interval '90 seconds' ELSE now() END,CASE WHEN $3 THEN now() ELSE NULL END)
        ON CONFLICT(user_id,family_id) DO UPDATE SET online_until=excluded.online_until,
        last_active_at=CASE WHEN $3 THEN now() ELSE user_presence.last_active_at END")
        .bind(&user.uid).bind(family).bind(active).execute(&mut *tx).await?;
    signal_peers(&mut tx, &user.uid).await?;
    tx.commit().await?;
    Ok(json!({"ok":true,"leaseSeconds":90}))
}

pub async fn presence(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let ids: Vec<String> = data["conversationIds"]
        .as_array()
        .filter(|ids| ids.len() <= 100)
        .ok_or_else(|| ApiError::invalid("รายการห้องไม่ถูกต้อง"))?
        .iter()
        .map(|id| {
            id.as_str()
                .filter(|v| crate::chat::room_id(v).is_ok())
                .map(str::to_owned)
                .ok_or_else(|| ApiError::invalid("ห้องไม่ถูกต้อง"))
        })
        .collect::<Result<_, _>>()?;
    crate::throttle(&state.db, "chat-presence", &user.uid, 60).await?;
    let rows = sqlx::query("SELECT c.id,a.id AS peer,
        COALESCE((mine.settings->>'showOnlineStatus')::boolean,true)
          AND COALESCE((theirs.settings->>'showOnlineStatus')::boolean,true)
          AND NOT a.suspended AND a.deleted_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.actor_id=$1 AND b.target_id=a.id) OR (b.actor_id=a.id AND b.target_id=$1)) AS visible,
        (extract(epoch FROM activity.until)*1000)::bigint AS until_ms,
        (extract(epoch FROM activity.last_at)*1000)::bigint AS last_ms
        FROM conversations c JOIN conversation_members me ON me.conversation_id=c.id AND me.user_id=$1
        JOIN accounts a ON a.id=CASE WHEN c.member_a=$1 THEN c.member_b ELSE c.member_a END
        LEFT JOIN user_app_settings mine ON mine.user_id=$1 LEFT JOIN user_app_settings theirs ON theirs.user_id=a.id
        LEFT JOIN LATERAL (SELECT max(p.last_active_at) AS last_at,
            max(p.online_until) FILTER(WHERE EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=p.user_id AND s.family_id=p.family_id
                AND s.revoked_at IS NULL AND s.used_at IS NULL AND s.expires_at>now())) AS until
            FROM user_presence p WHERE p.user_id=a.id) activity ON true
        WHERE c.id=ANY($2) AND c.active")
        .bind(&user.uid).bind(&ids).fetch_all(&state.db).await?;
    let now = chrono::Utc::now().timestamp_millis();
    let mut out = Map::new();
    for row in rows {
        let visible: bool = row.get("visible");
        let until: Option<i64> = row.get("until_ms");
        let last: Option<i64> = row.get("last_ms");
        out.insert(
            row.get("id"),
            if visible {
                json!({"visible":true,"isOnline":until.is_some_and(|v| v>now),
            "lastActiveAt":last,"expiresAt":until,"userId":row.get::<String,_>("peer")})
            } else {
                json!({"visible":false,"isOnline":null,"lastActiveAt":null,"expiresAt":null})
            },
        );
    }
    Ok(json!({"presence":out,"serverTime":now}))
}
