//! Moving existing CampusMate users onto native sessions without a password
//! reset: a signed-in Firebase session is exchanged once, a legacy password is
//! verified once and rehashed, and Google Sign-In maps to the same account.
use axum::{extract::State, Json};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    auth::{self, Principal, TokenResponse},
    error::ApiError,
    google_identity, AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdTokenRequest {
    pub id_token: String,
}

fn migration_pending() -> ApiError {
    let mut error = ApiError::new(
        "failed-precondition",
        "บัญชีนี้ยังย้ายเข้าระบบใหม่ไม่เสร็จ กรุณาลองใหม่ภายหลัง",
    );
    error.details = Some(serde_json::json!({"reason":"MIGRATION_PENDING"}));
    error
}

/// `POST /v1/auth/firebase-exchange`. Turns a still-valid Firebase session
/// into a native one for the same imported UID. Never creates an account.
pub async fn firebase_exchange(
    State(state): State<AppState>,
    Json(input): Json<IdTokenRequest>,
) -> Result<Json<TokenResponse>, ApiError> {
    let firebase = state
        .firebase_identity
        .clone()
        .ok_or_else(|| ApiError::unavailable("ระบบย้ายบัญชีไม่พร้อม"))?;
    let (uid, email, verified) = firebase.exchange_identity(&input.id_token).await?;
    crate::throttle(&state.db, "auth-exchange", &uid, 10).await?;
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(
        "SELECT id AS user_id,email,email_verified,role FROM accounts
         WHERE id=$1 AND NOT suspended AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(&uid)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(migration_pending)?;
    let mut user = auth::principal(&row)?;
    // Firebase remains authoritative for the address until cutover; a change
    // made there after the export is applied only if no other account owns it.
    if user.email != email {
        let taken: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts WHERE email=$1 AND id<>$2)")
                .bind(&email)
                .bind(&uid)
                .fetch_one(&mut *tx)
                .await?;
        if taken {
            return Err(migration_pending());
        }
        sqlx::query("UPDATE accounts SET email=$2,email_verified=$3 WHERE id=$1")
            .bind(&uid)
            .bind(&email)
            .bind(verified)
            .execute(&mut *tx)
            .await?;
        user.email = email;
        user.email_verified = verified;
    } else if verified && !user.email_verified {
        sqlx::query("UPDATE accounts SET email_verified=true WHERE id=$1")
            .bind(&uid)
            .execute(&mut *tx)
            .await?;
        user.email_verified = true;
    }
    sqlx::query("UPDATE accounts SET last_sign_in_at=now() WHERE id=$1")
        .bind(&uid)
        .execute(&mut *tx)
        .await?;
    let response = auth::create_session(&mut tx, user, Uuid::new_v4()).await?;
    tx.commit().await?;
    Ok(Json(response))
}

/// Legacy-password half of `POST /v1/auth/login`. Called only for an imported
/// account that still has no native hash. On success the password is stored
/// as Argon2id under the account lock and the legacy flag is cleared.
pub async fn legacy_login(
    state: &AppState,
    account_id: &str,
    email: &str,
    password: String,
) -> Result<TokenResponse, ApiError> {
    let firebase = state
        .firebase_identity
        .clone()
        .ok_or_else(ApiError::unauthenticated)?;
    let verified_uid = firebase.check_legacy_password(email, &password).await?;
    if verified_uid.as_deref() != Some(account_id) {
        return Err(ApiError::unauthenticated());
    }
    let hash = auth::make_password_hash(state, password).await?;
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(
        "SELECT id AS user_id,email,email_verified,role,password_hash,legacy_password FROM accounts
         WHERE id=$1 AND email=$2 AND NOT suspended AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(account_id)
    .bind(email)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::unauthenticated)?;
    // A reset completed meanwhile wins; the old password no longer applies.
    if row.try_get::<Option<String>, _>("password_hash")?.is_some()
        || !row.try_get::<bool, _>("legacy_password")?
    {
        return Err(ApiError::unauthenticated());
    }
    sqlx::query(
        "UPDATE accounts SET password_hash=$2,legacy_password=false,last_sign_in_at=now() WHERE id=$1",
    )
    .bind(account_id)
    .bind(hash)
    .execute(&mut *tx)
    .await?;
    let response = auth::create_session(&mut tx, auth::principal(&row)?, Uuid::new_v4()).await?;
    tx.commit().await?;
    Ok(response)
}

