//! Photo verification with Amazon Rekognition Face Liveness + CompareFaces.
//!
//! The server alone decides. A client callback, uploaded selfie, score or
//! `verified` flag is never evidence. Each attempt pins an immutable private
//! snapshot of the caller's own profile photo (SHA-256), owns one AWS
//! liveness session, and reaches exactly one terminal decision. Responses
//! and logs never contain images, scores or credentials.
//!
//! A verified photo badge proves liveness and resemblance to that photo. It
//! is not identity, student status or a login factor.

use std::{env, sync::Arc, time::Duration};

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, PgPool, Row};
use uuid::Uuid;

use crate::{
    error::ApiError,
    firebase_identity::authenticate,
    identity_provider::{
        normalize_reference, AwsFaceProvider, Challenge, FaceProvider, LivenessStatus,
        ProviderError, R2ReferenceStore, ReferenceStore, MAX_COMPARE_BYTES,
    },
    AppState,
};

/// AWS: a Face Liveness `SessionId` expires three minutes after creation.
const SESSION_LIFETIME_SECS: i64 = 180;
/// AWS recommends at most 5 failed attempts per 3 minutes, then 30–60 min off.
const FAILURE_WINDOW_SECS: i64 = 180;
const MAX_FAILURES: usize = 5;
const COOLDOWN_SECS: i64 = 1800;
/// Snapshots wait this long for a human reviewer, then are deleted.
const REVIEW_RETENTION_DAYS: i64 = 14;
/// A request that crashed mid-processing is retried or expired after this.
const STALE_PROCESSING_SECS: i64 = 60;
pub const BADGE: &str = "PHOTO_VERIFIED";
const ALTERNATIVE_REASONS: [&str; 4] = [
    "PHOTOSENSITIVITY",
    "CAMERA_UNAVAILABLE",
    "ACCESSIBILITY",
    "OTHER",
];

/// Versioned thresholds. There are no built-in approval thresholds: values
/// must come from a calibration on consented, representative test pairs.
/// Until then the policy runs in manual mode and a person approves badges.
#[derive(Clone, Debug, PartialEq)]
pub struct DecisionPolicy {
    pub version: String,
    /// `false` (manual mode, the default) sends every result AWS confirmed to
    /// human review instead of approving it automatically.
    pub auto_approve: bool,
    pub liveness_min: f32,
    pub liveness_review_min: f32,
    pub similarity_min: f32,
    pub similarity_review_min: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Verified,
    Review,
    Failed(&'static str),
}

impl DecisionPolicy {
    pub fn validate(&self) -> Result<(), &'static str> {
        let range = 0.0..=100.0;
        if self.version.trim().is_empty() || self.version.len() > 64 {
            return Err("FACE_POLICY_VERSION is required");
        }
        for value in [
            self.liveness_min,
            self.liveness_review_min,
            self.similarity_min,
            self.similarity_review_min,
        ] {
            if !range.contains(&value) {
                return Err("face thresholds must be between 0 and 100");
            }
        }
        if self.liveness_review_min > self.liveness_min
            || self.similarity_review_min > self.similarity_min
        {
            return Err("review thresholds must not exceed approval thresholds");
        }
        Ok(())
    }

    /// `FACE_DECISION_MODE` is `manual` (default) or `automatic`. Automatic
    /// mode requires all four thresholds; manual mode only rejects below the
    /// optional review floors (default 0) and never approves by itself.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> anyhow::Result<Self> {
        let value = |name: &str| {
            get(name)
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        };
        let auto_approve = match value("FACE_DECISION_MODE").as_deref() {
            None | Some("manual") => false,
            Some("automatic") => true,
            Some(_) => anyhow::bail!("FACE_DECISION_MODE must be manual or automatic"),
        };
        let number = |name: &str, manual: f32| -> anyhow::Result<f32> {
            match value(name) {
                Some(text) => text
                    .parse::<f32>()
                    .map_err(|_| anyhow::anyhow!("{name} must be a number")),
                None if !auto_approve => Ok(manual),
                None => Err(anyhow::anyhow!(
                    "{name} is required when FACE_DECISION_MODE=automatic"
                )),
            }
        };
        let policy = Self {
            version: value("FACE_POLICY_VERSION").unwrap_or_default(),
            auto_approve,
            liveness_min: number("FACE_LIVENESS_MIN", 100.0)?,
            liveness_review_min: number("FACE_LIVENESS_REVIEW_MIN", 0.0)?,
            similarity_min: number("FACE_SIMILARITY_MIN", 100.0)?,
            similarity_review_min: number("FACE_SIMILARITY_REVIEW_MIN", 0.0)?,
        };
        policy.validate().map_err(anyhow::Error::msg)?;
        Ok(policy)
    }

    /// Liveness and similarity are judged independently; both must pass.
    /// Only the light challenge in automatic mode can approve without a human.
    pub fn decide(
        &self,
        liveness: Option<f32>,
        similarity: Option<f32>,
        challenge: Challenge,
    ) -> Outcome {
        let Some(liveness) = liveness.filter(|value| value.is_finite()) else {
            return Outcome::Failed("LIVENESS_NOT_CONFIRMED");
        };
        if liveness < self.liveness_review_min {
            return Outcome::Failed("LIVENESS_NOT_CONFIRMED");
        }
        let Some(similarity) = similarity.filter(|value| value.is_finite()) else {
            return Outcome::Failed("FACE_NOT_MATCHED");
        };
        if similarity < self.similarity_review_min {
            return Outcome::Failed("FACE_NOT_MATCHED");
        }
        let automatic = self.auto_approve && challenge == Challenge::MovementAndLight;
        if automatic && liveness >= self.liveness_min && similarity >= self.similarity_min {
            Outcome::Verified
        } else {
            Outcome::Review
        }
    }
}

pub struct IdentityServices {
    pub provider: Arc<dyn FaceProvider>,
    pub store: Arc<dyn ReferenceStore>,
    pub policy: DecisionPolicy,
    /// AWS Region of the liveness session (must support Face Liveness).
    pub region: String,
    pub consent_version: String,
    /// Public origin of profile photos, e.g. `https://cdn.example.app`.
    pub media_origin: String,
    /// Other public origins of the *same* media bucket (for example its
    /// `r2.dev` address). Only list an origin after confirming it serves the
    /// same objects; bytes are always read from the bucket by key.
    pub media_alias_origins: Vec<String>,
    /// Badges imported from the previous backend (no liveness check) are
    /// revoked after this instant. `None` keeps them, marked as legacy.
    pub legacy_grace_until: Option<DateTime<Utc>>,
}

impl IdentityServices {
    /// `None` unless `FACE_VERIFICATION_ENABLED=true`; every other value is
    /// then required, so a partial configuration fails at startup.
    pub async fn from_env() -> anyhow::Result<Option<Self>> {
        if env::var("FACE_VERIFICATION_ENABLED").as_deref() != Ok("true") {
            return Ok(None);
        }
        let required = |name: &str| -> anyhow::Result<String> {
            env::var(name)
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| anyhow::anyhow!("{name} is required"))
        };
        let region = required("FACE_LIVENESS_REGION")?;
        let media_origin = required("PROFILE_MEDIA_ORIGIN")?;
        anyhow::ensure!(
            media_origin.starts_with("https://") && !media_origin.ends_with('/'),
            "PROFILE_MEDIA_ORIGIN must be an https origin without a trailing slash"
        );
        let provider =
            AwsFaceProvider::new(region.clone(), required("FACE_LIVENESS_STREAM_ROLE_ARN")?).await;
        let media_alias_origins: Vec<String> = env::var("PROFILE_MEDIA_ALIAS_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .collect();
        for origin in &media_alias_origins {
            anyhow::ensure!(
                origin.starts_with("https://")
                    && origin[8..]
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-'),
                "PROFILE_MEDIA_ALIAS_ORIGINS must list https origins without paths"
            );
        }
        let legacy_grace_until = match env::var("FACE_LEGACY_GRACE_UNTIL") {
            Ok(value) if !value.trim().is_empty() => Some(
                DateTime::parse_from_rfc3339(value.trim())
                    .map_err(|_| anyhow::anyhow!("FACE_LEGACY_GRACE_UNTIL must be RFC 3339"))?
                    .with_timezone(&Utc),
            ),
            _ => None,
        };
        let store = R2ReferenceStore::new(
            required("R2_ENDPOINT")?,
            required("R2_ACCESS_KEY_ID")?,
            required("R2_SECRET_ACCESS_KEY")?,
            required("R2_MEDIA_ACCESS_KEY_ID")?,
            required("R2_MEDIA_SECRET_ACCESS_KEY")?,
            required("R2_MEDIA_BUCKET")?,
            required("R2_VERIFICATION_BUCKET")?,
        );
        Ok(Some(Self {
            provider: Arc::new(provider),
            store: Arc::new(store),
            policy: DecisionPolicy::from_lookup(|name| env::var(name).ok())?,
            region,
            consent_version: required("FACE_CONSENT_VERSION")?,
            media_origin,
            media_alias_origins,
            legacy_grace_until,
        }))
    }
}

