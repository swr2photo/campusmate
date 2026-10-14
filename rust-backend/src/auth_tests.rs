//! These tests need DATABASE_URL pointing to a test Postgres role with CREATE
//! DATABASE permission. sqlx creates and migrates a separate database per test.
use super::*;
use sqlx::PgPool;

#[sqlx::test(migrations = "./migrations")]
async fn stopped_mail_worker_does_not_retain_cancelled_delivery_tokens(pool: PgPool) {
    let state = state(pool).await;
    let response = register(&state, "6912345690@psu.ac.th").await;
    assert_eq!(scrub_auth_outbox(&state.db).await.unwrap(), 0);
    let mut tx = state.db.begin().await.unwrap();
    sqlx::query(
        "UPDATE outbox SET locked_until=now()+interval '90 seconds',lease_id=$1 WHERE user_id=$2",
    )
    .bind(Uuid::new_v4())
    .bind(&response.user.uid)
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query("UPDATE auth_challenges SET used_at=now() WHERE user_id=$1")
        .bind(&response.user.uid)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(scrub_auth_outbox(&state.db).await.unwrap(), 0);
    sqlx::query("UPDATE outbox SET locked_until=now()-interval '1 second' WHERE user_id=$1")
        .bind(&response.user.uid)
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(scrub_auth_outbox(&state.db).await.unwrap(), 1);
    let row=sqlx::query("SELECT payload,finished_at IS NOT NULL AS finished,lease_id IS NULL AS released FROM outbox WHERE user_id=$1")
        .bind(&response.user.uid).fetch_one(&state.db).await.unwrap();
    assert_eq!(row.get::<Value, _>("payload"), json!({}));
    assert!(row.get::<bool, _>("finished") && row.get::<bool, _>("released"));
}

fn headers(token: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
    headers
}

async fn state(pool: PgPool) -> AppState {
    crate::new_state(pool, vec![73; 32]).await.unwrap()
}

async fn register(state: &AppState, email: &str) -> TokenResponse {
    signup(
        State(state.clone()),
        Json(Credentials {
            email: email.into(),
            password: "long enough unique test password".into(),
        }),
    )
    .await
    .unwrap()
    .0
}

