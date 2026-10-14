//! Native authentication. Opaque session tokens are stored as SHA-256 digests;
//! passwords use Argon2id in bounded blocking jobs, never on Tokio's reactor.
use crate::{error::ApiError, AppState};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Algorithm, Argon2, Params, Version,
};
use axum::{extract::State, http::HeaderMap, Json};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{postgres::PgRow, PgConnection, Row};
use uuid::Uuid;

const ACCESS_SECONDS: i64 = 15 * 60;
const REFRESH_SECONDS: i64 = 30 * 24 * 60 * 60;
const MAX_PASSWORD_BYTES: usize = 512;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmailRequest {
    pub email: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChallengeRequest {
    pub token: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResetRequest {
    pub token: String,
    pub password: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Principal {
    pub uid: String,
    pub email: String,
    pub email_verified: bool,
    pub role: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    user: Principal,
}

pub(crate) fn principal(row: &PgRow) -> Result<Principal, ApiError> {
    Ok(Principal {
        uid: row.try_get("user_id")?,
        email: row.try_get("email")?,
        email_verified: row.try_get("email_verified")?,
        role: row.try_get("role")?,
    })
}

pub(crate) fn normalized_email(value: &str) -> Result<String, ApiError> {
    let email = value.trim().to_ascii_lowercase();
    if email.len() > 254 || !email.is_ascii() || email.chars().any(char::is_whitespace) {
        return Err(ApiError::invalid("Invalid email address"));
    }
    let mut parts = email.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    if local.is_empty()
        || local.len() > 64
        || domain.is_empty()
        || parts.next().is_some()
        || local.starts_with('.')
        || local.ends_with('.')
        || local.contains("..")
        || !local
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".!#$%&'*+-/=?^_`{|}~".contains(&b))
        || !domain.contains('.')
        || domain.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
    {
        return Err(ApiError::invalid("Invalid email address"));
    }
    Ok(email)
}

pub(crate) fn validate_new_password(password: &str) -> Result<(), ApiError> {
    let length = password.chars().count();
    // Matches the app's policy (src/utils/passwordPolicy.js); the app also
    // enforces character classes before submitting.
    if !(8..=128).contains(&length) || password.len() > MAX_PASSWORD_BYTES {
        return Err(ApiError::invalid("รหัสผ่านต้องมี 8–128 ตัวอักษร"));
    }
    Ok(())
}

pub(crate) fn validate_signup_email(email: &str) -> Result<(), ApiError> {
    let local = email.strip_suffix("@psu.ac.th").unwrap_or_default();
    if local.len() != 10 || !local.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ApiError::invalid(
            "สมัครใหม่ต้องใช้อีเมลรหัสนักศึกษา 10 หลัก @psu.ac.th",
        ));
    }
    Ok(())
}

fn valid_token(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(crate) fn token_hash(token: &str) -> Result<Vec<u8>, ApiError> {
    use sha2::{Digest, Sha256};
    if !valid_token(token) {
        return Err(ApiError::unauthenticated());
    }
    Ok(Sha256::digest(token.as_bytes()).to_vec())
}

pub(crate) fn new_token() -> Result<String, ApiError> {
    let mut bytes = [0_u8; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| ApiError::unavailable("Secure random generator unavailable"))?;
    Ok(hex::encode(bytes))
}

fn bearer_hash(headers: &HeaderMap) -> Result<Vec<u8>, ApiError> {
    // Reject duplicate headers, extra words and unbounded input before hashing.
    let mut values = headers.get_all(axum::http::header::AUTHORIZATION).iter();
    let value = values.next().ok_or_else(ApiError::unauthenticated)?;
    if values.next().is_some() {
        return Err(ApiError::unauthenticated());
    }
    let header = value.to_str().map_err(|_| ApiError::unauthenticated())?;
    let token = header
        .strip_prefix("Bearer ")
        .ok_or_else(ApiError::unauthenticated)?;
    token_hash(token)
}

/// Startup may use this to build the dummy PHC hash. Request handlers call it
/// only inside spawn_blocking with a held password-job semaphore permit.
pub fn hash_password(password: &str) -> Result<String, ApiError> {
    let params = Params::new(19 * 1024, 2, 1, Some(32)).map_err(|_| ApiError::internal())?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut salt_bytes = [0_u8; 16];
    OsRng
        .try_fill_bytes(&mut salt_bytes)
        .map_err(|_| ApiError::unavailable("Secure random generator unavailable"))?;
    let salt = SaltString::encode_b64(&salt_bytes).map_err(|_| ApiError::internal())?;
    argon
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| ApiError::internal())
}