/// `POST /v1/auth/google`. Signs in by Google subject, links an existing
/// account only when Google is authoritative for its address, and creates new
/// accounts only for campus student emails.
pub async fn google(
    State(state): State<AppState>,
    Json(input): Json<IdTokenRequest>,
) -> Result<Json<TokenResponse>, ApiError> {
    let google = state
        .google_identity
        .clone()
        .ok_or_else(|| ApiError::unavailable("ยังไม่ได้ตั้งค่าการเข้าสู่ระบบด้วย Google"))?;
    let claims = google.verify(&input.id_token).await?;
    let email = auth::normalized_email(&claims.email)?;
    crate::throttle(&state.db, "auth-google", &claims.sub, 10).await?;
    let mut tx = state.db.begin().await?;
    let by_subject = sqlx::query(
        "SELECT id AS user_id,email,email_verified,role,suspended,deleted_at IS NOT NULL AS deleted
         FROM accounts WHERE google_subject=$1 FOR UPDATE",
    )
    .bind(&claims.sub)
    .fetch_optional(&mut *tx)
    .await?;
    let row = if let Some(row) = by_subject {
        row
    } else {
        let by_email = sqlx::query(
            "SELECT id AS user_id,email,email_verified,role,suspended,deleted_at IS NOT NULL AS deleted,
             google_subject FROM accounts WHERE email=$1 FOR UPDATE",
        )
        .bind(&email)
        .fetch_optional(&mut *tx)
        .await?;
        match by_email {
            Some(row) => {
                if row
                    .try_get::<Option<String>, _>("google_subject")?
                    .is_some()
                    || !google_identity::authoritative_for_email(&claims)
                {
                    return Err(ApiError::new(
                        "permission-denied",
                        "บัญชีนี้ผูกกับวิธีเข้าสู่ระบบอื่น กรุณาเข้าสู่ระบบด้วยอีเมลและรหัสผ่าน",
                    ));
                }
                let id: String = row.try_get("user_id")?;
                sqlx::query(
                    "UPDATE accounts SET google_subject=$2,email_verified=true WHERE id=$1",
                )
                .bind(&id)
                .bind(&claims.sub)
                .execute(&mut *tx)
                .await?;
                sqlx::query(
                    "SELECT id AS user_id,email,email_verified,role,suspended,deleted_at IS NOT NULL AS deleted
                     FROM accounts WHERE id=$1",
                )
                .bind(&id)
                .fetch_one(&mut *tx)
                .await?
            }
            None => {
                auth::validate_signup_email(&email)?;
                let id = Uuid::new_v4().to_string();
                let display = claims
                    .name
                    .as_deref()
                    .unwrap_or_default()
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(200)
                    .collect::<String>();
                let row = sqlx::query(
                    "INSERT INTO accounts(id,email,email_verified,google_subject,display_name)
                     VALUES($1,$2,true,$3,$4)
                     RETURNING id AS user_id,email,email_verified,role,suspended,false AS deleted",
                )
                .bind(&id)
                .bind(&email)
                .bind(&claims.sub)
                .bind(display)
                .fetch_one(&mut *tx)
                .await?;
                sqlx::query("INSERT INTO profiles(user_id,raw) VALUES($1,'{}'::jsonb)")
                    .bind(&id)
                    .execute(&mut *tx)
                    .await?;
                row
            }
        }
    };
    if row.try_get::<bool, _>("suspended")? || row.try_get::<bool, _>("deleted")? {
        return Err(ApiError::unauthenticated());
    }
    let user: Principal = auth::principal(&row)?;
    sqlx::query("UPDATE accounts SET last_sign_in_at=now() WHERE id=$1")
        .bind(&user.uid)
        .execute(&mut *tx)
        .await?;
    let response = auth::create_session(&mut tx, user, Uuid::new_v4()).await?;
    tx.commit().await?;
    Ok(Json(response))
}