fn services(state: &AppState) -> Result<Arc<IdentityServices>, ApiError> {
    state.identity.clone().ok_or_else(|| {
        coded(
            "unavailable",
            "IDENTITY_UNAVAILABLE",
            "ระบบยืนยันใบหน้ายังไม่เปิดให้ใช้งาน",
        )
    })
}

/// Errors carry a safe reason code only; never thresholds or scores.
fn coded(code: &'static str, reason: &'static str, message: &str) -> ApiError {
    let mut error = ApiError::new(code, message);
    error.details = Some(json!({ "reason": reason }));
    error
}

/// `https://{origin}/users/{uid}/avatar.{ext}` (optional query) -> R2 key,
/// only for the caller's own uid. Anything else is refused: the server never
/// fetches a client-chosen URL.
pub fn profile_photo_key(avatar_uri: &str, media_origin: &str, uid: &str) -> Option<String> {
    let rest = avatar_uri.strip_prefix(media_origin)?.strip_prefix('/')?;
    let path = rest.split_once('?').map_or(rest, |(path, _)| path);
    let file = path
        .strip_prefix("users/")?
        .strip_prefix(uid)?
        .strip_prefix('/')?;
    let valid_uid = !uid.is_empty()
        && uid
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-');
    let valid_file = ["avatar.jpg", "avatar.jpeg", "avatar.png", "avatar.webp"].contains(&file);
    (valid_uid && valid_file).then(|| path.to_owned())
}

/// AWS-recommended throttle: 5 failures inside 3 minutes => 30 min cooldown.
pub fn cooldown_until(mut failures: Vec<DateTime<Utc>>) -> Option<DateTime<Utc>> {
    failures.sort();
    failures
        .windows(MAX_FAILURES)
        .filter(|window| {
            (window[MAX_FAILURES - 1] - window[0]).num_seconds() <= FAILURE_WINDOW_SECS
        })
        .map(|window| window[MAX_FAILURES - 1] + chrono::Duration::seconds(COOLDOWN_SECS))
        .max()
}

async fn audit(
    connection: &mut PgConnection,
    user_id: &str,
    attempt_id: Option<Uuid>,
    event: &str,
    actor: (&str, Option<&str>),
    policy_version: Option<&str>,
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO identity_verification_audit_events(user_id,attempt_id,event_type,actor_type,actor_id,policy_version)
         VALUES($1,$2,$3,$4,$5,$6)",
    )
    .bind(user_id)
    .bind(attempt_id)
    .bind(event)
    .bind(actor.0)
    .bind(actor.1)
    .bind(policy_version)
    .execute(connection)
    .await?;
    Ok(())
}

/// Expire abandoned attempts and release crashed ones so they can be retried
/// while their AWS session is still valid. Never infers a pass.
pub async fn reconcile(db: &PgPool, user_id: Option<&str>) -> Result<(), ApiError> {
    sqlx::query(
        "UPDATE face_verification_attempts SET state='EXPIRED',failure_code='SESSION_EXPIRED',
           finished_at=now(),updated_at=now(),reference_purge_after=now()
         WHERE ($1::text IS NULL OR user_id=$1)
           AND ((state IN ('CREATED','IN_PROGRESS') AND expires_at<=now())
             OR (state='CREATING' AND created_at<now()-make_interval(secs=>$2))
             OR (state='PROCESSING' AND updated_at<now()-make_interval(secs=>$2) AND expires_at<=now()))",
    )
    .bind(user_id)
    .bind(STALE_PROCESSING_SECS as f64)
    .execute(db)
    .await?;
    sqlx::query(
        "UPDATE face_verification_attempts SET state='IN_PROGRESS',updated_at=now()
         WHERE ($1::text IS NULL OR user_id=$1) AND state='PROCESSING'
           AND updated_at<now()-make_interval(secs=>$2) AND expires_at>now()",
    )
    .bind(user_id)
    .bind(STALE_PROCESSING_SECS as f64)
    .execute(db)
    .await?;
    Ok(())
}

/// Delete snapshots whose retention ended. Failures stay queued for later.
pub async fn purge_snapshots(
    db: &PgPool,
    store: &dyn ReferenceStore,
    user_id: Option<&str>,
) -> Result<(), ApiError> {
    let rows = sqlx::query(
        "SELECT id,reference_key,evidence_key FROM face_verification_attempts
         WHERE reference_deleted_at IS NULL AND reference_purge_after<=now()
           AND ($1::text IS NULL OR user_id=$1)
         ORDER BY reference_purge_after LIMIT 50",
    )
    .bind(user_id)
    .fetch_all(db)
    .await?;
    for row in rows {
        let key: String = row.get("reference_key");
        let mut deleted = store.delete_snapshot(&key).await.is_ok();
        if let Some(evidence) = row.get::<Option<String>, _>("evidence_key") {
            deleted &= store.delete_snapshot(&evidence).await.is_ok();
        }
        if deleted {
            sqlx::query(
                "UPDATE face_verification_attempts SET reference_deleted_at=now() WHERE id=$1",
            )
            .bind(row.get::<Uuid, _>("id"))
            .execute(db)
            .await?;
        }
    }
    Ok(())
}

/// Periodic sweep: abandoned attempts, deleted accounts, expired legacy
/// badges and images past their deletion deadline.
pub async fn sweep(db: &PgPool, services: &IdentityServices) -> Result<(), ApiError> {
    reconcile(db, None).await?;
    erase_deleted_accounts(db, services.store.as_ref()).await?;
    expire_legacy(db, services.legacy_grace_until).await?;
    purge_snapshots(db, services.store.as_ref(), None).await
}

/// Close open review and alternative requests; `erase` also drops notes.
async fn withdraw_requests(
    tx: &mut PgConnection,
    user_id: &str,
    erase: bool,
) -> Result<(), ApiError> {
    for table in ["identity_review_requests", "identity_alternative_requests"] {
        let sql = format!(
            "UPDATE {table} SET status=CASE WHEN status='OPEN' THEN 'WITHDRAWN' ELSE status END,
               note=CASE WHEN $2 THEN NULL ELSE note END
             WHERE user_id=$1 AND (status='OPEN' OR ($2 AND note IS NOT NULL))"
        );
        sqlx::query(&sql)
            .bind(user_id)
            .bind(erase)
            .execute(&mut *tx)
            .await?;
    }
    Ok(())
}

/// Erase the verification data of a deleted account: badge, open requests,
/// free-text notes and private images. Audit events hold no images or notes.
pub async fn erase_user(
    db: &PgPool,
    store: &dyn ReferenceStore,
    user_id: &str,
) -> Result<(), ApiError> {
    let mut tx = db.begin().await?;
    revoke_in(&mut tx, user_id, "ACCOUNT_DELETED", ("system", None)).await?;
    sqlx::query(
        "UPDATE user_photo_verifications SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),
           revoke_reason='ACCOUNT_DELETED',updated_at=now()
         WHERE user_id=$1 AND status<>'REVOKED'",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE face_verification_attempts SET reference_purge_after=now()
         WHERE user_id=$1 AND reference_deleted_at IS NULL",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    withdraw_requests(&mut tx, user_id, true).await?;
    tx.commit().await?;
    purge_snapshots(db, store, Some(user_id)).await
}

async fn erase_deleted_accounts(db: &PgPool, store: &dyn ReferenceStore) -> Result<(), ApiError> {
    let users: Vec<String> = sqlx::query_scalar(
        "SELECT a.id FROM accounts a WHERE a.deleted_at IS NOT NULL AND (
           EXISTS(SELECT 1 FROM profiles p WHERE p.user_id=a.id AND p.face_verified)
           OR EXISTS(SELECT 1 FROM user_photo_verifications v
                     WHERE v.user_id=a.id AND v.status<>'REVOKED')
           OR EXISTS(SELECT 1 FROM face_verification_attempts f
                     WHERE f.user_id=a.id AND f.reference_deleted_at IS NULL
                       AND (f.reference_purge_after IS NULL OR f.reference_purge_after>now()))
           OR EXISTS(SELECT 1 FROM identity_review_requests r
                     WHERE r.user_id=a.id AND (r.status='OPEN' OR r.note IS NOT NULL))
           OR EXISTS(SELECT 1 FROM identity_alternative_requests x
                     WHERE x.user_id=a.id AND (x.status='OPEN' OR x.note IS NOT NULL)))
         ORDER BY a.id LIMIT 50",
    )
    .fetch_all(db)
    .await?;
    for user_id in users {
        erase_user(db, store, &user_id).await?;
    }
    Ok(())
}