pub(crate) async fn make_password_hash(
    state: &AppState,
    password: String,
) -> Result<String, ApiError> {
    let permit = state
        .password_jobs
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::unavailable("Authentication is busy; please retry"))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        hash_password(&password)
    })
    .await
    .map_err(|_| ApiError::internal())?
}

pub(crate) async fn check_password(
    state: &AppState,
    password: String,
    encoded_hash: String,
) -> Result<bool, ApiError> {
    let permit = state
        .password_jobs
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::unavailable("Authentication is busy; please retry"))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let parsed = PasswordHash::new(&encoded_hash).map_err(|_| ApiError::internal())?;
        Ok(Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok())
    })
    .await
    .map_err(|_| ApiError::internal())?
}

pub(crate) async fn create_session(
    connection: &mut PgConnection,
    user: Principal,
    family_id: Uuid,
) -> Result<TokenResponse, ApiError> {
    let access_token = new_token()?;
    let refresh_token = new_token()?;
    sqlx::query(
        "INSERT INTO sessions(user_id,family_id,access_hash,refresh_hash,expires_at,refresh_expires_at)
         VALUES($1,$2,$3,$4,now()+make_interval(secs=>$5),now()+make_interval(secs=>$6))",
    )
    .bind(&user.uid)
    .bind(family_id)
    .bind(token_hash(&access_token)?)
    .bind(token_hash(&refresh_token)?)
    .bind(ACCESS_SECONDS as f64)
    .bind(REFRESH_SECONDS as f64)
    .execute(connection)
    .await?;
    Ok(TokenResponse {
        access_token,
        refresh_token,
        expires_in: ACCESS_SECONDS,
        user,
    })
}

pub(crate) async fn enqueue_challenge(
    connection: &mut PgConnection,
    user: &Principal,
    kind: &str,
    lifetime_seconds: f64,
) -> Result<(), ApiError> {
    let token = new_token()?;
    sqlx::query(
        "UPDATE auth_challenges SET used_at=now() WHERE user_id=$1 AND kind=$2 AND used_at IS NULL",
    )
    .bind(&user.uid)
    .bind(kind)
    .execute(&mut *connection)
    .await?;
    sqlx::query("INSERT INTO auth_challenges(user_id,kind,token_hash,expires_at) VALUES($1,$2,$3,now()+make_interval(secs=>$4))")
        .bind(&user.uid).bind(kind).bind(token_hash(&token)?).bind(lifetime_seconds)
        .execute(&mut *connection).await?;
    // Delivery needs the raw challenge. This is a sensitive, short-lived outbox
    // payload: grant access only to the mail worker and scrub it after delivery.
    // Never return the token in an HTTP response or write the payload to logs.
    sqlx::query("INSERT INTO outbox(kind,user_id,payload) VALUES($1,$2,$3)")
        .bind(kind)
        .bind(&user.uid)
        .bind(json!({"email":user.email,"token":token}))
        .execute(connection)
        .await?;
    Ok(())
}

pub async fn signup(
    State(state): State<AppState>,
    Json(input): Json<Credentials>,
) -> Result<Json<TokenResponse>, ApiError> {
    let email = normalized_email(&input.email)?;
    validate_signup_email(&email)?;
    validate_new_password(&input.password)?;
    crate::throttle(&state.db, "auth-signup", &email, 3).await?;
    let password_hash = make_password_hash(&state, input.password).await?;
    let user_id = Uuid::new_v4().to_string();
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(
        "INSERT INTO accounts(id,email,password_hash) VALUES($1,$2,$3)
         ON CONFLICT(email) DO NOTHING RETURNING id AS user_id,email,email_verified,role",
    )
    .bind(user_id)
    .bind(email)
    .bind(password_hash)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        ApiError::new(
            "already-exists",
            "An account already uses this email address",
        )
    })?;
    let user = principal(&row)?;
    sqlx::query(
        "INSERT INTO profiles(user_id,raw) VALUES($1,'{}'::jsonb) ON CONFLICT(user_id) DO NOTHING",
    )
    .bind(&user.uid)
    .execute(&mut *tx)
    .await?;
    enqueue_challenge(&mut tx, &user, "verify_email", 24.0 * 60.0 * 60.0).await?;
    let response = create_session(&mut tx, user, Uuid::new_v4()).await?;
    tx.commit().await?;
    Ok(Json(response))
}

