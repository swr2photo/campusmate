//! Profile, likes, blocks, reports and small read-only services that the
//! legacy app reached through Firestore documents or simple callables.
use axum::{http::HeaderMap, Json};
use chrono::Utc;
use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::{auth, error::ApiError, events, policy, profiles, projection, AppState};

fn ms(row: &sqlx::postgres::PgRow, column: &str) -> Value {
    row.try_get::<Option<i64>, _>(column)
        .ok()
        .flatten()
        .map(Value::from)
        .unwrap_or(Value::Null)
}

/// The signed-in user's own record in the shape of the legacy `users/{uid}`.
pub async fn my_profile(
    state: &AppState,
    headers: &HeaderMap,
    _: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let row = sqlx::query(
        "SELECT p.raw,p.revision,p.face_verified,p.discoverable,p.is_new,p.visibility,a.email,a.role,
            (extract(epoch FROM p.updated_at)*1000)::bigint AS updated_ms,(extract(epoch FROM a.created_at)*1000)::bigint AS created_ms
         FROM profiles p JOIN accounts a ON a.id=p.user_id WHERE p.user_id=$1",
    )
    .bind(&user.uid)
    .fetch_optional(&state.db)
    .await?;
    let Some(row) = row else {
        return Ok(json!({"profile":null}));
    };
    let mut profile: Value = row.get("raw");
    if !profile.is_object() {
        profile = json!({});
    }
    for (key, value) in [
        ("id", json!(user.uid)),
        ("email", json!(row.get::<String, _>("email"))),
        ("isFaceVerified", json!(row.get::<bool, _>("face_verified"))),
        ("isDiscoverable", json!(row.get::<bool, _>("discoverable"))),
        ("isNewUser", json!(row.get::<bool, _>("is_new"))),
        ("visibilityMode", json!(row.get::<String, _>("visibility"))),
        ("role", json!(row.get::<String, _>("role"))),
        ("isAdmin", json!(row.get::<String, _>("role") == "admin")),
        ("updatedAt", ms(&row, "updated_ms")),
        ("createdAt", ms(&row, "created_ms")),
    ] {
        profile[key] = value;
    }
    Ok(json!({"profile":profile,"revision":row.get::<i64,_>("revision")}))
}

