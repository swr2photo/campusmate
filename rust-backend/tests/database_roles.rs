//! Run only in the disposable integration database. These capability roles
//! are never created in production by the test runner.
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};

async fn denied(pool: &PgPool, role: &str, statement: &str) {
    let mut tx = pool.begin().await.unwrap();
    sqlx::query(&format!("SET LOCAL ROLE {role}"))
        .execute(&mut *tx)
        .await
        .unwrap();
    let error = sqlx::query(statement)
        .execute(&mut *tx)
        .await
        .expect_err("operation should be denied");
    assert_eq!(
        error
            .as_database_error()
            .and_then(|error| error.code())
            .as_deref(),
        Some("42501")
    );
    tx.rollback().await.unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn runtime_roles_separate_mail_tokens_staging_data_and_schema_permissions(pool: PgPool) {
    sqlx::raw_sql(include_str!("../operations/runtime-grants.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let token = "a".repeat(64);
    sqlx::query("INSERT INTO accounts(id,email,password_hash) VALUES('student','6912345699@psu.ac.th','PRIVATE-PASSWORD-HASH')").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO auth_challenges(user_id,kind,token_hash,expires_at) VALUES('student','verify_email',$1,now()-interval '1 second')")
        .bind(Sha256::digest(token.as_bytes()).to_vec()).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO outbox(user_id,kind,payload) VALUES('student','verify_email',$1)")
        .bind(json!({"email":"6912345699@psu.ac.th","token":token}))
        .execute(&pool)
        .await
        .unwrap();
    denied(&pool, "campusmate_api", "SELECT payload FROM outbox").await;
    denied(
        &pool,
        "campusmate_api",
        "SELECT data FROM migration_documents",
    )
    .await;
    denied(
        &pool,
        "campusmate_api",
        "CREATE TABLE public.must_not_exist(id integer)",
    )
    .await;
    denied(
        &pool,
        "campusmate_mail",
        "SELECT password_hash FROM accounts",
    )
    .await;
    denied(&pool, "campusmate_mail", "SELECT access_hash FROM sessions").await;
    denied(&pool, "campusmate_mail", "UPDATE accounts SET role='admin'").await;
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SET LOCAL ROLE campusmate_api")
        .execute(&mut *tx)
        .await
        .unwrap();
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM outbox WHERE user_id='student' AND kind='verify_email' AND created_at>now()-interval '60 seconds'")
        .fetch_one(&mut *tx).await.unwrap();
    assert_eq!(count, 1);
    let scrubbed: i64 = sqlx::query_scalar("SELECT public.scrub_auth_outbox()")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(scrubbed, 1);
    tx.commit().await.unwrap();
    let row = sqlx::query("SELECT payload,finished_at IS NOT NULL AS finished FROM outbox")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.get::<serde_json::Value, _>("payload"), json!({}));
    assert!(row.get::<bool, _>("finished"));
}
