use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use campusmate_backend::{new_state, router};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

async fn seed(pool: &PgPool, id: &str) -> String {
    sqlx::query("INSERT INTO accounts(id,email,email_verified) VALUES($1,$2,true)")
        .bind(id)
        .bind(format!("{id}@psu.ac.th"))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO profiles(user_id,raw,face_verified,discoverable,is_new) VALUES($1,'{\"name\":\"Student\",\"age\":21}',true,true,false)")
        .bind(id).execute(pool).await.unwrap();
    session(pool, id).await
}

async fn session(pool: &PgPool, id: &str) -> String {
    let token = hex::encode(Sha256::digest(Uuid::new_v4().as_bytes()));
    sqlx::query("INSERT INTO sessions(user_id,family_id,access_hash,refresh_hash,expires_at,refresh_expires_at)
        VALUES($1,$2,$3,$4,now()+interval '15 minutes',now()+interval '30 days')")
        .bind(id).bind(Uuid::new_v4()).bind(Sha256::digest(token.as_bytes()).to_vec())
        .bind(Sha256::digest(format!("refresh:{token}").as_bytes()).to_vec()).execute(pool).await.unwrap();
    token
}

async fn rpc(app: &Router, token: &str, name: &str, data: Value) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/rpc/{name}"))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(json!({"data":data}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    (
        status,
        if status == StatusCode::OK {
            body["result"].clone()
        } else {
            body
        },
    )
}

async fn ok(app: &Router, token: &str, name: &str, data: Value) -> Value {
    let (status, body) = rpc(app, token, name, data).await;
    assert_eq!(status, StatusCode::OK, "{name}: {body}");
    body
}

#[sqlx::test(migrations = "./migrations")]
async fn preferences_persist_privately_validate_and_sync_legacy_push(pool: PgPool) {
    let alice = seed(&pool, "alice").await;
    let bob = seed(&pool, "bob").await;
    let app = router(new_state(pool.clone(), vec![91; 32]).await.unwrap());
    let saved = ok(
        &app,
        &alice,
        "saveAppPreferences",
        json!({"settings":{"showOnlineStatus":false,
        "publicUsername":"alice_psu","autoplay":"wifi","notifications":{"push":false}}}),
    )
    .await;
    assert_eq!(saved["preferences"]["showOnlineStatus"], false);
    let other_device = session(&pool, "alice").await;
    let loaded = ok(&app, &other_device, "getAppPreferences", json!({})).await;
    assert_eq!(loaded["preferences"], saved["preferences"]);
    assert_eq!(loaded["capabilities"]["sms"], false);
    assert_eq!(
        ok(&app, &bob, "getAppPreferences", json!({"userId":"alice"})).await["preferences"]
            ["publicUsername"],
        ""
    );
    let (status, _) = rpc(
        &app,
        &bob,
        "saveAppPreferences",
        json!({"settings":{"publicUsername":"alice_psu"}}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    for invalid in [
        json!({"unknown":true}),
        json!({"showOnlineStatus":"false"}),
        json!({"theme":"invalid"}),
        json!({"publicUsername":"x y"}),
        json!({"notifications":{"sms":true}}),
        json!({"notifications":{"push":"true"}}),
    ] {
        let (status, _) = rpc(
            &app,
            &alice,
            "saveAppPreferences",
            json!({"settings":invalid}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    let enabled: bool = sqlx::query_scalar(
        "SELECT (raw->>'notificationsEnabled')::boolean FROM profiles WHERE user_id='alice'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!enabled);
    ok(
        &app,
        &alice,
        "saveMyProfile",
        json!({"patch":{"notificationsEnabled":true}}),
    )
    .await;
    assert_eq!(
        ok(&app, &alice, "getAppPreferences", json!({})).await["preferences"]["notifications"]
            ["push"],
        true
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn presence_is_session_bound_expires_and_honors_both_privacy_switches(pool: PgPool) {
    let alice = seed(&pool, "alice").await;
    let alice_second = session(&pool, "alice").await;
    let bob = seed(&pool, "bob").await;
    let stranger = seed(&pool, "stranger").await;
    sqlx::query(
        "INSERT INTO conversations(id,member_a,member_b) VALUES('c-presence','alice','bob')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO conversation_members(conversation_id,user_id) VALUES('c-presence','alice'),('c-presence','bob') ON CONFLICT DO NOTHING").execute(&pool).await.unwrap();
    let app = router(new_state(pool.clone(), vec![92; 32]).await.unwrap());
    let query = json!({"conversationIds":["c-presence"]});
    ok(
        &app,
        &alice,
        "presenceHeartbeat",
        json!({"active":true,"userId":"bob","timestamp":9999999999999_i64}),
    )
    .await;
    let online = ok(&app, &bob, "getChatPresence", query.clone()).await;
    assert_eq!(online["presence"]["c-presence"]["isOnline"], true);
    assert!(
        online["presence"]["c-presence"]["expiresAt"]
            .as_i64()
            .unwrap()
            < 9999999999999_i64
    );
    assert!(
        ok(&app, &stranger, "getChatPresence", query.clone()).await["presence"]
            .as_object()
            .unwrap()
            .is_empty()
    );
    ok(
        &app,
        &alice_second,
        "presenceHeartbeat",
        json!({"active":true}),
    )
    .await;
    ok(&app, &alice, "presenceHeartbeat", json!({"active":false})).await;
    assert_eq!(
        ok(&app, &bob, "getChatPresence", query.clone()).await["presence"]["c-presence"]
            ["isOnline"],
        true
    );
    sqlx::query(
        "UPDATE user_presence SET online_until=now()-interval '1 second' WHERE user_id='alice'",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        ok(&app, &bob, "getChatPresence", query.clone()).await["presence"]["c-presence"]
            ["isOnline"],
        false
    );
    ok(
        &app,
        &alice_second,
        "presenceHeartbeat",
        json!({"active":true}),
    )
    .await;
    sqlx::query("UPDATE sessions SET revoked_at=now() WHERE user_id='alice'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        ok(&app, &bob, "getChatPresence", query.clone()).await["presence"]["c-presence"]
            ["isOnline"],
        false
    );
    let alice_new = session(&pool, "alice").await;
    ok(
        &app,
        &alice_new,
        "presenceHeartbeat",
        json!({"active":true}),
    )
    .await;
    ok(
        &app,
        &alice_new,
        "saveAppPreferences",
        json!({"settings":{"showOnlineStatus":false}}),
    )
    .await;
    let hidden = ok(&app, &bob, "getChatPresence", query.clone()).await;
    assert_eq!(hidden["presence"]["c-presence"]["visible"], false);
    assert!(hidden["presence"]["c-presence"]["lastActiveAt"].is_null());
    ok(
        &app,
        &alice_new,
        "saveAppPreferences",
        json!({"settings":{"showOnlineStatus":true}}),
    )
    .await;
    ok(
        &app,
        &bob,
        "saveAppPreferences",
        json!({"settings":{"showOnlineStatus":false}}),
    )
    .await;
    assert_eq!(
        ok(&app, &bob, "getChatPresence", query.clone()).await["presence"]["c-presence"]["visible"],
        false
    );
    ok(
        &app,
        &bob,
        "saveAppPreferences",
        json!({"settings":{"showOnlineStatus":true}}),
    )
    .await;
    sqlx::query("INSERT INTO blocks(actor_id,target_id) VALUES('bob','alice')")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        ok(&app, &bob, "getChatPresence", query).await["presence"]["c-presence"]["visible"],
        false
    );
}