fn otp_code() -> Result<String, ApiError> {
    use rand::RngCore;
    let mut bytes = [0_u8; 4];
    rand::rngs::OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| ApiError::unavailable("Secure random generator unavailable"))?;
    Ok(format!("{:06}", u32::from_be_bytes(bytes) % 1_000_000))
}

fn digest(value: &str) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    Sha256::digest(value.as_bytes()).to_vec()
}

/// Legacy `sendAccountDeletionOtp`: a six-digit code to the account email.
pub async fn send_deletion_otp(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<serde_json::Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    crate::throttle(&state.db, "delete-otp", &user.uid, 3).await?;
    let code = otp_code()?;
    let mut tx = state.db.begin().await?;
    let email: String = sqlx::query_scalar(
        "SELECT email FROM accounts WHERE id=$1 AND NOT suspended AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(&user.uid)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::unauthenticated)?;
    sqlx::query(
        "INSERT INTO account_otps(user_id,purpose,code_hash,expires_at) VALUES($1,'delete_account',$2,now()+interval '10 minutes')
         ON CONFLICT(user_id,purpose) DO UPDATE SET code_hash=excluded.code_hash,attempts=0,expires_at=excluded.expires_at,used_at=NULL,created_at=now()",
    )
    .bind(&user.uid)
    .bind(digest(&code))
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO outbox(kind,user_id,payload) VALUES('delete_account_otp',$1,$2)")
        .bind(&user.uid)
        .bind(serde_json::json!({"email":email,"code":code}))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(serde_json::json!({"sent":true,"email":email}))
}

/// Legacy `verifyAccountDeletionOtp`. Five wrong codes void the request.
/// A verified code authorizes `deleteUserData` for ten minutes.
pub async fn verify_deletion_otp(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    data: serde_json::Value,
) -> Result<serde_json::Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let code = data["code"].as_str().unwrap_or_default().trim().to_owned();
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ApiError::invalid("กรุณาระบุรหัสยืนยัน 6 หลัก"));
    }
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(
        "SELECT code_hash,attempts,expires_at>now() AS live FROM account_otps
         WHERE user_id=$1 AND purpose='delete_account' FOR UPDATE",
    )
    .bind(&user.uid)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        ApiError::new(
            "not-found",
            "ไม่พบคำขอลบบัญชี หรือรหัสยืนยันหมดอายุแล้ว กรุณากดขอรหัสใหม่",
        )
    })?;
    if !row.get::<bool, _>("live") || row.get::<i32, _>("attempts") >= 5 {
        return Err(ApiError::new(
            "deadline-exceeded",
            "รหัสยืนยันหมดอายุแล้ว กรุณากดขอรหัสใหม่",
        ));
    }
    if row.get::<Vec<u8>, _>("code_hash") != digest(&code) {
        sqlx::query("UPDATE account_otps SET attempts=attempts+1 WHERE user_id=$1 AND purpose='delete_account'")
            .bind(&user.uid)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Err(ApiError::new(
            "permission-denied",
            "รหัสยืนยันจากอีเมลไม่ถูกต้อง กรุณาตรวจสอบรหัสในอีเมลอีกครั้ง",
        ));
    }
    sqlx::query("UPDATE account_otps SET used_at=now(),expires_at=now()+interval '10 minutes' WHERE user_id=$1 AND purpose='delete_account'")
        .bind(&user.uid)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(serde_json::json!({"verified":true}))
}