async fn challenge(state: &AppState, uid: &str, kind: &str) -> String {
    let payload: Value = sqlx::query_scalar(
        "SELECT payload FROM outbox WHERE user_id=$1 AND kind=$2 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(uid)
    .bind(kind)
    .fetch_one(&state.db)
    .await
    .unwrap();
    payload["token"].as_str().unwrap().into()
}

#[sqlx::test(migrations = "./migrations")]
async fn signup_verification_live_account_guards_and_secret_storage(pool: PgPool) {
    let state = state(pool).await;
    let response = register(&state, "6912345678@PSU.AC.TH").await;
    assert_eq!(response.user.email, "6912345678@psu.ac.th");
    assert!(!response.user.email_verified);
    assert_eq!(response.expires_in, 900);
    assert!(me(State(state.clone()), headers(&response.access_token))
        .await
        .is_ok());
    let denied = authenticate(&state, &headers(&response.access_token))
        .await
        .err()
        .unwrap();
    assert_eq!(denied.code, "permission-denied");
    assert_eq!(denied.details.unwrap()["reason"], "EMAIL_NOT_VERIFIED");

    let row = sqlx::query("SELECT password_hash FROM accounts WHERE id=$1")
        .bind(&response.user.uid)
        .fetch_one(&state.db)
        .await
        .unwrap();
    let stored: String = row.get("password_hash");
    assert!(stored.starts_with("$argon2id$"));
    assert_ne!(stored, "long enough unique test password");
    let row = sqlx::query("SELECT access_hash,refresh_hash,extract(epoch from expires_at-created_at)::int AS access_seconds,extract(epoch from refresh_expires_at-created_at)::int AS refresh_seconds FROM sessions WHERE user_id=$1")
        .bind(&response.user.uid).fetch_one(&state.db).await.unwrap();
    assert_eq!(
        row.get::<Vec<u8>, _>("access_hash"),
        token_hash(&response.access_token).unwrap()
    );
    assert_eq!(
        row.get::<Vec<u8>, _>("refresh_hash"),
        token_hash(&response.refresh_token).unwrap()
    );
    assert_eq!(row.get::<i32, _>("access_seconds"), 900);
    assert_eq!(row.get::<i32, _>("refresh_seconds"), 30 * 86400);
    assert!(serde_json::from_value::<Credentials>(json!({"email":"x@example.com","password":"a sufficiently long password","emailVerified":true,"role":"admin"})).is_err());

    let token = challenge(&state, &response.user.uid, "verify_email").await;
    let saved_hash: Vec<u8> = sqlx::query_scalar(
        "SELECT token_hash FROM auth_challenges WHERE user_id=$1 AND kind='verify_email'",
    )
    .bind(&response.user.uid)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(saved_hash, token_hash(&token).unwrap());
    let _ = verify_email(
        State(state.clone()),
        Json(ChallengeRequest {
            token: token.clone(),
        }),
    )
    .await
    .unwrap();
    assert!(
        authenticate(&state, &headers(&response.access_token))
            .await
            .unwrap()
            .email_verified
    );
    assert!(
        verify_email(State(state.clone()), Json(ChallengeRequest { token }))
            .await
            .is_err()
    );

    sqlx::query("UPDATE accounts SET suspended=true WHERE id=$1")
        .bind(&response.user.uid)
        .execute(&state.db)
        .await
        .unwrap();
    assert!(me(State(state.clone()), headers(&response.access_token))
        .await
        .is_err());
    assert!(refresh(
        State(state.clone()),
        Json(RefreshRequest {
            refresh_token: response.refresh_token.clone()
        })
    )
    .await
    .is_err());
    sqlx::query("UPDATE accounts SET suspended=false,deleted_at=now() WHERE id=$1")
        .bind(&response.user.uid)
        .execute(&state.db)
        .await
        .unwrap();
    assert!(me(State(state.clone()), headers(&response.access_token))
        .await
        .is_err());
    assert!(login(
        State(state.clone()),
        Json(Credentials {
            email: response.user.email,
            password: "long enough unique test password".into()
        })
    )
    .await
    .is_err());
}

#[sqlx::test(migrations = "./migrations")]
async fn refresh_rotation_and_replay_commit_family_revocation(pool: PgPool) {
    let state = state(pool).await;
    let first = register(&state, "6912345679@psu.ac.th").await;
    let second = refresh(
        State(state.clone()),
        Json(RefreshRequest {
            refresh_token: first.refresh_token.clone(),
        }),
    )
    .await
    .unwrap()
    .0;
    assert_ne!(first.access_token, second.access_token);
    assert_ne!(first.refresh_token, second.refresh_token);
    assert!(me(State(state.clone()), headers(&first.access_token))
        .await
        .is_err());
    assert!(me(State(state.clone()), headers(&second.access_token))
        .await
        .is_ok());
    assert!(refresh(
        State(state.clone()),
        Json(RefreshRequest {
            refresh_token: first.refresh_token
        })
    )
    .await
    .is_err());
    // Read after the failed handler to prove revocation was committed rather
    // than rolled back with its unauthorized response.
    let active: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sessions WHERE user_id=$1 AND revoked_at IS NULL")
            .bind(&first.user.uid)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(active, 0);
    assert!(me(State(state.clone()), headers(&second.access_token))
        .await
        .is_err());
    assert!(refresh(
        State(state.clone()),
        Json(RefreshRequest {
            refresh_token: second.refresh_token
        })
    )
    .await
    .is_err());
}

#[sqlx::test(migrations = "./migrations")]
async fn simultaneous_refresh_cannot_create_two_valid_replacements(pool: PgPool) {
    let state = state(pool).await;
    let first = register(&state, "6912345680@psu.ac.th").await;
    let (left, right) = tokio::join!(
        refresh(
            State(state.clone()),
            Json(RefreshRequest {
                refresh_token: first.refresh_token.clone()
            })
        ),
        refresh(
            State(state.clone()),
            Json(RefreshRequest {
                refresh_token: first.refresh_token.clone()
            })
        ),
    );
    assert_ne!(left.is_ok(), right.is_ok());
    let active: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sessions WHERE user_id=$1 AND revoked_at IS NULL")
            .bind(first.user.uid)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(
        active, 0,
        "the second use must revoke the replacement family"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn password_reset_is_single_use_revokes_all_sessions_and_hides_email_existence(pool: PgPool) {
    let state = state(pool).await;
    let first = register(&state, "6912345681@psu.ac.th").await;
    let second = login(
        State(state.clone()),
        Json(Credentials {
            email: first.user.email.clone(),
            password: "long enough unique test password".into(),
        }),
    )
    .await
    .unwrap()
    .0;
    let known = forgot_password(
        State(state.clone()),
        Json(EmailRequest {
            email: first.user.email.clone(),
        }),
    )
    .await
    .unwrap()
    .0;
    let unknown = forgot_password(
        State(state.clone()),
        Json(EmailRequest {
            email: "unknown@example.com".into(),
        }),
    )
    .await
    .unwrap()
    .0;
    assert_eq!(known, unknown);
    let token = challenge(&state, &first.user.uid, "reset_password").await;
    let _ = reset_password(
        State(state.clone()),
        Json(ResetRequest {
            token: token.clone(),
            password: "replacement password that is long".into(),
        }),
    )
    .await
    .unwrap();
    assert!(reset_password(
        State(state.clone()),
        Json(ResetRequest {
            token,
            password: "replacement password that is long".into()
        })
    )
    .await
    .is_err());
    for token in [&first.access_token, &second.access_token] {
        assert!(me(State(state.clone()), headers(token)).await.is_err());
    }
    for token in [first.refresh_token, second.refresh_token] {
        assert!(refresh(
            State(state.clone()),
            Json(RefreshRequest {
                refresh_token: token
            })
        )
        .await
        .is_err());
    }
    assert!(login(
        State(state.clone()),
        Json(Credentials {
            email: first.user.email.clone(),
            password: "long enough unique test password".into()
        })
    )
    .await
    .is_err());
    assert!(login(
        State(state.clone()),
        Json(Credentials {
            email: first.user.email,
            password: "replacement password that is long".into()
        })
    )
    .await
    .is_ok());
}

#[sqlx::test(migrations = "./migrations")]
async fn expiry_and_logout_revoke_refresh_even_after_access_expiry(pool: PgPool) {
    let state = state(pool).await;
    let first = register(&state, "6912345682@psu.ac.th").await;
    sqlx::query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1")
        .bind(&first.user.uid)
        .execute(&state.db)
        .await
        .unwrap();
    assert!(me(State(state.clone()), headers(&first.access_token))
        .await
        .is_err());
    let _ = logout(State(state.clone()), headers(&first.access_token))
        .await
        .unwrap();
    assert!(refresh(
        State(state.clone()),
        Json(RefreshRequest {
            refresh_token: first.refresh_token
        })
    )
    .await
    .is_err());
    let second = login(
        State(state.clone()),
        Json(Credentials {
            email: first.user.email,
            password: "long enough unique test password".into(),
        }),
    )
    .await
    .unwrap()
    .0;
    sqlx::query(
        "UPDATE sessions SET refresh_expires_at=now()-interval '1 second' WHERE refresh_hash=$1",
    )
    .bind(token_hash(&second.refresh_token).unwrap())
    .execute(&state.db)
    .await
    .unwrap();
    assert!(refresh(
        State(state.clone()),
        Json(RefreshRequest {
            refresh_token: second.refresh_token
        })
    )
    .await
    .is_err());
}
