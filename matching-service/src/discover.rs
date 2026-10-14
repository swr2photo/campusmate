//! POST /v1/discover — ranked replacement for the `getDiscoveryPage` callable.
//! Request/response shapes match the callable (`{ filters, cursor }` ->
//! `{ profiles, hasMore, nextCursor }`) plus `compatibility`/`matchReasons`.

use std::sync::Arc;

use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::cursor::RankKey;
use crate::distance::visible_distance_km;
use crate::error::ApiError;
use crate::filters::{self, DiscoveryFilters};
use crate::model::UserRecord;
use crate::policy::{can_view_profile, ViewCheck};
use crate::pool::PoolData;
use crate::score::{self, tie_break, Context};
use crate::value::fields_to_json;
use crate::AppState;

pub const PAGE_SIZE: usize = 30;
const BANGKOK_OFFSET_MS: i64 = 7 * 3600 * 1000;

#[derive(Deserialize)]
pub struct DiscoverRequest {
    #[serde(default)]
    filters: Value,
    #[serde(default)]
    cursor: Option<String>,
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let token = value.strip_prefix("Bearer ")?.trim();
    (!token.is_empty() && token.len() < 8192).then_some(token)
}

pub fn today_in_bangkok(now_ms: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(now_ms + BANGKOK_OFFSET_MS).map_or_else(String::new, |at| at.format("%Y-%m-%d").to_string())
}

pub fn scope_of(filters: &DiscoveryFilters) -> String {
    let canonical = serde_json::to_vec(filters).expect("serializable");
    Sha256::digest(canonical).iter().map(|byte| format!("{byte:02x}")).collect()
}

pub async fn handler(State(state): State<AppState>, headers: HeaderMap, Json(request): Json<DiscoverRequest>) -> Result<Json<Value>, ApiError> {
    let started = std::time::Instant::now();
    let uid = state.verifier.verify_id_token(bearer(&headers).ok_or_else(ApiError::unauthenticated)?).await?;
    state.verifier.verify_app_check(headers.get("x-firebase-appcheck").and_then(|v| v.to_str().ok())).await?;
    if !state.limiter.allow(&uid) {
        return Err(ApiError::new("resource-exhausted", "เรียกข้อมูลถี่เกินไป กรุณารอสักครู่"));
    }
    if !state.pool.is_ready() {
        return Err(ApiError::unavailable("ระบบจับคู่กำลังเริ่มทำงาน"));
    }
    let now_ms = Utc::now().timestamp_millis();

    // The paywall decision always uses a fresh read, never the listener cache.
    let entitlement = state.db.fluent().select().by_id_in("entitlements").one(&uid).await
        .map_err(|error| { tracing::error!(%error, "entitlement read failed"); ApiError::internal() })?
        .map(|document| Value::Object(fields_to_json(&document)));
    let filters = filters::validate(&request.filters, entitlement.as_ref(), now_ms)?;
    let scope = scope_of(&filters);
    let after = match request.cursor.as_deref() {
        None | Some("") => None,
        Some(cursor) => Some(state.cursors.verify(cursor, &uid, &scope, now_ms)?),
    };

    // Release the pool lock before any await so the handler future stays Send.
    let cached_viewer = state.pool.data.read().users.get(&uid).cloned();
    let viewer = match cached_viewer {
        Some(viewer) => viewer,
        None => {
            // Brand-new account the listener has not delivered yet.
            let document = state.db.fluent().select().by_id_in("users").one(&uid).await
                .map_err(|error| { tracing::error!(%error, "viewer read failed"); ApiError::internal() })?
                .ok_or_else(|| ApiError::new("failed-precondition", "บัญชีไม่พร้อมใช้งาน"))?;
            Arc::new(UserRecord::from_fields(fields_to_json(&document)))
        }
    };

    let today = today_in_bangkok(now_ms);
    let (profiles, has_more, last) = {
        let data = state.pool.data.read();
        rank_page(&data, &uid, &viewer, &filters, &today, now_ms, after.as_ref())
    };
    let next_cursor = if has_more { last.map(|key| state.cursors.sign(&uid, &scope, key, now_ms)) } else { None };
    tracing::info!(results = profiles.len(), has_more, elapsed_us = started.elapsed().as_micros() as u64, "discover");
    Ok(Json(json!({ "profiles": profiles, "hasMore": has_more, "nextCursor": next_cursor })))
}

