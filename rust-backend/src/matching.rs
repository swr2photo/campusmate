//! Native matching mutations. Pair locks serialize acceptance, cancellation and
//! rewind without serializing unrelated pairs. Receipts never cache a profile.
use crate::{
    auth::{authenticate, Principal},
    error::ApiError,
    policy::{self, ViewCheck},
    projection, AppState,
};
use axum::{extract::State, http::HeaderMap, Json};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionRequest {
    pub target_user_id: String,
    pub action_id: Uuid,
    pub kind: String,
    #[serde(default)]
    pub like_message: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetRequest {
    pub target_user_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RespondRequest {
    pub target_user_id: String,
    pub response: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RewindRequest {
    pub action_id: Uuid,
}

#[derive(Clone, Deserialize, Serialize)]
struct Decision {
    kind: String,
    status: String,
    message: String,
    last_action_id: Option<Uuid>,
}
impl Decision {
    fn is_like(&self) -> bool {
        self.kind == "like" && ["pending", "accepted"].contains(&self.status.as_str())
    }
}
struct Pair {
    visible: bool,
    matched: bool,
    profile: Value,
    outgoing: Option<Decision>,
    incoming: Option<Decision>,
    conversation_id: String,
}

fn valid_target(actor: &str, target: &str) -> Result<(), ApiError> {
    if actor == target
        || target.is_empty()
        || target.chars().count() > 128
        || target.chars().any(char::is_control)
    {
        return Err(ApiError::invalid("ผู้ใช้ไม่ถูกต้อง"));
    }
    Ok(())
}
fn lock_key(namespace: &str, parts: &[&str]) -> i64 {
    // Length-prefixed input avoids ambiguous UID separators. Namespaces keep
    // receipt locks and pair locks independent; a collision only adds waiting.
    let mut digest = Sha256::new();
    digest.update(namespace.as_bytes());
    for part in parts {
        digest.update((part.len() as u64).to_be_bytes());
        digest.update(part.as_bytes());
    }
    let hash = digest.finalize();
    i64::from_be_bytes(hash[..8].try_into().expect("eight bytes"))
}
fn pair_key(actor: &str, target: &str) -> i64 {
    let (a, b) = if actor < target {
        (actor, target)
    } else {
        (target, actor)
    };
    lock_key("campusmate-matching-pair-v1", &[a, b])
}
async fn lock(connection: &mut PgConnection, key: i64) -> Result<(), ApiError> {
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(key)
        .execute(connection)
        .await?;
    Ok(())
}
/// Call inside the transaction before reading or mutating this relationship.
/// Block/unblock and chat writes use the same lock to close authorization races.
pub async fn lock_pair(
    connection: &mut PgConnection,
    actor: &str,
    target: &str,
) -> Result<(), ApiError> {
    lock(connection, pair_key(actor, target)).await
}
async fn receipt_lock(
    connection: &mut PgConnection,
    actor: &str,
    action: Uuid,
) -> Result<(), ApiError> {
    lock(
        connection,
        lock_key(
            "campusmate-matching-receipt-v1",
            &[actor, &action.to_string()],
        ),
    )
    .await
}
async fn active_actor(
    connection: &mut PgConnection,
    actor: &Principal,
    headers: &HeaderMap,
) -> Result<(), ApiError> {
    crate::auth::lock_business_session(connection, headers, &actor.uid).await?;
    Ok(())
}
async fn pair(connection: &mut PgConnection, actor: &str, target: &str) -> Result<Pair, ApiError> {
    let owner = sqlx::query("SELECT p.raw,p.face_verified,p.discoverable,p.is_new,p.visibility,(extract(epoch FROM p.updated_at)*1000)::bigint AS updated_ms,e.record AS entitlement FROM profiles p JOIN accounts a ON a.id=p.user_id LEFT JOIN entitlements e ON e.user_id=p.user_id WHERE p.user_id=$1 AND a.email_verified AND NOT a.suspended AND a.deleted_at IS NULL")
        .bind(target).fetch_optional(&mut *connection).await?;
    let rows = sqlx::query("SELECT actor_id,kind,status,message,last_action_id FROM decisions WHERE (actor_id=$1 AND target_id=$2) OR (actor_id=$2 AND target_id=$1)")
        .bind(actor).bind(target).fetch_all(&mut *connection).await?;
    let mut outgoing = None;
    let mut incoming = None;
    for row in rows {
        let value = Decision {
            kind: row.get("kind"),
            status: row.get("status"),
            message: row.get("message"),
            last_action_id: row.get("last_action_id"),
        };
        if row.get::<String, _>("actor_id") == actor {
            outgoing = Some(value);
        } else {
            incoming = Some(value);
        }
    }
    let (a, b) = if actor < target {
        (actor, target)
    } else {
        (target, actor)
    };
    let conversation =
        sqlx::query("SELECT id,active FROM conversations WHERE member_a=$1 AND member_b=$2")
            .bind(a)
            .bind(b)
            .fetch_optional(&mut *connection)
            .await?;
    // The app derives room IDs as `c-{lower uid}-{higher uid}`; keep that.
    let conversation_id = conversation
        .as_ref()
        .map(|row| row.get::<String, _>("id"))
        .unwrap_or_else(|| format!("c-{a}-{b}"));
    let rejected = [&outgoing, &incoming]
        .iter()
        .filter_map(|d| d.as_ref())
        .any(|d| ["removed", "rejected"].contains(&d.status.as_str()));
    let matched = !rejected
        && (conversation
            .as_ref()
            .is_some_and(|r| r.get::<bool, _>("active"))
            || [&outgoing, &incoming]
                .iter()
                .filter_map(|d| d.as_ref())
                .any(|d| d.kind == "like" && d.status == "accepted"));
    let blocked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM blocks WHERE (actor_id=$1 AND target_id=$2) OR (actor_id=$2 AND target_id=$1))")
        .bind(actor).bind(target).fetch_one(&mut *connection).await?;
    let mut profile = Value::Null;
    let visible = if let Some(owner) = owner {
        let entitlement: Option<Value> = owner.get("entitlement");
        let visible = policy::can_view_profile(
            actor,
            target,
            &ViewCheck {
                owner_exists: true,
                owner_discoverable: owner.get("discoverable"),
                owner_is_new: owner.get("is_new"),
                owner_face_verified: owner.get("face_verified"),
                blocked,
                matched,
                owner_liked_viewer: incoming.as_ref().is_some_and(Decision::is_like),
                visibility_mode: Some(owner.get("visibility")),
                owner_entitlement: entitlement.as_ref(),
                now_ms: Utc::now().timestamp_millis(),
            },
        );
        if visible {
            let mut raw: Value = owner.get("raw");
            raw["updatedAt"] = json!(owner.get::<i64, _>("updated_ms"));
            profile = projection::discovery_profile(target, &raw);
            profile["isFaceVerified"] = json!(owner.get::<bool, _>("face_verified"));
        }
        visible
    } else {
        false
    };
    Ok(Pair {
        visible,
        matched,
        profile,
        outgoing,
        incoming,
        conversation_id,
    })
}
async fn receipt(
    connection: &mut PgConnection,
    actor: &str,
    action: Uuid,
    request: &Value,
) -> Result<Option<Value>, ApiError> {
    let stored = sqlx::query(
        "SELECT request,response FROM action_receipts WHERE actor_id=$1 AND action_id=$2",
    )
    .bind(actor)
    .bind(action)
    .fetch_optional(connection)
    .await?;
    if let Some(row) = stored {
        if row.get::<Value, _>("request") != *request {
            return Err(ApiError::invalid("รหัสการกระทำถูกใช้แล้ว"));
        }
        Ok(Some(row.get("response")))
    } else {
        Ok(None)
    }
}
async fn save_receipt(
    connection: &mut PgConnection,
    actor: &str,
    action: Uuid,
    request: Value,
    response: &Value,
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO action_receipts(actor_id,action_id,request,response) VALUES($1,$2,$3,$4)",
    )
    .bind(actor)
    .bind(action)
    .bind(request)
    .bind(response)
    .execute(connection)
    .await?;
    Ok(())
}
async fn put_decision(
    connection: &mut PgConnection,
    actor: &str,
    target: &str,
    decision: &Decision,
) -> Result<(), ApiError> {
    sqlx::query("INSERT INTO decisions(actor_id,target_id,kind,status,message,last_action_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(actor_id,target_id) DO UPDATE SET kind=excluded.kind,status=excluded.status,message=excluded.message,last_action_id=excluded.last_action_id,updated_at=now()")
        .bind(actor).bind(target).bind(&decision.kind).bind(&decision.status).bind(&decision.message).bind(decision.last_action_id).execute(connection).await?;
    Ok(())
}
async fn retire_history(
    connection: &mut PgConnection,
    actor: &str,
    target: &str,
) -> Result<(), ApiError> {
    sqlx::query("UPDATE matching_history SET undoable=false,undone_at=now(),undo_reason='relationship-changed' WHERE undoable AND ((actor_id=$1 AND target_id=$2) OR (actor_id=$2 AND target_id=$1))")
        .bind(actor).bind(target).execute(connection).await?;
    Ok(())
}
async fn establish(
    connection: &mut PgConnection,
    actor: &str,
    target: &str,
    conversation_id: &str,
) -> Result<(), ApiError> {
    let (a, b) = if actor < target {
        (actor, target)
    } else {
        (target, actor)
    };
    let was_active: Option<bool> =
        sqlx::query_scalar("SELECT active FROM conversations WHERE member_a=$1 AND member_b=$2")
            .bind(a)
            .bind(b)
            .fetch_optional(&mut *connection)
            .await?;
    let room: String = sqlx::query_scalar("INSERT INTO conversations(id,member_a,member_b,active) VALUES($1,$2,$3,true) ON CONFLICT(member_a,member_b) DO UPDATE SET active=true,updated_at=now() RETURNING id")
        .bind(conversation_id).bind(a).bind(b).fetch_one(&mut *connection).await?;
    // A new match reopens a room hidden by an earlier unmatch. The history
    // cutoff written then stays, so the old timeline remains unavailable.
    sqlx::query("INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2),($1,$3) ON CONFLICT(conversation_id,user_id) DO UPDATE SET hidden=false")
        .bind(&room).bind(a).bind(b).execute(&mut *connection).await?;
    if was_active != Some(true) {
        let profiles = sqlx::query("SELECT user_id,raw FROM profiles WHERE user_id=ANY($1)")
            .bind(vec![a.to_owned(), b.to_owned()])
            .fetch_all(&mut *connection)
            .await?;
        for (recipient, other) in [(a, b), (b, a)] {
            let profile = profiles
                .iter()
                .find(|row| row.get::<String, _>("user_id") == other)
                .map(|row| row.get::<Value, _>("raw"))
                .unwrap_or(Value::Null);
            let notice = crate::notify::matched(&profile, &room);
            crate::notify::enqueue(
                connection,
                recipient,
                &format!("match:{room}:{}", Uuid::new_v4()),
                &notice,
            )
            .await?;
        }
    }
    crate::events::publish(connection, &[a, b], "conversations", Some(&room)).await?;
    retire_history(connection, actor, target).await
}

async fn signal(connection: &mut PgConnection, actor: &str, target: &str) -> Result<(), ApiError> {
    crate::events::publish(connection, &[actor, target], "decisions", None).await
}

pub async fn record(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<ActionRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate(&state, &headers).await?;
    valid_target(&actor.uid, &input.target_user_id)?;
    if !["like", "skip"].contains(&input.kind.as_str())
        || input.like_message.chars().count() > 1000
        || (input.kind == "skip" && !input.like_message.is_empty())
    {
        return Err(ApiError::invalid("การกระทำไม่ถูกต้อง"));
    }
    crate::throttle(&state.db, "matching-action", &actor.uid, 120).await?;
    let request = json!({"operation":"record","input":input});
    let mut tx = state.db.begin().await?;
    receipt_lock(&mut tx, &actor.uid, input.action_id).await?;
    active_actor(&mut tx, &actor, &headers).await?;
    if let Some(result) = receipt(&mut tx, &actor.uid, input.action_id, &request).await? {
        tx.commit().await?;
        return Ok(Json(result));
    }
    lock(&mut tx, pair_key(&actor.uid, &input.target_user_id)).await?;
    let current = pair(&mut tx, &actor.uid, &input.target_user_id).await?;
    if !current.visible {
        return Err(ApiError::new("not-found", "ไม่พบโปรไฟล์นี้"));
    }
    let result = if current.matched {
        establish(
            &mut tx,
            &actor.uid,
            &input.target_user_id,
            &current.conversation_id,
        )
        .await?;
        json!({"status":"accepted","conversationId":current.conversation_id})
    } else {
        let accepted =
            input.kind == "like" && current.incoming.as_ref().is_some_and(Decision::is_like);
        let decision = Decision {
            kind: input.kind.clone(),
            status: if accepted { "accepted" } else { "pending" }.to_owned(),
            message: input.like_message.clone(),
            last_action_id: Some(input.action_id),
        };
        put_decision(&mut tx, &actor.uid, &input.target_user_id, &decision).await?;
        let was_pending_like = current
            .outgoing
            .as_ref()
            .is_some_and(|d| d.kind == "like" && d.status == "pending");
        if input.kind == "like" && !accepted && !was_pending_like {
            crate::notify::enqueue(
                &mut tx,
                &input.target_user_id,
                &format!("like:{}:{}", actor.uid, input.action_id),
                &crate::notify::private_like(),
            )
            .await?;
        }
        if accepted {
            sqlx::query("UPDATE decisions SET status='accepted',updated_at=now() WHERE actor_id=$1 AND target_id=$2")
                .bind(&input.target_user_id).bind(&actor.uid).execute(&mut *tx).await?;
            establish(
                &mut tx,
                &actor.uid,
                &input.target_user_id,
                &current.conversation_id,
            )
            .await?;
        }
        let previous = current
            .outgoing
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| ApiError::internal())?;
        let sequence: i64 = sqlx::query_scalar("INSERT INTO matching_history(actor_id,action_id,target_id,previous,undoable) VALUES($1,$2,$3,$4,$5) RETURNING sequence")
            .bind(&actor.uid).bind(input.action_id).bind(&input.target_user_id).bind(previous).bind(input.kind == "skip" && !accepted).fetch_one(&mut *tx).await?;
        json!({"status":decision.status,"conversationId":if accepted {Some(current.conversation_id)} else {None},"sequence":sequence})
    };
    save_receipt(&mut tx, &actor.uid, input.action_id, request, &result).await?;
    signal(&mut tx, &actor.uid, &input.target_user_id).await?;
    tx.commit().await?;
    Ok(Json(result))
}