/// Merge-patch of the caller's profile (`null` removes a field). Validation,
/// photo ownership and face-badge revocation apply to the merged result.
pub async fn save_profile(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    crate::throttle(&state.db, "profile", &user.uid, 60).await?;
    let patch = data["patch"]
        .as_object()
        .ok_or_else(|| ApiError::invalid("ข้อมูลโปรไฟล์ไม่ถูกต้อง"))?
        .clone();
    let discoverable = data["isDiscoverable"].as_bool();
    let notifications_changed = patch.contains_key("notificationsEnabled");
    let mut tx = state.db.begin().await?;
    auth::lock_business_session(&mut tx, headers, &user.uid).await?;
    let current: Value = sqlx::query_scalar("SELECT raw FROM profiles WHERE user_id=$1 FOR UPDATE")
        .bind(&user.uid)
        .fetch_one(&mut *tx)
        .await?;
    let mut merged = current.as_object().cloned().unwrap_or_default();
    for (key, value) in patch {
        if value.is_null() {
            merged.remove(&key);
        } else {
            merged.insert(key, value);
        }
    }
    if (merged.contains_key("latitude") || merged.contains_key("longitude"))
        && (current.get("latitude") != merged.get("latitude")
            || current.get("longitude") != merged.get("longitude"))
    {
        merged.insert(
            "locationUpdatedAt".into(),
            json!(Utc::now().timestamp_millis()),
        );
    }
    let merged = Value::Object(merged);
    profiles::validate_profile(&merged)?;
    // New photos must be ones this server stored for the caller; unchanged
    // legacy URLs (imported accounts) stay valid.
    let previous_avatar = current.get("avatarUri").and_then(Value::as_str);
    let next_avatar = merged.get("avatarUri").and_then(Value::as_str);
    if let Some(next) = next_avatar.filter(|next| Some(*next) != previous_avatar) {
        if !crate::media::owned_profile_url(state, next, &user.uid) {
            return Err(ApiError::invalid("รูปโปรไฟล์นี้ไม่ตรงกับบัญชีปัจจุบัน กรุณาเลือกรูปใหม่"));
        }
    }
    let old_gallery: Vec<&str> = current["gallery"]
        .as_array()
        .map(|g| g.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if let Some(gallery) = merged["gallery"].as_array() {
        if gallery.len() > 8 {
            return Err(ApiError::invalid("แกลเลอรีมีรูปได้สูงสุด 8 รูป"));
        }
        for url in gallery.iter().filter_map(Value::as_str) {
            if !old_gallery.contains(&url)
                && !crate::media::owned_profile_url(state, url, &user.uid)
            {
                return Err(ApiError::invalid("รูปในแกลเลอรีไม่ถูกต้อง"));
            }
        }
    }
    let photo_changed = previous_avatar != next_avatar;
    if previous_avatar.is_some()
        && (photo_changed || current["avatarRevision"] != merged["avatarRevision"])
    {
        return Err(ApiError::new(
            "failed-precondition",
            "ต้องยืนยันรูปหลักใหม่ให้ผ่านก่อนเปลี่ยนรูปโปรไฟล์",
        ));
    }
    if photo_changed {
        crate::identity::revoke_in(
            &mut tx,
            &user.uid,
            "PHOTO_CHANGED",
            ("user", Some(&user.uid)),
        )
        .await?;
    }
    let revision: i64 = sqlx::query_scalar(
        "UPDATE profiles SET raw=$2,is_new=NOT($2 ? 'name' AND $2 ? 'age'),discoverable=COALESCE($3,discoverable),
         revision=revision+1,updated_at=now() WHERE user_id=$1 RETURNING revision",
    )
    .bind(&user.uid)
    .bind(&merged)
    .bind(discoverable)
    .fetch_one(&mut *tx)
    .await?;
    // Matched peers refresh the conversation card.
    if let Some(enabled) = merged
        .get("notificationsEnabled")
        .and_then(Value::as_bool)
        .filter(|_| notifications_changed)
    {
        sqlx::query("INSERT INTO user_app_settings(user_id,settings) VALUES($1,jsonb_build_object('notifications',jsonb_build_object('push',$2::boolean)))
            ON CONFLICT(user_id) DO UPDATE SET settings=user_app_settings.settings || jsonb_build_object('notifications',
            COALESCE(user_app_settings.settings->'notifications','{}'::jsonb) || jsonb_build_object('push',$2::boolean)),
            revision=user_app_settings.revision+1,updated_at=now()")
            .bind(&user.uid).bind(enabled).execute(&mut *tx).await?;
        events::publish_one(&mut tx, &user.uid, "preferences", Some(&user.uid)).await?;
    }
    let peers: Vec<String> = sqlx::query_scalar(
        "SELECT CASE WHEN member_a=$1 THEN member_b ELSE member_a END FROM conversations WHERE (member_a=$1 OR member_b=$1) AND active",
    )
    .bind(&user.uid)
    .fetch_all(&mut *tx)
    .await?;
    let mut users: Vec<&str> = peers.iter().map(String::as_str).collect();
    users.push(&user.uid);
    events::publish(&mut tx, &users, "profile", Some(&user.uid)).await?;
    tx.commit().await?;
    if photo_changed {
        if let Some(services) = state.identity.clone() {
            if crate::identity::purge_snapshots(&state.db, services.store.as_ref(), Some(&user.uid))
                .await
                .is_err()
            {
                tracing::warn!("verification snapshot purge deferred");
            }
        }
    }
    Ok(json!({"revision":revision}))
}

/// Legacy `setProfileVisibility` (mode only; discoverable is unchanged).
pub async fn set_visibility(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let mode = data["mode"].as_str().unwrap_or_default().to_owned();
    let discoverable: bool =
        sqlx::query_scalar("SELECT discoverable FROM profiles WHERE user_id=$1")
            .bind(&user.uid)
            .fetch_one(&state.db)
            .await?;
    let Json(result) = profiles::visibility(
        axum::extract::State(state.clone()),
        headers.clone(),
        Json(profiles::Visibility {
            mode,
            discoverable: data["isDiscoverable"].as_bool().unwrap_or(discoverable),
        }),
    )
    .await?;
    let mut tx = state.db.begin().await?;
    events::publish_one(&mut tx, &user.uid, "profile", Some(&user.uid)).await?;
    tx.commit().await?;
    Ok(json!({"mode":result["mode"]}))
}

pub async fn visibility_state(
    state: &AppState,
    headers: &HeaderMap,
    _: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let row = sqlx::query("SELECT visibility,discoverable FROM profiles WHERE user_id=$1")
        .bind(&user.uid)
        .fetch_one(&state.db)
        .await?;
    Ok(
        json!({"mode":row.get::<String,_>("visibility"),"isDiscoverable":row.get::<bool,_>("discoverable")}),
    )
}

const PAGE: i64 = 20;

/// Pending likes whose profiles the viewer is allowed to open. A raw decision
/// count includes unverified, hidden and blocked accounts, which the app then
/// showed as a profile that never arrives.
async fn viewable_pending_count(state: &AppState, uid: &str) -> Result<i64, ApiError> {
    let now = Utc::now().timestamp_millis();
    let rows = sqlx::query(
        "SELECT p.user_id,p.discoverable,p.is_new,p.face_verified,p.visibility,e.record AS entitlement,
           EXISTS(SELECT 1 FROM blocks b WHERE (b.actor_id=$1 AND b.target_id=p.user_id) OR (b.actor_id=p.user_id AND b.target_id=$1)) AS blocked,
           ((EXISTS(SELECT 1 FROM decisions d2 WHERE ((d2.actor_id=$1 AND d2.target_id=p.user_id) OR (d2.actor_id=p.user_id AND d2.target_id=$1)) AND d2.kind='like' AND d2.status='accepted')
             OR EXISTS(SELECT 1 FROM conversations c WHERE c.active AND ((c.member_a=$1 AND c.member_b=p.user_id) OR (c.member_a=p.user_id AND c.member_b=$1))))
             AND NOT EXISTS(SELECT 1 FROM decisions d3 WHERE ((d3.actor_id=$1 AND d3.target_id=p.user_id) OR (d3.actor_id=p.user_id AND d3.target_id=$1)) AND d3.status IN ('removed','rejected'))) AS matched
         FROM decisions d
         JOIN accounts a ON a.id=d.actor_id
         JOIN profiles p ON p.user_id=d.actor_id
         LEFT JOIN entitlements e ON e.user_id=p.user_id
         WHERE d.target_id=$1 AND d.kind='like' AND d.status='pending'
           AND NOT a.suspended AND a.deleted_at IS NULL AND a.email_verified",
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await?;
    let count = rows
        .iter()
        .filter(|row| {
            let owner_id: String = row.get("user_id");
            let visibility: String = row.get("visibility");
            let entitlement: Option<Value> = row.get("entitlement");
            policy::can_view_profile(
                uid,
                &owner_id,
                &policy::ViewCheck {
                    owner_exists: true,
                    owner_discoverable: row.get("discoverable"),
                    owner_is_new: row.get("is_new"),
                    owner_face_verified: row.get("face_verified"),
                    blocked: row.get("blocked"),
                    matched: row.get("matched"),
                    owner_liked_viewer: true,
                    visibility_mode: Some(visibility.as_str()),
                    owner_entitlement: entitlement.as_ref(),
                    now_ms: now,
                },
            )
        })
        .count();
    Ok(count as i64)
}

/// Legacy `getIncomingLikeSummary`: free plans see a count only.
pub async fn incoming_likes(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let now = Utc::now().timestamp_millis();
    let pending: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM decisions d JOIN accounts a ON a.id=d.actor_id WHERE d.target_id=$1 AND d.kind='like' AND d.status='pending'
           AND NOT a.suspended AND a.deleted_at IS NULL",
    )
    .bind(&user.uid)
    .fetch_one(&state.db)
    .await?;
    let entitlement: Option<Value> =
        sqlx::query_scalar("SELECT record FROM entitlements WHERE user_id=$1")
            .bind(&user.uid)
            .fetch_optional(&state.db)
            .await?;
    let none = json!({"pendingCount":pending,"pendingLikes":[],"identitiesAvailable":false,"hasMore":false,"nextCursor":null});
    if !policy::has_plan_feature(entitlement.as_ref(), "incomingLikeProfiles", now) {
        return Ok(none);
    }
    let before: Option<i64> = match data["cursor"].as_str() {
        Some(cursor) => Some(
            cursor
                .strip_prefix("s")
                .and_then(|n| n.parse().ok())
                .filter(|n: &i64| *n > 0)
                .ok_or_else(|| ApiError::invalid("หน้ารายการไม่ถูกต้อง"))?,
        ),
        None => None,
    };
    let rows = sqlx::query(
        "SELECT actor_id,message,sequence,(extract(epoch FROM created_at)*1000)::bigint AS created_ms FROM decisions
         WHERE target_id=$1 AND kind='like' AND status='pending' AND ($2::bigint IS NULL OR sequence<$2)
         ORDER BY sequence DESC LIMIT $3",
    )
    .bind(&user.uid)
    .bind(before)
    .bind(PAGE)
    .fetch_all(&state.db)
    .await?;
    let ids: Vec<String> = rows.iter().map(|r| r.get("actor_id")).collect();
    let Json(visible) = crate::discovery::visible(
        axum::extract::State(state.clone()),
        headers.clone(),
        Json(crate::discovery::VisibleRequest::new(ids)),
    )
    .await?;
    let by_id: Map<String, Value> = visible["profiles"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| Some((p["id"].as_str()?.to_owned(), p)))
        .collect();
    let latest: Option<Value> =
        sqlx::query_scalar("SELECT record FROM entitlements WHERE user_id=$1")
            .bind(&user.uid)
            .fetch_optional(&state.db)
            .await?;
    if !policy::has_plan_feature(
        latest.as_ref(),
        "incomingLikeProfiles",
        Utc::now().timestamp_millis(),
    ) {
        return Ok(none);
    }
    let likes: Vec<Value> = rows
        .iter()
        .filter_map(|row| {
            let actor: String = row.get("actor_id");
            let profile = by_id.get(&actor)?.clone();
            Some(json!({"decisionId":format!("{actor}_{}", user.uid),"profile":profile,
                "likeMessage":row.get::<String,_>("message"),"createdAt":row.get::<i64,_>("created_ms")}))
        })
        .collect();
    let has_more = rows.len() as i64 == PAGE;
    let next = if has_more {
        rows.last()
            .map(|r| format!("s{}", r.get::<i64, _>("sequence")))
    } else {
        None
    };
    // A short first page already contains every pending like, after the
    // visibility filter. Longer lists need the same filter over the whole set.
    let pending_count = if before.is_none() && !has_more {
        likes.len() as i64
    } else {
        viewable_pending_count(state, &user.uid).await?
    };
    Ok(
        json!({"pendingCount":pending_count,"identitiesAvailable":true,"pendingLikes":likes,"hasMore":has_more,"nextCursor":next}),
    )
}

fn decision_json(row: &sqlx::postgres::PgRow) -> Value {
    let from: String = row.get("actor_id");
    let to: String = row.get("target_id");
    json!({
        "id": format!("{from}_{to}"), "decisionId": format!("{from}_{to}"), "fromUserId": from, "toUserId": to,
        "type": row.get::<String,_>("kind"), "status": row.get::<String,_>("status"),
        "likeMessage": row.get::<String,_>("message"), "lastActionId": row.get::<Option<uuid::Uuid>,_>("last_action_id").map(|u| u.to_string()),
        "createdAt": row.get::<i64,_>("created_ms"), "updatedAt": row.get::<i64,_>("updated_ms"),
    })
}
const DECISION: &str = "actor_id,target_id,kind,status,message,last_action_id,(extract(epoch FROM created_at)*1000)::bigint AS created_ms,(extract(epoch FROM updated_at)*1000)::bigint AS updated_ms";

/// Legacy `getMyDecisionState`.
pub async fn decision_state(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let outgoing = sqlx::query(&format!(
        "SELECT {DECISION} FROM decisions WHERE actor_id=$1 ORDER BY sequence DESC LIMIT 300"
    ))
    .bind(&user.uid)
    .fetch_all(&state.db)
    .await?;
    let accepted = sqlx::query(&format!("SELECT {DECISION} FROM decisions WHERE target_id=$1 AND kind='like' AND status='accepted' ORDER BY sequence DESC LIMIT 300"))
        .bind(&user.uid).fetch_all(&state.db).await?;
    let summary = incoming_likes(state, headers, data).await?;
    let mut incoming: Vec<Value> = accepted.iter().map(decision_json).collect();
    for like in summary["pendingLikes"]
        .as_array()
        .cloned()
        .unwrap_or_default()
    {
        incoming.push(json!({"id":like["decisionId"],"decisionId":like["decisionId"],"fromUserId":like["profile"]["id"],
            "toUserId":user.uid,"type":"like","status":"pending","likeMessage":like["likeMessage"],"createdAt":like["createdAt"],
            "profile":like["profile"]}));
    }
    let pending_profiles: Vec<Value> = summary["pendingLikes"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|l| l.get("profile").cloned())
                .collect()
        })
        .unwrap_or_default();
    let actions: i64 = sqlx::query_scalar(
        "SELECT COALESCE(max(sequence),0) FROM matching_history WHERE actor_id=$1",
    )
    .bind(&user.uid)
    .fetch_one(&state.db)
    .await?;
    let mut connection = state.db.acquire().await?;
    let rewound_profiles = crate::matching::restored_profiles(&mut connection, &user.uid).await?;
    let can_rewind: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM matching_history h JOIN decisions d ON d.actor_id=h.actor_id AND d.target_id=h.target_id AND d.last_action_id=h.action_id WHERE h.actor_id=$1 AND h.undoable AND d.kind='skip' AND d.status='pending')")
        .bind(&user.uid).fetch_one(&mut *connection).await?;
    Ok(json!({
        "incomingDecisions": incoming, "outgoingDecisions": outgoing.iter().map(decision_json).collect::<Vec<_>>(),
        "pendingCount": summary["pendingCount"], "pendingProfiles": pending_profiles, "discoveryActionCount": actions,
        "hasMorePending": summary["hasMore"], "nextPendingCursor": summary["nextCursor"],
        "rewoundProfiles": rewound_profiles,
        "canRewind": can_rewind,
    }))
}