/// Legacy `deleteUserData`. Requires a deletion code verified in the last ten
/// minutes. The account row remains as a tombstone (UID never reused); its
/// email, credentials, profile, device keys and social graph are removed.
pub async fn delete_account(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<serde_json::Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE")
        .bind(&user.uid)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(ApiError::unauthenticated)?;
    if auth::reauthorize_session(&mut tx, headers).await?.uid != user.uid {
        return Err(ApiError::unauthenticated());
    }
    let authorized: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM account_otps WHERE user_id=$1 AND purpose='delete_account' AND used_at IS NOT NULL AND expires_at>now())",
    )
    .bind(&user.uid)
    .fetch_one(&mut *tx)
    .await?;
    if !authorized {
        return Err(ApiError::new(
            "failed-precondition",
            "กรุณายืนยันรหัสจากอีเมลก่อนลบบัญชี",
        ));
    }
    let uid = user.uid.as_str();
    // Hosted parties end; joined parties lose this member and must rekey.
    sqlx::query("UPDATE parties SET status='cancelled',cancelled_at=now(),updated_at=now() WHERE host_id=$1 AND status='open'")
        .bind(uid)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "DELETE FROM group_chats WHERE party_id IN (SELECT id FROM parties WHERE host_id=$1)",
    )
    .bind(uid)
    .execute(&mut *tx)
    .await?;
    let joined: Vec<String> =
        sqlx::query_scalar("DELETE FROM group_members WHERE user_id=$1 RETURNING party_id")
            .bind(uid)
            .fetch_all(&mut *tx)
            .await?;
    sqlx::query(
        "UPDATE group_chats SET rekey_required=true,updated_at=now() WHERE party_id=ANY($1)",
    )
    .bind(&joined)
    .execute(&mut *tx)
    .await?;
    // Direct rooms end for both people; no ciphertext of a deleted account is kept.
    let rooms: Vec<String> =
        sqlx::query_scalar("SELECT id FROM conversations WHERE member_a=$1 OR member_b=$1")
            .bind(uid)
            .fetch_all(&mut *tx)
            .await?;
    let peers: Vec<String> = sqlx::query_scalar(
        "SELECT CASE WHEN member_a=$1 THEN member_b ELSE member_a END FROM conversations WHERE member_a=$1 OR member_b=$1",
    )
    .bind(uid)
    .fetch_all(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM calls WHERE caller_id=$1 OR receiver_id=$1 OR conversation_id=ANY($2)",
    )
    .bind(uid)
    .bind(&rooms)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM appointments WHERE conversation_id=ANY($1) OR host_id=$2 OR guest_id=$2",
    )
    .bind(&rooms)
    .bind(uid)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM encrypted_messages WHERE conversation_id=ANY($1)")
        .bind(&rooms)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM conversations WHERE id=ANY($1)")
        .bind(&rooms)
        .execute(&mut *tx)
        .await?;
    for sql in [
        "DELETE FROM group_reads WHERE user_id=$1",
        "DELETE FROM party_members WHERE user_id=$1 AND party_id NOT IN (SELECT id FROM parties WHERE host_id=$1)",
        "DELETE FROM party_requests WHERE requester_id=$1",
        "DELETE FROM decisions WHERE actor_id=$1 OR target_id=$1",
        "DELETE FROM matching_history WHERE actor_id=$1 OR target_id=$1",
        "DELETE FROM action_receipts WHERE actor_id=$1",
        "DELETE FROM blocks WHERE actor_id=$1 OR target_id=$1",
        "DELETE FROM notifications WHERE user_id=$1",
        "DELETE FROM push_outbox WHERE user_id=$1",
        "DELETE FROM push_tokens WHERE user_id=$1",
        "DELETE FROM encryption_devices WHERE user_id=$1",
        "DELETE FROM discovery_snapshots WHERE user_id=$1",
        "DELETE FROM entitlements WHERE user_id=$1",
        "DELETE FROM account_otps WHERE user_id=$1",
        "UPDATE auth_challenges SET used_at=COALESCE(used_at,now()) WHERE user_id=$1",
        "UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",
        "UPDATE profiles SET raw='{}'::jsonb,discoverable=false,visibility='hidden',face_verified=false,revision=revision+1,updated_at=now() WHERE user_id=$1",
        "UPDATE accounts SET deleted_at=now(),email='deleted-'||id||'@deleted.invalid',password_hash=NULL,legacy_password=false,google_subject=NULL,display_name='' WHERE id=$1",
    ] {
        sqlx::query(sql).bind(uid).execute(&mut *tx).await?;
    }
    crate::identity::revoke_in(&mut tx, uid, "ACCOUNT_DELETED", ("user", Some(uid))).await?;
    let notify: Vec<&str> = peers.iter().map(String::as_str).collect();
    crate::events::publish(&mut tx, &notify, "conversations", None).await?;
    tx.commit().await?;
    if let Some(services) = state.identity.clone() {
        let _ =
            crate::identity::purge_snapshots(&state.db, services.store.as_ref(), Some(uid)).await;
    }
    if let Some(media) = state.media.clone() {
        media.delete_profile_objects(uid).await;
    }
    Ok(serde_json::json!({"deleted":true}))
}