pub async fn login(
    State(state): State<AppState>,
    Json(input): Json<Credentials>,
) -> Result<Json<TokenResponse>, ApiError> {
    let email = normalized_email(&input.email)?;
    crate::throttle(&state.db, "auth-login", &email, 15).await?;
    if input.password.is_empty() || input.password.len() > MAX_PASSWORD_BYTES {
        return Err(ApiError::unauthenticated());
    }
    let row = sqlx::query(
        "SELECT id AS user_id,password_hash,legacy_password AND NOT suspended AND deleted_at IS NULL AS legacy
         FROM accounts WHERE email=$1",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await?;
    let encoded = row
        .as_ref()
        .and_then(|r| r.get::<Option<String>, _>("password_hash"));
    if let Some(account) = row
        .as_ref()
        .filter(|r| encoded.is_none() && r.get("legacy"))
    {
        let id: String = account.get("user_id");
        return crate::account::legacy_login(&state, &id, &email, input.password)
            .await
            .map(Json);
    }
    let checked_hash = encoded
        .clone()
        .unwrap_or_else(|| state.dummy_password_hash.as_ref().clone());
    let matches = check_password(&state, input.password, checked_hash).await?;
    if !matches || encoded.is_none() {
        return Err(ApiError::unauthenticated());
    }
    // Re-check the hash under the account lock so a concurrent password reset
    // cannot grant a session using the old password. Lock order is account,
    // then session/challenge throughout this module.
    let mut tx = state.db.begin().await?;
    let account = sqlx::query(
        "SELECT id AS user_id,email,email_verified,role,password_hash FROM accounts
         WHERE email=$1 AND NOT suspended AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(email)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::unauthenticated)?;
    if account.try_get::<Option<String>, _>("password_hash")? != encoded {
        return Err(ApiError::unauthenticated());
    }
    let response = create_session(&mut tx, principal(&account)?, Uuid::new_v4()).await?;
    tx.commit().await?;
    Ok(Json(response))
}

/// Existing conversation membership survives profile/email visibility changes.
/// This checks an active native session; callers must still authorize their resource.
pub async fn authenticate_session(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<Principal, ApiError> {
    let mut connection = state.db.acquire().await?;
    reauthorize_session(&mut connection, headers).await
}

/// Recheck after the caller locks the account in a write transaction. Logout,
/// refresh and password reset lock that account before revoking its sessions.
pub async fn reauthorize_session(
    connection: &mut PgConnection,
    headers: &HeaderMap,
) -> Result<Principal, ApiError> {
    let digest = bearer_hash(headers)?;
    let row = sqlx::query(
        "SELECT a.id AS user_id,a.email,a.email_verified,a.role
         FROM sessions s JOIN accounts a ON a.id=s.user_id
         WHERE s.access_hash=$1 AND s.revoked_at IS NULL AND s.used_at IS NULL
         AND s.expires_at>now() AND NOT a.suspended AND a.deleted_at IS NULL",
    )
    .bind(digest)
    .fetch_optional(connection)
    .await?
    .ok_or_else(ApiError::unauthenticated)?;
    principal(&row)
}

/// Scrub short-lived delivery secrets even when the mail consumer is stopped.
/// Active leases are left to the bounded sender; the next sweep handles them.
pub async fn scrub_auth_outbox(db: &sqlx::PgPool) -> Result<u64, sqlx::Error> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT public.scrub_auth_outbox()")
            .fetch_one(db)
            .await? as u64,
    )
}

/// Business endpoints must call this on each request; verification, suspension,
/// deletion and session revocation are checked against the live database.
pub async fn authenticate(state: &AppState, headers: &HeaderMap) -> Result<Principal, ApiError> {
    let user = authenticate_session(state, headers).await?;
    require_business_identity(user)
}

