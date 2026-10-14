//! Stateless page cursors: HMAC-SHA256 signed, bound to the uid and the
//! filter scope, expiring after 15 minutes. Replaces the per-page Firestore
//! cursor document the Node callable writes.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::error::ApiError;

type HmacSha256 = Hmac<Sha256>;
pub const CURSOR_TTL_MS: i64 = 15 * 60 * 1000;
const PREFIX: &str = "m1";

/// Position in the ranked list: (score desc, tie desc, id asc).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RankKey {
    pub score: u8,
    pub tie: String,
    pub id: String,
}

#[derive(Serialize, Deserialize)]
struct Payload {
    u: String,
    s: String,
    k: RankKey,
    e: i64,
}

pub struct CursorSigner {
    secret: Vec<u8>,
}

impl CursorSigner {
    pub fn new(secret: Vec<u8>) -> Self {
        Self { secret }
    }

    fn mac(&self) -> HmacSha256 {
        HmacSha256::new_from_slice(&self.secret).expect("HMAC accepts any key length")
    }

    pub fn sign(&self, uid: &str, scope: &str, key: RankKey, now_ms: i64) -> String {
        let payload = serde_json::to_vec(&Payload {
            u: uid.into(),
            s: scope.into(),
            k: key,
            e: now_ms + CURSOR_TTL_MS,
        })
        .expect("serializable");
        let body = URL_SAFE_NO_PAD.encode(payload);
        let signature = URL_SAFE_NO_PAD.encode(
            self.mac()
                .chain_update(PREFIX)
                .chain_update(".")
                .chain_update(&body)
                .finalize()
                .into_bytes(),
        );
        format!("{PREFIX}.{body}.{signature}")
    }

    pub fn verify(
        &self,
        cursor: &str,
        uid: &str,
        scope: &str,
        now_ms: i64,
    ) -> Result<RankKey, ApiError> {
        let invalid = || ApiError::invalid("หน้ารายการไม่ถูกต้อง");
        if cursor.len() > 1024 {
            return Err(invalid());
        }
        let mut parts = cursor.split('.');
        let (Some(PREFIX), Some(body), Some(signature), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return Err(invalid());
        };
        let signature = URL_SAFE_NO_PAD.decode(signature).map_err(|_| invalid())?;
        // `verify_slice` compares in constant time.
        self.mac()
            .chain_update(PREFIX)
            .chain_update(".")
            .chain_update(body)
            .verify_slice(&signature)
            .map_err(|_| invalid())?;
        let payload: Payload =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(body).map_err(|_| invalid())?)
                .map_err(|_| invalid())?;
        if payload.u != uid || payload.s != scope || payload.e <= now_ms {
            return Err(ApiError::invalid("หน้ารายการหมดอายุ กรุณาโหลดใหม่"));
        }
        Ok(payload.k)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_tamper() {
        let signer = CursorSigner::new(b"0123456789abcdef0123456789abcdef".to_vec());
        let key = RankKey {
            score: 77,
            tie: "123".into(),
            id: "u2".into(),
        };
        let cursor = signer.sign("u1", "scope", key.clone(), 1000);
        assert_eq!(signer.verify(&cursor, "u1", "scope", 2000).unwrap(), key);
        assert!(signer.verify(&cursor, "other", "scope", 2000).is_err());
        assert!(signer.verify(&cursor, "u1", "changed", 2000).is_err());
        assert!(signer
            .verify(&cursor, "u1", "scope", 1000 + CURSOR_TTL_MS)
            .is_err());
        let mut tampered = cursor.clone();
        tampered.replace_range(5..6, if &cursor[5..6] == "A" { "B" } else { "A" });
        assert!(signer.verify(&tampered, "u1", "scope", 2000).is_err());
    }
}
