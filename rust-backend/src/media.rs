//! Profile photos, gallery images, image moderation and chat-media upload
//! tickets. Profile images are re-encoded on the server (EXIF/GPS removed,
//! bounded size) after moderation; chat media is client-encrypted and goes to
//! object storage directly with a short-lived, room-scoped ticket.
use std::{sync::Arc, time::Duration};

use aws_sdk_s3::{presigning::PresigningConfig, primitives::ByteStream};
use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::{auth, error::ApiError, AppState};

pub const MAX_IMAGE_BYTES: usize = 6 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;
const PROFILE_EDGE: u32 = 1080;
/// Images decoded and re-encoded at once, and how long a request waits for
/// a turn before it is told to retry.
const IMAGE_JOBS: usize = 4;
const IMAGE_QUEUE_WAIT: std::time::Duration = std::time::Duration::from_secs(10);
const CHAT_MAX_BYTES: u64 = 25 * 1024 * 1024;

pub struct MediaServices {
    profile: aws_sdk_s3::Client,
    profile_bucket: String,
    profile_origin: String,
    chat: Option<ChatStore>,
    worker: Option<(String, String)>,
    moderation: Option<aws_sdk_rekognition::Client>,
    jobs: Arc<Semaphore>,
}

struct ChatStore {
    client: aws_sdk_s3::Client,
    bucket: String,
    origin: String,
}

fn https_origin(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none()
    }) && !value.ends_with('/')
}

fn s3(endpoint: &str, key: String, secret: String) -> aws_sdk_s3::Client {
    use aws_sdk_s3::config::{
        BehaviorVersion, Builder, Credentials, Region, RequestChecksumCalculation,
        ResponseChecksumValidation,
    };
    aws_sdk_s3::Client::from_conf(
        Builder::new()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new("auto"))
            .endpoint_url(endpoint)
            .credentials_provider(Credentials::new(key, secret, None, None, "r2"))
            .force_path_style(true)
            .request_checksum_calculation(RequestChecksumCalculation::WhenRequired)
            .response_checksum_validation(ResponseChecksumValidation::WhenRequired)
            .build(),
    )
}

impl MediaServices {
    pub async fn from_env() -> anyhow::Result<Option<Self>> {
        let var = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
        let (Some(endpoint), Some(key), Some(secret), Some(bucket), Some(origin)) = (
            var("R2_ENDPOINT"),
            var("R2_MEDIA_ACCESS_KEY_ID"),
            var("R2_MEDIA_SECRET_ACCESS_KEY"),
            var("R2_MEDIA_BUCKET"),
            var("PROFILE_MEDIA_ORIGIN"),
        ) else {
            return Ok(None);
        };
        anyhow::ensure!(
            https_origin(&origin),
            "PROFILE_MEDIA_ORIGIN must be an https origin"
        );
        let chat = match (
            var("R2_CHAT_ACCESS_KEY_ID"),
            var("R2_CHAT_SECRET_ACCESS_KEY"),
            var("R2_CHAT_BUCKET"),
            var("CHAT_MEDIA_ORIGIN"),
        ) {
            (Some(key), Some(secret), Some(bucket), Some(origin)) => {
                anyhow::ensure!(
                    https_origin(&origin),
                    "CHAT_MEDIA_ORIGIN must be an https origin"
                );
                anyhow::ensure!(
                    !origin.contains(".r2.cloudflarestorage.com"),
                    "CHAT_MEDIA_ORIGIN must be a public delivery host"
                );
                Some(ChatStore {
                    client: s3(&endpoint, key, secret),
                    bucket,
                    origin,
                })
            }
            _ => None,
        };
        let worker = match (var("R2_WORKER_ORIGIN"), var("R2_UPLOAD_SIGNING_KEY")) {
            (Some(origin), Some(secret)) => {
                anyhow::ensure!(
                    https_origin(&origin),
                    "R2_WORKER_ORIGIN must be an https origin"
                );
                anyhow::ensure!(secret.trim().len() >= 32, "R2_UPLOAD_SIGNING_KEY too short");
                Some((origin, secret.trim().to_owned()))
            }
            _ => None,
        };
        let moderation = match var("MODERATION_REGION") {
            Some(region) => {
                let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
                    .region(aws_config::Region::new(region))
                    .load()
                    .await;
                Some(aws_sdk_rekognition::Client::new(&config))
            }
            None => None,
        };
        Ok(Some(Self {
            profile: s3(&endpoint, key, secret),
            profile_bucket: bucket,
            profile_origin: origin,
            chat,
            worker,
            moderation,
            jobs: Arc::new(Semaphore::new(IMAGE_JOBS)),
        }))
    }
}