pub fn require_business_identity(user: Principal) -> Result<Principal, ApiError> {
    if !user.email_verified {
        let mut error = ApiError::new("permission-denied", "Verify your email address to continue");
        error.details = Some(json!({"reason":"EMAIL_NOT_VERIFIED"}));
        return Err(error);
    }
    if !user.email.ends_with("@psu.ac.th") {
        let mut error = ApiError::new("permission-denied", "กรุณายืนยันอีเมลมหาวิทยาลัยก่อนใช้งาน");
        error.details = Some(json!({"reason":"CAMPUS_EMAIL_REQUIRED"}));
        return Err(error);
    }
    Ok(user)
}

pub async fn lock_business_session(
    connection: &mut PgConnection,
    headers: &HeaderMap,
    uid: &str,
) -> Result<Principal, ApiError> {
    sqlx::query("SELECT id FROM accounts WHERE id=$1 FOR SHARE")
        .bind(uid)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(ApiError::unauthenticated)?;
    let user = require_business_identity(reauthorize_session(connection, headers).await?)?;
    if user.uid != uid {
        return Err(ApiError::unauthenticated());
    }
    Ok(user)
}

pub async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({"user":authenticate_session(&state,&headers).await?}),
    ))
}

pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let digest = bearer_hash(&headers)?;
    let owner: Option<String> =
        sqlx::query_scalar("SELECT user_id FROM sessions WHERE access_hash=$1")
            .bind(&digest)
            .fetch_optional(&state.db)
            .await?;
    let Some(owner) = owner else {
        return Ok(Json(json!({"ok":true})));
    };
    let mut tx = state.db.begin().await?;
    // Serialize logout with token rotation/reset using the same account-first
    // lock order. An UPDATE snapshot alone can miss a concurrently inserted
    // replacement session in the family.
    sqlx::query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE")
        .bind(owner)
        .fetch_one(&mut *tx)
        .await?;
    // Logout may revoke an expired access token's refresh family as well.
    // A previously rotated/revoked token does not authorize further changes.
    sqlx::query(
        "UPDATE sessions SET revoked_at=COALESCE(revoked_at,now())
         WHERE family_id IN (SELECT family_id FROM sessions
         WHERE access_hash=$1 AND revoked_at IS NULL AND used_at IS NULL)",
    )
    .bind(digest)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}