fn campus_student_email(email: &str) -> bool {
    auth::validate_signup_email(email).is_ok()
}

/// Legacy `checkCampusEmailAvailability` (public; no Workspace directory
/// lookup is configured for the native backend).
pub async fn campus_email_availability(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    data: serde_json::Value,
) -> Result<serde_json::Value, ApiError> {
    let email = auth::normalized_email(data["email"].as_str().unwrap_or_default())?;
    if !campus_student_email(&email) {
        return Err(ApiError::invalid(
            "อีเมลต้องขึ้นต้นด้วยรหัสนักศึกษา 10 หลัก เช่น 6912345678@psu.ac.th",
        ));
    }
    crate::throttle(&state.db, "campus-email-check", &email, 20).await?;
    let owner: Option<String> = sqlx::query_scalar("SELECT id FROM accounts WHERE email=$1")
        .bind(&email)
        .fetch_optional(&state.db)
        .await?;
    let caller = auth::authenticate_session(state, headers)
        .await
        .ok()
        .map(|p| p.uid);
    Ok(serde_json::json!({
        "email": email, "exists": owner.is_some(),
        "ownedByCurrentUser": owner.is_some() && owner == caller,
        "workspaceExists": false, "workspaceCheckConfigured": false,
    }))
}

/// Legacy `sendCampusEmailChange`: a link to the new campus address; the
/// account email changes only when that link is opened.
pub async fn send_campus_email_change(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    data: serde_json::Value,
) -> Result<serde_json::Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let email = auth::normalized_email(data["email"].as_str().unwrap_or_default())?;
    if !campus_student_email(&email) {
        return Err(ApiError::invalid(
            "อีเมลต้องขึ้นต้นด้วยรหัสนักศึกษา 10 หลัก เช่น 6912345678@psu.ac.th",
        ));
    }
    if user.email.ends_with("@psu.ac.th") || user.email == email {
        return Ok(serde_json::json!({"alreadyCampus":true,"email":user.email}));
    }
    crate::throttle(&state.db, "campus-email-change", &user.uid, 3).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "SELECT id FROM accounts WHERE id=$1 AND NOT suspended AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(&user.uid)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::unauthenticated)?;
    let taken: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts WHERE email=$1 AND id<>$2)")
            .bind(&email)
            .bind(&user.uid)
            .fetch_one(&mut *tx)
            .await?;
    if taken {
        return Err(ApiError::new(
            "already-exists",
            "อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว กรุณาใช้อีเมล @psu.ac.th ของคุณ",
        ));
    }
    let recent: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM outbox WHERE user_id=$1 AND kind='change_email' AND created_at>now()-interval '60 seconds')")
        .bind(&user.uid)
        .fetch_one(&mut *tx)
        .await?;
    if recent {
        return Err(ApiError::new(
            "resource-exhausted",
            "ส่งอีเมลยืนยันบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
        ));
    }
    let token = auth::new_token()?;
    sqlx::query("UPDATE auth_challenges SET used_at=now() WHERE user_id=$1 AND kind='change_email' AND used_at IS NULL")
        .bind(&user.uid)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO auth_challenges(user_id,kind,token_hash,expires_at,new_email) VALUES($1,'change_email',$2,now()+interval '24 hours',$3)")
        .bind(&user.uid)
        .bind(auth::token_hash(&token)?)
        .bind(&email)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO outbox(kind,user_id,payload) VALUES('change_email',$1,$2)")
        .bind(&user.uid)
        .bind(serde_json::json!({"email":email,"token":token}))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(serde_json::json!({"sent":true,"email":email,"sender":"noreply@getcampusmate.app"}))
}