fn services(state: &AppState) -> Result<Arc<MediaServices>, ApiError> {
    state
        .media
        .clone()
        .ok_or_else(|| ApiError::unavailable("ระบบรูปภาพยังไม่พร้อม"))
}

/// Moderation result in the legacy `checkImageSafety` shape (policy v2).
pub fn evaluate_labels(labels: &[(String, String, f32)]) -> Value {
    for (name, parent, confidence) in labels {
        if (parent == "Explicit Nudity" || name == "Explicit Nudity") && *confidence >= 60.0 {
            return json!({"isSafe":false,"status":"blocked","reason":"adult","policyVersion":2,
                "message":"ระบบประเมินว่าภาพนี้อาจมีเนื้อหาโป๊เปลือย จึงยังใช้ภาพนี้ไม่ได้"});
        }
        if (parent == "Violence" || name == "Violence") && name != "Weapons" && *confidence >= 65.0
        {
            return json!({"isSafe":false,"status":"blocked","reason":"violence","policyVersion":2,
                "message":"ระบบประเมินว่าภาพนี้อาจมีเนื้อหาความรุนแรง จึงยังใช้ภาพนี้ไม่ได้"});
        }
    }
    json!({"isSafe":true,"status":"allowed","reason":null,"policyVersion":2,"detectedLabelsCount":labels.len()})
}

async fn moderate(services: &MediaServices, jpeg: &[u8]) -> Value {
    let Some(client) = &services.moderation else {
        return json!({"isSafe":null,"status":"unavailable","policyVersion":2,"moderationSkipped":true,
            "warning":"ไม่สามารถเชื่อมต่อระบบสแกนรูปภาพได้ในขณะนี้"});
    };
    use aws_sdk_rekognition::{primitives::Blob, types::Image};
    let result = client
        .detect_moderation_labels()
        .image(Image::builder().bytes(Blob::new(jpeg.to_vec())).build())
        .min_confidence(50.0)
        .send()
        .await;
    match result {
        Ok(output) => {
            let labels: Vec<(String, String, f32)> = output
                .moderation_labels()
                .iter()
                .map(|label| {
                    (
                        label.name().unwrap_or_default().to_owned(),
                        label.parent_name().unwrap_or_default().to_owned(),
                        label.confidence().unwrap_or_default(),
                    )
                })
                .collect();
            evaluate_labels(&labels)
        }
        Err(_) => {
            tracing::warn!("image moderation unavailable");
            json!({"isSafe":null,"status":"unavailable","policyVersion":2,"moderationSkipped":true,
                "warning":"ไม่สามารถเชื่อมต่อระบบสแกนรูปภาพได้ในขณะนี้"})
        }
    }
}

/// Decodes any supported still image with pixel limits, fixes orientation is
/// not attempted (clients upload upright JPEGs), resizes and re-encodes JPEG.
/// Re-encoding drops EXIF including GPS.
pub fn normalize_image(bytes: &[u8], edge: u32) -> Result<Vec<u8>, ApiError> {
    let bad = || ApiError::invalid("อ่านรูปภาพไม่ได้ รองรับ JPEG, PNG หรือ WebP ขนาดไม่เกิน 6 MB");
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(bad());
    }
    let format = image::guess_format(bytes).map_err(|_| bad())?;
    if !matches!(
        format,
        image::ImageFormat::Jpeg | image::ImageFormat::Png | image::ImageFormat::WebP
    ) {
        return Err(bad());
    }
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let (width, height) = reader.into_dimensions().map_err(|_| bad())?;
    if u64::from(width) * u64::from(height) > MAX_PIXELS || width == 0 || height == 0 {
        return Err(bad());
    }
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|_| bad())?;
    let resized = if width.max(height) > edge {
        decoded.resize(edge, edge, image::imageops::FilterType::Triangle)
    } else {
        decoded
    };
    let rgb = resized.to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
        .encode_image(&rgb)
        .map_err(|_| ApiError::internal())?;
    Ok(out)
}

