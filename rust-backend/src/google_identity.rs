//! Google Sign-In ID tokens (OIDC) for native sessions. The audience must be
//! one of this app's OAuth client IDs; the token itself is never stored.
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use ring::signature::{RsaPublicKeyComponents, RSA_PKCS1_2048_8192_SHA256};
use serde::Deserialize;
use tokio::sync::Mutex;

use crate::error::ApiError;

const KEYS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const MAX_TOKEN: usize = 8192;

#[derive(Clone, Deserialize)]
struct Jwk {
    kid: String,
    kty: String,
    #[serde(default)]
    alg: Option<String>,
    n: String,
    e: String,
}
#[derive(Deserialize)]
struct Header {
    alg: String,
    kid: String,
}
#[derive(Clone, Deserialize)]
pub struct GoogleClaims {
    pub iss: String,
    pub aud: String,
    pub sub: String,
    pub exp: i64,
    pub iat: i64,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub email_verified: bool,
    #[serde(default)]
    pub hd: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

struct Keys {
    entries: HashMap<String, Jwk>,
    expires: Instant,
    refreshed: Option<Instant>,
}

pub struct GoogleIdentity {
    audiences: Vec<String>,
    http: reqwest::Client,
    keys: Mutex<Keys>,
}

fn denied() -> ApiError {
    ApiError::unauthenticated()
}
fn unavailable() -> ApiError {
    ApiError::unavailable("ระบบเข้าสู่ระบบด้วย Google ไม่พร้อม")
}

fn split(token: &str) -> Result<(Header, GoogleClaims, Vec<u8>, &str), ApiError> {
    if token.is_empty() || token.len() > MAX_TOKEN {
        return Err(denied());
    }
    let mut parts = token.split('.');
    let (Some(header), Some(payload), Some(signature), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(denied());
    };
    let decode = |v: &str| URL_SAFE_NO_PAD.decode(v).map_err(|_| denied());
    let header: Header = serde_json::from_slice(&decode(header)?).map_err(|_| denied())?;
    let claims: GoogleClaims = serde_json::from_slice(&decode(payload)?).map_err(|_| denied())?;
    if header.alg != "RS256" || header.kid.is_empty() || header.kid.len() > 128 {
        return Err(denied());
    }
    let signed = token.rsplit_once('.').ok_or_else(denied)?.0;
    Ok((header, claims, decode(signature)?, signed))
}

pub fn check_claims(claims: &GoogleClaims, audiences: &[String], now: i64) -> Result<(), ApiError> {
    if !matches!(
        claims.iss.as_str(),
        "accounts.google.com" | "https://accounts.google.com"
    ) || !audiences.iter().any(|aud| aud == &claims.aud)
        || claims.sub.is_empty()
        || claims.sub.len() > 255
        || !claims.sub.bytes().all(|b| b.is_ascii_digit())
        || claims.exp <= now
        || claims.iat > now + 60
        || claims.exp <= claims.iat
        || !claims.email_verified
        || claims.email.is_empty()
    {
        return Err(denied());
    }
    Ok(())
}

impl GoogleIdentity {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let audiences: Vec<String> = std::env::var("GOOGLE_OAUTH_CLIENT_IDS")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_owned)
            .collect();
        if audiences.is_empty() {
            return Ok(None);
        }
        anyhow::ensure!(
            audiences.iter().all(|id| id.len() <= 200
                && id.ends_with(".apps.googleusercontent.com")
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')),
            "invalid GOOGLE_OAUTH_CLIENT_IDS"
        );
        Ok(Some(Self {
            audiences,
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

    pub async fn verify(&self, token: &str) -> Result<GoogleClaims, ApiError> {
        let (header, claims, signature, signed) = split(token)?;
        check_claims(&claims, &self.audiences, Utc::now().timestamp())?;
        let mut keys = self.keys.lock().await;
        if keys.expires <= Instant::now() || !keys.entries.contains_key(&header.kid) {
            if keys
                .refreshed
                .is_some_and(|t| t.elapsed() < Duration::from_secs(60))
                && keys.expires > Instant::now()
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
            struct Set {
                keys: Vec<Jwk>,
            }
            let set: Set = serde_json::from_slice(&body).map_err(|_| unavailable())?;
            keys.entries = set.keys.into_iter().map(|k| (k.kid.clone(), k)).collect();
            keys.expires = Instant::now() + Duration::from_secs(max_age);
        }
        let jwk = keys.entries.get(&header.kid).ok_or_else(denied)?;
        if jwk.kty != "RSA" || jwk.alg.as_deref().is_some_and(|alg| alg != "RS256") {
            return Err(denied());
        }
        let n = URL_SAFE_NO_PAD.decode(&jwk.n).map_err(|_| denied())?;
        let e = URL_SAFE_NO_PAD.decode(&jwk.e).map_err(|_| denied())?;
        RsaPublicKeyComponents { n: &n, e: &e }
            .verify(&RSA_PKCS1_2048_8192_SHA256, signed.as_bytes(), &signature)
            .map_err(|_| denied())?;
        Ok(claims)
    }
}

/// Google is authoritative for an address only on its own consumer domain or
/// on a Workspace domain it reports in `hd`. Other verified addresses are not
/// trusted to link an existing account.
pub fn authoritative_for_email(claims: &GoogleClaims) -> bool {
    let email = claims.email.to_ascii_lowercase();
    let Some((_, domain)) = email.rsplit_once('@') else {
        return false;
    };
    domain == "gmail.com"
        || claims
            .hd
            .as_deref()
            .is_some_and(|hd| hd.eq_ignore_ascii_case(domain))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims() -> GoogleClaims {
        GoogleClaims {
            iss: "https://accounts.google.com".into(),
            aud: "123-abc.apps.googleusercontent.com".into(),
            sub: "1234567890".into(),
            exp: 2_000,
            iat: 1_000,
            email: "6912345678@psu.ac.th".into(),
            email_verified: true,
            hd: Some("psu.ac.th".into()),
            name: None,
        }
    }

    #[test]
    fn audience_issuer_expiry_and_verified_email_are_required() {
        let audiences = vec!["123-abc.apps.googleusercontent.com".to_string()];
        assert!(check_claims(&claims(), &audiences, 1_500).is_ok());
        let mut wrong = claims();
        wrong.aud = "other.apps.googleusercontent.com".into();
        assert!(check_claims(&wrong, &audiences, 1_500).is_err());
        let mut issuer = claims();
        issuer.iss = "https://evil.example".into();
        assert!(check_claims(&issuer, &audiences, 1_500).is_err());
        assert!(check_claims(&claims(), &audiences, 2_000).is_err());
        let mut unverified = claims();
        unverified.email_verified = false;
        assert!(check_claims(&unverified, &audiences, 1_500).is_err());
    }

    #[test]
    fn linking_requires_google_to_own_the_domain() {
        assert!(authoritative_for_email(&claims()));
        let mut gmail = claims();
        gmail.email = "someone@gmail.com".into();
        gmail.hd = None;
        assert!(authoritative_for_email(&gmail));
        let mut other = claims();
        other.email = "someone@example.com".into();
        other.hd = None;
        assert!(!authoritative_for_email(&other));
        other.hd = Some("psu.ac.th".into());
        assert!(!authoritative_for_email(&other));
    }
}
