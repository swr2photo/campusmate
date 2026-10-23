use crate::{
    auth::authenticate,
    cursor::RankKey,
    error::ApiError,
    filters,
    policy::{self, ViewCheck},
    projection, score, AppState,
};
use axum::{extract::State, http::HeaderMap, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

const PAGE_SIZE: usize = 30;
const MODEL_VERSION: &str = "native-v3";
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiscoverRequest {
    #[serde(default = "empty_filters")]
    filters: Value,
    #[serde(default)]
    cursor: Option<String>,
}
fn empty_filters() -> Value {
    json!({})
}
#[derive(Serialize, Deserialize, Clone)]
struct Ranked {
    id: String,
    score: u8,
    tie: u64,
    revision: i64,
}

fn today(now: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(now + 7 * 3_600_000)
        .map_or_else(String::new, |d| d.format("%Y-%m-%d").to_string())
}
fn scope(filters: &filters::DiscoveryFilters, date: &str, viewer_revision: i64) -> String {
    hex::encode(Sha256::digest(
        serde_json::to_vec(
            &json!({"filters":filters,"day":date,"model":MODEL_VERSION,"revision":viewer_revision}),
        )
        .expect("json"),
    ))
}
async fn begin(state: &AppState) -> Result<Transaction<'_, Postgres>, ApiError> {
    let mut tx = state.db.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}

// All privacy decisions use authoritative SQL rows in one snapshot, never a listener cache.
const CANDIDATES: &str = r#"SELECT * FROM (SELECT p.user_id,p.raw,p.revision,p.face_verified,p.discoverable,p.is_new,p.visibility,
 (extract(epoch FROM p.updated_at)*1000)::bigint AS updated_ms,
 e.record AS entitlement,
 EXISTS(SELECT 1 FROM blocks b WHERE (b.actor_id=$1 AND b.target_id=p.user_id) OR (b.actor_id=p.user_id AND b.target_id=$1)) AS blocked,
 EXISTS(SELECT 1 FROM decisions d WHERE d.actor_id=p.user_id AND d.target_id=$1 AND d.kind='like' AND d.status IN ('pending','accepted')) AS liked,
 ((EXISTS(SELECT 1 FROM decisions d WHERE ((d.actor_id=$1 AND d.target_id=p.user_id) OR (d.actor_id=p.user_id AND d.target_id=$1)) AND d.kind='like' AND d.status='accepted')
 OR EXISTS(SELECT 1 FROM conversations c WHERE c.active AND ((c.member_a=$1 AND c.member_b=p.user_id) OR (c.member_a=p.user_id AND c.member_b=$1))))
 AND NOT EXISTS(SELECT 1 FROM decisions d WHERE ((d.actor_id=$1 AND d.target_id=p.user_id) OR (d.actor_id=p.user_id AND d.target_id=$1)) AND d.status IN ('removed','rejected'))) AS matched,
 EXISTS(SELECT 1 FROM decisions d WHERE (d.actor_id=$1 AND d.target_id=p.user_id) OR (d.actor_id=p.user_id AND d.target_id=$1 AND d.status IN ('accepted','rejected','removed'))) AS acted
 FROM profiles p JOIN accounts a ON a.id=p.user_id LEFT JOIN entitlements e ON e.user_id=p.user_id
 WHERE a.deleted_at IS NULL AND NOT a.suspended AND a.email_verified AND (p.user_id<>$1 OR NOT $3)
 AND ($2::text[] IS NULL OR p.user_id=ANY($2))) eligible
 WHERE NOT $3 OR (face_verified AND discoverable AND NOT is_new AND visibility IN ('public','incognito') AND NOT blocked AND NOT matched AND NOT acted)
 ORDER BY user_id LIMIT 5001"#;

fn raw_with_timestamp(row: &sqlx::postgres::PgRow) -> Value {
    let mut raw = row.get::<Value, _>("raw");
    raw["updatedAt"] = json!(row.get::<i64, _>("updated_ms"));
    raw
}

fn authorized(row: &sqlx::postgres::PgRow, viewer: &str, now: i64) -> bool {
    policy::can_view_profile(
        viewer,
        row.get("user_id"),
        &ViewCheck {
            owner_exists: true,
            owner_discoverable: row.get("discoverable"),
            owner_is_new: row.get("is_new"),
            owner_face_verified: row.get("face_verified"),
            blocked: row.get("blocked"),
            matched: row.get("matched"),
            owner_liked_viewer: row.get("liked"),
            visibility_mode: Some(row.get("visibility")),
            owner_entitlement: row.get::<Option<Value>, _>("entitlement").as_ref(),
            now_ms: now,
        },
    )
}

