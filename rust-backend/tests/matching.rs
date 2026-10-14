//! PostgreSQL transaction checks, including acceptance racing a rewind.
use axum::{
    body::Body,
    http::{Request, StatusCode},
    routing::post,
    Router,
};
use campusmate_backend::{matching, new_state};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

async fn app(pool: &PgPool) -> Router {
    Router::new()
        .route("/actions", post(matching::record))
        .route("/respond", post(matching::respond))
        .route("/cancel", post(matching::cancel))
        .route("/unmatch", post(matching::unmatch))
        .route("/rewind", post(matching::rewind))
        .with_state(new_state(pool.clone(), vec![94; 32]).await.unwrap())
}
async fn seed(pool: &PgPool, id: &str) -> String {
    sqlx::query("INSERT INTO accounts(id,email,email_verified) VALUES($1,$2,true)")
        .bind(id)
        .bind(format!("{id}@psu.ac.th"))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO profiles(user_id,raw,face_verified,discoverable,is_new) VALUES($1,$2,true,true,false)")
        .bind(id).bind(json!({"name":"Student","age":21,"activities":["running"],"privacy":{"showAge":false},"email":"PRIVATE"}))
        .execute(pool).await.unwrap();
    let access = hex::encode(Sha256::digest(format!("matching-access:{id}")));
    let refresh = hex::encode(Sha256::digest(format!("matching-refresh:{id}")));
    sqlx::query("INSERT INTO sessions(user_id,family_id,access_hash,refresh_hash,expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes',now()+interval '30 days')")
        .bind(id).bind(Uuid::new_v4()).bind(Sha256::digest(access.as_bytes()).to_vec()).bind(Sha256::digest(refresh.as_bytes()).to_vec())
        .execute(pool).await.unwrap();
    access
}
async fn plus(pool: &PgPool, id: &str, active: bool) {
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query("INSERT INTO entitlements(user_id,record) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET record=excluded.record")
        .bind(id).bind(json!({"source":"revenuecat","entitlementId":"campusmate_plus","verifiedAt":now,"activeUntil":if active {now+3_600_000} else {now-1}}))
        .execute(pool).await.unwrap();
}
async fn call(app: &Router, path: &str, token: &str, body: Value) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or_else(|_| panic!("non-JSON response {status}")),
    )
}
fn action(target: &str, kind: &str, id: Uuid) -> Value {
    json!({"targetUserId":target,"kind":kind,"actionId":id,"likeMessage":""})
}
async fn count(pool: &PgPool, query: &str) -> i64 {
    sqlx::query_scalar(query).fetch_one(pool).await.unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn exact_idempotency_and_conflicting_concurrent_receipts(pool: PgPool) {
    let token = seed(&pool, "alice").await;
    seed(&pool, "bob").await;
    seed(&pool, "carol").await;
    let app = app(&pool).await;
    let id = Uuid::new_v4();
    let first = action("bob", "like", id);
    let (status, result) = call(&app, "/actions", &token, first.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        call(&app, "/actions", &token, first.clone()).await,
        (StatusCode::OK, result.clone())
    );
    let mut changed = first;
    changed["likeMessage"] = json!("different message");
    assert_eq!(
        call(&app, "/actions", &token, changed).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        count(&pool, "SELECT count(*) FROM matching_history").await,
        1
    );
    assert_eq!(count(&pool, "SELECT count(*) FROM decisions").await, 1);
    let concurrent = Uuid::new_v4();
    let (a, b) = tokio::join!(
        call(&app, "/actions", &token, action("bob", "skip", concurrent)),
        call(
            &app,
            "/actions",
            &token,
            action("carol", "like", concurrent)
        )
    );
    let statuses = [a.0, b.0];
    assert_eq!(statuses.iter().filter(|s| **s == StatusCode::OK).count(), 1);
    assert_eq!(
        statuses
            .iter()
            .filter(|s| **s == StatusCode::BAD_REQUEST)
            .count(),
        1
    );
    assert_eq!(
        count(&pool, "SELECT count(*) FROM action_receipts").await,
        2
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn concurrent_mutual_likes_accept_once_and_unmatch_revokes_relationship(pool: PgPool) {
    let alice = seed(&pool, "alice").await;
    let bob = seed(&pool, "bob").await;
    let app = app(&pool).await;
    let (a, b) = tokio::join!(
        call(
            &app,
            "/actions",
            &alice,
            action("bob", "like", Uuid::new_v4())
        ),
        call(
            &app,
            "/actions",
            &bob,
            action("alice", "like", Uuid::new_v4())
        )
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    assert!([&a.1, &b.1].iter().any(|v| v["status"] == "accepted"));
    assert_eq!(
        count(
            &pool,
            "SELECT count(*) FROM decisions WHERE status='accepted'"
        )
        .await,
        2
    );
    assert_eq!(
        count(&pool, "SELECT count(*) FROM conversations WHERE active").await,
        1
    );
    assert_eq!(
        count(
            &pool,
            "SELECT count(*) FROM matching_history WHERE undoable"
        )
        .await,
        0
    );
    assert_eq!(
        call(&app, "/cancel", &alice, json!({"targetUserId":"bob"}))
            .await
            .0,
        StatusCode::PRECONDITION_FAILED
    );
    assert_eq!(
        call(
            &app,
            "/respond",
            &bob,
            json!({"targetUserId":"alice","response":"reject"})
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    assert_eq!(
        call(&app, "/unmatch", &alice, json!({"targetUserId":"bob"}))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "/unmatch", &alice, json!({"targetUserId":"bob"}))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        count(&pool, "SELECT count(*) FROM conversations WHERE active").await,
        0
    );
    assert_eq!(
        count(
            &pool,
            "SELECT count(*) FROM decisions WHERE status='removed'"
        )
        .await,
        2
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn acceptance_racing_rewind_never_deletes_an_accepted_relationship(pool: PgPool) {
    let app = app(&pool).await;
    for index in 0..8 {
        let a = format!("a{index}");
        let b = format!("b{index}");
        let alice = seed(&pool, &a).await;
        let bob = seed(&pool, &b).await;
        plus(&pool, &a, true).await;
        assert_eq!(
            call(&app, "/actions", &alice, action(&b, "like", Uuid::new_v4()))
                .await
                .0,
            StatusCode::OK
        );
        let (accepted, rewound) = tokio::join!(
            call(
                &app,
                "/respond",
                &bob,
                json!({"targetUserId":a,"response":"accept"})
            ),
            call(&app, "/rewind", &alice, json!({"actionId":Uuid::new_v4()}))
        );
        assert_eq!(rewound.0, StatusCode::OK);
        let statuses:Vec<String>=sqlx::query_scalar("SELECT status FROM decisions WHERE (actor_id=$1 AND target_id=$2) OR (actor_id=$2 AND target_id=$1)")
            .bind(&a).bind(&b).fetch_all(&pool).await.unwrap();
        if accepted.0 == StatusCode::OK {
            assert_eq!(statuses, vec!["accepted".to_owned(), "accepted".to_owned()]);
            assert!(rewound.1["profile"].is_null());
        } else {
            assert_eq!(accepted.0, StatusCode::NOT_FOUND);
            assert!(statuses.is_empty());
            assert_eq!(rewound.1["profile"]["id"], b);
        }
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn rewind_restores_previous_pending_action_and_cancellation_retires_history(pool: PgPool) {
    let alice = seed(&pool, "alice").await;
    seed(&pool, "bob").await;
    plus(&pool, "alice", true).await;
    let app = app(&pool).await;
    let first = Uuid::new_v4();
    assert_eq!(
        call(&app, "/actions", &alice, action("bob", "skip", first))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "/actions",
            &alice,
            action("bob", "like", Uuid::new_v4())
        )
        .await
        .0,
        StatusCode::OK
    );
    let rewound = call(&app, "/rewind", &alice, json!({"actionId":Uuid::new_v4()})).await;
    assert_eq!(rewound.0, StatusCode::OK);
    assert_eq!(rewound.1["profile"]["id"], "bob");
    let last: Uuid = sqlx::query_scalar(
        "SELECT last_action_id FROM decisions WHERE actor_id='alice' AND target_id='bob'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(last, first);
    let kind: String =
        sqlx::query_scalar("SELECT kind FROM decisions WHERE actor_id='alice' AND target_id='bob'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(kind, "skip");
    assert_eq!(
        call(
            &app,
            "/actions",
            &alice,
            action("bob", "like", Uuid::new_v4())
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "/cancel", &alice, json!({"targetUserId":"bob"}))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(count(&pool, "SELECT count(*) FROM decisions").await, 0);
    assert_eq!(
        call(&app, "/rewind", &alice, json!({"actionId":Uuid::new_v4()}))
            .await
            .1["profile"],
        Value::Null
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn rewind_receipts_reauthorize_privacy_blocks_and_expired_membership(pool: PgPool) {
    let alice = seed(&pool, "alice").await;
    seed(&pool, "bob").await;
    let app = app(&pool).await;
    assert_eq!(
        call(&app, "/rewind", &alice, json!({"actionId":Uuid::new_v4()}))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    plus(&pool, "alice", true).await;
    assert_eq!(
        call(
            &app,
            "/actions",
            &alice,
            action("bob", "skip", Uuid::new_v4())
        )
        .await
        .0,
        StatusCode::OK
    );
    let id = Uuid::new_v4();
    let request = json!({"actionId":id});
    let result = call(&app, "/rewind", &alice, request.clone()).await;
    assert_eq!(result.0, StatusCode::OK);
    assert_eq!(result.1["profile"]["id"], "bob");
    assert!(result.1["profile"].get("age").is_none());
    assert!(result.1["profile"].get("email").is_none());
    let stored: Value = sqlx::query_scalar(
        "SELECT response FROM action_receipts WHERE actor_id='alice' AND action_id=$1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(stored.get("profile").is_none());
    assert_eq!(stored["targetId"], "bob");
    sqlx::query("UPDATE profiles SET visibility='hidden' WHERE user_id='bob'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "/rewind", &alice, request.clone()).await.1["profile"],
        Value::Null
    );
    sqlx::query("UPDATE profiles SET visibility='public' WHERE user_id='bob'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO blocks(actor_id,target_id) VALUES('bob','alice')")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "/rewind", &alice, request.clone()).await.1["profile"],
        Value::Null
    );
    plus(&pool, "alice", false).await;
    assert_eq!(
        call(&app, "/rewind", &alice, request).await.0,
        StatusCode::FORBIDDEN
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn matching_requires_current_restrictions_verification_and_incognito_permission(
    pool: PgPool,
) {
    let alice = seed(&pool, "alice").await;
    let bob = seed(&pool, "bob").await;
    let app = app(&pool).await;
    sqlx::query("UPDATE profiles SET visibility='incognito' WHERE user_id='bob'")
        .execute(&pool)
        .await
        .unwrap();
    plus(&pool, "bob", true).await;
    assert_eq!(
        call(
            &app,
            "/actions",
            &alice,
            action("bob", "like", Uuid::new_v4())
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &app,
            "/actions",
            &bob,
            action("alice", "like", Uuid::new_v4())
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "/respond",
            &alice,
            json!({"targetUserId":"bob","response":"reject"})
        )
        .await
        .0,
        StatusCode::OK
    );
    // Rejection removes the owner-liked exception; retries reveal no profile.
    assert_eq!(
        call(
            &app,
            "/actions",
            &alice,
            action("bob", "like", Uuid::new_v4())
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE profiles SET visibility='public',face_verified=false,raw=raw||'{\"isFaceVerified\":true}'::jsonb WHERE user_id='bob'").execute(&pool).await.unwrap();
    assert_eq!(
        call(
            &app,
            "/actions",
            &alice,
            action("bob", "like", Uuid::new_v4())
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE profiles SET face_verified=true WHERE user_id='bob'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE accounts SET suspended=true WHERE id='alice'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "/actions",
            &alice,
            action("bob", "like", Uuid::new_v4())
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
}