/// After the grace period, badges imported without a liveness check end.
/// A person mid-way through re-verification keeps their attempt.
async fn expire_legacy(db: &PgPool, grace: Option<DateTime<Utc>>) -> Result<(), ApiError> {
    if !grace.is_some_and(|until| until <= Utc::now()) {
        return Ok(());
    }
    let users: Vec<String> = sqlx::query_scalar(
        "SELECT p.user_id FROM profiles p
         LEFT JOIN user_photo_verifications v ON v.user_id=p.user_id
         WHERE p.face_verified AND v.status IS DISTINCT FROM 'VERIFIED'
         ORDER BY p.user_id LIMIT 100",
    )
    .fetch_all(db)
    .await?;
    for user_id in users {
        let mut tx = db.begin().await?;
        // Re-checked under the profile lock: a fresh decision may have landed.
        let legacy: bool = sqlx::query_scalar(
            "SELECT p.face_verified AND v.status IS DISTINCT FROM 'VERIFIED' FROM profiles p
             LEFT JOIN user_photo_verifications v ON v.user_id=p.user_id
             WHERE p.user_id=$1 FOR UPDATE OF p",
        )
        .bind(&user_id)
        .fetch_one(&mut *tx)
        .await?;
        if legacy {
            revoke_in(&mut tx, &user_id, "LEGACY_EXPIRED", ("system", None)).await?;
        }
        tx.commit().await?;
    }
    Ok(())
}

pub async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    let row = sqlx::query(
        "SELECT p.face_verified,v.status,v.verified_at,v.verified_reference_source,
           EXISTS(SELECT 1 FROM identity_alternative_requests x
                  WHERE x.user_id=p.user_id AND x.status='OPEN') AS alternative_open
         FROM profiles p LEFT JOIN user_photo_verifications v ON v.user_id=p.user_id
         WHERE p.user_id=$1",
    )
    .bind(&principal.uid)
    .fetch_optional(&state.db)
    .await?;
    // No profile yet: nothing has been verified.
    let Some(row) = row else {
        return Ok(Json(json!({
            "status": "UNVERIFIED",
            "badge": Value::Null,
            "needsReverification": false,
            "reviewPending": false,
        })));
    };
    let verified: bool = row.get("face_verified");
    let record = row.get::<Option<String>, _>("status");
    let status = match (verified, record.as_deref()) {
        (true, Some("VERIFIED")) => "VERIFIED",
        // Badge imported from the previous backend, without a liveness check.
        (true, _) => "LEGACY",
        (false, Some(status)) if status != "VERIFIED" => status,
        (false, _) => "UNVERIFIED",
    };
    let legacy = status == "LEGACY";
    let grace = state
        .identity
        .as_ref()
        .and_then(|services| services.legacy_grace_until)
        .filter(|_| legacy);
    Ok(Json(json!({
        "status": status,
        "badge": verified.then_some(BADGE),
        "verifiedAt": row
            .get::<Option<DateTime<Utc>>, _>("verified_at")
            .filter(|_| status == "VERIFIED"),
        // The owner's own photo URL, so the badge is mirrored only onto it.
        "photo": row
            .get::<Option<String>, _>("verified_reference_source")
            .filter(|_| status == "VERIFIED"),
        "needsReverification": legacy,
        "legacyGraceUntil": grace,
        "reviewPending": record.as_deref() == Some("REVIEW_REQUIRED"),
        "alternativeRequest": row.get::<bool, _>("alternative_open").then_some("OPEN"),
    })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateRequest {
    pub consent: bool,
    pub consent_version: String,
    /// `FACE_MOVEMENT` asks for the check without flashing lights.
    #[serde(default)]
    pub challenge: Option<String>,
}

fn client_ip(headers: &HeaderMap) -> Option<String> {
    headers
        .get("fly-client-ip")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty() && value.len() <= 64)
}

async fn mark_failed(db: &PgPool, attempt_id: Uuid, code: &'static str) -> Result<(), ApiError> {
    sqlx::query(
        "UPDATE face_verification_attempts SET state='FAILED',failure_code=$2,finished_at=now(),
           updated_at=now(),reference_purge_after=now()
         WHERE id=$1 AND state IN ('CREATING','CREATED','IN_PROGRESS','PROCESSING')",
    )
    .bind(attempt_id)
    .bind(code)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CreateRequest>,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    let services = services(&state)?;
    if !input.consent || input.consent_version != services.consent_version {
        return Err(coded(
            "invalid-argument",
            "CONSENT_REQUIRED",
            "กรุณาอ่านและยินยอมการประมวลผลภาพใบหน้าก่อนเริ่ม",
        ));
    }
    let challenge = match input.challenge.as_deref() {
        None => Challenge::MovementAndLight,
        Some(value) => {
            Challenge::parse(value).ok_or_else(|| ApiError::invalid("รูปแบบการตรวจไม่ถูกต้อง"))?
        }
    };
    crate::throttle(&state.db, "identity-create", &principal.uid, 6).await?;
    if let Some(ip) = client_ip(&headers) {
        crate::throttle(&state.db, "identity-create-ip", &ip, 30).await?;
    }
    reconcile(&state.db, Some(&principal.uid)).await?;
    purge_snapshots(&state.db, services.store.as_ref(), Some(&principal.uid)).await?;

    let failures: Vec<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT finished_at FROM face_verification_attempts
         WHERE user_id=$1 AND state='FAILED' AND failure_code<>'SERVICE_UNAVAILABLE'
           AND finished_at>now()-interval '40 minutes'",
    )
    .bind(&principal.uid)
    .fetch_all(&state.db)
    .await?;
    if cooldown_until(failures).is_some_and(|until| until > Utc::now()) {
        return Err(coded(
            "resource-exhausted",
            "RATE_LIMITED",
            "ลองยืนยันหลายครั้งเกินไป กรุณารอประมาณ 30 นาทีแล้วลองใหม่",
        ));
    }

    let profile = sqlx::query(
        "SELECT p.raw->>'avatarUri' AS avatar,p.face_verified,v.status FROM profiles p
         LEFT JOIN user_photo_verifications v ON v.user_id=p.user_id WHERE p.user_id=$1",
    )
    .bind(&principal.uid)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| {
        coded(
            "failed-precondition",
            "REFERENCE_UNAVAILABLE",
            "กรุณาตั้งรูปโปรไฟล์หลักผ่านแอปก่อนยืนยันใบหน้า",
        )
    })?;
    if profile.get::<bool, _>("face_verified")
        && profile.get::<Option<String>, _>("status").as_deref() == Some("VERIFIED")
    {
        return Err(coded(
            "already-exists",
            "ALREADY_VERIFIED",
            "รูปโปรไฟล์นี้ยืนยันแล้ว",
        ));
    }
    let avatar: String = profile
        .get::<Option<String>, _>("avatar")
        .unwrap_or_default();
    let photo_key = std::iter::once(&services.media_origin)
        .chain(&services.media_alias_origins)
        .find_map(|origin| profile_photo_key(&avatar, origin, &principal.uid));
    let Some(photo_key) = photo_key else {
        return Err(coded(
            "failed-precondition",
            "REFERENCE_UNAVAILABLE",
            "กรุณาตั้งรูปโปรไฟล์หลักผ่านแอปก่อนยืนยันใบหน้า",
        ));
    };
    let source = services
        .store
        .read_profile_photo(&photo_key)
        .await
        .map_err(|error| match error {
            ProviderError::Transient => coded(
                "unavailable",
                "SERVICE_UNAVAILABLE",
                "ระบบไม่พร้อม กรุณาลองใหม่",
            ),
            _ => coded(
                "failed-precondition",
                "REFERENCE_UNAVAILABLE",
                "ไม่พบรูปโปรไฟล์หลัก กรุณาอัปโหลดใหม่",
            ),
        })?;
    let snapshot = tokio::task::spawn_blocking(move || normalize_reference(&source))
        .await
        .map_err(|_| ApiError::internal())?
        .map_err(|_| {
            coded(
                "failed-precondition",
                "REFERENCE_UNUSABLE",
                "รูปโปรไฟล์หลักใช้เปรียบเทียบไม่ได้ กรุณาอัปโหลดรูปใหม่",
            )
        })?;
    let digest = Sha256::digest(&snapshot).to_vec();
    let attempt_id = Uuid::new_v4();
    let snapshot_key = format!("photo-verification/{}/{attempt_id}.jpg", principal.uid);

    let inserted = sqlx::query(
        "INSERT INTO face_verification_attempts(id,user_id,aws_region,reference_source,reference_key,
           reference_sha256,consent_version,consented_at,policy_version,state,expires_at,challenge)
         VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8,'CREATING',now()+make_interval(secs=>$9),$10)",
    )
    .bind(attempt_id)
    .bind(&principal.uid)
    .bind(&services.region)
    .bind(&avatar)
    .bind(&snapshot_key)
    .bind(&digest)
    .bind(&services.consent_version)
    .bind(&services.policy.version)
    .bind(SESSION_LIFETIME_SECS as f64)
    .bind(challenge.as_str())
    .execute(&state.db)
    .await;
    if let Err(sqlx::Error::Database(error)) = &inserted {
        if error.is_unique_violation() {
            return Err(coded(
                "aborted",
                "VERIFICATION_IN_PROGRESS",
                "มีการยืนยันที่ยังไม่เสร็จ กรุณารอสักครู่",
            ));
        }
    }
    inserted?;

    let unavailable = || {
        coded(
            "unavailable",
            "SERVICE_UNAVAILABLE",
            "ระบบยืนยันใบหน้าไม่พร้อม กรุณาลองใหม่",
        )
    };
    if services
        .store
        .put_snapshot(&snapshot_key, snapshot)
        .await
        .is_err()
    {
        mark_failed(&state.db, attempt_id, "SERVICE_UNAVAILABLE").await?;
        return Err(unavailable());
    }
    let credentials = match services
        .provider
        .streaming_credentials(&attempt_id.to_string())
        .await
    {
        Ok(credentials) => credentials,
        Err(_) => {
            mark_failed(&state.db, attempt_id, "SERVICE_UNAVAILABLE").await?;
            return Err(unavailable());
        }
    };
    // Created last, just before the camera starts: the session lives 3 min.
    let session_id = match services
        .provider
        .create_session(&attempt_id.to_string(), challenge)
        .await
    {
        Ok(session_id) => session_id,
        Err(_) => {
            mark_failed(&state.db, attempt_id, "SERVICE_UNAVAILABLE").await?;
            return Err(unavailable());
        }
    };
    let mut tx = state.db.begin().await?;
    let expires_at: DateTime<Utc> = sqlx::query_scalar(
        "UPDATE face_verification_attempts SET state='CREATED',aws_session_id=$2,updated_at=now(),
           expires_at=now()+make_interval(secs=>$3)
         WHERE id=$1 AND state='CREATING' RETURNING expires_at",
    )
    .bind(attempt_id)
    .bind(&session_id)
    .bind(SESSION_LIFETIME_SECS as f64)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(unavailable)?;
    audit(
        &mut tx,
        &principal.uid,
        Some(attempt_id),
        "ATTEMPT_CREATED",
        ("user", Some(&principal.uid)),
        Some(&services.policy.version),
    )
    .await?;
    tx.commit().await?;

    Ok(Json(json!({
        "verificationId": attempt_id,
        "sessionId": session_id,
        "region": services.region,
        "expiresAt": expires_at,
        "state": "CREATED",
        "challenge": challenge.as_str(),
        // Limited to rekognition:StartFaceLivenessSession; expires in minutes.
        "credentials": {
            "accessKeyId": credentials.access_key_id,
            "secretAccessKey": credentials.secret_access_key,
            "sessionToken": credentials.session_token,
            "expiration": credentials.expiration,
        },
    })))
}