/// Legacy `getVisibleProfiles`.
pub async fn visible_profiles(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let ids: Vec<String> = data["userIds"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect();
    let mut unique = Vec::new();
    for id in ids {
        if !unique.contains(&id) {
            unique.push(id);
        }
    }
    let Json(result) = crate::discovery::visible(
        axum::extract::State(state.clone()),
        headers.clone(),
        Json(crate::discovery::VisibleRequest::new(unique)),
    )
    .await?;
    Ok(result)
}

pub async fn blocked(state: &AppState, headers: &HeaderMap, _: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT target_id FROM blocks WHERE actor_id=$1 ORDER BY created_at DESC",
    )
    .bind(&user.uid)
    .fetch_all(&state.db)
    .await?;
    Ok(json!({"userIds":ids}))
}

/// Block, then end any match (legacy blockUserAccount + unmatchUser).
pub async fn block(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let target = data["targetUserId"].as_str().unwrap_or_default().to_owned();
    let _ = profiles::block(
        axum::extract::State(state.clone()),
        headers.clone(),
        axum::extract::Path(target.clone()),
    )
    .await?;
    let _ = crate::matching::unmatch(
        axum::extract::State(state.clone()),
        headers.clone(),
        Json(crate::matching::TargetRequest {
            target_user_id: target.clone(),
        }),
    )
    .await;
    let user = auth::authenticate_session(state, headers).await?;
    let mut tx = state.db.begin().await?;
    events::publish(&mut tx, &[&user.uid, &target], "blocks", None).await?;
    tx.commit().await?;
    Ok(json!({"blocked":true}))
}