/// Applies a campus email-change link. `Ok(false)` when the token is not an
/// email-change challenge, so `verify_email` can report the usual error.
pub async fn confirm_email_change(state: &AppState, token: &str) -> Result<bool, ApiError> {
    let Ok(digest) = auth::token_hash(token) else {
        return Ok(false);
    };
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(
        "SELECT user_id,new_email FROM auth_challenges WHERE token_hash=$1 AND kind='change_email' AND used_at IS NULL AND expires_at>now()",
    )
    .bind(&digest)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else { return Ok(false) };
    let uid: String = row.get("user_id");
    let email: Option<String> = row.get("new_email");
    let email = email.ok_or_else(ApiError::internal)?;
    sqlx::query(
        "SELECT id FROM accounts WHERE id=$1 AND NOT suspended AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(&uid)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::unauthenticated)?;
    let consumed = sqlx::query(
        "UPDATE auth_challenges SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL",
    )
    .bind(&digest)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if consumed == 0 {
        return Ok(false);
    }
    let taken: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts WHERE email=$1 AND id<>$2)")
            .bind(&email)
            .bind(&uid)
            .fetch_one(&mut *tx)
            .await?;
    if taken {
        tx.commit().await?;
        return Err(ApiError::new("already-exists", "อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว"));
    }
    sqlx::query("UPDATE accounts SET email=$2,email_verified=true WHERE id=$1")
        .bind(&uid)
        .bind(&email)
        .execute(&mut *tx)
        .await?;
    crate::events::publish_one(&mut tx, &uid, "account", None).await?;
    tx.commit().await?;
    Ok(true)
}

/// Re-authentication for sensitive settings: checks the caller's own password
/// (native hash, or a not-yet-migrated legacy password via Firebase).
pub async fn verify_password(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    data: serde_json::Value,
) -> Result<serde_json::Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    crate::throttle(&state.db, "verify-password", &user.uid, 10).await?;
    let password = data["password"].as_str().unwrap_or_default().to_owned();
    let wrong = || ApiError::new("permission-denied", "รหัสผ่านไม่ถูกต้อง");
    if password.is_empty() || password.len() > 512 {
        return Err(wrong());
    }
    let row = sqlx::query("SELECT email,password_hash,legacy_password FROM accounts WHERE id=$1")
        .bind(&user.uid)
        .fetch_one(&state.db)
        .await?;
    let hash: Option<String> = row.get("password_hash");
    let valid = match hash {
        Some(hash) => auth::check_password(state, password, hash).await?,
        None if row.get::<bool, _>("legacy_password") => {
            let firebase = state.firebase_identity.clone().ok_or_else(wrong)?;
            let email: String = row.get("email");
            firebase
                .check_legacy_password(&email, &password)
                .await?
                .as_deref()
                == Some(user.uid.as_str())
        }
        None => false,
    };
    if !valid {
        return Err(wrong());
    }
    Ok(serde_json::json!({"verified":true}))
}
