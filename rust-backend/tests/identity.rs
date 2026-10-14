//! Photo verification contracts: server-side decisions, ownership, replay,
//! races, expiry, image swaps, revocation, review and data deletion. AWS and
//! R2 are replaced by scripted doubles; PostgreSQL is real.

use std::sync::{atomic::Ordering, Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use campusmate_backend::{
    identity::{sweep, sync_primary_photo, DecisionPolicy, IdentityServices},
    identity_provider::{
        testing::{sample_jpeg, shared, FakeFaceProvider, FakeReferenceStore},
        Challenge, LivenessStatus, ProviderError,
    },
    new_state, router,
};
use chrono::{DateTime, Utc};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

const ORIGIN: &str = "https://cdn.campus.test";
/// Public `r2.dev`-style address of the same media bucket.
const ALIAS: &str = "https://pub-media.r2.test";
const CONSENT: &str = "face-consent-2026-10";

struct Harness {
    app: Router,
    provider: Arc<FakeFaceProvider>,
    store: Arc<FakeReferenceStore>,
    services: Arc<IdentityServices>,
}

/// Automatic mode with test thresholds, so both outcomes can be exercised.
fn policy() -> DecisionPolicy {
    DecisionPolicy {
        version: "test-policy-v1".into(),
        auto_approve: true,
        liveness_min: 90.0,
        liveness_review_min: 70.0,
        similarity_min: 95.0,
        similarity_review_min: 80.0,
    }
}

async fn harness(pool: &PgPool) -> Harness {
    harness_with(pool, policy(), None).await
}

async fn harness_with(
    pool: &PgPool,
    policy: DecisionPolicy,
    legacy_grace_until: Option<DateTime<Utc>>,
) -> Harness {
    let (provider, store) = shared();
    let services = Arc::new(IdentityServices {
        provider: provider.clone(),
        store: store.clone(),
        policy,
        region: "ap-southeast-7".into(),
        consent_version: CONSENT.into(),
        media_origin: ORIGIN.into(),
        media_alias_origins: vec![ALIAS.into()],
        legacy_grace_until,
    });
    let mut state = new_state(pool.clone(), vec![47; 32]).await.unwrap();
    state.identity = Some(services.clone());
    Harness {
        app: router(state),
        provider,
        store,
        services,
    }
}

fn avatar(id: &str) -> String {
    format!("{ORIGIN}/users/{id}/avatar.jpg?v=1")
}

async fn seed(pool: &PgPool, store: &FakeReferenceStore, id: &str, role: &str) -> String {
    sqlx::query("INSERT INTO accounts(id,email,email_verified,role) VALUES($1,$2,true,$3)")
        .bind(id)
        .bind(format!("{id}@psu.ac.th"))
        .bind(role)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO profiles(user_id,raw,discoverable,is_new) VALUES($1,$2,true,false)")
        .bind(id)
        .bind(json!({"name":"Student","age":21,"activities":["running"],"avatarUri":avatar(id)}))
        .execute(pool)
        .await
        .unwrap();
    store
        .photos
        .lock()
        .unwrap()
        .insert(format!("users/{id}/avatar.jpg"), sample_jpeg());
    let token = hex::encode(Sha256::digest(format!("identity-access:{id}")));
    let refresh = hex::encode(Sha256::digest(format!("identity-refresh:{id}")));
    sqlx::query("INSERT INTO sessions(user_id,family_id,access_hash,refresh_hash,expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes',now()+interval '30 days')")
        .bind(id)
        .bind(Uuid::new_v4())
        .bind(Sha256::digest(token.as_bytes()).to_vec())
        .bind(Sha256::digest(refresh.as_bytes()).to_vec())
        .execute(pool)
        .await
        .unwrap();
    token
}

async fn call(
    app: &Router,
    method: &str,
    path: &str,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| panic!("non-JSON {status}: {}", String::from_utf8_lossy(&bytes)));
    (status, value)
}

fn reason(body: &Value) -> &str {
    body["error"]["details"]["reason"]
        .as_str()
        .unwrap_or_default()
}

/// No score, confidence or threshold may reach a client.
fn assert_no_scores(body: &Value) {
    let text = body.to_string().to_lowercase();
    for word in ["similarity", "confidence", "score", "threshold"] {
        assert!(!text.contains(word), "{word} leaked in {text}");
    }
}

async fn start(h: &Harness, token: &str) -> (StatusCode, Value) {
    call(
        &h.app,
        "POST",
        "/v1/identity/photo-verifications",
        token,
        json!({"consent":true,"consentVersion":CONSENT}),
    )
    .await
}

async fn start_id(h: &Harness, token: &str) -> String {
    let (status, body) = start(h, token).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["verificationId"].as_str().unwrap().to_owned()
}

async fn finish(h: &Harness, token: &str, id: &str) -> (StatusCode, Value) {
    call(
        &h.app,
        "POST",
        &format!("/v1/identity/photo-verifications/{id}/complete"),
        token,
        json!({}),
    )
    .await
}