/// Public view of an attempt: decision only, never scores.
fn decision(
    id: Uuid,
    state: &str,
    failure_code: Option<&str>,
    finished: Option<DateTime<Utc>>,
) -> Value {
    let verified = state == "VERIFIED";
    json!({
        "verificationId": id,
        "status": state,
        "badge": verified.then_some(BADGE),
        "verifiedAt": finished.filter(|_| verified),
        "reason": if verified { None } else { failure_code },
    })
}

async fn load_owned(
    db: &PgPool,
    id: Uuid,
    user_id: &str,
) -> Result<sqlx::postgres::PgRow, ApiError> {
    sqlx::query(
        "SELECT state::text AS state,failure_code,finished_at,expires_at FROM face_verification_attempts
         WHERE id=$1 AND user_id=$2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| ApiError::new("not-found", "ไม่พบรายการยืนยัน"))
}

fn parse_id(raw: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(raw).map_err(|_| ApiError::new("not-found", "ไม่พบรายการยืนยัน"))
}

pub async fn attempt(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    let id = parse_id(&id)?;
    reconcile(&state.db, Some(&principal.uid)).await?;
    let row = load_owned(&state.db, id, &principal.uid).await?;
    let mut value = decision(
        id,
        row.get("state"),
        row.get::<Option<String>, _>("failure_code").as_deref(),
        row.get("finished_at"),
    );
    value["expiresAt"] = json!(row.get::<DateTime<Utc>, _>("expires_at"));
    Ok(Json(value))
}

struct Claimed {
    challenge: Challenge,
    session_id: String,
    reference_key: String,
    reference_sha256: Vec<u8>,
    reference_source: String,
    policy_version: String,
}

enum Evaluation {
    /// The liveness frame is returned only when a person must review.
    Decided(Outcome, Option<Vec<u8>>),
    Expired,
    /// AWS or R2 not ready; the attempt goes back to IN_PROGRESS for retry.
    Retry,
}

async fn evaluate(services: &IdentityServices, claimed: &Claimed) -> Evaluation {
    let result = match services.provider.session_results(&claimed.session_id).await {
        Ok(result) => result,
        Err(ProviderError::Transient) => return Evaluation::Retry,
        Err(ProviderError::NotFound) => return Evaluation::Expired,
        Err(ProviderError::Rejected) => {
            return Evaluation::Decided(Outcome::Failed("LIVENESS_NOT_CONFIRMED"), None)
        }
    };
    match result.status {
        LivenessStatus::Succeeded => {}
        LivenessStatus::Expired => return Evaluation::Expired,
        LivenessStatus::Failed => {
            return Evaluation::Decided(Outcome::Failed("LIVENESS_NOT_CONFIRMED"), None)
        }
        LivenessStatus::Created | LivenessStatus::InProgress => return Evaluation::Retry,
    }
    let Some(frame) = result
        .reference_image
        .filter(|bytes| !bytes.is_empty() && bytes.len() <= MAX_COMPARE_BYTES)
    else {
        return Evaluation::Decided(Outcome::Failed("REFERENCE_IMAGE_MISSING"), None);
    };
    let snapshot = match services.store.read_snapshot(&claimed.reference_key).await {
        Ok(bytes) => bytes,
        Err(ProviderError::Transient) => return Evaluation::Retry,
        Err(_) => return Evaluation::Decided(Outcome::Failed("REFERENCE_UNAVAILABLE"), None),
    };
    // The pinned digest guards against any change to the private object.
    if Sha256::digest(&snapshot).as_slice() != claimed.reference_sha256.as_slice() {
        return Evaluation::Decided(Outcome::Failed("REFERENCE_TAMPERED"), None);
    }
    let evidence = frame.clone();
    let similarity = match services.provider.compare(frame, snapshot).await {
        Ok(similarity) => similarity,
        Err(ProviderError::Transient) => return Evaluation::Retry,
        Err(_) => return Evaluation::Decided(Outcome::Failed("FACE_NOT_MATCHED"), None),
    };
    // If AWS reports a weaker check than requested, judge it as the weaker one.
    let challenge = match result.challenge {
        Some(Challenge::Movement) => Challenge::Movement,
        _ => claimed.challenge,
    };
    let outcome = services
        .policy
        .decide(result.confidence, similarity, challenge);
    Evaluation::Decided(outcome, (outcome == Outcome::Review).then_some(evidence))
}

/// Keep AWS's liveness frame for the reviewer in the private bucket. The key
/// is recorded first so the purge sweep finds the object whatever happens next.
async fn store_evidence(
    db: &PgPool,
    services: &IdentityServices,
    id: Uuid,
    user_id: &str,
    frame: Vec<u8>,
) -> Result<Option<String>, ApiError> {
    let key = format!("photo-verification/{user_id}/{id}-live.jpg");
    let recorded = sqlx::query(
        "UPDATE face_verification_attempts SET evidence_key=$2,updated_at=now()
         WHERE id=$1 AND state='PROCESSING'",
    )
    .bind(id)
    .bind(&key)
    .execute(db)
    .await?
    .rows_affected()
        == 1;
    Ok((recorded && services.store.put_snapshot(&key, frame).await.is_ok()).then_some(key))
}

