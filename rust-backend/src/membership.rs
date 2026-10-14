//! CampusMate Plus (port of plusEntitlements.js / plusFunctions.js). The
//! client never supplies a receipt, product or expiry: the server asks
//! RevenueCat and applies a conservative store/sandbox/refund policy.
use std::time::Duration;

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};

use crate::{auth, error::ApiError, events, policy, AppState};

const FEATURES: [&str; 5] = [
    "noAds",
    "advancedFilters",
    "incomingLikeProfiles",
    "unlimitedRewind",
    "incognito",
];

pub fn membership_state(record: Option<&Value>, now_ms: i64) -> Value {
    let plus = policy::is_plus_active(record, now_ms);
    let empty = Value::Null;
    let record = record.unwrap_or(&empty);
    let features: serde_json::Map<String, Value> = FEATURES
        .iter()
        .map(|f| ((*f).to_owned(), json!(plus)))
        .collect();
    json!({
        "plus": plus, "plan": if plus {"plus"} else {"free"},
        "activeUntil": record["activeUntil"].as_i64().unwrap_or(0),
        "productId": record["productId"], "store": record["store"], "managementUrl": record["managementUrl"],
        "verifiedAt": record["verifiedAt"].as_i64().unwrap_or(0), "features": features,
    })
}

fn parse_ms(value: &Value) -> Option<i64> {
    value
        .as_str()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis())
}

/// Port of `entitlementFromSubscriber`.
pub fn entitlement_from_subscriber(
    payload: &Value,
    now_ms: i64,
    allow_sandbox: bool,
) -> Result<Value, ApiError> {
    let subscriber = payload["subscriber"]
        .as_object()
        .ok_or_else(|| ApiError::unavailable("ข้อมูลสมาชิกไม่สมบูรณ์ กรุณาลองอีกครั้ง"))?;
    let entitlement = &subscriber
        .get("entitlements")
        .cloned()
        .unwrap_or(Value::Null)[policy::PLUS_ENTITLEMENT];
    let product = entitlement["product_identifier"].as_str();
    let plan = entitlement["product_plan_identifier"]
        .as_str()
        .unwrap_or_default();
    let subscriptions = subscriber
        .get("subscriptions")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let subscription = product.and_then(|product| {
        subscriptions
            .get(product)
            .or_else(|| {
                (!plan.is_empty())
                    .then(|| subscriptions.get(&format!("{product}:{plan}")))
                    .flatten()
            })
            .or_else(|| {
                subscriptions
                    .iter()
                    .find(|(k, _)| k.starts_with(&format!("{product}:")))
                    .map(|(_, v)| v)
            })
            .or_else(|| {
                product
                    .split_once(':')
                    .and_then(|(base, _)| subscriptions.get(base))
            })
            .cloned()
    });
    let expiration = parse_ms(&entitlement["expires_date"]);
    let grace = parse_ms(&entitlement["grace_period_expires_date"]).or_else(|| {
        subscription
            .as_ref()
            .and_then(|s| parse_ms(&s["grace_period_expires_date"]))
    });
    let permitted = subscription.as_ref().is_some_and(|s| {
        (s["is_sandbox"] == false || (allow_sandbox && s["is_sandbox"] == true))
            && ["app_store", "play_store"].contains(&s["store"].as_str().unwrap_or_default())
    });
    let refunded = subscription
        .as_ref()
        .is_some_and(|s| !s["refunded_at"].is_null());
    let active_until = match expiration {
        Some(expires) if permitted && !refunded => expires.max(grace.unwrap_or(0)).max(0),
        _ => 0,
    };
    let management = subscriber
        .get("management_url")
        .and_then(Value::as_str)
        .and_then(|u| url::Url::parse(u).ok())
        .filter(|u| {
            u.scheme() == "https"
                && u.username().is_empty()
                && u.password().is_none()
                && matches!(u.host_str(), Some("apps.apple.com" | "play.google.com"))
        })
        .map(|u| u.to_string());
    Ok(json!({
        "source": "revenuecat", "entitlementId": policy::PLUS_ENTITLEMENT, "activeUntil": active_until, "verifiedAt": now_ms,
        "productId": product.filter(|p| p.len() <= 200),
        "store": if permitted { subscription.as_ref().map(|s| s["store"].clone()).unwrap_or(Value::Null) } else { Value::Null },
        "environment": if subscription.as_ref().is_some_and(|s| s["is_sandbox"] == true) { "SANDBOX" } else { "PRODUCTION" },
        "managementUrl": management,
    }))
}

