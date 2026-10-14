//! Router-level contract checks. sqlx creates a separate database per test.

use std::collections::HashSet;

use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use campusmate_backend::{new_state, router};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

async fn app(pool: &PgPool) -> Router {
    router(
        new_state(pool.clone(), vec![47; 32])
            .await
            .expect("test state"),
    )
}

async fn seed(pool: &PgPool, id: &str, raw: Value) -> String {
    sqlx::query("INSERT INTO accounts(id,email,email_verified) VALUES($1,$2,true)")
        .bind(id)
        .bind(format!("{id}@psu.ac.th"))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO profiles(user_id,raw,face_verified,discoverable,is_new) VALUES($1,$2,true,true,false)")
        .bind(id).bind(raw).execute(pool).await.unwrap();
    // Only the digest enters SQL, matching the production session contract.
    let token = hex::encode(Sha256::digest(format!("test-access:{id}")));
    let refresh = hex::encode(Sha256::digest(format!("test-refresh:{id}")));
    sqlx::query("INSERT INTO sessions(user_id,family_id,access_hash,refresh_hash,expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes',now()+interval '30 days')")
        .bind(id).bind(Uuid::new_v4()).bind(Sha256::digest(token.as_bytes()).to_vec())
        .bind(Sha256::digest(refresh.as_bytes()).to_vec()).execute(pool).await.unwrap();
    token
}

fn profile() -> Value {
    json!({"name":"Student","age":21,"activities":["running"],"activity":"running","faculty":"science","year":"2",
        "bio":"A student looking for exercise friends","avatarUri":"https://cdn.example.test/avatar.jpg"})
}

async fn call(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value = serde_json::from_slice(&bytes).unwrap_or_else(|error| {
        panic!(
            "non-JSON response {status}: {error}; {}",
            String::from_utf8_lossy(&bytes)
        )
    });
    (status, value)
}

fn ids(body: &Value) -> Vec<String> {
    body["profiles"]
        .as_array()
        .expect("profile array")
        .iter()
        .map(|profile| profile["id"].as_str().expect("profile id").to_owned())
        .collect()
}

async fn plus(pool: &PgPool, id: &str, active: bool) {
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query("INSERT INTO entitlements(user_id,record) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET record=excluded.record")
        .bind(id).bind(json!({"source":"revenuecat","entitlementId":"campusmate_plus","verifiedAt":now,"activeUntil":if active {now+3_600_000} else {now-1}}))
        .execute(pool).await.unwrap();
}

