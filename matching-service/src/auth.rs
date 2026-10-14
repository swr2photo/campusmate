//! Firebase ID token (and optional App Check token) verification against
//! Google's published JWKS. Mirrors what callable functions check: RS256,
//! known key id, audience = project, issuer = securetoken, unexpired.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use parking_lot::RwLock;
use serde::Deserialize;

use crate::error::ApiError;

const ID_TOKEN_JWKS: &str = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const APP_CHECK_JWKS: &str = "https://firebaseappcheck.googleapis.com/v1/jwks";
const LEEWAY_SECS: u64 = 30;
const MIN_FORCED_REFRESH: Duration = Duration::from_secs(60);

#[derive(Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Deserialize)]
struct Jwk {
    kid: String,
    kty: String,
    n: String,
    e: String,
}

struct Cached {
    keys: HashMap<String, DecodingKey>,
    expires_at: Instant,
    fetched_at: Option<Instant>,
}

pub struct JwksCache {
    url: &'static str,
    http: reqwest::Client,
    cached: RwLock<Cached>,
    refresh: tokio::sync::Mutex<()>,
}

fn max_age(headers: &reqwest::header::HeaderMap) -> Duration {
    headers
        .get(reqwest::header::CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').find_map(|part| part.trim().strip_prefix("max-age=")?.parse::<u64>().ok()))
        .map_or(Duration::from_secs(3600), |secs| Duration::from_secs(secs.clamp(60, 6 * 3600)))
}

impl JwksCache {
    pub fn new(url: &'static str, http: reqwest::Client) -> Self {
        Self { url, http, cached: RwLock::new(Cached { keys: HashMap::new(), expires_at: Instant::now(), fetched_at: None }), refresh: tokio::sync::Mutex::new(()) }
    }

    fn lookup(&self, kid: &str) -> Option<DecodingKey> {
        let cached = self.cached.read();
        (Instant::now() < cached.expires_at).then(|| cached.keys.get(kid).cloned()).flatten()
    }

    async fn key(&self, kid: &str) -> Result<DecodingKey, ApiError> {
        if let Some(key) = self.lookup(kid) {
            return Ok(key);
        }
        let _guard = self.refresh.lock().await;
        if let Some(key) = self.lookup(kid) {
            return Ok(key);
        }
        {
            // Unknown kids can be attacker-chosen: refetch at most once a minute.
            let cached = self.cached.read();
            let fresh = Instant::now() < cached.expires_at;
            if fresh && cached.fetched_at.is_some_and(|at| at.elapsed() < MIN_FORCED_REFRESH) {
                return Err(ApiError::unauthenticated());
            }
        }
        let response = self.http.get(self.url).send().await.and_then(|r| r.error_for_status()).map_err(|error| {
            tracing::error!(%error, url = self.url, "jwks fetch failed");
            ApiError::unavailable("ระบบยืนยันตัวตนไม่พร้อมใช้งาน")
        })?;
        let ttl = max_age(response.headers());
        let jwks: Jwks = response.json().await.map_err(|_| ApiError::unavailable("ระบบยืนยันตัวตนไม่พร้อมใช้งาน"))?;
        let keys: HashMap<String, DecodingKey> = jwks
            .keys
            .into_iter()
            .filter(|jwk| jwk.kty == "RSA")
            .filter_map(|jwk| Some((jwk.kid, DecodingKey::from_rsa_components(&jwk.n, &jwk.e).ok()?)))
            .collect();
        let key = keys.get(kid).cloned();
        *self.cached.write() = Cached { keys, expires_at: Instant::now() + ttl, fetched_at: Some(Instant::now()) };
        key.ok_or_else(ApiError::unauthenticated)
    }
}

#[derive(Deserialize)]
struct IdClaims {
    sub: String,
    iat: u64,
    auth_time: Option<u64>,
}

#[derive(Deserialize)]
struct AppCheckClaims {
    #[allow(dead_code)]
    sub: String,
}

pub struct Verifier {
    project_id: String,
    app_check_project_number: Option<String>,
    id_keys: JwksCache,
    app_check_keys: JwksCache,
}

pub fn valid_uid(uid: &str) -> bool {
    !uid.is_empty() && uid.len() <= 128 && uid.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

impl Verifier {
    pub fn new(project_id: String, app_check_project_number: Option<String>, http: reqwest::Client) -> Self {
        Self {
            project_id,
            app_check_project_number,
            id_keys: JwksCache::new(ID_TOKEN_JWKS, http.clone()),
            app_check_keys: JwksCache::new(APP_CHECK_JWKS, http),
        }
    }

    /// Returns the Firebase uid for a valid ID token.
    pub async fn verify_id_token(&self, token: &str) -> Result<String, ApiError> {
        let header = decode_header(token).map_err(|_| ApiError::unauthenticated())?;
        let kid = header.kid.filter(|_| header.alg == Algorithm::RS256).ok_or_else(ApiError::unauthenticated)?;
        let key = self.id_keys.key(&kid).await?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.leeway = LEEWAY_SECS;
        validation.set_audience(&[&self.project_id]);
        validation.set_issuer(&[format!("https://securetoken.google.com/{}", self.project_id)]);
        validation.set_required_spec_claims(&["exp", "iat", "aud", "iss", "sub"]);
        let claims = decode::<IdClaims>(token, &key, &validation).map_err(|_| ApiError::unauthenticated())?.claims;
        let now = now_secs() + LEEWAY_SECS;
        if claims.iat > now || claims.auth_time.is_some_and(|at| at > now) || !valid_uid(&claims.sub) {
            return Err(ApiError::unauthenticated());
        }
        Ok(claims.sub)
    }

    /// Enforced only when APP_CHECK_PROJECT_NUMBER is configured.
    pub async fn verify_app_check(&self, token: Option<&str>) -> Result<(), ApiError> {
        let Some(number) = &self.app_check_project_number else { return Ok(()) };
        let denied = || ApiError::new("unauthenticated", "แอปไม่ผ่านการตรวจสอบ");
        let token = token.ok_or_else(denied)?;
        let header = decode_header(token).map_err(|_| denied())?;
        let kid = header.kid.filter(|_| header.alg == Algorithm::RS256).ok_or_else(denied)?;
        let key = self.app_check_keys.key(&kid).await.map_err(|_| denied())?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.leeway = LEEWAY_SECS;
        validation.set_audience(&[format!("projects/{number}"), format!("projects/{}", self.project_id)]);
        validation.set_issuer(&[format!("https://firebaseappcheck.googleapis.com/{number}")]);
        decode::<AppCheckClaims>(token, &key, &validation).map_err(|_| denied())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uid_shape() {
        assert!(valid_uid("aZ09_-"));
        assert!(!valid_uid(""));
        assert!(!valid_uid("../users"));
        assert!(!valid_uid(&"a".repeat(129)));
    }

    #[test]
    fn cache_control_parsing() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(reqwest::header::CACHE_CONTROL, "public, max-age=19302, must-revalidate".parse().unwrap());
        assert_eq!(max_age(&headers), Duration::from_secs(19302.min(6 * 3600)));
    }
}