pub async fn respond(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<RespondRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate(&state, &headers).await?;
    valid_target(&actor.uid, &input.target_user_id)?;
    if !["accept", "reject"].contains(&input.response.as_str()) {
        return Err(ApiError::invalid("คำตอบไม่ถูกต้อง"));
    }
    crate::throttle(&state.db, "matching-response", &actor.uid, 120).await?;
    let mut tx = state.db.begin().await?;
    lock(&mut tx, pair_key(&actor.uid, &input.target_user_id)).await?;
    active_actor(&mut tx, &actor, &headers).await?;
    let current = pair(&mut tx, &actor.uid, &input.target_user_id).await?;
    if !current.visible {
        return Err(ApiError::new("not-found", "คำขอเปลี่ยนแปลงแล้ว"));
    }
    if input.response == "reject"
        && current
            .incoming
            .as_ref()
            .is_some_and(|d| d.kind == "like" && d.status == "rejected")
    {
        tx.commit().await?;
        return Ok(Json(json!({"status":"rejected","conversationId":null})));
    }
    if !current.incoming.as_ref().is_some_and(Decision::is_like) {
        return Err(ApiError::new("not-found", "คำขอเปลี่ยนแปลงแล้ว"));
    }
    if input.response == "reject" && current.matched {
        return Err(ApiError::new(
            "failed-precondition",
            "ใช้การยกเลิกจับคู่สำหรับคู่ที่ยอมรับแล้ว",
        ));
    }
    let accepted = input.response == "accept";
    sqlx::query(
        "UPDATE decisions SET status=$3,updated_at=now() WHERE actor_id=$1 AND target_id=$2",
    )
    .bind(&input.target_user_id)
    .bind(&actor.uid)
    .bind(if accepted { "accepted" } else { "rejected" })
    .execute(&mut *tx)
    .await?;
    put_decision(
        &mut tx,
        &actor.uid,
        &input.target_user_id,
        &Decision {
            kind: if accepted { "like" } else { "skip" }.to_owned(),
            status: if accepted { "accepted" } else { "pending" }.to_owned(),
            message: String::new(),
            last_action_id: None,
        },
    )
    .await?;
    retire_history(&mut tx, &actor.uid, &input.target_user_id).await?;
    if accepted {
        establish(
            &mut tx,
            &actor.uid,
            &input.target_user_id,
            &current.conversation_id,
        )
        .await?;
    }
    signal(&mut tx, &actor.uid, &input.target_user_id).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"status":if accepted {"accepted"} else {"rejected"},"conversationId":if accepted {Some(current.conversation_id)} else {None}}),
    ))
}