async fn fetch_subscriber(uid: &str) -> Result<Value, ApiError> {
    let key = std::env::var("REVENUECAT_SECRET_API_KEY")
        .ok()
        .filter(|k| !k.is_empty())
        .ok_or_else(|| ApiError::new("failed-precondition", "ระบบสมาชิกยังไม่เปิดให้ใช้งาน"))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| ApiError::internal())?;
    let unavailable = || ApiError::unavailable("ตรวจสอบสมาชิกไม่ได้ กรุณาลองอีกครั้ง");
    let response = client
        .get(format!(
            "https://api.revenuecat.com/v1/subscribers/{}",
            url_path(uid)
        ))
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|_| unavailable())?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|_| unavailable())?;
    if bytes.len() > 1_000_000 {
        return Err(unavailable());
    }
    let payload: Value = serde_json::from_slice(&bytes).map_err(|_| unavailable())?;
    if status.is_success() {
        return Ok(payload);
    }
    if status.as_u16() == 403 && payload["code"] == 7723 {
        if let Ok(project) = std::env::var("REVENUECAT_PROJECT_ID") {
            return fetch_v2(&client, &key, &project, uid).await;
        }
    }
    Err(unavailable())
}

fn url_path(value: &str) -> String {
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

/// RevenueCat V2 keys cannot call V1; normalize subscriptions into V1 shape.
async fn fetch_v2(
    client: &reqwest::Client,
    key: &str,
    project: &str,
    uid: &str,
) -> Result<Value, ApiError> {
    let unavailable = || ApiError::unavailable("ตรวจสอบสมาชิกไม่ได้ กรุณาลองอีกครั้ง");
    let base = format!(
        "https://api.revenuecat.com/v2/projects/{}",
        url_path(project)
    );
    let prefix = format!("{base}/customers/{}/subscriptions?", url_path(uid));
    let mut next = Some(format!("{prefix}limit=100"));
    let mut items = Vec::new();
    for page in 0..20 {
        let Some(url) = next.take() else { break };
        let response = client
            .get(&url)
            .bearer_auth(key)
            .send()
            .await
            .map_err(|_| unavailable())?;
        if response.status().as_u16() == 404 && page == 0 {
            return Ok(json!({"subscriber":{"entitlements":{},"subscriptions":{}}}));
        }
        if !response.status().is_success() {
            return Err(unavailable());
        }
        let data: Value = response.json().await.map_err(|_| unavailable())?;
        items.extend(data["items"].as_array().cloned().ok_or_else(unavailable)?);
        next = data["next_page"].as_str().map(|n| {
            if n.starts_with("http") {
                n.to_owned()
            } else {
                format!("https://api.revenuecat.com{n}")
            }
        });
        if next.as_ref().is_some_and(|n| !n.starts_with(&prefix)) {
            return Err(unavailable());
        }
    }
    if next.is_some() {
        return Err(unavailable());
    }
    let mut active: Vec<&Value> = items
        .iter()
        .filter(|item| {
            item["gives_access"] == true
                && item["pending_payment"] != true
                && ["production", "sandbox"]
                    .contains(&item["environment"].as_str().unwrap_or_default())
                && ["play_store", "app_store"].contains(&item["store"].as_str().unwrap_or_default())
                && item["entitlements"]["items"].as_array().is_some_and(|e| {
                    e.iter()
                        .any(|x| x["lookup_key"] == policy::PLUS_ENTITLEMENT)
                })
                && item["current_period_ends_at"].as_i64().is_some()
        })
        .collect();
    active.sort_by_key(|item| {
        std::cmp::Reverse(item["current_period_ends_at"].as_i64().unwrap_or(0))
    });
    let Some(selected) = active
        .iter()
        .find(|i| i["environment"] == "production")
        .or(active.first())
    else {
        return Ok(json!({"subscriber":{"entitlements":{},"subscriptions":{}}}));
    };
    let product = selected["product_id"].as_str().unwrap_or_default();
    let ends = DateTime::<Utc>::from_timestamp_millis(
        selected["current_period_ends_at"].as_i64().unwrap_or(0),
    )
    .map(|d| d.to_rfc3339())
    .unwrap_or_default();
    let store = selected["store"].as_str().unwrap_or_default();
    Ok(json!({"subscriber":{
        "entitlements": {policy::PLUS_ENTITLEMENT: {"product_identifier": product, "expires_date": ends}},
        "subscriptions": {product: {"store": store, "is_sandbox": selected["environment"] == "sandbox"}},
        "management_url": if store == "play_store" {"https://play.google.com/store/account/subscriptions"} else {"https://apps.apple.com/account/subscriptions"},
    }}))
}

/// Verify with RevenueCat. A generation counter stops an older response that
/// arrives after a refund or transfer from re-granting access.
pub async fn sync(state: &AppState, uid: &str) -> Result<Value, ApiError> {
    let generation: i64 = sqlx::query_scalar(
        "INSERT INTO entitlements(user_id,record) VALUES($1,'{\"syncGeneration\":1}')
         ON CONFLICT(user_id) DO UPDATE SET record=entitlements.record||jsonb_build_object('syncGeneration',COALESCE((entitlements.record->>'syncGeneration')::bigint,0)+1)
         RETURNING (record->>'syncGeneration')::bigint",
    )
    .bind(uid)
    .fetch_one(&state.db)
    .await?;
    let allow_sandbox = std::env::var("CAMPUSMATE_PLUS_ALLOW_SANDBOX").as_deref() == Ok("true");
    let now = Utc::now().timestamp_millis();
    let verified = entitlement_from_subscriber(&fetch_subscriber(uid).await?, now, allow_sandbox)?;
    let mut tx = state.db.begin().await?;
    let current: Value =
        sqlx::query_scalar("SELECT record FROM entitlements WHERE user_id=$1 FOR UPDATE")
            .bind(uid)
            .fetch_one(&mut *tx)
            .await?;
    if current["syncGeneration"].as_i64() != Some(generation) {
        tx.commit().await?;
        return Ok(membership_state(Some(&current), now));
    }
    let merged: Value = sqlx::query_scalar(
        "UPDATE entitlements SET record=record||$2 WHERE user_id=$1 RETURNING record",
    )
    .bind(uid)
    .bind(&verified)
    .fetch_one(&mut *tx)
    .await?;
    // Plus loss does not reveal an incognito profile: it stays private until
    // the owner chooses public (policy::can_view_profile).
    sqlx::query("UPDATE profiles SET revision=revision+1,updated_at=now() WHERE user_id=$1")
        .bind(uid)
        .execute(&mut *tx)
        .await?;
    events::publish_one(&mut tx, uid, "membership", None).await?;
    tx.commit().await?;
    Ok(membership_state(Some(&merged), now))
}

pub async fn get_state(state: &AppState, headers: &HeaderMap, _: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let record: Option<Value> =
        sqlx::query_scalar("SELECT record FROM entitlements WHERE user_id=$1")
            .bind(&user.uid)
            .fetch_optional(&state.db)
            .await?;
    let mut result = membership_state(record.as_ref(), Utc::now().timestamp_millis());
    // The verified record (same fields the app read from entitlements/{uid}).
    let mut public = serde_json::Map::new();
    if let Some(record) = record.as_ref().and_then(Value::as_object) {
        for key in [
            "source",
            "entitlementId",
            "activeUntil",
            "verifiedAt",
            "productId",
            "store",
            "managementUrl",
            "environment",
        ] {
            if let Some(value) = record.get(key) {
                public.insert(key.into(), value.clone());
            }
        }
    }
    result["record"] = if public.is_empty() {
        Value::Null
    } else {
        Value::Object(public)
    };
    result["isAdmin"] = json!(
        user.role == "admin" || crate::admin::is_super_admin(&user.email, user.email_verified)
    );
    Ok(result)
}

pub async fn sync_rpc(state: &AppState, headers: &HeaderMap, _: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    if std::env::var("CAMPUSMATE_PLUS_ENABLED").as_deref() != Ok("true") {
        return Err(ApiError::new(
            "failed-precondition",
            "ระบบสมาชิกยังไม่เปิดให้ใช้งาน",
        ));
    }
    crate::throttle(&state.db, "membership-sync", &user.uid, 10).await?;
    sync(state, &user.uid).await
}

pub fn webhook_user_ids(event: &Value) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    let mut push = |value: &Value| {
        if let Some(id) = value.as_str() {
            if !id.is_empty()
                && id.len() <= 128
                && !id.starts_with("$RCAnonymousID:")
                && !id.contains('/')
                && !id.chars().any(char::is_control)
                && !ids.iter().any(|x| x == id)
            {
                ids.push(id.to_owned());
            }
        }
    };
    push(&event["app_user_id"]);
    push(&event["original_app_user_id"]);
    for key in ["aliases", "transferred_from", "transferred_to"] {
        for value in event[key].as_array().cloned().unwrap_or_default() {
            push(&value);
        }
    }
    ids.truncate(20);
    ids
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0_u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// `POST /v1/webhooks/revenuecat`.
pub async fn webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> (StatusCode, &'static str) {
    if std::env::var("CAMPUSMATE_PLUS_ENABLED").as_deref() != Ok("true") {
        return (StatusCode::SERVICE_UNAVAILABLE, "Membership not configured");
    }
    let expected = std::env::var("REVENUECAT_WEBHOOK_AUTHORIZATION").unwrap_or_default();
    let actual = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if expected.len() < 24 || !constant_time_eq(actual.as_bytes(), expected.as_bytes()) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized");
    }
    let Ok(payload) = serde_json::from_slice::<Value>(&body) else {
        return (StatusCode::BAD_REQUEST, "Invalid event");
    };
    let event = &payload["event"];
    let Some(id) = event["id"].as_str().filter(|id| {
        !id.is_empty()
            && id.len() <= 200
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    }) else {
        return (StatusCode::BAD_REQUEST, "Invalid event");
    };
    match sqlx::query("SELECT 1 FROM revenuecat_events WHERE id=$1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(_)) => return (StatusCode::OK, "Already processed"),
        Ok(None) => {}
        Err(_) => return (StatusCode::SERVICE_UNAVAILABLE, "Retry later"),
    }
    for uid in webhook_user_ids(event) {
        let exists = sqlx::query("SELECT 1 FROM accounts WHERE id=$1 AND deleted_at IS NULL")
            .bind(&uid)
            .fetch_optional(&state.db)
            .await;
        match exists {
            Ok(Some(_)) => {
                if sync(&state, &uid).await.is_err() {
                    return (StatusCode::SERVICE_UNAVAILABLE, "Retry later");
                }
            }
            Ok(None) => {}
            Err(_) => return (StatusCode::SERVICE_UNAVAILABLE, "Retry later"),
        }
    }
    let kind: String = event["type"]
        .as_str()
        .unwrap_or("UNKNOWN")
        .chars()
        .take(80)
        .collect();
    if sqlx::query("INSERT INTO revenuecat_events(id,type) VALUES($1,$2) ON CONFLICT DO NOTHING")
        .bind(id)
        .bind(kind)
        .execute(&state.db)
        .await
        .is_err()
    {
        return (StatusCode::SERVICE_UNAVAILABLE, "Retry later");
    }
    (StatusCode::OK, "Processed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscriber_policy_rejects_sandbox_promo_and_refunds() {
        let now = 1_000;
        let payload = |store: &str, sandbox: bool, refunded: Value| {
            json!({"subscriber":{
            "entitlements":{"campusmate_plus":{"product_identifier":"plus_monthly","expires_date":"2099-01-01T00:00:00Z"}},
            "subscriptions":{"plus_monthly":{"store":store,"is_sandbox":sandbox,"refunded_at":refunded}},
            "management_url":"https://apps.apple.com/account/subscriptions"}})
        };
        let active =
            entitlement_from_subscriber(&payload("app_store", false, Value::Null), now, false)
                .unwrap();
        assert!(active["activeUntil"].as_i64().unwrap() > now);
        assert_eq!(
            active["managementUrl"],
            "https://apps.apple.com/account/subscriptions"
        );
        assert_eq!(
            entitlement_from_subscriber(&payload("app_store", true, Value::Null), now, false)
                .unwrap()["activeUntil"],
            0
        );
        assert!(
            entitlement_from_subscriber(&payload("app_store", true, Value::Null), now, true)
                .unwrap()["activeUntil"]
                .as_i64()
                .unwrap()
                > 0
        );
        assert_eq!(
            entitlement_from_subscriber(&payload("promotional", false, Value::Null), now, false)
                .unwrap()["activeUntil"],
            0
        );
        assert_eq!(
            entitlement_from_subscriber(
                &payload("app_store", false, json!("2020-01-01")),
                now,
                false
            )
            .unwrap()["activeUntil"],
            0
        );
    }

    #[test]
    fn webhook_ids_skip_anonymous_and_paths() {
        let ids = webhook_user_ids(
            &json!({"app_user_id":"alice","original_app_user_id":"$RCAnonymousID:x","aliases":["alice","bob","a/b"]}),
        );
        assert_eq!(ids, vec!["alice", "bob"]);
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
    }
}