async fn my_status(h: &Harness, token: &str) -> Value {
    let (status, body) = call(
        &h.app,
        "GET",
        "/v1/identity/photo-verification",
        token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn queue(h: &Harness, token: &str) -> (StatusCode, Value) {
    call(
        &h.app,
        "GET",
        "/v1/admin/identity-reviews",
        token,
        json!({}),
    )
    .await
}

async fn view_evidence(h: &Harness, token: &str, id: &str) -> (StatusCode, Value) {
    call(
        &h.app,
        "GET",
        &format!("/v1/admin/identity-reviews/{id}/evidence"),
        token,
        json!({}),
    )
    .await
}

async fn review(h: &Harness, token: &str, id: &str, decision: &str) -> (StatusCode, Value) {
    call(
        &h.app,
        "POST",
        &format!("/v1/admin/identity-reviews/{id}/decision"),
        token,
        json!({ "decision": decision }),
    )
    .await
}

async fn request_alternative(h: &Harness, token: &str, body: Value) -> (StatusCode, Value) {
    call(
        &h.app,
        "POST",
        "/v1/identity/photo-verification/alternative",
        token,
        body,
    )
    .await
}

async fn verified(pool: &PgPool, id: &str) -> bool {
    sqlx::query_scalar("SELECT face_verified FROM profiles WHERE user_id=$1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn without_images(mut evidence: Value) -> Value {
    for side in ["reference", "live"] {
        if evidence[side].is_object() {
            evidence[side]["base64"] = json!("<image>");
        }
    }
    evidence
}

#[sqlx::test(migrations = "./migrations")]
async fn a_verified_badge_comes_only_from_the_server_decision(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    let (status, created) = start(&h, &token).await;
    assert_eq!(status, StatusCode::OK, "{created}");
    assert_no_scores(&created);
    assert_eq!(created["state"], "CREATED");
    assert_eq!(created["region"], "ap-southeast-7");
    assert_eq!(created["challenge"], "FACE_MOVEMENT_AND_LIGHT");
    assert!(created["credentials"]["sessionToken"].is_string());
    let id = created["verificationId"].as_str().unwrap().to_owned();

    let row = sqlx::query("SELECT reference_key,reference_sha256,aws_session_id,state::text AS state FROM face_verification_attempts WHERE id=$1")
        .bind(Uuid::parse_str(&id).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    let key: String = row.get("reference_key");
    let digest: Vec<u8> = row.get("reference_sha256");
    assert_eq!(row.get::<String, _>("state"), "CREATED");
    assert_eq!(
        row.get::<String, _>("aws_session_id"),
        created["sessionId"].as_str().unwrap()
    );
    let snapshot = h
        .store
        .snapshots
        .lock()
        .unwrap()
        .get(&key)
        .cloned()
        .unwrap();
    assert_eq!(Sha256::digest(&snapshot).to_vec(), digest);
    assert!(key.starts_with("photo-verification/alice/"));

    let (status, decided) = finish(&h, &token, &id).await;
    assert_eq!(status, StatusCode::OK, "{decided}");
    assert_no_scores(&decided);
    assert_eq!(decided["status"], "VERIFIED");
    assert_eq!(decided["badge"], "PHOTO_VERIFIED");
    assert!(verified(&pool, "alice").await);
    let proof = sqlx::query("SELECT status,method,verified_reference_sha256,policy_version FROM user_photo_verifications WHERE user_id='alice'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(proof.get::<String, _>("status"), "VERIFIED");
    assert_eq!(proof.get::<String, _>("method"), "LIVENESS");
    assert_eq!(proof.get::<Vec<u8>, _>("verified_reference_sha256"), digest);
    assert_eq!(proof.get::<String, _>("policy_version"), "test-policy-v1");
    // The biometric snapshot is deleted as soon as the decision is stored.
    assert!(h.store.snapshots.lock().unwrap().is_empty());

    // Completing again returns the saved decision without another comparison.
    assert_eq!(finish(&h, &token, &id).await.1["status"], "VERIFIED");
    assert_eq!(h.provider.compares.load(Ordering::SeqCst), 1);
    let status_body = my_status(&h, &token).await;
    assert_eq!(status_body["status"], "VERIFIED");
    assert_eq!(status_body["badge"], "PHOTO_VERIFIED");
    assert_eq!(status_body["photo"], avatar("alice"));
    assert_eq!(status_body["needsReverification"], false);
    let events: Vec<String> = sqlx::query_scalar("SELECT event_type FROM identity_verification_audit_events WHERE user_id='alice' ORDER BY created_at")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(events, ["ATTEMPT_CREATED", "DECIDED_VERIFIED"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn racing_completions_evaluate_exactly_once(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    let id = start_id(&h, &token).await;
    let (first, second) = tokio::join!(finish(&h, &token, &id), finish(&h, &token, &id));
    assert_eq!(h.provider.compares.load(Ordering::SeqCst), 1);
    let results = [first, second];
    assert!(results
        .iter()
        .any(|(status, body)| *status == StatusCode::OK && body["status"] == "VERIFIED"));
    for (status, body) in &results {
        assert!(
            *status == StatusCode::OK || reason(body) == "AWAITING_RESULT",
            "{body}"
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn another_user_cannot_read_or_complete_an_attempt(pool: PgPool) {
    let h = harness(&pool).await;
    let alice = seed(&pool, &h.store, "alice", "user").await;
    let mallory = seed(&pool, &h.store, "mallory", "user").await;
    let id = start_id(&h, &alice).await;
    assert_eq!(finish(&h, &mallory, &id).await.0, StatusCode::NOT_FOUND);
    let path = format!("/v1/identity/photo-verifications/{id}");
    assert_eq!(
        call(&h.app, "GET", &path, &mallory, json!({})).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(h.provider.results.load(Ordering::SeqCst), 0);
    assert!(!verified(&pool, "mallory").await);
    assert_eq!(
        call(&h.app, "GET", &path, &alice, json!({})).await.1["status"],
        "CREATED"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn failed_liveness_or_weak_match_never_verifies(pool: PgPool) {
    let h = harness(&pool).await;
    type Setup = fn(&mut campusmate_backend::identity_provider::testing::Script);
    let cases: [(&str, Setup, &str); 5] = [
        (
            "liveness-failed",
            |s| s.status = LivenessStatus::Failed,
            "LIVENESS_NOT_CONFIRMED",
        ),
        (
            "low-liveness",
            |s| s.confidence = Some(40.0),
            "LIVENESS_NOT_CONFIRMED",
        ),
        (
            "low-similarity",
            |s| s.similarity = Some(10.0),
            "FACE_NOT_MATCHED",
        ),
        ("no-match", |s| s.similarity = None, "FACE_NOT_MATCHED"),
        (
            "no-frame",
            |s| s.reference_image = None,
            "REFERENCE_IMAGE_MISSING",
        ),
    ];
    for (user, setup, expected) in cases {
        let token = seed(&pool, &h.store, user, "user").await;
        h.provider.set(|script| *script = Default::default());
        h.provider.set(setup);
        let id = start_id(&h, &token).await;
        let (status, body) = finish(&h, &token, &id).await;
        assert_eq!(status, StatusCode::OK, "{user}: {body}");
        assert_eq!(body["status"], "FAILED", "{user}");
        assert_eq!(body["reason"], expected, "{user}");
        assert_eq!(body["badge"], Value::Null);
        assert_no_scores(&body);
        assert!(!verified(&pool, user).await, "{user}");
    }
    // Failures keep no images.
    assert!(h.store.snapshots.lock().unwrap().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn client_claims_in_the_request_are_ignored(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    h.provider.set(|script| script.similarity = Some(5.0));
    let id = start_id(&h, &token).await;
    let (_, body) = call(
        &h.app,
        "POST",
        &format!("/v1/identity/photo-verifications/{id}/complete"),
        &token,
        json!({"verified":true,"status":"VERIFIED","similarity":100}),
    )
    .await;
    assert_eq!(body["status"], "FAILED");
    assert!(!verified(&pool, "alice").await);
}

#[sqlx::test(migrations = "./migrations")]
async fn expired_sessions_need_a_new_attempt(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    let id = start_id(&h, &token).await;
    sqlx::query("UPDATE face_verification_attempts SET expires_at=now()-interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    let (status, body) = finish(&h, &token, &id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "EXPIRED");
    assert_eq!(h.provider.results.load(Ordering::SeqCst), 0);
    assert!(!verified(&pool, "alice").await);
    // The expired slot no longer blocks a fresh session.
    assert_eq!(start(&h, &token).await.0, StatusCode::OK);
}

#[sqlx::test(migrations = "./migrations")]
async fn a_tampered_snapshot_is_rejected(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    let id = start_id(&h, &token).await;
    for bytes in h.store.snapshots.lock().unwrap().values_mut() {
        bytes.push(0);
    }
    let (_, body) = finish(&h, &token, &id).await;
    assert_eq!(body["status"], "FAILED");
    assert_eq!(body["reason"], "REFERENCE_TAMPERED");
    assert!(!verified(&pool, "alice").await);
}

async fn change_photo(h: &Harness, token: &str, id: &str) -> StatusCode {
    let (_, me) = call(&h.app, "GET", "/v1/me/profile", token, json!({})).await;
    let mut profile = me["profile"].clone();
    profile["avatarUri"] = json!(format!("{ORIGIN}/users/{id}/avatar.jpg?v=2"));
    call(
        &h.app,
        "PUT",
        "/v1/me/profile",
        token,
        json!({"revision":me["revision"],"profile":profile}),
    )
    .await
    .0
}

#[sqlx::test(migrations = "./migrations")]
async fn replacing_the_photo_revokes_the_badge_and_cancels_attempts(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    let id = start_id(&h, &token).await;
    assert_eq!(finish(&h, &token, &id).await.1["status"], "VERIFIED");
    assert_eq!(change_photo(&h, &token, "alice").await, StatusCode::OK);
    assert!(!verified(&pool, "alice").await);
    let status = my_status(&h, &token).await;
    assert_eq!(status["status"], "REVOKED");
    assert_eq!(status["badge"], Value::Null);

    // A swap while an attempt is open voids that attempt as well.
    let bob = seed(&pool, &h.store, "bob", "user").await;
    let attempt = start_id(&h, &bob).await;
    assert_eq!(change_photo(&h, &bob, "bob").await, StatusCode::OK);
    let (_, body) = finish(&h, &bob, &attempt).await;
    assert_eq!(body["status"], "EXPIRED");
    assert_eq!(body["reason"], "IMAGE_CHANGED");
    assert!(!verified(&pool, "bob").await);
    assert!(h.store.snapshots.lock().unwrap().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn a_photo_change_reported_by_the_mobile_backend_revokes_the_badge(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    let id = start_id(&h, &token).await;
    assert_eq!(finish(&h, &token, &id).await.1["status"], "VERIFIED");

    // The same photo keeps the badge.
    let mut tx = pool.begin().await.unwrap();
    assert!(!sync_primary_photo(&mut tx, "alice", &avatar("alice"))
        .await
        .unwrap());
    tx.commit().await.unwrap();
    assert!(verified(&pool, "alice").await);

    // A new photo from the Firebase bridge revokes it.
    let mut tx = pool.begin().await.unwrap();
    let replaced = format!("{ORIGIN}/users/alice/avatar.jpg?v=9");
    assert!(sync_primary_photo(&mut tx, "alice", &replaced)
        .await
        .unwrap());
    tx.commit().await.unwrap();
    assert!(!verified(&pool, "alice").await);
    assert_eq!(my_status(&h, &token).await["status"], "REVOKED");

    // A first sync for a new account creates the profile without revoking.
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO accounts(id,email,email_verified) VALUES('newcomer','newcomer@psu.ac.th',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    assert!(
        !sync_primary_photo(&mut tx, "newcomer", &avatar("newcomer"))
            .await
            .unwrap()
    );
    tx.commit().await.unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn ambiguous_results_go_to_human_review(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    let admin = seed(&pool, &h.store, "admin1", "admin").await;
    let other = seed(&pool, &h.store, "carol", "user").await;
    h.provider.set(|script| script.similarity = Some(88.0));
    let id = start_id(&h, &token).await;
    let (_, body) = finish(&h, &token, &id).await;
    assert_eq!(body["status"], "REVIEW_REQUIRED");
    assert!(!verified(&pool, "alice").await);
    assert_eq!(my_status(&h, &token).await["reviewPending"], true);
    // The pinned snapshot and the liveness frame wait for the reviewer.
    assert_eq!(h.store.snapshots.lock().unwrap().len(), 2);

    // Not an admin: no queue, no images, no decision.
    assert_eq!(queue(&h, &other).await.0, StatusCode::FORBIDDEN);
    assert_eq!(
        view_evidence(&h, &other, &id).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        review(&h, &other, &id, "APPROVE").await.0,
        StatusCode::FORBIDDEN
    );

    let (status, listed) = queue(&h, &admin).await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    assert_no_scores(&listed);
    assert_eq!(listed["reviews"][0]["verificationId"], id.as_str());
    assert_eq!(listed["reviews"][0]["hasEvidence"], true);

    // Approving without opening the images is refused.
    let (status, body) = review(&h, &admin, &id, "APPROVE").await;
    assert_eq!(
        (status, reason(&body)),
        (StatusCode::PRECONDITION_FAILED, "EVIDENCE_NOT_VIEWED")
    );
    let (status, evidence) = view_evidence(&h, &admin, &id).await;
    assert_eq!(status, StatusCode::OK, "{evidence}");
    assert!(evidence["reference"]["base64"].as_str().unwrap().len() > 100);
    assert!(evidence["live"]["base64"].is_string());
    assert_no_scores(&without_images(evidence));

    let (status, decided) = review(&h, &admin, &id, "APPROVE").await;
    assert_eq!(status, StatusCode::OK, "{decided}");
    assert!(verified(&pool, "alice").await);
    assert!(h.store.snapshots.lock().unwrap().is_empty());
    let method: String =
        sqlx::query_scalar("SELECT method FROM user_photo_verifications WHERE user_id='alice'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(method, "HUMAN_REVIEW");
    let events: Vec<(String, Option<String>)> = sqlx::query_as("SELECT event_type,actor_id FROM identity_verification_audit_events WHERE event_type IN ('EVIDENCE_VIEWED','REVIEW_APPROVED') ORDER BY created_at")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(
        events,
        [
            ("EVIDENCE_VIEWED".to_owned(), Some("admin1".to_owned())),
            ("REVIEW_APPROVED".to_owned(), Some("admin1".to_owned())),
        ]
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn a_rejected_review_clears_the_pending_state(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    let admin = seed(&pool, &h.store, "admin1", "admin").await;
    h.provider.set(|script| script.similarity = Some(88.0));
    let id = start_id(&h, &token).await;
    assert_eq!(finish(&h, &token, &id).await.1["status"], "REVIEW_REQUIRED");
    let (status, body) = review(&h, &admin, &id, "REJECT").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let status = my_status(&h, &token).await;
    assert_eq!(status["status"], "UNVERIFIED");
    assert_eq!(status["reviewPending"], false);
    assert!(!verified(&pool, "alice").await);
    assert!(h.store.snapshots.lock().unwrap().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn reviewers_cannot_see_or_decide_their_own_attempt(pool: PgPool) {
    let h = harness(&pool).await;
    let admin = seed(&pool, &h.store, "admin1", "admin").await;
    h.provider.set(|script| script.similarity = Some(88.0));
    let id = start_id(&h, &admin).await;
    assert_eq!(finish(&h, &admin, &id).await.1["status"], "REVIEW_REQUIRED");
    assert_eq!(
        view_evidence(&h, &admin, &id).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        review(&h, &admin, &id, "APPROVE").await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(queue(&h, &admin).await.1["reviews"], json!([]));
    assert!(!verified(&pool, "admin1").await);
}

#[sqlx::test(migrations = "./migrations")]
async fn a_modified_reference_can_never_be_approved(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    let admin = seed(&pool, &h.store, "admin1", "admin").await;
    h.provider.set(|script| script.similarity = Some(88.0));
    let id = start_id(&h, &token).await;
    assert_eq!(finish(&h, &token, &id).await.1["status"], "REVIEW_REQUIRED");
    for (key, bytes) in h.store.snapshots.lock().unwrap().iter_mut() {
        if !key.ends_with("-live.jpg") {
            bytes.push(0);
        }
    }
    let (status, body) = view_evidence(&h, &admin, &id).await;
    assert_eq!(
        (status, reason(&body)),
        (StatusCode::PRECONDITION_FAILED, "REFERENCE_TAMPERED")
    );
    let (status, body) = review(&h, &admin, &id, "APPROVE").await;
    assert_eq!(
        (status, reason(&body)),
        (StatusCode::PRECONDITION_FAILED, "EVIDENCE_NOT_VIEWED")
    );
    assert!(!verified(&pool, "alice").await);
}

#[sqlx::test(migrations = "./migrations")]
async fn manual_mode_sends_every_confirmed_check_to_a_person(pool: PgPool) {
    let manual = DecisionPolicy::from_lookup(|name| {
        (name == "FACE_POLICY_VERSION").then(|| "manual-v1".to_owned())
    })
    .unwrap();
    let h = harness_with(&pool, manual, None).await;
    let alice = seed(&pool, &h.store, "alice", "user").await;
    let id = start_id(&h, &alice).await;
    let (_, body) = finish(&h, &alice, &id).await;
    assert_eq!(body["status"], "REVIEW_REQUIRED");
    assert!(!verified(&pool, "alice").await);
    // A failed AWS liveness check is still a failure, not a review.
    let bob = seed(&pool, &h.store, "bob", "user").await;
    h.provider
        .set(|script| script.status = LivenessStatus::Failed);
    let id = start_id(&h, &bob).await;
    assert_eq!(finish(&h, &bob, &id).await.1["status"], "FAILED");
}

#[sqlx::test(migrations = "./migrations")]
async fn the_no_flash_check_is_offered_but_never_auto_approved(pool: PgPool) {
    let h = harness(&pool).await;
    let alice = seed(&pool, &h.store, "alice", "user").await;
    let path = "/v1/identity/photo-verifications";
    let (status, _) = call(
        &h.app,
        "POST",
        path,
        &alice,
        json!({"consent":true,"consentVersion":CONSENT,"challenge":"STROBE"}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, created) = call(
        &h.app,
        "POST",
        path,
        &alice,
        json!({"consent":true,"consentVersion":CONSENT,"challenge":"FACE_MOVEMENT"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");
    assert_eq!(created["challenge"], "FACE_MOVEMENT");
    assert_eq!(
        *h.provider.last_challenge.lock().unwrap(),
        Some(Challenge::Movement)
    );
    let id = created["verificationId"].as_str().unwrap();
    assert_eq!(finish(&h, &alice, id).await.1["status"], "REVIEW_REQUIRED");

    // AWS reporting a weaker check than requested is judged as that check.
    let bob = seed(&pool, &h.store, "bob", "user").await;
    h.provider
        .set(|script| script.challenge = Some(Challenge::Movement));
    let id = start_id(&h, &bob).await;
    assert_eq!(finish(&h, &bob, &id).await.1["status"], "REVIEW_REQUIRED");
    assert!(!verified(&pool, "bob").await);
}

#[sqlx::test(migrations = "./migrations")]
async fn imported_badges_are_legacy_until_reverified(pool: PgPool) {
    let open = harness_with(&pool, policy(), None).await;
    let dave = seed(&pool, &open.store, "dave", "user").await;
    sqlx::query("UPDATE profiles SET face_verified=true WHERE user_id='dave'")
        .execute(&pool)
        .await
        .unwrap();
    let status = my_status(&open, &dave).await;
    assert_eq!(status["status"], "LEGACY");
    assert_eq!(status["badge"], "PHOTO_VERIFIED");
    assert_eq!(status["needsReverification"], true);
    // Without a grace deadline legacy badges stay.
    sweep(&pool, &open.services).await.unwrap();
    assert!(verified(&pool, "dave").await);

    let h = harness_with(
        &pool,
        policy(),
        Some(Utc::now() - chrono::Duration::days(1)),
    )
    .await;
    let alice = seed(&pool, &h.store, "alice", "user").await;
    let bob = seed(&pool, &h.store, "bob", "user").await;
    let carol = seed(&pool, &h.store, "carol", "user").await;
    sqlx::query("UPDATE profiles SET face_verified=true WHERE user_id IN ('alice','bob','carol')")
        .execute(&pool)
        .await
        .unwrap();
    assert!(my_status(&h, &alice).await["legacyGraceUntil"].is_string());
    // Bob re-verifies; Carol is in the middle of a new attempt.
    let id = start_id(&h, &bob).await;
    assert_eq!(finish(&h, &bob, &id).await.1["status"], "VERIFIED");
    let carol_attempt = start_id(&h, &carol).await;

    sweep(&pool, &h.services).await.unwrap();
    assert!(!verified(&pool, "alice").await);
    assert!(!verified(&pool, "dave").await);
    let status = my_status(&h, &alice).await;
    assert_eq!(status["status"], "REVOKED");
    assert_eq!(status["badge"], Value::Null);
    assert!(verified(&pool, "bob").await);
    assert_eq!(my_status(&h, &bob).await["status"], "VERIFIED");
    assert!(!verified(&pool, "carol").await);
    // Carol's open attempt survives the sweep and can still succeed.
    assert_eq!(
        finish(&h, &carol, &carol_attempt).await.1["status"],
        "VERIFIED"
    );
    assert!(verified(&pool, "carol").await);
}

#[sqlx::test(migrations = "./migrations")]
async fn people_who_cannot_scan_can_ask_for_another_route(pool: PgPool) {
    let h = harness(&pool).await;
    let alice = seed(&pool, &h.store, "alice", "user").await;
    let admin = seed(&pool, &h.store, "admin1", "admin").await;
    let (status, _) = request_alternative(&h, &alice, json!({"reason":"BORED"})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, first) = request_alternative(
        &h,
        &alice,
        json!({"reason":"PHOTOSENSITIVITY","note":"flashing lights trigger seizures"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["status"], "OPEN");
    // One open request per person; asking again returns it.
    let (_, again) = request_alternative(&h, &alice, json!({"reason":"CAMERA_UNAVAILABLE"})).await;
    assert_eq!(again["requestId"], first["requestId"]);
    assert_eq!(my_status(&h, &alice).await["alternativeRequest"], "OPEN");

    let (status, listed) = queue(&h, &admin).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed["alternatives"][0]["requestId"], first["requestId"]);
    assert_eq!(listed["alternatives"][0]["reason"], "PHOTOSENSITIVITY");

    let (_, own) = request_alternative(&h, &admin, json!({"reason":"OTHER"})).await;
    let decide = |id: &Value| {
        format!(
            "/v1/admin/identity-alternatives/{}/decision",
            id.as_str().unwrap()
        )
    };
    assert_eq!(
        call(
            &h.app,
            "POST",
            &decide(&own["requestId"]),
            &admin,
            json!({"decision":"RESOLVED"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &h.app,
            "POST",
            &decide(&first["requestId"]),
            &alice,
            json!({"decision":"RESOLVED"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (status, body) = call(
        &h.app,
        "POST",
        &decide(&first["requestId"]),
        &admin,
        json!({"decision":"RESOLVED"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // Resolving a request never grants a badge.
    assert!(!verified(&pool, "alice").await);
    assert_eq!(
        my_status(&h, &alice).await["alternativeRequest"],
        Value::Null
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn repeated_failures_trigger_a_cooldown(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    h.provider.set(|script| script.similarity = Some(1.0));
    for _ in 0..5 {
        let id = start_id(&h, &token).await;
        assert_eq!(finish(&h, &token, &id).await.1["status"], "FAILED");
    }
    let (status, body) = start(&h, &token).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(reason(&body), "RATE_LIMITED");
    assert_eq!(h.provider.creates.load(Ordering::SeqCst), 5);
}

#[sqlx::test(migrations = "./migrations")]
async fn one_active_session_and_explicit_consent(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    let path = "/v1/identity/photo-verifications";
    let (status, body) = call(
        &h.app,
        "POST",
        path,
        &token,
        json!({"consent":false,"consentVersion":CONSENT}),
    )
    .await;
    assert_eq!(
        (status, reason(&body)),
        (StatusCode::BAD_REQUEST, "CONSENT_REQUIRED")
    );
    let (status, body) = call(
        &h.app,
        "POST",
        path,
        &token,
        json!({"consent":true,"consentVersion":"old"}),
    )
    .await;
    assert_eq!(
        (status, reason(&body)),
        (StatusCode::BAD_REQUEST, "CONSENT_REQUIRED")
    );
    assert_eq!(start(&h, &token).await.0, StatusCode::OK);
    let (status, body) = start(&h, &token).await;
    assert_eq!(
        (status, reason(&body)),
        (StatusCode::CONFLICT, "VERIFICATION_IN_PROGRESS")
    );
    assert_eq!(h.provider.creates.load(Ordering::SeqCst), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn only_the_callers_own_uploaded_photo_is_used(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    for uri in [
        "https://evil.test/users/alice/avatar.jpg".to_owned(),
        format!("{ORIGIN}/users/victim/avatar.jpg"),
        "https://169.254.169.254/latest/meta-data".to_owned(),
    ] {
        sqlx::query("UPDATE profiles SET raw=jsonb_set(raw,'{avatarUri}',to_jsonb($1::text)) WHERE user_id='alice'")
            .bind(&uri)
            .execute(&pool)
            .await
            .unwrap();
        let (status, body) = start(&h, &token).await;
        assert_eq!(
            (status, reason(&body)),
            (StatusCode::PRECONDITION_FAILED, "REFERENCE_UNAVAILABLE"),
            "{uri}"
        );
    }
    assert_eq!(h.store.photo_reads.load(Ordering::SeqCst), 0);
    assert_eq!(h.provider.creates.load(Ordering::SeqCst), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn a_configured_alias_of_the_media_bucket_is_accepted(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    let aliased = format!("{ALIAS}/users/alice/avatar.jpg");
    sqlx::query("UPDATE profiles SET raw=jsonb_set(raw,'{avatarUri}',to_jsonb($1::text)) WHERE user_id='alice'")
        .bind(&aliased)
        .execute(&pool)
        .await
        .unwrap();
    let id = start_id(&h, &token).await;
    assert_eq!(finish(&h, &token, &id).await.1["status"], "VERIFIED");
    assert_eq!(my_status(&h, &token).await["photo"], aliased.as_str());
    // A look-alike of the alias host is still refused.
    let bob = seed(&pool, &h.store, "bob", "user").await;
    sqlx::query("UPDATE profiles SET raw=jsonb_set(raw,'{avatarUri}',to_jsonb($1::text)) WHERE user_id='bob'")
        .bind(format!("{ALIAS}.evil.test/users/bob/avatar.jpg"))
        .execute(&pool)
        .await
        .unwrap();
    let (status, body) = start(&h, &bob).await;
    assert_eq!(
        (status, reason(&body)),
        (StatusCode::PRECONDITION_FAILED, "REFERENCE_UNAVAILABLE")
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn non_images_are_refused_before_any_aws_call(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    h.store.photos.lock().unwrap().insert(
        "users/alice/avatar.jpg".into(),
        b"<svg onload=alert(1)>".to_vec(),
    );
    let (status, body) = start(&h, &token).await;
    assert_eq!(
        (status, reason(&body)),
        (StatusCode::PRECONDITION_FAILED, "REFERENCE_UNUSABLE")
    );
    assert_eq!(h.provider.creates.load(Ordering::SeqCst), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn transient_aws_errors_keep_the_attempt_retryable(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    let id = start_id(&h, &token).await;
    h.provider
        .set(|script| script.results_error = Some(ProviderError::Transient));
    let (status, body) = finish(&h, &token, &id).await;
    assert_eq!(
        (status, reason(&body)),
        (StatusCode::SERVICE_UNAVAILABLE, "AWAITING_RESULT")
    );
    assert!(!verified(&pool, "alice").await);
    h.provider.set(|script| script.results_error = None);
    assert_eq!(finish(&h, &token, &id).await.1["status"], "VERIFIED");
}

#[sqlx::test(migrations = "./migrations")]
async fn deleting_verification_revokes_and_purges(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "alice", "user").await;
    h.provider.set(|script| script.similarity = Some(88.0));
    let id = start_id(&h, &token).await;
    assert_eq!(finish(&h, &token, &id).await.1["status"], "REVIEW_REQUIRED");
    assert_eq!(h.store.snapshots.lock().unwrap().len(), 2);
    let (status, body) = call(
        &h.app,
        "DELETE",
        "/v1/identity/photo-verification",
        &token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(h.store.snapshots.lock().unwrap().is_empty());
    assert!(!verified(&pool, "alice").await);
    let pending: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM face_verification_attempts WHERE reference_deleted_at IS NULL",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(pending, 0);
    let open: i64 =
        sqlx::query_scalar("SELECT count(*) FROM identity_review_requests WHERE status='OPEN'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(open, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn deleted_accounts_lose_badges_notes_and_images(pool: PgPool) {
    let h = harness(&pool).await;
    let alice = seed(&pool, &h.store, "alice", "user").await;
    let bob = seed(&pool, &h.store, "bob", "user").await;
    let id = start_id(&h, &alice).await;
    assert_eq!(finish(&h, &alice, &id).await.1["status"], "VERIFIED");
    h.provider.set(|script| script.similarity = Some(88.0));
    let id = start_id(&h, &bob).await;
    assert_eq!(finish(&h, &bob, &id).await.1["status"], "REVIEW_REQUIRED");
    let (status, _) = call(
        &h.app,
        "POST",
        &format!("/v1/identity/photo-verifications/{id}/appeal"),
        &bob,
        json!({"note":"it is really me"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) =
        request_alternative(&h, &bob, json!({"reason":"OTHER","note":"call me"})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(h.store.snapshots.lock().unwrap().len(), 2);

    sqlx::query("UPDATE accounts SET deleted_at=now() WHERE id IN ('alice','bob')")
        .execute(&pool)
        .await
        .unwrap();
    sweep(&pool, &h.services).await.unwrap();
    assert!(!verified(&pool, "alice").await);
    assert!(!verified(&pool, "bob").await);
    assert!(h.store.snapshots.lock().unwrap().is_empty());
    let leftovers: i64 = sqlx::query_scalar(
        "SELECT (SELECT count(*) FROM identity_review_requests WHERE note IS NOT NULL OR status='OPEN')
              + (SELECT count(*) FROM identity_alternative_requests WHERE note IS NOT NULL OR status='OPEN')
              + (SELECT count(*) FROM user_photo_verifications WHERE status<>'REVOKED')
              + (SELECT count(*) FROM face_verification_attempts WHERE reference_deleted_at IS NULL)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(leftovers, 0);
    // A second sweep has nothing left to do.
    let before = audit_events(&pool).await;
    sweep(&pool, &h.services).await.unwrap();
    assert_eq!(audit_events(&pool).await, before);
}

async fn audit_events(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM identity_verification_audit_events")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn accounts_without_a_profile_get_safe_answers(pool: PgPool) {
    let h = harness(&pool).await;
    let token = seed(&pool, &h.store, "newcomer", "user").await;
    sqlx::query("DELETE FROM profiles WHERE user_id='newcomer'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(my_status(&h, &token).await["status"], "UNVERIFIED");
    let (status, body) = start(&h, &token).await;
    assert_eq!(
        (status, reason(&body)),
        (StatusCode::PRECONDITION_FAILED, "REFERENCE_UNAVAILABLE")
    );
    assert_eq!(h.provider.creates.load(Ordering::SeqCst), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn the_service_fails_closed_when_not_configured(pool: PgPool) {
    let app = router(new_state(pool.clone(), vec![47; 32]).await.unwrap());
    let store = FakeReferenceStore::default();
    let token = seed(&pool, &store, "alice", "user").await;
    let (status, body) = call(
        &app,
        "POST",
        "/v1/identity/photo-verifications",
        &token,
        json!({"consent":true,"consentVersion":CONSENT}),
    )
    .await;
    assert_eq!(
        (status, reason(&body)),
        (StatusCode::SERVICE_UNAVAILABLE, "IDENTITY_UNAVAILABLE")
    );
}

/// A pool logged in as a disposable member of the production API role, so
/// every statement below runs with exactly the runtime column grants.
async fn api_role_pool(owner: &PgPool) -> (PgPool, String) {
    let mut connection = owner.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock(7498196128800)")
        .execute(&mut *connection)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../operations/runtime-grants.sql"))
        .execute(&mut *connection)
        .await
        .unwrap();
    sqlx::query("SELECT pg_advisory_unlock(7498196128800)")
        .execute(&mut *connection)
        .await
        .unwrap();
    drop(connection);
    let role = format!("identity_{}", Uuid::new_v4().simple());
    sqlx::raw_sql(&format!(
        "CREATE ROLE {role} LOGIN PASSWORD 'disposable-identity-test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT campusmate_api TO {role};"
    ))
    .execute(owner)
    .await
    .unwrap();
    let options = owner
        .connect_options()
        .as_ref()
        .clone()
        .username(&role)
        .password("disposable-identity-test");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .unwrap();
    (pool, role)
}

#[sqlx::test(migrations = "./migrations")]
async fn the_runtime_role_can_run_every_identity_flow(owner: PgPool) {
    let (api, role) = api_role_pool(&owner).await;
    let h = harness_with(&api, policy(), Some(Utc::now() - chrono::Duration::days(1))).await;
    let alice = seed(&owner, &h.store, "alice", "user").await;
    let bob = seed(&owner, &h.store, "bob", "user").await;
    let carol = seed(&owner, &h.store, "carol", "user").await;
    let admin = seed(&owner, &h.store, "admin1", "admin").await;
    seed(&owner, &h.store, "legacy", "user").await;
    sqlx::query("UPDATE profiles SET face_verified=true WHERE user_id='legacy'")
        .execute(&owner)
        .await
        .unwrap();

    // Automatic decision, then a photo change revokes it.
    let id = start_id(&h, &alice).await;
    assert_eq!(finish(&h, &alice, &id).await.1["status"], "VERIFIED");
    assert_eq!(change_photo(&h, &alice, "alice").await, StatusCode::OK);
    assert!(!verified(&owner, "alice").await);

    // Human review with evidence, appeal and approval.
    h.provider.set(|script| script.similarity = Some(88.0));
    let id = start_id(&h, &bob).await;
    assert_eq!(finish(&h, &bob, &id).await.1["status"], "REVIEW_REQUIRED");
    let appeal = format!("/v1/identity/photo-verifications/{id}/appeal");
    assert_eq!(
        call(&h.app, "POST", &appeal, &bob, json!({"note":"me"}))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(queue(&h, &admin).await.0, StatusCode::OK);
    assert_eq!(view_evidence(&h, &admin, &id).await.0, StatusCode::OK);
    let (status, body) = review(&h, &admin, &id, "APPROVE").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(verified(&owner, "bob").await);

    // Alternative request, user deletion of verification data, then account
    // deletion and legacy expiry in the sweep.
    let (status, request) =
        request_alternative(&h, &carol, json!({"reason":"CAMERA_UNAVAILABLE"})).await;
    assert_eq!(status, StatusCode::OK, "{request}");
    let decide = format!(
        "/v1/admin/identity-alternatives/{}/decision",
        request["requestId"].as_str().unwrap()
    );
    assert_eq!(
        call(
            &h.app,
            "POST",
            &decide,
            &admin,
            json!({"decision":"DECLINED"})
        )
        .await
        .0,
        StatusCode::OK
    );
    let id = start_id(&h, &carol).await;
    assert_eq!(finish(&h, &carol, &id).await.1["status"], "REVIEW_REQUIRED");
    let (status, body) = call(
        &h.app,
        "DELETE",
        "/v1/identity/photo-verification",
        &carol,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    sqlx::query("UPDATE accounts SET deleted_at=now() WHERE id='bob'")
        .execute(&owner)
        .await
        .unwrap();
    sweep(&api, &h.services).await.unwrap();
    assert!(!verified(&owner, "bob").await);
    assert!(!verified(&owner, "legacy").await);
    assert!(h.store.snapshots.lock().unwrap().is_empty());

    api.close().await;
    sqlx::raw_sql(&format!("DROP OWNED BY {role}; DROP ROLE {role};"))
        .execute(&owner)
        .await
        .unwrap();
}