async fn decision(pool: &PgPool, from: &str, to: &str, status: &str) {
    sqlx::query("INSERT INTO decisions(actor_id,target_id,kind,status) VALUES($1,$2,'like',$3)")
        .bind(from)
        .bind(to)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn identities_obey_authoritative_visibility_face_restrictions_and_bilateral_blocks(
    pool: PgPool,
) {
    let token = seed(&pool, "viewer", profile()).await;
    let candidates = [
        "public",
        "incognito_like",
        "incognito_without_like",
        "incognito_expired",
        "incognito_free",
        "hidden",
        "unverified",
        "new",
        "undiscoverable",
        "blocked_by_viewer",
        "blocked_viewer",
        "suspended",
        "deleted",
        "unverified_email",
    ];
    for id in candidates {
        // Even a raw forged verification value cannot replace the SQL flag.
        let mut raw = profile();
        raw["isFaceVerified"] = json!(true);
        seed(&pool, id, raw).await;
    }
    sqlx::query("UPDATE profiles SET visibility='incognito' WHERE user_id LIKE 'incognito_%'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE profiles SET visibility='hidden' WHERE user_id='hidden'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE profiles SET face_verified=false WHERE user_id='unverified'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE profiles SET is_new=true WHERE user_id='new'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE profiles SET discoverable=false WHERE user_id='undiscoverable'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE accounts SET suspended=true WHERE id='suspended'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE accounts SET deleted_at=now() WHERE id='deleted'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE accounts SET email_verified=false WHERE id='unverified_email'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO blocks(actor_id,target_id) VALUES('viewer','blocked_by_viewer'),('blocked_viewer','viewer')").execute(&pool).await.unwrap();
    plus(&pool, "incognito_like", true).await;
    plus(&pool, "incognito_without_like", true).await;
    plus(&pool, "incognito_expired", false).await;
    for id in ["incognito_like", "incognito_expired", "incognito_free"] {
        decision(&pool, id, "viewer", "pending").await;
    }
    let app = app(&pool).await;
    for (path, payload) in [
        ("/v1/discover", json!({})),
        ("/v1/profiles/visible", json!({"userIds":candidates})),
    ] {
        let (status, body) = call(&app, "POST", path, Some(&token), payload).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let actual: HashSet<_> = ids(&body).into_iter().collect();
        assert_eq!(
            actual,
            HashSet::from(["public".to_owned(), "incognito_like".to_owned()])
        );
    }
    // Revocation immediately hides incognito; reverting to public is explicit.
    plus(&pool, "incognito_like", false).await;
    let (status, body) = call(
        &app,
        "POST",
        "/v1/profiles/visible",
        Some(&token),
        json!({"userIds":["incognito_like"]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(ids(&body).is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn accepted_relationships_allow_private_profiles_but_never_override_block_or_face_checks(
    pool: PgPool,
) {
    let token = seed(&pool, "viewer", profile()).await;
    for id in [
        "matched_hidden",
        "matched_blocked",
        "matched_unverified",
        "rejected_match",
    ] {
        seed(&pool, id, profile()).await;
        sqlx::query("UPDATE profiles SET visibility='hidden',discoverable=false,is_new=true WHERE user_id=$1").bind(id).execute(&pool).await.unwrap();
        decision(&pool, id, "viewer", "accepted").await;
    }
    sqlx::query("INSERT INTO blocks(actor_id,target_id) VALUES('matched_blocked','viewer')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE profiles SET face_verified=false WHERE user_id='matched_unverified'")
        .execute(&pool)
        .await
        .unwrap();
    decision(&pool, "viewer", "rejected_match", "rejected").await;
    let app = app(&pool).await;
    let (status,body)=call(&app,"POST","/v1/profiles/visible",Some(&token),json!({"userIds":["matched_hidden","matched_blocked","matched_unverified","rejected_match"]})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(ids(&body), vec!["matched_hidden"]);
    let (status, body) = call(&app, "POST", "/v1/discover", Some(&token), json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        ids(&body).is_empty(),
        "matches must not return as new discovery"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn private_attributes_do_not_change_scores_reasons_or_return_secrets_and_gps_is_coarsened(
    pool: PgPool,
) {
    let mut viewer = profile();
    viewer["latitude"] = json!(7.0);
    viewer["longitude"] = json!(100.5);
    let token = seed(&pool, "viewer", viewer).await;
    let hidden = json!({"name":"Student","bio":"A student looking for exercise friends","avatarUri":"https://cdn.example.test/avatar.jpg",
        "age":21,"gender":"hidden","faculty":"secret faculty","year":"2","activity":"running","activities":["running"],"interests":["running"],"tags":["running"],
        "availability":"เย็น","activityDetails":{"running":{"pace":"easy"}},"availabilitySlots":[{"date":"2026-10-12","start":"18:00","end":"20:00"}],
        "latitude":7.0,"longitude":100.5,"email":"secret@example.test","passwordHash":"secret-password-hash","refreshToken":"secret-refresh-token",
        "encryptionDevices":{"device":{"publicKey":"secret-device-key"}},"role":"admin","faceMatchScore":99,
        "privacy":{"showAge":false,"showGender":false,"showFaculty":false,"showActivity":false,"showAvailability":false,"showLocation":false}});
    seed(&pool, "hidden_a", hidden.clone()).await;
    let mut other = hidden.clone();
    other["age"] = json!(80);
    other["gender"] = json!("other");
    other["faculty"] = json!("different");
    other["year"] = json!("5");
    other["activity"] = json!("gaming");
    other["activities"] = json!(["gaming"]);
    other["interests"] = json!(["gaming"]);
    other["tags"] = json!(["gaming"]);
    other["availability"] = json!("เช้า");
    other["availabilitySlots"] = json!([]);
    other["latitude"] = json!(40.0);
    other["longitude"] = json!(70.0);
    seed(&pool, "hidden_b", other).await;
    let mut near = profile();
    near["latitude"] = json!(7.0);
    near["longitude"] = json!(100.5);
    seed(&pool, "near", near).await;
    let app = app(&pool).await;
    let (status, body) = call(&app, "POST", "/v1/discover", Some(&token), json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let profiles = body["profiles"].as_array().unwrap();
    let a = profiles
        .iter()
        .find(|p| p["id"] == "hidden_a")
        .expect("hidden age remains in default unrestricted feed");
    let b = profiles.iter().find(|p| p["id"] == "hidden_b").unwrap();
    assert_eq!(a["compatibility"], b["compatibility"]);
    assert_eq!(a["matchReasons"], b["matchReasons"]);
    for hidden in [a, b] {
        for key in [
            "age",
            "gender",
            "faculty",
            "year",
            "activities",
            "activity",
            "activityDetails",
            "availability",
            "availabilitySlots",
            "interests",
            "tags",
        ] {
            assert!(hidden.get(key).is_none(), "hidden {key} was exposed");
        }
        assert!(hidden["distance"].is_null());
    }
    let near = profiles.iter().find(|p| p["id"] == "near").unwrap();
    assert_eq!(near["distance"], json!(1.0));
    for projected in profiles {
        for key in [
            "latitude",
            "longitude",
            "email",
            "passwordHash",
            "refreshToken",
            "encryptionDevices",
            "role",
            "faceMatchScore",
        ] {
            assert!(projected.get(key).is_none(), "private {key} exposed");
        }
    }
    assert!(!body.to_string().contains("secret"));
    // A selected age filter cannot inspect a hidden age to distinguish these users.
    let (status, body) = call(
        &app,
        "POST",
        "/v1/discover",
        Some(&token),
        json!({"filters":{"minAge":20,"maxAge":22}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ids(&body), vec!["near"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn pagination_is_unique_cursor_is_bound_and_a_new_block_takes_effect_on_next_page(
    pool: PgPool,
) {
    let token = seed(&pool, "viewer", profile()).await;
    let other_token = seed(&pool, "another_viewer", profile()).await;
    sqlx::query("UPDATE profiles SET discoverable=false WHERE user_id='another_viewer'")
        .execute(&pool)
        .await
        .unwrap();
    for i in 0..75 {
        seed(&pool, &format!("peer_{i:03}"), profile()).await;
    }
    let app = app(&pool).await;
    let (status, first) = call(&app, "POST", "/v1/discover", Some(&token), json!({})).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(ids(&first).len(), 30);
    assert_eq!(first["hasMore"], true);
    let first_cursor = first["nextCursor"].as_str().unwrap();
    for (caller, filters) in [
        (&other_token, json!({})),
        (&token, json!({"minAge":20,"maxAge":22})),
    ] {
        let (status, error) = call(
            &app,
            "POST",
            "/v1/discover",
            Some(caller),
            json!({"cursor":first_cursor,"filters":filters}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert_eq!(error["error"]["code"], "invalid-argument");
    }
    let mut tampered = first_cursor.to_owned();
    tampered.replace_range(5..6, if &first_cursor[5..6] == "A" { "B" } else { "A" });
    let (status, _) = call(
        &app,
        "POST",
        "/v1/discover",
        Some(&token),
        json!({"cursor":tampered}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let ranked:Value=sqlx::query_scalar("SELECT ranked FROM discovery_snapshots WHERE user_id='viewer' ORDER BY expires_at DESC LIMIT 1").fetch_one(&pool).await.unwrap();
    let blocked = ranked[30]["id"].as_str().unwrap().to_owned();
    let (status, _) = call(
        &app,
        "PUT",
        &format!("/v1/me/blocks/{blocked}"),
        Some(&token),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let mut seen: HashSet<String> = ids(&first).into_iter().collect();
    let mut cursor = Some(first_cursor.to_owned());
    let mut pages = 0;
    while let Some(value) = cursor {
        pages += 1;
        assert!(pages < 5, "pagination did not terminate");
        let (status, page) = call(
            &app,
            "POST",
            "/v1/discover",
            Some(&token),
            json!({"cursor":value}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{page}");
        for id in ids(&page) {
            assert_ne!(id, blocked);
            assert!(seen.insert(id), "duplicate profile across pages");
        }
        cursor = page["nextCursor"].as_str().map(str::to_owned);
        assert_eq!(page["hasMore"].as_bool().unwrap(), cursor.is_some());
    }
    assert_eq!(seen.len(), 74);
}

#[sqlx::test(migrations = "./migrations")]
async fn privacy_revision_changes_abort_stale_ranked_pages(pool: PgPool) {
    let token = seed(&pool, "viewer", profile()).await;
    for i in 0..40 {
        seed(&pool, &format!("peer_{i:03}"), profile()).await;
    }
    let app = app(&pool).await;
    let (status, page) = call(&app, "POST", "/v1/discover", Some(&token), json!({})).await;
    assert_eq!(status, StatusCode::OK, "{page}");
    let ranked: Value =
        sqlx::query_scalar("SELECT ranked FROM discovery_snapshots WHERE user_id='viewer'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let changed = ranked[30]["id"].as_str().unwrap();
    sqlx::query("UPDATE profiles SET raw=jsonb_set(raw,'{privacy}','{\"showActivity\":false}'::jsonb),revision=revision+1 WHERE user_id=$1")
        .bind(changed).execute(&pool).await.unwrap();
    let (status, error) = call(
        &app,
        "POST",
        "/v1/discover",
        Some(&token),
        json!({"cursor":page["nextCursor"]}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error["error"]["code"], "aborted");
    assert!(error.get("profiles").is_none());
    let (status, fresh) = call(
        &app,
        "POST",
        "/v1/profiles/visible",
        Some(&token),
        json!({"userIds":[changed]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ids(&fresh), vec![changed]);
    assert!(fresh["profiles"][0].get("activities").is_none());
}

#[sqlx::test(migrations = "./migrations")]
async fn profile_writes_reject_server_flags_and_enforce_compare_and_swap(pool: PgPool) {
    let token = seed(&pool, "viewer", profile()).await;
    let app = app(&pool).await;
    for field in [
        "isFaceVerified",
        "isAdmin",
        "role",
        "emailVerified",
        "faceMatchScore",
        "encryptionDevices",
    ] {
        let (status, error) = call(
            &app,
            "PUT",
            "/v1/me/profile",
            Some(&token),
            json!({"revision":0,"profile":{field:true}}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{field}: {error}");
    }
    let before =
        sqlx::query("SELECT raw,revision,face_verified FROM profiles WHERE user_id='viewer'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(before.get::<i64, _>("revision"), 0);
    assert_eq!(before.get::<Value, _>("raw"), profile());
    assert!(before.get::<bool, _>("face_verified"));
    // Keeping the same photo keeps the photo badge (replacing it revokes it).
    let saved = json!({"name":"Updated student","age":22,"privacy":{"showLocation":false},
        "avatarUri":profile()["avatarUri"]});
    let (status, response) = call(
        &app,
        "PUT",
        "/v1/me/profile",
        Some(&token),
        json!({"revision":0,"profile":saved}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response["revision"], 1);
    let (status, error) = call(
        &app,
        "PUT",
        "/v1/me/profile",
        Some(&token),
        json!({"revision":0,"profile":{"name":"Stale overwrite"}}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error["error"]["code"], "aborted");
    let (status, read) = call(&app, "GET", "/v1/me/profile", Some(&token), json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(read["profile"]["name"], "Updated student");
    assert_eq!(read["revision"], 1);
    assert_eq!(read["isFaceVerified"], true);
    let (status, error) = call(
        &app,
        "PUT",
        "/v1/me/visibility",
        Some(&token),
        json!({"mode":"incognito","discoverable":true}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error["error"]["details"]["reason"], "PLUS_REQUIRED");
    plus(&pool, "viewer", true).await;
    let (status, response) = call(
        &app,
        "PUT",
        "/v1/me/visibility",
        Some(&token),
        json!({"mode":"incognito","discoverable":true}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{response}");
}

#[sqlx::test(migrations = "./migrations")]
async fn discovery_rejects_missing_revoked_suspended_deleted_and_unverified_caller_sessions(
    pool: PgPool,
) {
    let token = seed(&pool, "viewer", profile()).await;
    seed(&pool, "peer", profile()).await;
    let app = app(&pool).await;
    let (status, _) = call(&app, "POST", "/v1/discover", None, json!({})).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    sqlx::query("UPDATE accounts SET suspended=true WHERE id='viewer'")
        .execute(&pool)
        .await
        .unwrap();
    let (status, _) = call(&app, "POST", "/v1/discover", Some(&token), json!({})).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    sqlx::query("UPDATE accounts SET suspended=false,deleted_at=now() WHERE id='viewer'")
        .execute(&pool)
        .await
        .unwrap();
    let (status, _) = call(
        &app,
        "POST",
        "/v1/profiles/visible",
        Some(&token),
        json!({"userIds":["peer"]}),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    sqlx::query("UPDATE accounts SET deleted_at=NULL,email_verified=false WHERE id='viewer'")
        .execute(&pool)
        .await
        .unwrap();
    let (status, error) = call(&app, "POST", "/v1/discover", Some(&token), json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error["error"]["details"]["reason"], "EMAIL_NOT_VERIFIED");
    sqlx::query("UPDATE accounts SET email_verified=true WHERE id='viewer'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE accounts SET email='viewer@gmail.com' WHERE id='viewer'")
        .execute(&pool)
        .await
        .unwrap();
    let (status, error) = call(&app, "POST", "/v1/discover", Some(&token), json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error["error"]["details"]["reason"], "CAMPUS_EMAIL_REQUIRED");
    sqlx::query("UPDATE sessions SET revoked_at=now() WHERE user_id='viewer'")
        .execute(&pool)
        .await
        .unwrap();
    let (status, _) = call(&app, "POST", "/v1/discover", Some(&token), json!({})).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