/// Persist exactly one terminal decision for a PROCESSING attempt. The photo
/// must still be the one pinned at start, checked under the profile lock.
async fn finalize(
    db: &PgPool,
    id: Uuid,
    user_id: &str,
    claimed: &Claimed,
    outcome: Outcome,
    evidence_stored: bool,
) -> Result<Option<Value>, ApiError> {
    let mut tx = db.begin().await?;
    let current: Option<String> =
        sqlx::query_scalar("SELECT raw->>'avatarUri' FROM profiles WHERE user_id=$1 FOR UPDATE")
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?;
    let outcome = if current.as_deref() == Some(claimed.reference_source.as_str()) {
        outcome
    } else {
        Outcome::Failed("IMAGE_CHANGED")
    };
    let (state, code, purge_days) = match outcome {
        Outcome::Verified => ("VERIFIED", None, 0),
        Outcome::Review => (
            "REVIEW_REQUIRED",
            Some("REVIEW_REQUIRED"),
            REVIEW_RETENTION_DAYS,
        ),
        Outcome::Failed(code) => ("FAILED", Some(code), 0),
    };
    let row = sqlx::query(
        "UPDATE face_verification_attempts SET state=$3::face_attempt_state,failure_code=$4,
           finished_at=now(),updated_at=now(),reference_purge_after=now()+make_interval(days=>$5),
           evidence_stored=$6
         WHERE id=$1 AND user_id=$2 AND state='PROCESSING' RETURNING finished_at",
    )
    .bind(id)
    .bind(user_id)
    .bind(state)
    .bind(code)
    .bind(purge_days as i32)
    .bind(evidence_stored && outcome == Outcome::Review)
    .fetch_optional(&mut *tx)
    .await?;
    // Revoked or expired while AWS was being called: nothing to record.
    let Some(row) = row else {
        return Ok(None);
    };
    let finished: DateTime<Utc> = row.get("finished_at");
    match outcome {
        Outcome::Verified => {
            sqlx::query(
                "INSERT INTO user_photo_verifications(user_id,latest_attempt_id,verified_reference_source,
                   verified_reference_sha256,status,method,policy_version,verified_at,revoked_at,
                   revoke_reason,updated_at)
                 VALUES($1,$2,$3,$4,'VERIFIED','LIVENESS',$5,now(),NULL,NULL,now())
                 ON CONFLICT(user_id) DO UPDATE SET latest_attempt_id=excluded.latest_attempt_id,
                   verified_reference_source=excluded.verified_reference_source,
                   verified_reference_sha256=excluded.verified_reference_sha256,status='VERIFIED',
                   method=excluded.method,policy_version=excluded.policy_version,verified_at=now(),
                   revoked_at=NULL,revoke_reason=NULL,updated_at=now()",
            )
            .bind(user_id)
            .bind(id)
            .bind(&claimed.reference_source)
            .bind(&claimed.reference_sha256)
            .bind(&claimed.policy_version)
            .execute(&mut *tx)
            .await?;
            sqlx::query("UPDATE profiles SET face_verified=true,updated_at=now() WHERE user_id=$1")
                .bind(user_id)
                .execute(&mut *tx)
                .await?;
        }
        Outcome::Review => {
            sqlx::query(
                "INSERT INTO user_photo_verifications(user_id,latest_attempt_id,status,policy_version)
                 VALUES($1,$2,'REVIEW_REQUIRED',$3)
                 ON CONFLICT(user_id) DO UPDATE SET latest_attempt_id=excluded.latest_attempt_id,
                   status='REVIEW_REQUIRED',policy_version=excluded.policy_version,updated_at=now()
                 WHERE user_photo_verifications.status<>'VERIFIED'",
            )
            .bind(user_id)
            .bind(id)
            .bind(&claimed.policy_version)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO identity_review_requests(attempt_id,user_id) VALUES($1,$2)
                 ON CONFLICT(attempt_id) DO NOTHING",
            )
            .bind(id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        }
        Outcome::Failed(_) => {}
    }
    let event = match outcome {
        Outcome::Verified => "DECIDED_VERIFIED",
        Outcome::Review => "DECIDED_REVIEW",
        Outcome::Failed(_) => "DECIDED_FAILED",
    };
    audit(
        &mut tx,
        user_id,
        Some(id),
        event,
        ("system", None),
        Some(&claimed.policy_version),
    )
    .await?;
    tx.commit().await?;
    Ok(Some(decision(id, state, code, Some(finished))))
}

pub async fn complete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    let services = services(&state)?;
    let id = parse_id(&id)?;
    crate::throttle(&state.db, "identity-complete", &principal.uid, 20).await?;

    // Exactly one request moves the attempt to PROCESSING.
    let claimed = sqlx::query(
        "UPDATE face_verification_attempts SET state='PROCESSING',updated_at=now()
         WHERE id=$1 AND user_id=$2 AND state IN ('CREATED','IN_PROGRESS') AND expires_at>now()
         RETURNING aws_session_id,reference_key,reference_sha256,reference_source,policy_version,
           challenge",
    )
    .bind(id)
    .bind(&principal.uid)
    .fetch_optional(&state.db)
    .await?;
    let Some(row) = claimed else {
        reconcile(&state.db, Some(&principal.uid)).await?;
        let row = load_owned(&state.db, id, &principal.uid).await?;
        let current: String = row.get("state");
        if matches!(
            current.as_str(),
            "CREATING" | "CREATED" | "IN_PROGRESS" | "PROCESSING"
        ) {
            return Err(coded(
                "aborted",
                "AWAITING_RESULT",
                "กำลังตรวจสอบผล กรุณารอสักครู่",
            ));
        }
        purge_snapshots(&state.db, services.store.as_ref(), Some(&principal.uid)).await?;
        // Idempotent: a finished attempt returns its saved decision.
        return Ok(Json(decision(
            id,
            &current,
            row.get::<Option<String>, _>("failure_code").as_deref(),
            row.get("finished_at"),
        )));
    };
    let claimed = Claimed {
        // An unknown stored value is judged as the weaker check.
        challenge: Challenge::parse(row.get::<&str, _>("challenge")).unwrap_or(Challenge::Movement),
        session_id: row.get("aws_session_id"),
        reference_key: row.get("reference_key"),
        reference_sha256: row.get("reference_sha256"),
        reference_source: row.get("reference_source"),
        policy_version: row.get("policy_version"),
    };

    // No transaction or row lock is held during the AWS/R2 calls.
    let started = std::time::Instant::now();
    let evaluation = tokio::time::timeout(Duration::from_secs(15), evaluate(&services, &claimed))
        .await
        .unwrap_or(Evaluation::Retry);
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis() as u64,
        "photo verification evaluated"
    );
    let result = match evaluation {
        Evaluation::Decided(outcome, frame) => {
            let evidence = match frame {
                Some(frame) => {
                    store_evidence(&state.db, &services, id, &principal.uid, frame).await?
                }
                None => None,
            };
            let stored = evidence.is_some();
            match finalize(&state.db, id, &principal.uid, &claimed, outcome, stored).await? {
                Some(result) => result,
                None => {
                    // Revoked meanwhile: drop the frame that was just written.
                    if let Some(key) = evidence {
                        let _ = services.store.delete_snapshot(&key).await;
                    }
                    let row = load_owned(&state.db, id, &principal.uid).await?;
                    decision(
                        id,
                        row.get("state"),
                        row.get::<Option<String>, _>("failure_code").as_deref(),
                        row.get("finished_at"),
                    )
                }
            }
        }
        Evaluation::Expired => {
            sqlx::query(
                "UPDATE face_verification_attempts SET state='EXPIRED',failure_code='SESSION_EXPIRED',
                   finished_at=now(),updated_at=now(),reference_purge_after=now()
                 WHERE id=$1 AND state='PROCESSING'",
            )
            .bind(id)
            .execute(&state.db)
            .await?;
            decision(id, "EXPIRED", Some("SESSION_EXPIRED"), None)
        }
        Evaluation::Retry => {
            sqlx::query(
                "UPDATE face_verification_attempts SET state='IN_PROGRESS',updated_at=now()
                 WHERE id=$1 AND state='PROCESSING'",
            )
            .bind(id)
            .execute(&state.db)
            .await?;
            return Err(coded(
                "unavailable",
                "AWAITING_RESULT",
                "ยังไม่ได้รับผลการตรวจ กรุณาลองอีกครั้ง",
            ));
        }
    };
    purge_snapshots(&state.db, services.store.as_ref(), Some(&principal.uid)).await?;
    Ok(Json(result))
}

fn clean_note(note: Option<String>) -> Result<Option<String>, ApiError> {
    let note = note
        .map(|note| note.trim().to_owned())
        .filter(|note| !note.is_empty());
    if note.as_ref().is_some_and(|note| note.chars().count() > 500) {
        return Err(ApiError::invalid("ข้อความยาวเกินไป"));
    }
    Ok(note)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppealRequest {
    pub note: Option<String>,
}

pub async fn appeal(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<AppealRequest>,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    let id = parse_id(&id)?;
    crate::throttle(&state.db, "identity-appeal", &principal.uid, 3).await?;
    let note = clean_note(input.note)?;
    let row = load_owned(&state.db, id, &principal.uid).await?;
    if !matches!(
        row.get::<String, _>("state").as_str(),
        "FAILED" | "REVIEW_REQUIRED"
    ) {
        return Err(coded(
            "failed-precondition",
            "NOT_APPEALABLE",
            "รายการนี้ยื่นทบทวนไม่ได้",
        ));
    }
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO identity_review_requests(attempt_id,user_id,note) VALUES($1,$2,$3)
         ON CONFLICT(attempt_id) DO UPDATE SET note=COALESCE(excluded.note,identity_review_requests.note)
         WHERE identity_review_requests.status='OPEN'",
    )
    .bind(id)
    .bind(&principal.uid)
    .bind(note)
    .execute(&mut *tx)
    .await?;
    audit(
        &mut tx,
        &principal.uid,
        Some(id),
        "APPEAL_OPENED",
        ("user", Some(&principal.uid)),
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "verificationId": id, "appeal": "OPEN" })))
}