pub async fn discover(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<DiscoverRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate(&state, &headers).await?;
    crate::throttle(&state.db, "discovery", &actor.uid, 60).await?;
    let ranking_capacity = state
        .discovery_jobs
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::unavailable("ระบบค้นหากำลังทำงาน กรุณาลองอีกครั้ง"))?;
    let now = Utc::now().timestamp_millis();
    let date = today(now);
    let mut tx = begin(&state).await?;
    let viewer_row=sqlx::query("SELECT p.raw,p.revision FROM profiles p JOIN accounts a ON a.id=p.user_id WHERE p.user_id=$1 AND a.email_verified AND NOT a.suspended AND a.deleted_at IS NULL")
        .bind(&actor.uid).fetch_optional(&mut *tx).await?.ok_or_else(ApiError::unauthenticated)?;
    let viewer = projection::visible_match_record(&viewer_row.get::<Value, _>("raw"));
    let entitlement =
        sqlx::query_scalar::<_, Value>("SELECT record FROM entitlements WHERE user_id=$1")
            .bind(&actor.uid)
            .fetch_optional(&mut *tx)
            .await?;
    let validated = filters::validate(&request.filters, entitlement.as_ref(), now)?;
    let scope = scope(&validated, &date, viewer_row.get("revision"));
    let (snapshot_id, ranked, start) = if let Some(cursor) =
        request.cursor.as_deref().filter(|s| !s.is_empty())
    {
        drop(ranking_capacity);
        let key = state.cursor.verify(cursor, &actor.uid, &scope, now)?;
        let id = Uuid::parse_str(&key.id).map_err(|_| ApiError::invalid("หน้ารายการไม่ถูกต้อง"))?;
        let offset: usize = key
            .tie
            .parse()
            .map_err(|_| ApiError::invalid("หน้ารายการไม่ถูกต้อง"))?;
        let ranked=sqlx::query_scalar::<_,Value>("SELECT ranked FROM discovery_snapshots WHERE id=$1 AND user_id=$2 AND scope=$3 AND expires_at>now()")
            .bind(id).bind(&actor.uid).bind(&scope).fetch_optional(&mut *tx).await?
            .ok_or_else(||ApiError::new("aborted","รายการหมดอายุ กรุณาค้นหาใหม่"))?;
        let ranked: Vec<Ranked> =
            serde_json::from_value(ranked).map_err(|_| ApiError::internal())?;
        if offset > ranked.len() {
            return Err(ApiError::invalid("หน้ารายการไม่ถูกต้อง"));
        }
        (id, ranked, offset)
    } else if let Some(row) = sqlx::query(
        "SELECT id, ranked FROM discovery_snapshots WHERE user_id=$1 AND scope=$2 AND expires_at>now() ORDER BY expires_at DESC LIMIT 1",
    )
    .bind(&actor.uid)
    .bind(&scope)
    .fetch_optional(&mut *tx)
    .await?
    {
        // Reuse the ranking for this filter set. A fresh score of every profile
        // on each open is what made Find Friends stall and reshuffle the card.
        drop(ranking_capacity);
        let id: Uuid = row.get("id");
        let ranked: Vec<Ranked> = serde_json::from_value(row.get("ranked"))
            .map_err(|_| ApiError::internal())?;
        (id, ranked, 0)
    } else {
        let rows = sqlx::query(CANDIDATES)
            .bind(&actor.uid)
            .bind(Option::<Vec<String>>::None)
            .bind(true)
            .fetch_all(&mut *tx)
            .await?;
        if rows.len() > 5000 {
            return Err(ApiError::new(
                "resource-exhausted",
                "จำนวนโปรไฟล์เกินขอบเขตของดัชนี กรุณาติดต่อผู้ดูแล",
            ));
        }
        let rank_viewer = viewer.clone();
        let rank_filters = validated.clone();
        let rank_date = date.clone();
        let rank_uid = actor.uid.clone();
        // Scoring thousands of candidates must not block Tokio's network workers.
        let ranked = tokio::task::spawn_blocking(move || {
            // Cancellation of the HTTP request must not release CPU capacity
            // while this blocking job is still running.
            let _ranking_capacity = ranking_capacity;
            let mut ranked = Vec::new();
            for row in &rows {
                if row.get::<bool, _>("acted")
                    || row.get::<bool, _>("matched")
                    || !authorized(row, &rank_uid, now)
                {
                    continue;
                }
                let raw = raw_with_timestamp(row);
                let candidate = projection::visible_match_record(&raw);
                let distance = crate::distance::visible_distance_km(&rank_viewer, &candidate);
                if !filters::matches_at(&candidate, &rank_filters, distance, &rank_date, now) {
                    continue;
                }
                let result = score::score(
                    &score::Context {
                        today: &rank_date,
                        now_ms: now,
                    },
                    &rank_viewer,
                    &candidate,
                    distance,
                );
                let id: String = row.get("user_id");
                ranked.push(Ranked {
                    tie: score::tie_break(&rank_uid, &id, &rank_date),
                    id,
                    score: result.score,
                    revision: row.get("revision"),
                });
            }
            ranked.sort_by(|a, b| {
                b.score
                    .cmp(&a.score)
                    .then(b.tie.cmp(&a.tie))
                    .then(a.id.cmp(&b.id))
            });
            ranked
        })
        .await
        .map_err(|_| ApiError::internal())?;
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO discovery_snapshots(id,user_id,scope,ranked,expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes')")
            .bind(id).bind(&actor.uid).bind(&scope).bind(json!(ranked)).execute(&mut *tx).await?;
        (id, ranked, 0)
    };
    let mut profiles = Vec::new();
    let mut next = start;
    while next < ranked.len() && profiles.len() < PAGE_SIZE {
        let end = (next + PAGE_SIZE * 2).min(ranked.len());
        let ids: Vec<String> = ranked[next..end].iter().map(|r| r.id.clone()).collect();
        let rows = sqlx::query(CANDIDATES)
            .bind(&actor.uid)
            .bind(ids)
            .bind(true)
            .fetch_all(&mut *tx)
            .await?;
        let rows: std::collections::HashMap<String, _> = rows
            .into_iter()
            .map(|row| (row.get("user_id"), row))
            .collect();
        for ranked in &ranked[next..end] {
            next += 1;
            let Some(row) = rows.get(&ranked.id) else {
                continue;
            };
            if row.get::<bool, _>("acted")
                || row.get::<bool, _>("matched")
                || !authorized(row, &actor.uid, now)
            {
                continue;
            }
            if row.get::<i64, _>("revision") != ranked.revision {
                return Err(ApiError::new("aborted", "ข้อมูลโปรไฟล์เปลี่ยน กรุณาค้นหาใหม่"));
            }
            let raw = raw_with_timestamp(row);
            let candidate = projection::visible_match_record(&raw);
            let distance = crate::distance::visible_distance_km(&viewer, &candidate);
            if !filters::matches_at(&candidate, &validated, distance, &date, now) {
                continue;
            }
            let result = score::score(
                &score::Context {
                    today: &date,
                    now_ms: now,
                },
                &viewer,
                &candidate,
                distance,
            );
            let mut profile = projection::discovery_profile(&ranked.id, &raw);
            profile["isFaceVerified"] = json!(row.get::<bool, _>("face_verified"));
            profile["compatibility"] = json!(result.score);
            profile["matchReasons"] = json!(result.reasons);
            profile["distance"] = json!(distance);
            profiles.push(profile);
            if profiles.len() == PAGE_SIZE {
                break;
            }
        }
    }
    let has_more = next < ranked.len();
    let cursor = has_more.then(|| {
        state.cursor.sign(
            &actor.uid,
            &scope,
            RankKey {
                score: 0,
                tie: next.to_string(),
                id: snapshot_id.to_string(),
            },
            now,
        )
    });
    tx.commit().await?;
    Ok(Json(
        json!({"profiles":profiles,"hasMore":has_more,"nextCursor":cursor,"modelVersion":MODEL_VERSION}),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisibleRequest {
    user_ids: Vec<String>,
}
impl VisibleRequest {
    pub fn new(user_ids: Vec<String>) -> Self {
        Self { user_ids }
    }
}
pub async fn visible(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<VisibleRequest>,
) -> Result<Json<Value>, ApiError> {
    let actor = authenticate(&state, &headers).await?;
    if request.user_ids.len() > 50
        || request
            .user_ids
            .iter()
            .any(|s| s.is_empty() || s.len() > 128)
    {
        return Err(ApiError::invalid("รายการผู้ใช้ไม่ถูกต้อง"));
    }
    crate::throttle(&state.db, "visible", &actor.uid, 60).await?;
    let mut tx = begin(&state).await?;
    let now = Utc::now().timestamp_millis();
    let rows = sqlx::query(CANDIDATES)
        .bind(&actor.uid)
        .bind(request.user_ids)
        .bind(false)
        .fetch_all(&mut *tx)
        .await?;
    let profiles: Vec<Value> = rows
        .iter()
        .filter(|row| authorized(row, &actor.uid, now))
        .map(|row| {
            let mut value =
                projection::discovery_profile(row.get("user_id"), &raw_with_timestamp(row));
            value["isFaceVerified"] = json!(row.get::<bool, _>("face_verified"));
            value
        })
        .collect();
    tx.commit().await?;
    Ok(Json(json!({"profiles":profiles})))
}
