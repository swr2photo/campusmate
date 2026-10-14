//! Firebase authentication for identity routes only. Native business/session
//! routes still require their original opaque tokens. No service-account key,
//! client role claim or client-selected media URL is accepted.
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use axum::http::HeaderMap;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use ring::signature::{RsaPublicKeyComponents, RSA_PKCS1_2048_8192_SHA256};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgConnection, Row};
use tokio::sync::Mutex;

use crate::{
    auth::{self, Principal},
    error::ApiError,
    AppState,
};

const KEYS_URL: &str =
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const MAX_TOKEN: usize = 8192;

#[derive(Clone, Deserialize)]
struct Jwk {
    kid: String,
    kty: String,
    alg: String,
    n: String,
    e: String,
}
struct Keys {
    entries: HashMap<String, Jwk>,
    expires: Instant,
    refreshed: Option<Instant>,
}

pub struct FirebaseIdentity {
    project: String,
    api_key: String,
    http: reqwest::Client,
    keys: Mutex<Keys>,
}

#[derive(Deserialize)]
struct Header {
    alg: String,
    kid: String,
}
#[derive(Clone, Deserialize)]
struct Claims {
    aud: String,
    iss: String,
    sub: String,
    exp: i64,
    iat: i64,
    auth_time: i64,
}

fn denied() -> ApiError {
    ApiError::unauthenticated()
}
fn unavailable() -> ApiError {
    ApiError::unavailable("ระบบตรวจสอบการเข้าสู่ระบบไม่พร้อม")
}

fn token(headers: &HeaderMap) -> Result<&str, ApiError> {
    let mut values = headers.get_all(axum::http::header::AUTHORIZATION).iter();
    let value = values.next().ok_or_else(denied)?;
    if values.next().is_some() {
        return Err(denied());
    }
    let token = value
        .to_str()
        .map_err(|_| denied())?
        .strip_prefix("Bearer ")
        .ok_or_else(denied)?;
    if token.is_empty() || token.len() > MAX_TOKEN {
        return Err(denied());
    }
    Ok(token)
}

fn parts(token: &str) -> Result<(Header, Claims, Vec<u8>, &str), ApiError> {
    let mut split = token.split('.');
    let header = split.next().ok_or_else(denied)?;
    let payload = split.next().ok_or_else(denied)?;
    let signature = split.next().ok_or_else(denied)?;
    if split.next().is_some() {
        return Err(denied());
    }
    let decode = |v| URL_SAFE_NO_PAD.decode(v).map_err(|_| denied());
    let h: Header = serde_json::from_slice(&decode(header)?).map_err(|_| denied())?;
    let c: Claims = serde_json::from_slice(&decode(payload)?).map_err(|_| denied())?;
    if h.alg != "RS256" || h.kid.is_empty() || h.kid.len() > 128 {
        return Err(denied());
    }
    let signed = token.rsplit_once('.').ok_or_else(denied)?.0;
    Ok((h, c, decode(signature)?, signed))
}

fn check_claims(claims: &Claims, project: &str, now: i64) -> Result<(), ApiError> {
    if claims.aud != project
        || claims.iss != format!("https://securetoken.google.com/{project}")
        || claims.sub.is_empty()
        || claims.sub.len() > 128
        || !claims
            .sub
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || claims.exp <= now
        || claims.iat > now
        || claims.auth_time > now
        || claims.iat < 0
        || claims.auth_time < 0
        || claims.exp <= claims.iat
    {
        return Err(denied());
    }
    Ok(())
}

fn verify_signature(jwk: &Jwk, signature: &[u8], signed: &str) -> Result<(), ApiError> {
    if jwk.kty != "RSA" || jwk.alg != "RS256" {
        return Err(denied());
    }
    let n = URL_SAFE_NO_PAD.decode(&jwk.n).map_err(|_| denied())?;
    let e = URL_SAFE_NO_PAD.decode(&jwk.e).map_err(|_| denied())?;
    RsaPublicKeyComponents { n: &n, e: &e }
        .verify(&RSA_PKCS1_2048_8192_SHA256, signed.as_bytes(), signature)
        .map_err(|_| denied())
}