/// Revoke the badge and delete verification snapshots for the caller.
pub async fn revoke(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    let mut tx = state.db.begin().await?;
    crate::firebase_identity::lock_business_session(&state, &mut tx, &headers, &principal.uid)
        .await?;
    revoke_in(
        &mut tx,
        &principal.uid,
        "USER_REQUEST",
        ("user", Some(&principal.uid)),
    )
    .await?;
    sqlx::query(
        "UPDATE face_verification_attempts SET reference_purge_after=now()
         WHERE user_id=$1 AND reference_deleted_at IS NULL",
    )
    .bind(&principal.uid)
    .execute(&mut *tx)
    .await?;
    withdraw_requests(&mut tx, &principal.uid, true).await?;
    tx.commit().await?;
    if let Some(services) = state.identity.clone() {
        purge_snapshots(&state.db, services.store.as_ref(), Some(&principal.uid)).await?;
    }
    Ok(Json(json!({ "status": "REVOKED", "badge": Value::Null })))
}

/// Record the caller's current primary photo as reported by the mobile
/// backend. A different photo revokes any proof made for the old one, exactly
/// like a profile save. Returns whether the photo changed.
pub async fn sync_primary_photo(
    tx: &mut PgConnection,
    user_id: &str,
    avatar: &str,
) -> Result<bool, ApiError> {
    // Locked first (same order as revocation and finalize).
    let previous: Option<Option<String>> =
        sqlx::query_scalar("SELECT raw->>'avatarUri' FROM profiles WHERE user_id=$1 FOR UPDATE")
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
    let changed = previous
        .as_ref()
        .is_some_and(|previous| previous.as_deref().unwrap_or("") != avatar);
    if changed {
        revoke_in(tx, user_id, "PHOTO_CHANGED", ("user", Some(user_id))).await?;
    }
    sqlx::query(
        "INSERT INTO profiles(user_id,raw) VALUES($1,jsonb_build_object('avatarUri',$2::text))
         ON CONFLICT(user_id) DO UPDATE SET raw=jsonb_set(profiles.raw,'{avatarUri}',to_jsonb($2::text)),
           revision=profiles.revision+1,updated_at=now()
         WHERE profiles.raw->>'avatarUri' IS DISTINCT FROM $2",
    )
    .bind(user_id)
    .bind(avatar)
    .execute(&mut *tx)
    .await?;
    Ok(changed)
}