pub async fn cancel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<TargetRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate(&state, &headers).await?;
    valid_target(&actor.uid, &input.target_user_id)?;
    crate::throttle(&state.db, "matching-cancel", &actor.uid, 120).await?;
    let mut tx = state.db.begin().await?;
    lock(&mut tx, pair_key(&actor.uid, &input.target_user_id)).await?;
    active_actor(&mut tx, &actor, &headers).await?;
    let current = pair(&mut tx, &actor.uid, &input.target_user_id).await?;
    if current.matched {
        return Err(ApiError::new("failed-precondition", "ย้อนคู่ที่ยอมรับแล้วไม่ได้"));
    }
    sqlx::query("DELETE FROM decisions WHERE actor_id=$1 AND target_id=$2 AND kind='like' AND status='pending'")
        .bind(&actor.uid).bind(&input.target_user_id).execute(&mut *tx).await?;
    // Cancellation must not let a historic rewind resurrect the cancelled like.
    retire_history(&mut tx, &actor.uid, &input.target_user_id).await?;
    signal(&mut tx, &actor.uid, &input.target_user_id).await?;
    tx.commit().await?;
    Ok(Json(json!({"cancelled":true})))
}

pub async fn unmatch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<TargetRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate(&state, &headers).await?;
    valid_target(&actor.uid, &input.target_user_id)?;
    crate::throttle(&state.db, "matching-unmatch", &actor.uid, 120).await?;
    let mut tx = state.db.begin().await?;
    lock(&mut tx, pair_key(&actor.uid, &input.target_user_id)).await?;
    active_actor(&mut tx, &actor, &headers).await?;
    sqlx::query("UPDATE decisions SET status='removed',updated_at=now() WHERE (actor_id=$1 AND target_id=$2) OR (actor_id=$2 AND target_id=$1)")
        .bind(&actor.uid).bind(&input.target_user_id).execute(&mut *tx).await?;
    let rooms: Vec<String> = sqlx::query_scalar("UPDATE conversations SET active=false,updated_at=now() WHERE (member_a=$1 AND member_b=$2) OR (member_a=$2 AND member_b=$1) RETURNING id")
        .bind(&actor.uid).bind(&input.target_user_id).fetch_all(&mut *tx).await?;
    // Both sides lose the visible timeline; ciphertext stays for the record.
    sqlx::query("UPDATE conversation_members SET hidden=true,history_cleared_at=now(),unread=0 WHERE conversation_id=ANY($1)")
        .bind(&rooms).execute(&mut *tx).await?;
    sqlx::query("UPDATE appointments SET status='cancelled',cancelled_by=$2,cancelled_at=now(),updated_at=now() WHERE conversation_id=ANY($1) AND status='active'")
        .bind(&rooms).bind(&actor.uid).execute(&mut *tx).await?;
    retire_history(&mut tx, &actor.uid, &input.target_user_id).await?;
    signal(&mut tx, &actor.uid, &input.target_user_id).await?;
    crate::events::publish(
        &mut tx,
        &[&actor.uid, &input.target_user_id],
        "conversations",
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"removed":true})))
}

