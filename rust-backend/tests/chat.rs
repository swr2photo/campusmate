//! Router contracts for direct-room encrypted transport. Fixtures use only
//! synthetic ciphertext; cryptographic authentication occurs on the clients.

use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use campusmate_backend::{new_state, router};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::collections::HashSet;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrations = "./migrations")]
async fn a_waiting_send_rechecks_committed_blocks_and_revoked_sessions(pool: PgPool) {
    let (app, alice, bob, _) = setup(&pool).await;
    initialize(&app, &alice, &bob).await;
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO blocks(actor_id,target_id) VALUES('bob','alice')")
        .execute(&mut *tx)
        .await
        .unwrap();
    let task_app = app.clone();
    let task_token = alice.clone();
    let mut send = tokio::spawn(async move {
        call(
            &task_app,
            "PUT",
            "/v1/conversations/legacy-room-id/messages/racing-block",
            Some(&task_token),
            message(3),
        )
        .await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut send)
            .await
            .is_err()
    );
    tx.commit().await.unwrap();
    assert_eq!(send.await.unwrap().0, StatusCode::FORBIDDEN);
    sqlx::query("DELETE FROM blocks")
        .execute(&pool)
        .await
        .unwrap();
    let mut reset = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM accounts WHERE id='alice' FOR UPDATE")
        .execute(&mut *reset)
        .await
        .unwrap();
    sqlx::query("UPDATE sessions SET revoked_at=now() WHERE user_id='alice'")
        .execute(&mut *reset)
        .await
        .unwrap();
    let task_app = app.clone();
    let task_token = alice.clone();
    let mut send = tokio::spawn(async move {
        call(
            &task_app,
            "PUT",
            "/v1/conversations/legacy-room-id/messages/racing-reset",
            Some(&task_token),
            message(4),
        )
        .await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut send)
            .await
            .is_err()
    );
    reset.commit().await.unwrap();
    assert_eq!(send.await.unwrap().0, StatusCode::UNAUTHORIZED);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM encrypted_messages")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

async fn seed(pool: &PgPool, uid: &str) -> String {
    sqlx::query("INSERT INTO accounts(id,email,email_verified) VALUES($1,$2,true)")
        .bind(uid)
        .bind(format!("{uid}@psu.ac.th"))
        .execute(pool)
        .await
        .unwrap();
    // Chat authorization deliberately does not depend on these hidden,
    // unverified and undiscoverable profile flags.
    sqlx::query("INSERT INTO profiles(user_id,raw,visibility,face_verified,discoverable,is_new) VALUES($1,$2,'hidden',false,false,true)")
        .bind(uid).bind(json!({"name":"Never exposed by keys endpoint","email":"private@example.test","latitude":7.0,"privateKey":"must-never-leave"})).execute(pool).await.unwrap();
    let token = hex::encode(Sha256::digest(format!("chat-access:{uid}")));
    sqlx::query("INSERT INTO sessions(user_id,family_id,access_hash,refresh_hash,expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes',now()+interval '30 days')")
        .bind(uid).bind(Uuid::new_v4()).bind(Sha256::digest(token.as_bytes()).to_vec()).bind(Sha256::digest(format!("refresh:{uid}").as_bytes()).to_vec()).execute(pool).await.unwrap();
    token
}
async fn setup(pool: &PgPool) -> (Router, String, String, String) {
    let alice = seed(pool, "alice").await;
    let bob = seed(pool, "bob").await;
    let mallory = seed(pool, "mallory").await;
    sqlx::query(
        "INSERT INTO conversations(id,member_a,member_b) VALUES('legacy-room-id','alice','bob')",
    )
    .execute(pool)
    .await
    .unwrap();
    let app = router(new_state(pool.clone(), vec![77; 32]).await.unwrap());
    (app, alice, bob, mallory)
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
    let value = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| json!({"nonJson":String::from_utf8_lossy(&bytes)}));
    (status, value)
}
fn message(seed: u8) -> Value {
    json!({"encrypted":true,"encryptionVersion":1,"nonce":STANDARD.encode([seed;24]),"ciphertext":STANDARD.encode([seed;40])})
}
fn envelope(seed: u8) -> Value {
    json!({"senderDeviceId":"alice-phone","senderPublicKey":STANDARD.encode([7;32]),"nonce":STANDARD.encode([seed;24]),"ciphertext":STANDARD.encode([seed;48])})
}
fn encryption() -> Value {
    json!({"version":1,"algorithm":"x25519-xsalsa20-poly1305.v1","keyEnvelopes":{"alice":{"alice-phone":envelope(7)},"bob":{"bob-phone":envelope(8)}}})
}
async fn initialize(app: &Router, alice: &str, bob: &str) {
    for (uid, token, key) in [("alice", alice, 7), ("bob", bob, 8)] {
        let (status, body) = call(
            app,
            "PUT",
            &format!("/v1/me/encryption-devices/{uid}-phone"),
            Some(token),
            json!({"publicKey":STANDARD.encode([key;32])}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    let (status, body) = call(
        app,
        "PUT",
        "/v1/conversations/legacy-room-id/encryption",
        Some(alice),
        json!({"revision":0,"encryption":encryption()}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[sqlx::test(migrations = "./migrations")]
async fn only_real_room_members_receive_allowlisted_keys_independent_of_profile_privacy(
    pool: PgPool,
) {
    let (app, alice, bob, mallory) = setup(&pool).await;
    initialize(&app, &alice, &bob).await;
    sqlx::query("UPDATE accounts SET email_verified=false WHERE id='bob'")
        .execute(&pool)
        .await
        .unwrap();
    for token in [&alice, &bob] {
        let (status, body) = call(
            &app,
            "POST",
            "/v1/conversations/legacy-room-id/encryption-profiles",
            Some(token),
            json!({"userIds":["alice","bob","bob"]}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["profiles"].as_array().unwrap().len(), 2);
        assert_eq!(
            body["profiles"][1],
            json!({"id":"bob","encryptionDevices":{"bob-phone":{"publicKey":STANDARD.encode([8;32])}}})
        );
        let encoded = body.to_string();
        for secret in ["email", "Never exposed", "privateKey", "latitude"] {
            assert!(!encoded.contains(secret));
        }
    }
    for (token, expected) in [
        (None, StatusCode::UNAUTHORIZED),
        (Some(mallory.as_str()), StatusCode::FORBIDDEN),
    ] {
        let (status, _) = call(
            &app,
            "POST",
            "/v1/conversations/legacy-room-id/encryption-profiles",
            token,
            json!({"userIds":["alice","bob"]}),
        )
        .await;
        assert_eq!(status, expected);
    }
    let (status, _) = call(
        &app,
        "POST",
        "/v1/conversations/legacy-room-id/encryption-profiles",
        Some(&alice),
        json!({"userIds":["mallory"]}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    for change in ["suspended=true", "suspended=false,deleted_at=now()"] {
        sqlx::query(&format!("UPDATE accounts SET {change} WHERE id='alice'"))
            .execute(&pool)
            .await
            .unwrap();
        let (status, _) = call(
            &app,
            "GET",
            "/v1/conversations/legacy-room-id",
            Some(&alice),
            json!({}),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn own_device_publication_is_bounded_immutable_and_never_accepts_private_keys(pool: PgPool) {
    let (app, alice, _, _) = setup(&pool).await;
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/me/encryption-devices/phone",
        Some(&alice),
        json!({"publicKey":STANDARD.encode([7;32]),"secretKey":"secret"}),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/me/encryption-devices/phone",
        Some(&alice),
        json!({"publicKey":"not-a-key"}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    for i in 0..5 {
        let (status, body) = call(
            &app,
            "PUT",
            &format!("/v1/me/encryption-devices/device-{i}"),
            Some(&alice),
            json!({"publicKey":STANDARD.encode([i;32])}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/me/encryption-devices/sixth",
        Some(&alice),
        json!({"publicKey":STANDARD.encode([7;32])}),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/me/encryption-devices/device-0",
        Some(&alice),
        json!({"publicKey":STANDARD.encode([7;32])}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = call(
        &app,
        "DELETE",
        "/v1/me/encryption-devices/device-0",
        Some(&alice),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/me/encryption-devices/sixth",
        Some(&alice),
        json!({"publicKey":STANDARD.encode([7;32])}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM encryption_devices WHERE user_id='alice'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 5);
}

#[sqlx::test(migrations = "./migrations")]
async fn sends_are_idempotent_sender_and_time_are_authoritative_and_plaintext_is_rejected(
    pool: PgPool,
) {
    let (app, alice, bob, mallory) = setup(&pool).await;
    initialize(&app, &alice, &bob).await;
    let (status, first) = call(
        &app,
        "PUT",
        "/v1/conversations/legacy-room-id/messages/existing-msg-42",
        Some(&alice),
        message(1),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["duplicate"], false);
    assert_eq!(first["message"]["id"], "existing-msg-42");
    assert_eq!(first["message"]["senderId"], "alice");
    assert!(first["message"]["createdAt"].as_i64().unwrap() > 0);
    let (status, duplicate) = call(
        &app,
        "PUT",
        "/v1/conversations/legacy-room-id/messages/existing-msg-42",
        Some(&alice),
        message(1),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(duplicate["duplicate"], true);
    assert_eq!(duplicate["message"], first["message"]);
    for (token, body) in [(&alice, message(2)), (&bob, message(1))] {
        let (status, _) = call(
            &app,
            "PUT",
            "/v1/conversations/legacy-room-id/messages/existing-msg-42",
            Some(token),
            body,
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
    }
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/conversations/legacy-room-id/messages/outsider",
        Some(&mallory),
        message(1),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    for field in [
        "text",
        "replyTo",
        "mediaUrl",
        "senderId",
        "createdAt",
        "lastMessage",
    ] {
        let mut packet = message(1);
        packet[field] = json!("must remain encrypted");
        let (status, _) = call(
            &app,
            "PUT",
            "/v1/conversations/legacy-room-id/messages/plaintext",
            Some(&alice),
            packet,
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "accepted {field}");
    }
    let (status, room) = call(
        &app,
        "GET",
        "/v1/conversations/legacy-room-id",
        Some(&bob),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(room["lastMessage"], "ข้อความที่เข้ารหัส");
    assert!(!room.to_string().contains("must remain encrypted"));
}

#[sqlx::test(migrations = "./migrations")]
async fn blocks_in_either_direction_and_inactive_rooms_revoke_writes_but_preserve_member_history(
    pool: PgPool,
) {
    let (app, alice, bob, _) = setup(&pool).await;
    initialize(&app, &alice, &bob).await;
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/conversations/legacy-room-id/messages/old",
        Some(&alice),
        message(1),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    for (from, to) in [("alice", "bob"), ("bob", "alice")] {
        sqlx::query("INSERT INTO blocks(actor_id,target_id) VALUES($1,$2)")
            .bind(from)
            .bind(to)
            .execute(&pool)
            .await
            .unwrap();
        for token in [&alice, &bob] {
            let (status, _) = call(
                &app,
                "PUT",
                "/v1/conversations/legacy-room-id/messages/blocked",
                Some(token),
                message(2),
            )
            .await;
            assert_eq!(status, StatusCode::FORBIDDEN);
            let (status, _) = call(
                &app,
                "PUT",
                "/v1/conversations/legacy-room-id/encryption",
                Some(token),
                json!({"revision":1,"encryption":encryption()}),
            )
            .await;
            assert_eq!(status, StatusCode::FORBIDDEN);
            let (status, history) = call(
                &app,
                "POST",
                "/v1/conversations/legacy-room-id/messages/page",
                Some(token),
                json!({}),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(history["messages"].as_array().unwrap().len(), 1);
        }
        sqlx::query("DELETE FROM blocks WHERE actor_id=$1 AND target_id=$2")
            .bind(from)
            .bind(to)
            .execute(&pool)
            .await
            .unwrap();
    }
    sqlx::query("UPDATE conversations SET active=false WHERE id='legacy-room-id'")
        .execute(&pool)
        .await
        .unwrap();
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/conversations/legacy-room-id/messages/inactive",
        Some(&alice),
        message(2),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "./migrations")]
async fn initialized_envelopes_use_published_participant_keys_and_cannot_replace_message_keys(
    pool: PgPool,
) {
    let (app, alice, bob, _) = setup(&pool).await;
    initialize(&app, &alice, &bob).await;
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/conversations/legacy-room-id/encryption",
        Some(&alice),
        json!({"revision":0,"encryption":encryption()}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/conversations/legacy-room-id/messages/msg",
        Some(&alice),
        message(1),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let mut changed = encryption();
    changed["keyEnvelopes"]["bob"]["bob-phone"]["ciphertext"] = json!(STANDARD.encode([99; 48]));
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/conversations/legacy-room-id/encryption",
        Some(&alice),
        json!({"revision":1,"encryption":changed}),
    )
    .await;
    assert_eq!(status, StatusCode::PRECONDITION_FAILED);
    let mut changed = encryption();
    changed["keyEnvelopes"]
        .as_object_mut()
        .unwrap()
        .remove("bob");
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/conversations/legacy-room-id/encryption",
        Some(&alice),
        json!({"revision":1,"encryption":changed}),
    )
    .await;
    assert_eq!(status, StatusCode::PRECONDITION_FAILED);
    let (status, _) = call(
        &app,
        "DELETE",
        "/v1/me/encryption-devices/bob-phone",
        Some(&bob),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/conversations/legacy-room-id/messages/missing-device",
        Some(&alice),
        message(2),
    )
    .await;
    assert_eq!(status, StatusCode::PRECONDITION_FAILED);
}

#[sqlx::test(migrations = "./migrations")]
async fn message_pages_are_unique_bound_to_room_and_caller_and_exclude_new_arrivals(pool: PgPool) {
    let (app, alice, bob, mallory) = setup(&pool).await;
    initialize(&app, &alice, &bob).await;
    for i in 0..65 {
        let (status, body) = call(
            &app,
            "PUT",
            &format!("/v1/conversations/legacy-room-id/messages/msg-{i:03}"),
            Some(&alice),
            message(i),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    let (status, first) = call(
        &app,
        "POST",
        "/v1/conversations/legacy-room-id/messages/page",
        Some(&alice),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["messages"].as_array().unwrap().len(), 50);
    assert_eq!(first["hasMore"], true);
    let cursor = first["nextCursor"].as_str().unwrap();
    for (token, expected) in [
        (&bob, StatusCode::BAD_REQUEST),
        (&mallory, StatusCode::FORBIDDEN),
    ] {
        let (status, _) = call(
            &app,
            "POST",
            "/v1/conversations/legacy-room-id/messages/page",
            Some(token),
            json!({"cursor":cursor}),
        )
        .await;
        assert_eq!(status, expected);
    }
    sqlx::query(
        "INSERT INTO conversations(id,member_a,member_b) VALUES('another-room','alice','mallory')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let (status, _) = call(
        &app,
        "POST",
        "/v1/conversations/another-room/messages/page",
        Some(&alice),
        json!({"cursor":cursor}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(
        &app,
        "PUT",
        "/v1/conversations/legacy-room-id/messages/new-arrival",
        Some(&alice),
        message(99),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, second) = call(
        &app,
        "POST",
        "/v1/conversations/legacy-room-id/messages/page",
        Some(&alice),
        json!({"cursor":cursor}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(second["messages"].as_array().unwrap().len(), 15);
    assert_eq!(second["hasMore"], false);
    let mut seen = HashSet::new();
    for page in [&first, &second] {
        for message in page["messages"].as_array().unwrap() {
            let id = message["id"].as_str().unwrap();
            assert_ne!(id, "new-arrival");
            assert!(seen.insert(id));
        }
    }
    assert_eq!(seen.len(), 65);
}