pub async fn unblock(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let target = data["targetUserId"].as_str().unwrap_or_default().to_owned();
    let _ = profiles::unblock(
        axum::extract::State(state.clone()),
        headers.clone(),
        axum::extract::Path(target.clone()),
    )
    .await?;
    let user = auth::authenticate_session(state, headers).await?;
    let mut tx = state.db.begin().await?;
    events::publish_one(&mut tx, &user.uid, "blocks", None).await?;
    tx.commit().await?;
    Ok(json!({"blocked":false}))
}

fn short(data: &Value, key: &str, max: usize) -> Option<String> {
    data[key]
        .as_str()
        .map(|s| s.trim().chars().take(max).collect::<String>())
        .filter(|s| !s.is_empty())
}

pub async fn report(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    crate::throttle(&state.db, "report", &user.uid, 10).await?;
    let reason = short(&data, "reason", 100)
        .ok_or_else(|| ApiError::invalid("กรุณาระบุข้อมูลการรายงานให้ครบถ้วน"))?;
    let reported =
        short(&data, "reportedUserId", 128).filter(|id| crate::chat::identifier(id, 128));
    let conversation =
        short(&data, "conversationId", 259).filter(|id| crate::chat::identifier(id, 259));
    let message = short(&data, "messageId", 128).filter(|id| crate::chat::identifier(id, 128));
    let mut tx = state.db.begin().await?;
    let reported = match reported {
        Some(id) => {
            sqlx::query_scalar::<_, String>("SELECT id FROM accounts WHERE id=$1")
                .bind(&id)
                .fetch_optional(&mut *tx)
                .await?
        }
        None => None,
    };
    let id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO reports(reporter_id,reported_user_id,conversation_id,message_id,media_url,message_text,reason,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    )
    .bind(&user.uid)
    .bind(reported)
    .bind(&conversation)
    .bind(&message)
    .bind(short(&data, "mediaUrl", 2048))
    .bind(short(&data, "messageText", 2000))
    .bind(reason)
    .bind(short(&data, "details", 2000).unwrap_or_default())
    .fetch_one(&mut *tx)
    .await?;
    if let (Some(conversation), Some(message)) = (&conversation, &message) {
        let member: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2)")
            .bind(conversation).bind(&user.uid).fetch_one(&mut *tx).await?;
        if member {
            sqlx::query("UPDATE encrypted_messages SET hidden_for=array_append(hidden_for,$3) WHERE conversation_id=$1 AND id=$2 AND NOT ($3=ANY(hidden_for))")
                .bind(conversation).bind(message).bind(&user.uid).execute(&mut *tx).await?;
            events::publish_one(&mut tx, &user.uid, "messages", Some(conversation)).await?;
        }
    }
    tx.commit().await?;
    Ok(json!({"success":true,"reportId":id}))
}