async fn prepared(services: &MediaServices, body: Bytes) -> Result<Vec<u8>, ApiError> {
    // A short queue rather than an instant refusal: one person saving several
    // photos at once is normal; only a sustained backlog is turned away.
    let busy = || ApiError::unavailable("ระบบรูปภาพกำลังทำงานหนัก กรุณาลองใหม่");
    let permit = tokio::time::timeout(IMAGE_QUEUE_WAIT, services.jobs.clone().acquire_owned())
        .await
        .map_err(|_| busy())?
        .map_err(|_| busy())?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        normalize_image(&body, PROFILE_EDGE)
    })
    .await
    .map_err(|_| ApiError::internal())?
}

fn require_allowed(result: &Value) -> Result<(), ApiError> {
    if result["status"] == "blocked" {
        let mut error = ApiError::new(
            "failed-precondition",
            result["message"]
                .as_str()
                .unwrap_or("ภาพนี้ยังไม่ผ่านเกณฑ์การใช้งาน"),
        );
        error.details = Some(json!({"moderationStatus":"blocked","reason":result["reason"]}));
        return Err(error);
    }
    if result["status"] != "allowed" {
        let mut error = ApiError::unavailable("ยังตรวจสอบภาพไม่ได้ในขณะนี้ กรุณาลองอีกครั้ง");
        error.details = Some(json!({"moderationStatus":"unavailable"}));
        return Err(error);
    }
    Ok(())
}

async fn put_profile_object(
    services: &MediaServices,
    key: &str,
    bytes: Vec<u8>,
    cache: &str,
) -> Result<(), ApiError> {
    services
        .profile
        .put_object()
        .bucket(&services.profile_bucket)
        .key(key)
        .content_type("image/jpeg")
        .cache_control(cache)
        .body(ByteStream::from(bytes))
        .send()
        .await
        .map_err(|error| {
            use aws_sdk_s3::error::ProvideErrorMetadata;
            // HTTP status and the S3 error code only: no keys, URLs or bodies.
            let status = error
                .raw_response()
                .map(|response| response.status().as_u16());
            let code = error.as_service_error().and_then(|service| service.code());
            tracing::warn!(?status, ?code, "profile photo upload to R2 failed");
            ApiError::unavailable("อัปโหลดรูปภาพไม่สำเร็จ กรุณาลองใหม่")
        })?;
    Ok(())
}

/// `PUT /v1/media/avatar` with the raw image body.
pub async fn avatar(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let user = auth::authenticate(&state, &headers).await?;
    crate::throttle(&state.db, "media-avatar", &user.uid, 10).await?;
    let services = services(&state)?;
    let jpeg = prepared(&services, body).await?;
    let key = format!("users/{}/avatar.jpg", user.uid);
    let (mod_result, put_result) = tokio::join!(
        moderate(&services, &jpeg),
        put_profile_object(&services, &key, jpeg.clone(), "public, max-age=60")
    );
    if let Err(e) = require_allowed(&mod_result) {
        let _ = services
            .profile
            .delete_object()
            .bucket(&services.profile_bucket)
            .key(&key)
            .send()
            .await;
        return Err(e);
    }
    put_result?;
    let version = chrono::Utc::now().timestamp_millis();
    Ok(Json(
        json!({"url":format!("{}/{key}?v={version}", services.profile_origin)}),
    ))
}