impl FirebaseIdentity {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        if std::env::var("FIREBASE_IDENTITY_ENABLED").as_deref() != Ok("true") {
            return Ok(None);
        }
        let project = std::env::var("FIREBASE_PROJECT_ID").unwrap_or_default();
        let api_key = std::env::var("FIREBASE_WEB_API_KEY").unwrap_or_default();
        anyhow::ensure!(
            !project.is_empty()
                && project
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-'),
            "FIREBASE_PROJECT_ID required"
        );
        anyhow::ensure!(!api_key.is_empty(), "FIREBASE_WEB_API_KEY required");
        Ok(Some(Self {
            project,
            api_key,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            keys: Mutex::new(Keys {
                entries: HashMap::new(),
                expires: Instant::now(),
                refreshed: None,
            }),
        }))
    }

    async fn verify(&self, token: &str, refresh: bool) -> Result<Claims, ApiError> {
        let (header, claims, signature, signed) = parts(token)?;
        check_claims(&claims, &self.project, Utc::now().timestamp())?;
        let mut keys = self.keys.lock().await;
        if keys.expires <= Instant::now() || !keys.entries.contains_key(&header.kid) {
            // A lock-phase recheck never fetches external data while holding a
            // database transaction. Unknown keys cannot trigger a fetch storm.
            if !refresh
                || keys
                    .refreshed
                    .is_some_and(|t| t.elapsed() < Duration::from_secs(60))
            {
                return Err(denied());
            }
            keys.refreshed = Some(Instant::now());
            let response = self
                .http
                .get(KEYS_URL)
                .send()
                .await
                .map_err(|_| unavailable())?;
            if !response.status().is_success() {
                return Err(unavailable());
            }
            let max_age = response
                .headers()
                .get("cache-control")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| {
                    v.split(',')
                        .map(str::trim)
                        .find_map(|p| p.strip_prefix("max-age=")?.parse::<u64>().ok())
                })
                .unwrap_or(300)
                .clamp(60, 3600);
            let body = response.bytes().await.map_err(|_| unavailable())?;
            if body.len() > 65536 {
                return Err(unavailable());
            }
            #[derive(Deserialize)]
            struct Response {
                keys: Vec<Jwk>,
            }
            let response: Response = serde_json::from_slice(&body).map_err(|_| unavailable())?;
            keys.entries = response
                .keys
                .into_iter()
                .map(|k| (k.kid.clone(), k))
                .collect();
            keys.expires = Instant::now() + Duration::from_secs(max_age);
        }
        let key = keys.entries.get(&header.kid).ok_or_else(denied)?;
        verify_signature(key, &signature, signed)?;
        Ok(claims)
    }

    async fn lookup(&self, token: &str, claims: &Claims) -> Result<String, ApiError> {
        // Fresh server-side disabled/revoked/email checks on every request.
        let response = self
            .http
            .post("https://identitytoolkit.googleapis.com/v1/accounts:lookup")
            .query(&[("key", &self.api_key)])
            .json(&json!({"idToken":token}))
            .send()
            .await
            .map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(if response.status().is_client_error() {
                denied()
            } else {
                unavailable()
            });
        }
        let body = response.bytes().await.map_err(|_| unavailable())?;
        if body.len() > 65536 {
            return Err(unavailable());
        }
        let data: Value = serde_json::from_slice(&body).map_err(|_| unavailable())?;
        let users = data["users"]
            .as_array()
            .filter(|v| v.len() == 1)
            .ok_or_else(denied)?;
        let user = &users[0];
        let valid_since = user["validSince"]
            .as_str()
            .and_then(|v| v.parse::<i64>().ok())
            .ok_or_else(denied)?;
        if user["localId"].as_str() != Some(claims.sub.as_str())
            || user["disabled"] == true
            || user["emailVerified"] != true
            || claims.auth_time < valid_since
        {
            return Err(denied());
        }
        let email = user["email"]
            .as_str()
            .ok_or_else(denied)?
            .to_ascii_lowercase();
        auth::require_business_identity(Principal {
            uid: claims.sub.clone(),
            email: email.clone(),
            email_verified: true,
            role: "user".into(),
        })?;
        Ok(email)
    }

    /// Identity for a one-time session exchange: a signed, unrevoked Firebase
    /// ID token for an enabled user. Unlike business routes this accepts an
    /// unverified email so the person can finish verification natively.
    pub(crate) async fn exchange_identity(
        &self,
        token: &str,
    ) -> Result<(String, String, bool), ApiError> {
        if token.is_empty() || token.len() > MAX_TOKEN {
            return Err(denied());
        }
        let claims = self.verify(token, true).await?;
        let response = self
            .http
            .post("https://identitytoolkit.googleapis.com/v1/accounts:lookup")
            .query(&[("key", &self.api_key)])
            .json(&json!({"idToken":token}))
            .send()
            .await
            .map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(if response.status().is_client_error() {
                denied()
            } else {
                unavailable()
            });
        }
        let body = response.bytes().await.map_err(|_| unavailable())?;
        if body.len() > 65536 {
            return Err(unavailable());
        }
        let data: Value = serde_json::from_slice(&body).map_err(|_| unavailable())?;
        let user = data["users"]
            .as_array()
            .filter(|v| v.len() == 1)
            .map(|v| &v[0])
            .ok_or_else(denied)?;
        let valid_since = user["validSince"]
            .as_str()
            .and_then(|v| v.parse::<i64>().ok())
            .ok_or_else(denied)?;
        if user["localId"].as_str() != Some(claims.sub.as_str())
            || user["disabled"] == true
            || claims.auth_time < valid_since
        {
            return Err(denied());
        }
        let email = user["email"]
            .as_str()
            .filter(|e| !e.is_empty() && e.len() <= 254)
            .ok_or_else(denied)?
            .to_ascii_lowercase();
        Ok((claims.sub, email, user["emailVerified"] == true))
    }

    /// Verifies a legacy Firebase password once. `Ok(Some(uid))` only for the
    /// exact credentials; wrong passwords and unknown users are `Ok(None)`.
    pub(crate) async fn check_legacy_password(
        &self,
        email: &str,
        password: &str,
    ) -> Result<Option<String>, ApiError> {
        let response = self
            .http
            .post("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword")
            .query(&[("key", &self.api_key)])
            .json(&json!({"email":email,"password":password,"returnSecureToken":false}))
            .send()
            .await
            .map_err(|_| unavailable())?;
        let status = response.status();
        let body = response.bytes().await.map_err(|_| unavailable())?;
        if body.len() > 65536 {
            return Err(unavailable());
        }
        let data: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        if status.is_success() {
            return Ok(data["localId"]
                .as_str()
                .filter(|id| !id.is_empty() && id.len() <= 128)
                .map(str::to_owned));
        }
        let reason = data["error"]["message"].as_str().unwrap_or_default();
        if reason.starts_with("TOO_MANY_ATTEMPTS") {
            return Err(ApiError::new(
                "resource-exhausted",
                "มีการพยายามเข้าสู่ระบบผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่",
            ));
        }
        if status.is_client_error() {
            return Ok(None);
        }
        Err(unavailable())
    }

    async fn profile(&self, token: &str, uid: &str) -> Result<String, ApiError> {
        // Uses the caller's token and existing Firestore rules, not privileged
        // service credentials. This reads only their own primary photo field.
        let url = format!("https://firestore.googleapis.com/v1/projects/{}/databases/(default)/documents/users/{}", self.project, uid);
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(denied());
        }
        let bytes = response.bytes().await.map_err(|_| unavailable())?;
        if bytes.len() > 131072 {
            return Err(unavailable());
        }
        let data: Value = serde_json::from_slice(&bytes).map_err(|_| unavailable())?;
        let fields = &data["fields"];
        if fields["isBanned"]["booleanValue"] == true
            || fields["isSuspended"]["booleanValue"] == true
            || fields["isDeleted"]["booleanValue"] == true
        {
            return Err(denied());
        }
        Ok(fields["avatarUri"]["stringValue"]
            .as_str()
            .filter(|s| s.len() <= 2048)
            .unwrap_or("")
            .to_owned())
    }

    async fn authenticate(&self, state: &AppState, raw_token: &str) -> Result<Principal, ApiError> {
        let claims = self.verify(raw_token, true).await?;
        crate::throttle(&state.db, "firebase-identity", &claims.sub, 30).await?;
        let email = self.lookup(raw_token, &claims).await?;
        let avatar = self.profile(raw_token, &claims.sub).await?;
        let mut tx = state.db.begin().await?;
        // Native accounts with passwords are never taken over by this bridge.
        // Suspension/deletion and server roles remain database-authoritative.
        let row = sqlx::query(
            "INSERT INTO accounts(id,email,email_verified) VALUES($1,$2,true)
            ON CONFLICT(id) DO UPDATE SET email_verified=true
            WHERE accounts.email=excluded.email AND accounts.password_hash IS NULL
                AND NOT accounts.suspended AND accounts.deleted_at IS NULL
            RETURNING id,email,suspended,deleted_at",
        )
        .bind(&claims.sub)
        .bind(&email)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(denied)?;
        let _: String = row.try_get("id")?;
        // Copy no biography/contact data or client badge. A new primary photo
        // revokes the proof made for the old one.
        let changed = crate::identity::sync_primary_photo(&mut tx, &claims.sub, &avatar).await?;
        tx.commit().await?;
        if changed {
            if let Some(services) = state.identity.clone() {
                if crate::identity::purge_snapshots(
                    &state.db,
                    services.store.as_ref(),
                    Some(&claims.sub),
                )
                .await
                .is_err()
                {
                    tracing::warn!("verification snapshot purge deferred");
                }
            }
        }
        Ok(Principal {
            uid: claims.sub,
            email,
            email_verified: true,
            role: "user".into(),
        })
    }
}