pub async fn spots(state: &AppState, _: &HeaderMap, _: Value) -> Result<Value, ApiError> {
    let rows = sqlx::query("SELECT id,data FROM spots ORDER BY id LIMIT 1000")
        .fetch_all(&state.db)
        .await?;
    Ok(json!({"spots": rows.iter().map(|r| {
        let mut spot: Value = r.get("data");
        spot["id"] = json!(r.get::<String,_>("id"));
        spot
    }).collect::<Vec<_>>()}))
}

/// Public remote configuration (legacy `app_config/{id}`).
pub async fn app_config(state: &AppState, _: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let id = data["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 100)
        .unwrap_or("default");
    let config: Option<Value> = sqlx::query_scalar("SELECT data FROM app_config WHERE id=$1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?;
    Ok(json!({"config":config}))
}

/// Legacy `getPeerDistances`: visible peers only, 1 km privacy floor.
pub async fn peer_distances(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let visible = visible_profiles(state, headers, json!({"userIds": data["userIds"]})).await?;
    let ids: Vec<String> = visible["profiles"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|p| p["id"].as_str().map(str::to_owned))
        .filter(|id| *id != user.uid)
        .collect();
    if ids.is_empty() {
        return Ok(json!({"distances":{}}));
    }
    let me: Value = sqlx::query_scalar("SELECT raw FROM profiles WHERE user_id=$1")
        .bind(&user.uid)
        .fetch_one(&state.db)
        .await?;
    let me = projection::visible_match_record(&me);
    let rows = sqlx::query("SELECT user_id,raw FROM profiles WHERE user_id=ANY($1)")
        .bind(&ids)
        .fetch_all(&state.db)
        .await?;
    let mut distances = Map::new();
    for row in rows {
        let peer = projection::visible_match_record(&row.get::<Value, _>("raw"));
        if let Some(km) = crate::distance::visible_distance_km(&me, &peer) {
            distances.insert(row.get("user_id"), json!(km));
        }
    }
    Ok(json!({"distances":distances}))
}

/// Legacy `reportAppVersion` answered "manual release required"; keep that
/// answer and record which versions are still in use.
pub async fn report_app_version(
    state: &AppState,
    _: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    if let (Some(platform), Some(version)) = (data["platform"].as_str(), data["version"].as_str()) {
        if ["android", "ios", "web"].contains(&platform)
            && version.len() <= 50
            && version
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        {
            let _ = sqlx::query("INSERT INTO app_versions(platform,version) VALUES($1,$2) ON CONFLICT(platform,version) DO UPDATE SET reported_at=now()")
                .bind(platform).bind(version).execute(&state.db).await;
        }
    }
    Ok(json!({"success":false,"updated":false,"reason":"manual_release_required"}))
}