/// `PUT /v1/media/gallery` with the raw image body. Objects are immutable.
pub async fn gallery(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let user = auth::authenticate(&state, &headers).await?;
    crate::throttle(&state.db, "media-gallery", &user.uid, 20).await?;
    let services = services(&state)?;
    let jpeg = prepared(&services, body).await?;
    let key = format!("profile_gallery/{}/{}.jpg", user.uid, Uuid::new_v4());
    let (mod_result, put_result) = tokio::join!(
        moderate(&services, &jpeg),
        put_profile_object(
            &services,
            &key,
            jpeg.clone(),
            "public, max-age=31536000, immutable"
        )
    );
    if let Err(e) = require_allowed(&mod_result) {
        let _ = services
            .profile
            .delete_object()
            .bucket(&services.profile_bucket)
            .key(&key)
            .send()
            .await;
        return Err(e);
    }
    put_result?;
    Ok(Json(
        json!({"userId":user.uid,"url":format!("{}/{key}", services.profile_origin)}),
    ))
}

/// `POST /v1/media/moderate`: legacy `checkImageSafety` with a raw body.
pub async fn check(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let user = auth::authenticate_session(&state, &headers).await?;
    crate::throttle(&state.db, "media-moderate", &user.uid, 30).await?;
    let services = services(&state)?;
    let jpeg = prepared(&services, body).await?;
    Ok(Json(moderate(&services, &jpeg).await))
}

impl MediaServices {
    /// Best effort after account deletion: avatar and every gallery object.
    pub async fn delete_profile_objects(&self, uid: &str) {
        let mut keys: Vec<String> = ["jpg", "jpeg", "png", "webp"]
            .iter()
            .map(|ext| format!("users/{uid}/avatar.{ext}"))
            .collect();
        if let Ok(listing) = self
            .profile
            .list_objects_v2()
            .bucket(&self.profile_bucket)
            .prefix(format!("profile_gallery/{uid}/"))
            .max_keys(100)
            .send()
            .await
        {
            keys.extend(
                listing
                    .contents()
                    .iter()
                    .filter_map(|o| o.key().map(str::to_owned)),
            );
        }
        for key in keys {
            if self
                .profile
                .delete_object()
                .bucket(&self.profile_bucket)
                .key(&key)
                .send()
                .await
                .is_err()
            {
                tracing::warn!("profile object deletion deferred");
            }
        }
    }
}

/// Profile media URLs this server issued for `uid` (avatar or gallery).
pub fn owned_profile_url(state: &AppState, url: &str, uid: &str) -> bool {
    let Some(services) = state.media.as_ref() else {
        return false;
    };
    let Some(path) = url
        .strip_prefix(&services.profile_origin)
        .and_then(|rest| rest.strip_prefix('/'))
    else {
        return false;
    };
    let path = path.split_once('?').map_or(path, |(p, _)| p);
    path == format!("users/{uid}/avatar.jpg")
        || path
            .strip_prefix(&format!("profile_gallery/{uid}/"))
            .is_some_and(|file| {
                file.len() == 40 && file.ends_with(".jpg") && Uuid::parse_str(&file[..36]).is_ok()
            })
}

fn object_key(room: &str) -> String {
    format!(
        "chat_media/{room}/{}_{}.enc",
        chrono::Utc::now().timestamp_millis(),
        Uuid::new_v4().simple()
    )
}