pub async fn refresh(
    State(state): State<AppState>,
    Json(input): Json<RefreshRequest>,
) -> Result<Json<TokenResponse>, ApiError> {
    let digest = token_hash(&input.refresh_token)?;
    crate::throttle(&state.db, "auth-refresh", &hex::encode(&digest), 30).await?;
    let owner: Option<String> =
        sqlx::query_scalar("SELECT user_id FROM sessions WHERE refresh_hash=$1")
            .bind(&digest)
            .fetch_optional(&state.db)
            .await?;
    let owner = owner.ok_or_else(ApiError::unauthenticated)?;
    let mut tx = state.db.begin().await?;
    let account = sqlx::query(
        "SELECT id AS user_id,email,email_verified,role FROM accounts
         WHERE id=$1 AND NOT suspended AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(&owner)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::unauthenticated)?;
    let row = sqlx::query(
        "SELECT id,family_id,used_at,revoked_at,refresh_expires_at>now() AS valid
         FROM sessions WHERE refresh_hash=$1 AND user_id=$2 FOR UPDATE",
    )
    .bind(digest)
    .bind(owner)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::unauthenticated)?;
    let family_id: Uuid = row.try_get("family_id")?;
    if row
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("used_at")?
        .is_some()
    {
        // This is intentionally committed before returning an error. Rolling
        // back here would leave the replacement token usable after a replay.
        sqlx::query("UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1")
            .bind(family_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Err(ApiError::unauthenticated());
    }
    if !row.try_get::<bool, _>("valid")?
        || row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at")?
            .is_some()
    {
        return Err(ApiError::unauthenticated());
    }
    let id: Uuid = row.try_get("id")?;
    sqlx::query("UPDATE sessions SET used_at=now(),revoked_at=now() WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let response = create_session(&mut tx, principal(&account)?, family_id).await?;
    tx.commit().await?;
    Ok(Json(response))
}

async fn challenge_owner(state: &AppState, token: &str, kind: &str) -> Result<String, ApiError> {
    let digest = token_hash(token).map_err(|_| invalid_challenge())?;
    sqlx::query_scalar(
        "SELECT user_id FROM auth_challenges WHERE token_hash=$1 AND kind=$2
         AND used_at IS NULL AND expires_at>now()",
    )
    .bind(digest)
    .bind(kind)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(invalid_challenge)
}

fn invalid_challenge() -> ApiError {
    let mut error = ApiError::invalid("This link is invalid or expired");
    error.details = Some(json!({"reason":"INVALID_CHALLENGE"}));
    error
}

async fn consume_challenge(
    connection: &mut PgConnection,
    user_id: &str,
    token: &str,
    kind: &str,
) -> Result<(), ApiError> {
    // The account is locked by the caller. Single-use challenge consumption
    // remains atomic even when two requests arrive with the same link.
    let consumed = sqlx::query(
        "UPDATE auth_challenges SET used_at=now() WHERE token_hash=$1 AND user_id=$2
         AND kind=$3 AND used_at IS NULL AND expires_at>now() RETURNING id",
    )
    .bind(token_hash(token)?)
    .bind(user_id)
    .bind(kind)
    .fetch_optional(&mut *connection)
    .await?;
    if consumed.is_none() {
        return Err(invalid_challenge());
    }
    sqlx::query(
        "UPDATE auth_challenges SET used_at=now() WHERE user_id=$1 AND kind=$2 AND used_at IS NULL",
    )
    .bind(user_id)
    .bind(kind)
    .execute(connection)
    .await?;
    Ok(())
}

pub async fn verify_email(
    State(state): State<AppState>,
    Json(input): Json<ChallengeRequest>,
) -> Result<Json<Value>, ApiError> {
    // The same email page confirms a campus-address change link.
    if crate::account::confirm_email_change(&state, &input.token).await? {
        return Ok(Json(json!({"ok":true})));
    }
    let owner = challenge_owner(&state, &input.token, "verify_email").await?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "SELECT id FROM accounts WHERE id=$1 AND NOT suspended AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(&owner)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(invalid_challenge)?;
    consume_challenge(&mut tx, &owner, &input.token, "verify_email").await?;
    sqlx::query("UPDATE accounts SET email_verified=true WHERE id=$1")
        .bind(owner)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}

pub async fn request_verification(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let user = authenticate_session(&state, &headers).await?;
    crate::throttle(&state.db, "auth-verification", &user.uid, 3).await?;
    let mut tx = state.db.begin().await?;
    let row = sqlx::query("SELECT id AS user_id,email,email_verified,role FROM accounts WHERE id=$1 AND NOT suspended AND deleted_at IS NULL FOR UPDATE")
        .bind(&user.uid).fetch_optional(&mut *tx).await?.ok_or_else(ApiError::unauthenticated)?;
    let locked_user = principal(&row)?;
    let recent: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM outbox WHERE user_id=$1 AND kind='verify_email' AND created_at>now()-interval '60 seconds')")
        .bind(&user.uid).fetch_one(&mut *tx).await?;
    if !locked_user.email_verified && !recent {
        enqueue_challenge(&mut tx, &locked_user, "verify_email", 24.0 * 60.0 * 60.0).await?;
    }
    tx.commit().await?;
    Ok(Json(
        json!({"ok":true,"message":"If verification is needed, an email will be sent"}),
    ))
}

pub async fn forgot_password(
    State(state): State<AppState>,
    Json(input): Json<EmailRequest>,
) -> Result<Json<Value>, ApiError> {
    let email = normalized_email(&input.email)?;
    crate::throttle(&state.db, "auth-forgot", &email, 3).await?;
    let mut tx = state.db.begin().await?;
    let row = sqlx::query("SELECT id AS user_id,email,email_verified,role FROM accounts WHERE email=$1 AND NOT suspended AND deleted_at IS NULL FOR UPDATE")
        .bind(email).fetch_optional(&mut *tx).await?;
    if let Some(row) = row {
        let user = principal(&row)?;
        let recent: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM outbox WHERE user_id=$1 AND kind='reset_password' AND created_at>now()-interval '60 seconds')")
            .bind(&user.uid).fetch_one(&mut *tx).await?;
        if !recent {
            enqueue_challenge(&mut tx, &user, "reset_password", 60.0 * 60.0).await?;
        }
    }
    tx.commit().await?;
    // Identical status and body for unknown, imported, suspended and registered
    // accounts. Imported accounts gain a native password only through this flow.
    Ok(Json(
        json!({"ok":true,"message":"If this email has an account, password reset instructions will be sent"}),
    ))
}