pub async fn authenticate(state: &AppState, headers: &HeaderMap) -> Result<Principal, ApiError> {
    let raw = token(headers)?;
    if raw.contains('.') {
        let firebase = state.firebase_identity.as_ref().ok_or_else(denied)?;
        firebase.authenticate(state, raw).await
    } else {
        auth::authenticate(state, headers).await
    }
}

pub async fn lock_business_session(
    state: &AppState,
    connection: &mut PgConnection,
    headers: &HeaderMap,
    uid: &str,
) -> Result<Principal, ApiError> {
    let raw = token(headers)?;
    if !raw.contains('.') {
        return auth::lock_business_session(connection, headers, uid).await;
    }
    // Recheck the signature using already-fetched keys and the database state.
    // Never perform network I/O while the caller holds transaction locks.
    let firebase = state.firebase_identity.as_ref().ok_or_else(denied)?;
    let claims = firebase.verify(raw, false).await?;
    if claims.sub != uid || claims.exp <= Utc::now().timestamp() {
        return Err(denied());
    }
    let row = sqlx::query(
        "SELECT id,email,email_verified FROM accounts WHERE id=$1 AND password_hash IS NULL
        AND NOT suspended AND deleted_at IS NULL FOR SHARE",
    )
    .bind(uid)
    .fetch_optional(connection)
    .await?
    .ok_or_else(denied)?;
    auth::require_business_identity(Principal {
        uid: uid.into(),
        email: row.try_get("email")?,
        email_verified: row.try_get("email_verified")?,
        role: "user".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn claims() -> Claims {
        Claims {
            aud: "campusmate-7f1ab".into(),
            iss: "https://securetoken.google.com/campusmate-7f1ab".into(),
            sub: "firebase_uid".into(),
            exp: 2000,
            iat: 1000,
            auth_time: 900,
        }
    }
    #[test]
    fn issuer_audience_and_time_are_required() {
        let c = claims();
        assert!(check_claims(&c, "campusmate-7f1ab", 1500).is_ok());
        assert!(check_claims(&c, "another-project", 1500).is_err());
        assert!(check_claims(&c, "campusmate-7f1ab", 2000).is_err());
        assert!(check_claims(&c, "campusmate-7f1ab", 999).is_err());
        let mut wrong = c.clone();
        wrong.iss = "https://evil.example".into();
        assert!(check_claims(&wrong, "campusmate-7f1ab", 1500).is_err());
        wrong = c;
        wrong.sub = "../other".into();
        assert!(check_claims(&wrong, "campusmate-7f1ab", 1500).is_err());
    }
    #[test]
    fn reject_unsigned_duplicate_and_unbounded_tokens() {
        let raw = format!(
            "{}.{}.fake",
            URL_SAFE_NO_PAD.encode(br#"{"alg":"none","kid":"test"}"#),
            URL_SAFE_NO_PAD.encode(
                br#"{"aud":"x","iss":"x","sub":"x","exp":2000,"iat":1000,"auth_time":900}"#
            )
        );
        assert!(parts(&raw).is_err());
        let mut headers = HeaderMap::new();
        headers.append("authorization", "Bearer token".parse().unwrap());
        headers.append("authorization", "Bearer second".parse().unwrap());
        assert!(token(&headers).is_err());
        headers.clear();
        headers.insert(
            "authorization",
            format!("Bearer {}", "a".repeat(MAX_TOKEN + 1))
                .parse()
                .unwrap(),
        );
        assert!(token(&headers).is_err());
    }
    #[test]
    fn valid_signature_and_tampering_are_checked_with_a_synthetic_key() {
        let fixture: Value =
            serde_json::from_str(include_str!("../tests/fixtures/firebase-rs256.json")).unwrap();
        let jwk: Jwk = serde_json::from_value(fixture["key"].clone()).unwrap();
        let (_, claims, mut signature, signed) = parts(fixture["token"].as_str().unwrap()).unwrap();
        assert!(verify_signature(&jwk, &signature, signed).is_ok());
        assert!(check_claims(&claims, "campusmate-7f1ab", 1500).is_ok());
        signature[0] ^= 1;
        assert!(verify_signature(&jwk, &signature, signed).is_err());
        assert!(verify_signature(
            &jwk,
            &URL_SAFE_NO_PAD
                .decode(
                    fixture["token"]
                        .as_str()
                        .unwrap()
                        .rsplit('.')
                        .next()
                        .unwrap()
                )
                .unwrap(),
            "modified.payload"
        )
        .is_err());
    }
    #[test]
    fn invalid_rsa_signature_is_rejected() {
        let key = Jwk {
            kid: "test".into(),
            kty: "RSA".into(),
            alg: "RS256".into(),
            n: URL_SAFE_NO_PAD.encode([255u8; 256]),
            e: "AQAB".into(),
        };
        assert!(verify_signature(&key, &[0u8; 256], "header.payload").is_err());
    }
}