fn valid_object_room(room: &str) -> bool {
    !room.is_empty()
        && room.len() <= 256
        && room
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn worker_ticket(origin: &str, secret: &str, key: &str, now_s: i64) -> Result<Value, ApiError> {
    let payload = URL_SAFE_NO_PAD.encode(
        serde_json::to_vec(&json!({"v":1,"key":key,"exp":now_s+300,"maxBytes":CHAT_MAX_BYTES}))
            .map_err(|_| ApiError::internal())?,
    );
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(|_| ApiError::internal())?;
    mac.update(payload.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    Ok(json!({
        "success": true, "provider": "r2", "uploadUrl": format!("{origin}/upload/{key}"),
        "downloadUrl": format!("{origin}/{key}"), "objectKey": key, "contentType": "application/octet-stream",
        "uploadHeaders": {"Authorization": format!("Bearer {payload}.{signature}"),
            "Content-Type": "application/octet-stream", "Cache-Control": "no-store"},
    }))
}

/// Legacy `getR2ChatUploadUrl`. Only client-encrypted objects are accepted.
pub async fn chat_upload_ticket(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    crate::throttle(&state.db, "media-chat-ticket", &user.uid, 60).await?;
    if data["extension"] != "enc" || data["contentType"] != "application/octet-stream" {
        return Err(ApiError::invalid("สื่อในแชตต้องเข้ารหัสก่อนอัปโหลด"));
    }
    let room = if let Some(party) = data["groupChatId"].as_str() {
        crate::parties::require_group_member(state, headers, &user.uid, party, true).await?;
        format!("group-{party}")
    } else {
        let room = data["conversationId"]
            .as_str()
            .ok_or_else(|| ApiError::invalid("ข้อมูล conversationId ไม่ถูกต้อง"))?;
        let mut tx = state.db.begin().await?;
        crate::chat::member_room(&mut tx, &user.uid, headers, room, true).await?;
        tx.commit().await?;
        room.to_owned()
    };
    if !valid_object_room(&room) {
        return Err(ApiError::invalid("ห้องสนทนาไม่ถูกต้อง"));
    }
    let services = services(state)?;
    let key = object_key(&room);
    if let Some((origin, secret)) = &services.worker {
        return worker_ticket(origin, secret, &key, chrono::Utc::now().timestamp());
    }
    let chat = services
        .chat
        .as_ref()
        .ok_or_else(|| ApiError::unavailable("ระบบสื่อในแชตยังไม่พร้อม"))?;
    let presigned = chat
        .client
        .put_object()
        .bucket(&chat.bucket)
        .key(&key)
        .content_type("application/octet-stream")
        .cache_control("public, max-age=31536000, immutable")
        .presigned(
            PresigningConfig::expires_in(Duration::from_secs(300))
                .map_err(|_| ApiError::internal())?,
        )
        .await
        .map_err(|_| ApiError::unavailable("ระบบสื่อในแชตยังไม่พร้อม"))?;
    Ok(json!({
        "success": true, "provider": "r2", "uploadUrl": presigned.uri(),
        "downloadUrl": format!("{}/{key}", chat.origin), "objectKey": key,
        "contentType": "application/octet-stream",
        "uploadHeaders": {"Content-Type": "application/octet-stream",
            "Cache-Control": "public, max-age=31536000, immutable"},
    }))
}

/// Content type guard for raw upload routes.
pub fn image_request(headers: &HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| ["image/jpeg", "image/png", "image/webp"].contains(&v))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moderation_policy_matches_legacy_thresholds() {
        let blocked = evaluate_labels(&[("Explicit Nudity".into(), String::new(), 61.0)]);
        assert_eq!(blocked["reason"], "adult");
        let swimwear = evaluate_labels(&[("Swimwear".into(), "Suggestive".into(), 99.0)]);
        assert_eq!(swimwear["status"], "allowed");
        let weapons = evaluate_labels(&[("Weapons".into(), "Violence".into(), 99.0)]);
        assert_eq!(weapons["status"], "allowed");
        let violence = evaluate_labels(&[("Graphic Violence".into(), "Violence".into(), 70.0)]);
        assert_eq!(violence["reason"], "violence");
    }

    #[test]
    fn images_are_reencoded_and_bounded() {
        let mut png = Vec::new();
        image::DynamicImage::new_rgb8(4, 3)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let jpeg = normalize_image(&png, 1440).unwrap();
        assert_eq!(&jpeg[..3], &[0xff, 0xd8, 0xff]);
        assert!(normalize_image(b"GIF89a....", 1440).is_err());
        assert!(normalize_image(&[], 1440).is_err());
    }

    #[test]
    fn worker_tickets_are_signed_and_scoped() {
        let ticket = worker_ticket(
            "https://media.example",
            &"k".repeat(32),
            "chat_media/c-1/1_a.enc",
            100,
        )
        .unwrap();
        assert_eq!(
            ticket["uploadUrl"],
            "https://media.example/upload/chat_media/c-1/1_a.enc"
        );
        let auth = ticket["uploadHeaders"]["Authorization"].as_str().unwrap();
        let (payload, _) = auth
            .strip_prefix("Bearer ")
            .unwrap()
            .split_once('.')
            .unwrap();
        let claims: Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).unwrap()).unwrap();
        assert_eq!(claims["exp"], 400);
        assert!(valid_object_room("group-party_1"));
        assert!(!valid_object_room("../x"));
    }
}