pub async fn reset_password(
    State(state): State<AppState>,
    Json(input): Json<ResetRequest>,
) -> Result<Json<Value>, ApiError> {
    validate_new_password(&input.password)?;
    let owner = challenge_owner(&state, &input.token, "reset_password").await?;
    let password_hash = make_password_hash(&state, input.password).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "SELECT id FROM accounts WHERE id=$1 AND NOT suspended AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(&owner)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(invalid_challenge)?;
    consume_challenge(&mut tx, &owner, &input.token, "reset_password").await?;
    sqlx::query("UPDATE accounts SET password_hash=$2 WHERE id=$1")
        .bind(&owner)
        .bind(password_hash)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1")
        .bind(owner)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}

#[cfg(test)]
#[path = "auth_tests.rs"]
mod database_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_accounts_require_student_email_without_domain_lookalikes() {
        assert!(validate_signup_email("6912345678@psu.ac.th").is_ok());
        for email in [
            "student@psu.ac.th",
            "123@psu.ac.th",
            "6912345678@gmail.com",
            "6912345678@psu.ac.th.evil.test",
            "6912345678@sub.psu.ac.th",
        ] {
            assert!(validate_signup_email(email).is_err());
        }
    }

    #[test]
    fn tokens_are_unambiguous_and_never_stored_verbatim() {
        let first = new_token().unwrap();
        let second = new_token().unwrap();
        assert!(valid_token(&first));
        assert_ne!(first, second);
        assert_ne!(token_hash(&first).unwrap(), first.as_bytes());
        assert_eq!(token_hash(&first).unwrap().len(), 32);
        for token in [
            "",
            "0",
            &"a".repeat(63),
            &"a".repeat(65),
            &"A".repeat(64),
            &"ก".repeat(64),
            &"g".repeat(64),
        ] {
            assert!(!valid_token(token));
        }
    }

    #[test]
    fn bearer_is_exact_and_rejects_duplicate_headers() {
        let mut headers = HeaderMap::new();
        let token = "a".repeat(64);
        headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
        assert_eq!(bearer_hash(&headers).unwrap(), token_hash(&token).unwrap());
        headers.append("authorization", format!("Bearer {token}").parse().unwrap());
        assert!(bearer_hash(&headers).is_err());
        for value in [
            format!("Basic {token}"),
            format!("Bearer {token} "),
            format!("Bearer  {token}"),
            "Bearer ".repeat(100),
        ] {
            let mut headers = HeaderMap::new();
            headers.insert("authorization", value.parse().unwrap());
            assert!(bearer_hash(&headers).is_err());
        }
    }

    #[test]
    fn email_normalization_matches_unique_database_identity() {
        assert_eq!(
            normalized_email(" Student+test@EXAMPLE.ac.th ").unwrap(),
            "student+test@example.ac.th"
        );
        for email in [
            "",
            "no-at.example.com",
            "a@@example.com",
            "a@example",
            ".a@example.com",
            "a..b@example.com",
            "a@-example.com",
            "a@ex ample.com",
            "a@x..com",
            "ก@example.com",
        ] {
            assert!(normalized_email(email).is_err(), "accepted {email}");
        }
    }

    #[test]
    fn password_limits_count_unicode_characters_and_bound_memory_input() {
        assert!(validate_new_password("Long-enough1").is_ok());
        assert!(validate_new_password(&"ก".repeat(8)).is_ok());
        assert!(validate_new_password(&"a".repeat(7)).is_err());
        assert!(validate_new_password(&"a".repeat(129)).is_err());
    }

    #[test]
    fn passwords_have_unique_salts_argon2id_floor_and_reject_wrong_password() {
        let password = "correct horse battery staple";
        let first = hash_password(password).unwrap();
        let second = hash_password(password).unwrap();
        assert_ne!(first, second);
        assert!(first.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"));
        let parsed = PasswordHash::new(&first).unwrap();
        assert!(Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok());
        assert!(Argon2::default()
            .verify_password(b"wrong password", &parsed)
            .is_err());
    }
}