/// Shared by user deletion, admin action and photo replacement. Ends active
/// attempts and clears the badge in the caller's transaction.
pub async fn revoke_in(
    tx: &mut PgConnection,
    user_id: &str,
    reason: &'static str,
    actor: (&str, Option<&str>),
) -> Result<(), ApiError> {
    let was_verified: bool =
        sqlx::query_scalar("SELECT face_verified FROM profiles WHERE user_id=$1 FOR UPDATE")
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?
            .unwrap_or(false);
    let attempt_code = match reason {
        "PHOTO_CHANGED" => Some("IMAGE_CHANGED"),
        "ACCOUNT_DELETED" => Some("ACCOUNT_DELETED"),
        // Ending a legacy badge leaves an in-flight re-verification alone.
        "LEGACY_EXPIRED" => None,
        _ => Some("SESSION_EXPIRED"),
    };
    if let Some(code) = attempt_code {
        sqlx::query(
            "UPDATE face_verification_attempts SET state='EXPIRED',failure_code=$2,finished_at=now(),
               updated_at=now(),reference_purge_after=now()
             WHERE user_id=$1 AND state IN ('CREATING','CREATED','IN_PROGRESS','PROCESSING')",
        )
        .bind(user_id)
        .bind(code)
        .execute(&mut *tx)
        .await?;
    }
    // Only an explicit user request records a revocation without a badge.
    if !was_verified && reason != "USER_REQUEST" {
        return Ok(());
    }
    sqlx::query("UPDATE profiles SET face_verified=false WHERE user_id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO user_photo_verifications(user_id,status,revoked_at,revoke_reason)
         VALUES($1,'REVOKED',now(),$2)
         ON CONFLICT(user_id) DO UPDATE SET status='REVOKED',revoked_at=now(),revoke_reason=$2,
           updated_at=now()",
    )
    .bind(user_id)
    .bind(reason)
    .execute(&mut *tx)
    .await?;
    audit(tx, user_id, None, &format!("REVOKED_{reason}"), actor, None).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewDecision {
    pub decision: String,
}

/// Human review for REVIEW_REQUIRED attempts. Admin role is read live from
/// the database; reviewers cannot decide their own attempts.
pub async fn admin_decision(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<ReviewDecision>,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    let id = parse_id(&id)?;
    let approve = match input.decision.as_str() {
        "APPROVE" => true,
        "REJECT" => false,
        _ => return Err(ApiError::invalid("ผลการตรวจทานไม่ถูกต้อง")),
    };
    let mut tx = state.db.begin().await?;
    let reviewer =
        crate::firebase_identity::lock_business_session(&state, &mut tx, &headers, &principal.uid)
            .await?;
    require_admin(&reviewer.role)?;
    let not_found = || ApiError::new("not-found", "ไม่พบรายการตรวจทาน");
    let user_id: String =
        sqlx::query_scalar("SELECT user_id FROM identity_review_requests WHERE attempt_id=$1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(not_found)?;
    if user_id == reviewer.uid {
        return Err(admin_denied());
    }
    // Same lock order as revocation and finalize: profile, then attempts.
    let current: Option<String> =
        sqlx::query_scalar("SELECT raw->>'avatarUri' FROM profiles WHERE user_id=$1 FOR UPDATE")
            .bind(&user_id)
            .fetch_one(&mut *tx)
            .await?;
    let row = sqlx::query(
        "SELECT a.state::text AS state,a.reference_source,a.reference_sha256,a.policy_version,
           (a.evidence_stored AND a.reference_deleted_at IS NULL) AS has_evidence,r.viewed_by
         FROM identity_review_requests r JOIN face_verification_attempts a ON a.id=r.attempt_id
         WHERE r.attempt_id=$1 AND r.status='OPEN' FOR UPDATE OF r,a",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(not_found)?;
    let reviewable = row.get::<String, _>("state") == "REVIEW_REQUIRED";
    if approve && !reviewable {
        return Err(coded(
            "failed-precondition",
            "NOT_REVIEWABLE",
            "รายการนี้อนุมัติไม่ได้ ต้องยืนยันใหม่",
        ));
    }
    if approve && !row.get::<bool, _>("has_evidence") {
        return Err(coded(
            "failed-precondition",
            "EVIDENCE_UNAVAILABLE",
            "ไม่มีภาพสำหรับตรวจทาน ต้องยืนยันใหม่",
        ));
    }
    if approve
        && row.get::<Option<String>, _>("viewed_by").as_deref() != Some(reviewer.uid.as_str())
    {
        return Err(coded(
            "failed-precondition",
            "EVIDENCE_NOT_VIEWED",
            "กรุณาเปิดดูภาพทั้งสองก่อนอนุมัติ",
        ));
    }
    let reference_source: String = row.get("reference_source");
    if approve && current.as_deref() != Some(reference_source.as_str()) {
        return Err(coded(
            "failed-precondition",
            "IMAGE_CHANGED",
            "รูปโปรไฟล์เปลี่ยนแล้ว ต้องยืนยันใหม่",
        ));
    }
    if reviewable {
        sqlx::query(
            "UPDATE face_verification_attempts SET state=$2::face_attempt_state,
               failure_code=CASE WHEN $3 THEN NULL ELSE 'REVIEW_REJECTED' END,
               updated_at=now(),reference_purge_after=now() WHERE id=$1",
        )
        .bind(id)
        .bind(if approve { "VERIFIED" } else { "FAILED" })
        .bind(approve)
        .execute(&mut *tx)
        .await?;
    }
    if approve {
        sqlx::query(
            "INSERT INTO user_photo_verifications(user_id,latest_attempt_id,verified_reference_source,
               verified_reference_sha256,status,method,policy_version,verified_at)
             VALUES($1,$2,$3,$4,'VERIFIED','HUMAN_REVIEW',$5,now())
             ON CONFLICT(user_id) DO UPDATE SET latest_attempt_id=excluded.latest_attempt_id,
               verified_reference_source=excluded.verified_reference_source,
               verified_reference_sha256=excluded.verified_reference_sha256,status='VERIFIED',
               method=excluded.method,policy_version=excluded.policy_version,verified_at=now(),
               revoked_at=NULL,revoke_reason=NULL,updated_at=now()",
        )
        .bind(&user_id)
        .bind(id)
        .bind(&reference_source)
        .bind(row.get::<Vec<u8>, _>("reference_sha256"))
        .bind(row.get::<String, _>("policy_version"))
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE profiles SET face_verified=true,updated_at=now() WHERE user_id=$1")
            .bind(&user_id)
            .execute(&mut *tx)
            .await?;
    } else if reviewable {
        // The person is no longer waiting on this review.
        sqlx::query(
            "UPDATE user_photo_verifications SET status='UNVERIFIED',updated_at=now()
             WHERE user_id=$1 AND latest_attempt_id=$2 AND status='REVIEW_REQUIRED'",
        )
        .bind(&user_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "UPDATE identity_review_requests SET status=$2,decided_by=$3,decided_at=now() WHERE attempt_id=$1",
    )
    .bind(id)
    .bind(if approve { "APPROVED" } else { "REJECTED" })
    .bind(&reviewer.uid)
    .execute(&mut *tx)
    .await?;
    audit(
        &mut tx,
        &user_id,
        Some(id),
        if approve {
            "REVIEW_APPROVED"
        } else {
            "REVIEW_REJECTED"
        },
        ("admin", Some(&reviewer.uid)),
        None,
    )
    .await?;
    tx.commit().await?;
    if let Some(services) = state.identity.clone() {
        purge_snapshots(&state.db, services.store.as_ref(), Some(&user_id)).await?;
    }
    Ok(Json(
        json!({ "verificationId": id, "review": if approve { "APPROVED" } else { "REJECTED" } }),
    ))
}

fn admin_denied() -> ApiError {
    ApiError::new("permission-denied", "ไม่มีสิทธิ์ตรวจทาน")
}

/// Admin role is read live from the database session, never from a client.
fn require_admin(role: &str) -> Result<(), ApiError> {
    if role == "admin" {
        Ok(())
    } else {
        Err(admin_denied())
    }
}

/// Open reviews and alternative requests, oldest first, excluding the
/// reviewer's own. Metadata only: images need the audited evidence endpoint.
pub async fn admin_queue(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    let mut tx = state.db.begin().await?;
    let reviewer =
        crate::firebase_identity::lock_business_session(&state, &mut tx, &headers, &principal.uid)
            .await?;
    require_admin(&reviewer.role)?;
    let reviews = sqlx::query(
        "SELECT r.attempt_id,r.user_id,r.note,r.created_at,a.state::text AS state,a.challenge,
           a.reference_purge_after,(a.evidence_stored AND a.reference_deleted_at IS NULL) AS has_evidence
         FROM identity_review_requests r JOIN face_verification_attempts a ON a.id=r.attempt_id
         WHERE r.status='OPEN' AND r.user_id<>$1 ORDER BY r.created_at LIMIT 50",
    )
    .bind(&reviewer.uid)
    .fetch_all(&mut *tx)
    .await?;
    let alternatives = sqlx::query(
        "SELECT id,user_id,reason,note,created_at FROM identity_alternative_requests
         WHERE status='OPEN' AND user_id<>$1 ORDER BY created_at LIMIT 50",
    )
    .bind(&reviewer.uid)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    let reviews: Vec<Value> = reviews
        .iter()
        .map(|row| {
            json!({
                "verificationId": row.get::<Uuid, _>("attempt_id"),
                "userId": row.get::<String, _>("user_id"),
                "status": row.get::<String, _>("state"),
                "challenge": row.get::<String, _>("challenge"),
                "note": row.get::<Option<String>, _>("note"),
                "hasEvidence": row.get::<bool, _>("has_evidence"),
                "evidenceDeleteAfter": row.get::<Option<DateTime<Utc>>, _>("reference_purge_after"),
                "createdAt": row.get::<DateTime<Utc>, _>("created_at"),
            })
        })
        .collect();
    let alternatives: Vec<Value> = alternatives
        .iter()
        .map(|row| {
            json!({
                "requestId": row.get::<Uuid, _>("id"),
                "userId": row.get::<String, _>("user_id"),
                "reason": row.get::<String, _>("reason"),
                "note": row.get::<Option<String>, _>("note"),
                "createdAt": row.get::<DateTime<Utc>, _>("created_at"),
            })
        })
        .collect();
    Ok(Json(
        json!({ "reviews": reviews, "alternatives": alternatives }),
    ))
}

/// The pinned profile snapshot and AWS liveness frame of one open review.
/// The access is recorded (and audited) before any image is read; approval
/// later requires that this reviewer opened them.
pub async fn admin_evidence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    let services = services(&state)?;
    let id = parse_id(&id)?;
    let mut tx = state.db.begin().await?;
    let reviewer =
        crate::firebase_identity::lock_business_session(&state, &mut tx, &headers, &principal.uid)
            .await?;
    require_admin(&reviewer.role)?;
    let row = sqlx::query(
        "SELECT a.user_id,a.challenge,a.reference_key,a.reference_sha256,a.evidence_key,a.evidence_stored
         FROM identity_review_requests r JOIN face_verification_attempts a ON a.id=r.attempt_id
         WHERE r.attempt_id=$1 AND r.status='OPEN' AND a.state='REVIEW_REQUIRED'
           AND a.reference_deleted_at IS NULL FOR UPDATE OF r",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::new("not-found", "ไม่พบรายการตรวจทาน"))?;
    let user_id: String = row.get("user_id");
    if user_id == reviewer.uid {
        return Err(admin_denied());
    }
    sqlx::query(
        "UPDATE identity_review_requests SET viewed_by=$2,viewed_at=now() WHERE attempt_id=$1",
    )
    .bind(id)
    .bind(&reviewer.uid)
    .execute(&mut *tx)
    .await?;
    audit(
        &mut tx,
        &user_id,
        Some(id),
        "EVIDENCE_VIEWED",
        ("admin", Some(&reviewer.uid)),
        None,
    )
    .await?;
    tx.commit().await?;

    let unavailable = || {
        coded(
            "unavailable",
            "SERVICE_UNAVAILABLE",
            "โหลดภาพไม่ได้ กรุณาลองใหม่",
        )
    };
    let reference = services
        .store
        .read_snapshot(row.get::<&str, _>("reference_key"))
        .await
        .map_err(|_| unavailable())?;
    if Sha256::digest(&reference).as_slice() != row.get::<Vec<u8>, _>("reference_sha256").as_slice()
    {
        // A modified pin can never be approved.
        sqlx::query("UPDATE identity_review_requests SET viewed_by=NULL WHERE attempt_id=$1")
            .bind(id)
            .execute(&state.db)
            .await?;
        tracing::warn!(attempt = %id, "verification reference failed its integrity check");
        return Err(coded(
            "failed-precondition",
            "REFERENCE_TAMPERED",
            "ภาพอ้างอิงถูกแก้ไข ห้ามอนุมัติ",
        ));
    }
    let live = match row
        .get::<Option<String>, _>("evidence_key")
        .filter(|_| row.get::<bool, _>("evidence_stored"))
    {
        Some(key) => Some(
            services
                .store
                .read_snapshot(&key)
                .await
                .map_err(|_| unavailable())?,
        ),
        None => None,
    };
    let image = |bytes: &[u8]| json!({ "mimeType": "image/jpeg", "base64": BASE64.encode(bytes) });
    Ok(Json(json!({
        "verificationId": id,
        "userId": user_id,
        "challenge": row.get::<String, _>("challenge"),
        "reference": image(&reference),
        "live": live.as_deref().map(image),
    })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AlternativeRequest {
    pub reason: String,
    pub note: Option<String>,
}

/// Ask staff for help when no camera check is possible. Photosensitive
/// people can instead start an attempt with the `FACE_MOVEMENT` challenge.
pub async fn request_alternative(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<AlternativeRequest>,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    crate::throttle(&state.db, "identity-alternative", &principal.uid, 3).await?;
    if !ALTERNATIVE_REASONS.contains(&input.reason.as_str()) {
        return Err(ApiError::invalid("เหตุผลไม่ถูกต้อง"));
    }
    let note = clean_note(input.note)?;
    let mut tx = state.db.begin().await?;
    let created: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO identity_alternative_requests(user_id,reason,note) VALUES($1,$2,$3)
         ON CONFLICT(user_id) WHERE status='OPEN' DO NOTHING RETURNING id",
    )
    .bind(&principal.uid)
    .bind(&input.reason)
    .bind(note)
    .fetch_optional(&mut *tx)
    .await?;
    let id =
        match created {
            Some(id) => {
                audit(
                    &mut tx,
                    &principal.uid,
                    None,
                    "ALTERNATIVE_REQUESTED",
                    ("user", Some(&principal.uid)),
                    None,
                )
                .await?;
                id
            }
            // Idempotent: one open request per person.
            None => sqlx::query_scalar(
                "SELECT id FROM identity_alternative_requests WHERE user_id=$1 AND status='OPEN'",
            )
            .bind(&principal.uid)
            .fetch_one(&mut *tx)
            .await?,
        };
    tx.commit().await?;
    Ok(Json(json!({ "requestId": id, "status": "OPEN" })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AlternativeDecision {
    pub decision: String,
}

/// Close an alternative request. This never grants a badge: a badge still
/// needs a liveness result, e.g. a staff-assisted check on another device.
pub async fn admin_alternative_decision(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<AlternativeDecision>,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    let id = parse_id(&id)?;
    let (status, event) = match input.decision.as_str() {
        "RESOLVED" => ("RESOLVED", "ALTERNATIVE_RESOLVED"),
        "DECLINED" => ("DECLINED", "ALTERNATIVE_DECLINED"),
        _ => return Err(ApiError::invalid("ผลการตรวจทานไม่ถูกต้อง")),
    };
    let mut tx = state.db.begin().await?;
    let reviewer =
        crate::firebase_identity::lock_business_session(&state, &mut tx, &headers, &principal.uid)
            .await?;
    require_admin(&reviewer.role)?;
    let user_id: String = sqlx::query_scalar(
        "SELECT user_id FROM identity_alternative_requests WHERE id=$1 AND status='OPEN' FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::new("not-found", "ไม่พบคำขอ"))?;
    if user_id == reviewer.uid {
        return Err(admin_denied());
    }
    sqlx::query(
        "UPDATE identity_alternative_requests SET status=$2,resolved_by=$3,resolved_at=now()
         WHERE id=$1",
    )
    .bind(id)
    .bind(status)
    .bind(&reviewer.uid)
    .execute(&mut *tx)
    .await?;
    audit(
        &mut tx,
        &user_id,
        None,
        event,
        ("admin", Some(&reviewer.uid)),
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "requestId": id, "status": status })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> DecisionPolicy {
        DecisionPolicy {
            version: "test-v1".into(),
            auto_approve: true,
            liveness_min: 90.0,
            liveness_review_min: 70.0,
            similarity_min: 95.0,
            similarity_review_min: 80.0,
        }
    }

    #[test]
    fn liveness_and_similarity_must_both_pass() {
        let policy = policy();
        let light = Challenge::MovementAndLight;
        assert_eq!(
            policy.decide(Some(99.0), Some(99.0), light),
            Outcome::Verified
        );
        assert_eq!(
            policy.decide(Some(40.0), Some(99.9), light),
            Outcome::Failed("LIVENESS_NOT_CONFIRMED")
        );
        assert_eq!(
            policy.decide(Some(99.0), Some(10.0), light),
            Outcome::Failed("FACE_NOT_MATCHED")
        );
        assert_eq!(
            policy.decide(Some(99.0), None, light),
            Outcome::Failed("FACE_NOT_MATCHED")
        );
        assert_eq!(
            policy.decide(None, Some(99.0), light),
            Outcome::Failed("LIVENESS_NOT_CONFIRMED")
        );
        assert_eq!(
            policy.decide(Some(80.0), Some(99.0), light),
            Outcome::Review
        );
        assert_eq!(
            policy.decide(Some(99.0), Some(85.0), light),
            Outcome::Review
        );
        assert_eq!(
            policy.decide(Some(f32::NAN), Some(99.0), light),
            Outcome::Failed("LIVENESS_NOT_CONFIRMED")
        );
    }

    #[test]
    fn manual_mode_and_movement_only_checks_always_go_to_a_person() {
        let manual = DecisionPolicy {
            auto_approve: false,
            ..policy()
        };
        let light = Challenge::MovementAndLight;
        assert_eq!(
            manual.decide(Some(99.9), Some(99.9), light),
            Outcome::Review
        );
        assert_eq!(
            manual.decide(Some(40.0), Some(99.9), light),
            Outcome::Failed("LIVENESS_NOT_CONFIRMED")
        );
        let automatic = policy();
        assert_eq!(
            automatic.decide(Some(99.9), Some(99.9), Challenge::Movement),
            Outcome::Review
        );
        assert_eq!(
            automatic.decide(Some(99.9), Some(10.0), Challenge::Movement),
            Outcome::Failed("FACE_NOT_MATCHED")
        );
    }

    #[test]
    fn the_policy_defaults_to_manual_and_automatic_needs_every_threshold() {
        let lookup = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| {
                pairs
                    .iter()
                    .find(|(key, _)| *key == name)
                    .map(|(_, value)| value.to_string())
            }
        };
        let manual = DecisionPolicy::from_lookup(lookup(&[("FACE_POLICY_VERSION", "v1")])).unwrap();
        assert!(!manual.auto_approve);
        assert_eq!(manual.liveness_review_min, 0.0);
        assert_eq!(manual.similarity_review_min, 0.0);
        assert!(DecisionPolicy::from_lookup(lookup(&[])).is_err());
        assert!(DecisionPolicy::from_lookup(lookup(&[
            ("FACE_POLICY_VERSION", "v1"),
            ("FACE_DECISION_MODE", "automatic"),
            ("FACE_LIVENESS_MIN", "90"),
        ]))
        .is_err());
        assert!(DecisionPolicy::from_lookup(lookup(&[
            ("FACE_POLICY_VERSION", "v1"),
            ("FACE_DECISION_MODE", "yes"),
        ]))
        .is_err());
        assert!(DecisionPolicy::from_lookup(lookup(&[
            ("FACE_POLICY_VERSION", "v1"),
            ("FACE_SIMILARITY_REVIEW_MIN", "NaN"),
        ]))
        .is_err());
        let automatic = DecisionPolicy::from_lookup(lookup(&[
            ("FACE_POLICY_VERSION", "calibrated-2026-11"),
            ("FACE_DECISION_MODE", "automatic"),
            ("FACE_LIVENESS_MIN", "90"),
            ("FACE_LIVENESS_REVIEW_MIN", "70"),
            ("FACE_SIMILARITY_MIN", "95"),
            ("FACE_SIMILARITY_REVIEW_MIN", "80"),
        ]))
        .unwrap();
        assert!(automatic.auto_approve);
        assert_eq!(automatic.similarity_min, 95.0);
    }

    #[test]
    fn policies_must_be_explicit_and_ordered() {
        assert!(policy().validate().is_ok());
        assert!(DecisionPolicy {
            version: String::new(),
            ..policy()
        }
        .validate()
        .is_err());
        assert!(DecisionPolicy {
            similarity_min: 101.0,
            ..policy()
        }
        .validate()
        .is_err());
        assert!(DecisionPolicy {
            similarity_review_min: 96.0,
            ..policy()
        }
        .validate()
        .is_err());
    }

    #[test]
    fn only_the_callers_own_profile_photo_is_accepted() {
        let origin = "https://cdn.campus.test";
        assert_eq!(
            profile_photo_key(
                "https://cdn.campus.test/users/u1/avatar.jpg?v=3",
                origin,
                "u1"
            )
            .as_deref(),
            Some("users/u1/avatar.jpg")
        );
        for uri in [
            "https://cdn.campus.test/users/u2/avatar.jpg",
            "https://cdn.campus.test/users/u1/../u2/avatar.jpg",
            "https://cdn.campus.test/users/u1/avatar.gif",
            "https://cdn.campus.test.evil.test/users/u1/avatar.jpg",
            "http://cdn.campus.test/users/u1/avatar.jpg",
            "https://cdn.campus.test/users/u1/avatar.jpg/../../secret",
            "https://169.254.169.254/users/u1/avatar.jpg",
            "",
        ] {
            assert_eq!(profile_photo_key(uri, origin, "u1"), None, "{uri}");
        }
        assert_eq!(
            profile_photo_key("https://cdn.campus.test/users//avatar.jpg", origin, ""),
            None
        );
    }

    #[test]
    fn five_failures_within_three_minutes_start_a_cooldown() {
        let base = DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap();
        let at = |seconds: i64| base + chrono::Duration::seconds(seconds);
        assert_eq!(cooldown_until(vec![at(0), at(30), at(60), at(90)]), None);
        assert_eq!(
            cooldown_until(vec![at(0), at(60), at(120), at(240), at(400)]),
            None
        );
        assert_eq!(
            cooldown_until(vec![at(0), at(30), at(60), at(90), at(120)]),
            Some(at(120 + COOLDOWN_SECS))
        );
    }
}