async fn rewind_profile(
    connection: &mut PgConnection,
    actor: &str,
    receipt: &Value,
) -> Result<Value, ApiError> {
    let mut profile = if let Some(target) = receipt["targetId"].as_str() {
        let current = pair(connection, actor, target).await?;
        if current.outgoing.is_none() && !current.matched {
            current.profile
        } else {
            Value::Null
        }
    } else {
        Value::Null
    };
    if profile.is_object() {
        profile["rewindPriority"] = receipt["rewindPriority"].clone();
    }
    Ok(json!({"profile":profile,"hasMore":receipt["hasMore"].as_bool().unwrap_or(false)}))
}

/// Durable deck restoration, reauthorized on every device rather than kept in
/// the memory of the device that pressed Rewind.
pub async fn restored_profiles(
    connection: &mut PgConnection,
    actor: &str,
) -> Result<Vec<Value>, ApiError> {
    let history = sqlx::query("SELECT target_id,(extract(epoch FROM max(undone_at))*1000)::bigint AS priority FROM matching_history h WHERE actor_id=$1 AND undo_reason='rewind' AND NOT EXISTS(SELECT 1 FROM decisions d WHERE d.actor_id=h.actor_id AND d.target_id=h.target_id) GROUP BY target_id ORDER BY max(undone_at) DESC,target_id LIMIT 30")
        .bind(actor).fetch_all(&mut *connection).await?;
    let mut profiles = Vec::new();
    for entry in history {
        let current = pair(connection, actor, entry.get("target_id")).await?;
        if current.visible && !current.matched && current.outgoing.is_none() {
            let mut profile = current.profile;
            profile["rewindPriority"] = json!(entry.get::<i64, _>("priority"));
            profiles.push(profile);
        }
    }
    Ok(profiles)
}
pub async fn rewind(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<RewindRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate(&state, &headers).await?;
    crate::throttle(&state.db, "matching-rewind", &actor.uid, 60).await?;
    let request = json!({"operation":"rewind"});
    let mut tx = state.db.begin().await?;
    receipt_lock(&mut tx, &actor.uid, input.action_id).await?;
    lock(
        &mut tx,
        lock_key("campusmate-matching-rewind-v1", &[&actor.uid]),
    )
    .await?;
    active_actor(&mut tx, &actor, &headers).await?;
    // Share lock keeps an existing entitlement stable until commit. Missing or
    // expired membership fails closed, even when retrying an old receipt.
    let membership = sqlx::query_scalar::<_, Value>(
        "SELECT record FROM entitlements WHERE user_id=$1 FOR SHARE",
    )
    .bind(&actor.uid)
    .fetch_optional(&mut *tx)
    .await?;
    let role: String = sqlx::query_scalar("SELECT role FROM accounts WHERE id=$1")
        .bind(&actor.uid)
        .fetch_one(&mut *tx)
        .await?;
    if role != "admin"
        && !policy::has_plan_feature(
            membership.as_ref(),
            "unlimitedRewind",
            Utc::now().timestamp_millis(),
        )
    {
        return Err(ApiError::plus_required("unlimitedRewind"));
    }
    if let Some(stored) = receipt(&mut tx, &actor.uid, input.action_id, &request).await? {
        if let Some(target) = stored["targetId"].as_str() {
            lock_pair(&mut tx, &actor.uid, target).await?;
        }
        let result = rewind_profile(&mut tx, &actor.uid, &stored).await?;
        tx.commit().await?;
        return Ok(Json(result));
    }
    // Join the current decision so old like history (including records created
    // before skip-only rewind) can never be selected or consume the scan limit.
    let history = sqlx::query("SELECT h.action_id,h.target_id FROM matching_history h JOIN decisions d ON d.actor_id=h.actor_id AND d.target_id=h.target_id AND d.last_action_id=h.action_id WHERE h.actor_id=$1 AND h.undoable AND d.kind='skip' AND d.status='pending' ORDER BY h.sequence DESC LIMIT 20")
        .bind(&actor.uid).fetch_all(&mut *tx).await?;
    let mut keys: Vec<i64> = history
        .iter()
        .map(|r| pair_key(&actor.uid, r.get::<&str, _>("target_id")))
        .collect();
    keys.sort_unstable();
    keys.dedup();
    for key in keys {
        lock(&mut tx, key).await?;
    }
    let mut selected = None;
    let mut priority = None;
    for entry in &history {
        let action: Uuid = entry.get("action_id");
        let target: String = entry.get("target_id");
        // An acceptance waiting on the same pair either committed before these
        // fresh reads or will see the restored/deleted pending decision later.
        let stored = sqlx::query(
            "SELECT action_id FROM matching_history WHERE actor_id=$1 AND action_id=$2 AND undoable",
        )
        .bind(&actor.uid)
        .bind(action)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(_) = stored else { continue };
        let current = pair(&mut tx, &actor.uid, &target).await?;
        let eligible = current.visible
            && !current.matched
            && current.outgoing.as_ref().is_some_and(|d| {
                d.last_action_id == Some(action) && d.status == "pending" && d.kind == "skip"
            });
        let restored_at: i64 = sqlx::query_scalar("UPDATE matching_history SET undoable=false,undone_at=clock_timestamp(),undo_reason=$3 WHERE actor_id=$1 AND action_id=$2 RETURNING (extract(epoch FROM undone_at)*1000)::bigint")
            .bind(&actor.uid).bind(action).bind(if eligible {"rewind"} else {"unavailable"}).fetch_one(&mut *tx).await?;
        if !eligible {
            continue;
        }
        // Clear only the current skip. Restoring an older skip/like would hide
        // the same card again or resurrect a superseded relationship.
        sqlx::query("DELETE FROM decisions WHERE actor_id=$1 AND target_id=$2")
            .bind(&actor.uid)
            .bind(&target)
            .execute(&mut *tx)
            .await?;
        selected = Some(target);
        priority = Some(restored_at);
        break;
    }
    let stored = json!({"targetId":selected,"rewindPriority":priority,"hasMore":selected.is_none() && history.len()==20});
    save_receipt(&mut tx, &actor.uid, input.action_id, request, &stored).await?;
    let result = rewind_profile(&mut tx, &actor.uid, &stored).await?;
    if let Some(target) = stored["targetId"].as_str() {
        signal(&mut tx, &actor.uid, target).await?;
    }
    tx.commit().await?;
    Ok(Json(result))
}