/// Pure ranking over the in-memory pool; returns one page after `after`.
pub fn rank_page(data: &PoolData, uid: &str, viewer: &UserRecord, filters: &DiscoveryFilters, today: &str, now_ms: i64,
    after: Option<&RankKey>) -> (Vec<Value>, bool, Option<RankKey>) {
    let outgoing = data.outgoing.get(uid);
    let incoming = data.incoming.get(uid);
    let my_blocks = data.blocks.get(uid);
    let blocked_me = data.blocked_by.get(uid);
    let partners = data.partners.get(uid);
    let ctx = Context { today, now_ms };

    let mut ranked: Vec<(RankKey, u64, Option<f64>, Vec<String>, &Map<String, Value>)> = Vec::new();
    for (owner_id, projection) in &data.public {
        if owner_id == uid {
            continue;
        }
        let Some(owner) = data.users.get(owner_id) else { continue };
        // Anyone the viewer already acted on, or who answered the viewer, is
        // not "new" discovery. Chats and accepted likes are matches.
        if outgoing.is_some_and(|map| map.contains_key(owner_id))
            || incoming.and_then(|map| map.get(owner_id)).is_some_and(|d| matches!(d.status.as_str(), "accepted" | "rejected" | "removed"))
            || partners.is_some_and(|set| set.contains(owner_id)) {
            continue;
        }
        let owner_liked_viewer = incoming.and_then(|map| map.get(owner_id))
            .is_some_and(|d| d.kind == "like" && matches!(d.status.as_str(), "pending" | "accepted"));
        let check = ViewCheck {
            owner_exists: true,
            owner_discoverable: owner.discoverable,
            owner_is_new: owner.is_new,
            owner_face_verified: owner.face_verified,
            blocked: my_blocks.is_some_and(|set| set.contains(owner_id)) || blocked_me.is_some_and(|set| set.contains(owner_id)),
            matched: false,
            owner_liked_viewer,
            visibility_mode: data.visibility.get(owner_id).map(String::as_str),
            owner_entitlement: data.entitlements.get(owner_id),
            now_ms,
        };
        if !can_view_profile(uid, owner_id, &check) {
            continue;
        }
        let distance = visible_distance_km(viewer, owner);
        if !filters::matches(owner, filters, distance) {
            continue;
        }
        let result = score::score(&ctx, viewer, owner, distance);
        let tie = tie_break(uid, owner_id, today);
        ranked.push((RankKey { score: result.score, tie: tie.to_string(), id: owner_id.clone() }, tie, distance, result.reasons, projection.as_ref()));
    }
    // score desc, tie desc, id asc — a total order, so cursors never skip or repeat.
    ranked.sort_by(|a, b| b.0.score.cmp(&a.0.score).then(b.1.cmp(&a.1)).then(a.0.id.cmp(&b.0.id)));
    let start = after.map_or(0, |key| {
        let tie: u64 = key.tie.parse().unwrap_or(0);
        ranked.partition_point(|(k, t, ..)| (k.score, *t) > (key.score, tie) || ((k.score, *t) == (key.score, tie) && k.id <= key.id))
    });
    let page: Vec<_> = ranked.iter().skip(start).take(PAGE_SIZE).collect();
    let has_more = start + page.len() < ranked.len();
    let last = page.last().map(|(key, ..)| key.clone());
    let profiles = page
        .into_iter()
        .map(|(key, _, distance, reasons, projection)| {
            let mut profile = (*projection).clone();
            profile.insert("id".into(), Value::String(key.id.clone()));
            profile.insert("distance".into(), distance.map_or(Value::Null, |km| json!(km)));
            profile.insert("compatibility".into(), json!(key.score));
            profile.insert("matchReasons".into(), json!(reasons));
            Value::Object(profile)
        })
        .collect();
    (profiles, has_more, last)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn verified(extra: Value) -> Value {
        let mut base = json!({ "isFaceVerified": true, "age": 20, "activities": ["running"] });
        base.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        base
    }

    fn pool(users: &[(&str, Value)]) -> PoolData {
        let mut data = PoolData::default();
        for (id, fields) in users {
            data.apply(&["users", *id], fields.as_object().cloned());
            data.apply(&["discoveryProfiles", *id], json!({ "name": id }).as_object().cloned());
        }
        data
    }

    #[test]
    fn excludes_blocked_acted_and_hidden_then_ranks() {
        let mut data = pool(&[
            ("me", verified(json!({}))),
            ("close", verified(json!({ "activities": ["running"] }))),
            ("far", verified(json!({ "activities": ["gaming"] }))),
            ("blocked", verified(json!({}))),
            ("liked", verified(json!({}))),
            ("unverified", json!({ "age": 20 })),
            ("incognito", verified(json!({}))),
        ]);
        data.apply(&["users", "blocked", "blockedUsers", "me"], json!({}).as_object().cloned());
        data.apply(&["decisions", "me_liked"], json!({ "fromUserId": "me", "toUserId": "liked", "type": "like", "status": "pending" }).as_object().cloned());
        data.apply(&["profileVisibility", "incognito"], json!({ "mode": "incognito" }).as_object().cloned());
        let viewer = data.users["me"].clone();
        let filters = filters::validate(&json!({}), None, 0).unwrap();
        let (profiles, has_more, _) = rank_page(&data, "me", &viewer, &filters, "2026-10-12", 0, None);
        let ids: Vec<&str> = profiles.iter().map(|p| p["id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["close", "far"]);
        assert!(!has_more);
        assert!(profiles[0]["compatibility"].as_u64().unwrap() > profiles[1]["compatibility"].as_u64().unwrap());
    }

    #[test]
    fn cursor_pages_do_not_overlap() {
        let users: Vec<(String, Value)> = (0..75).map(|i| (format!("u{i:02}"), verified(json!({ "age": 20 + (i % 3) })))).collect();
        let refs: Vec<(&str, Value)> = users.iter().map(|(id, v)| (id.as_str(), v.clone())).collect();
        let mut all = refs.clone();
        all.push(("me", verified(json!({}))));
        let data = pool(&all);
        let viewer = data.users["me"].clone();
        let filters = filters::validate(&json!({}), None, 0).unwrap();
        let mut seen = std::collections::HashSet::new();
        let mut after = None;
        loop {
            let (profiles, has_more, last) = rank_page(&data, "me", &viewer, &filters, "2026-10-12", 0, after.as_ref());
            for profile in &profiles {
                assert!(seen.insert(profile["id"].as_str().unwrap().to_owned()), "duplicate across pages");
            }
            if !has_more { break; }
            after = last;
        }
        assert_eq!(seen.len(), 75);
    }
}
