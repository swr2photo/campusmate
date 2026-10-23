//! External services for photo verification: Amazon Rekognition (Face
//! Liveness, CompareFaces), AWS STS (streaming credentials) and Cloudflare R2
//! (profile photos and private verification snapshots).
//!
//! Nothing here logs image bytes, scores or credentials. Errors carry a coarse
//! kind only so callers can classify retryable failures.

use std::{future::Future, io::Cursor, pin::Pin, sync::Arc};

use chrono::{DateTime, Utc};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Rekognition accepts at most 5 MB of image bytes per input.
pub const MAX_COMPARE_BYTES: usize = 5 * 1024 * 1024;
/// Largest profile photo read from R2 before decoding.
pub const MAX_SOURCE_BYTES: usize = 15 * 1024 * 1024;
const MAX_EDGE: u32 = 1600;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderError {
    /// Worth retrying while the liveness session is still valid.
    Transient,
    /// The input or remote object cannot be used.
    Rejected,
    /// The object or session does not exist (any more).
    NotFound,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LivenessStatus {
    Created,
    InProgress,
    Succeeded,
    Failed,
    Expired,
}

/// Liveness challenge the server asks AWS to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Challenge {
    /// Head movement plus a colour-light sequence; AWS's most accurate check.
    MovementAndLight,
    /// Head movement only, without flashing lights (photosensitivity).
    Movement,
}

impl Challenge {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MovementAndLight => "FACE_MOVEMENT_AND_LIGHT",
            Self::Movement => "FACE_MOVEMENT",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "FACE_MOVEMENT_AND_LIGHT" => Some(Self::MovementAndLight),
            "FACE_MOVEMENT" => Some(Self::Movement),
            _ => None,
        }
    }
}

pub struct LivenessResult {
    pub status: LivenessStatus,
    pub confidence: Option<f32>,
    /// The frame AWS selected; used for CompareFaces and, only when a human
    /// must review the result, kept as private evidence until purged.
    pub reference_image: Option<Vec<u8>>,
    /// Challenge AWS reports it ran, when present.
    pub challenge: Option<Challenge>,
}

/// What DetectFaces saw in one gesture frame. Kept in memory only; identity
/// is checked separately, and only on a frame that shows the movement.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GestureFrame {
    /// Faces large enough to be someone in front of the camera.
    pub faces: usize,
    /// Head pose of the largest face, in degrees.
    pub yaw: f32,
    pub pitch: f32,
    pub roll: f32,
    /// `(open, confidence)` when eye state was requested and detected.
    pub eyes_open: Option<(bool, f32)>,
    /// Face width as a share of the frame width (0..1), for distance hints.
    pub face_width: Option<f32>,
    /// Face centre as shares of the frame `(x, y)`, for framing hints.
    pub face_center: Option<(f32, f32)>,
    /// Rekognition's brightness of the face (0..100), for lighting hints.
    pub brightness: Option<f32>,
}

pub struct StreamingCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: String,
    pub expiration: DateTime<Utc>,
}

/// Rekognition + STS operations. Only the server holds credentials for these.
pub trait FaceProvider: Send + Sync {
    fn create_session(
        &self,
        request_token: &str,
        challenge: Challenge,
    ) -> BoxFuture<'_, Result<String, ProviderError>>;
    fn session_results(
        &self,
        session_id: &str,
    ) -> BoxFuture<'_, Result<LivenessResult, ProviderError>>;
    /// Best similarity of `source` against `target`, `None` when no face matched.
    fn compare(
        &self,
        source: Vec<u8>,
        target: Vec<u8>,
    ) -> BoxFuture<'_, Result<Option<f32>, ProviderError>>;
    /// Pose of the face in `frame`, eye state too when `eyes` is set. Turned
    /// faces are reported, unlike CompareFaces' quality filter.
    fn detect_gesture(
        &self,
        frame: Vec<u8>,
        eyes: bool,
    ) -> BoxFuture<'_, Result<GestureFrame, ProviderError>>;
    /// Similarity of the face in `frame` to `snapshot`, turned faces
    /// included. `None` when CompareFaces found no face to compare.
    fn match_gesture(
        &self,
        snapshot: Vec<u8>,
        frame: Vec<u8>,
    ) -> BoxFuture<'_, Result<Option<f32>, ProviderError>>;
    /// Short-lived credentials limited to `rekognition:StartFaceLivenessSession`.
    fn streaming_credentials(
        &self,
        attempt_id: &str,
    ) -> BoxFuture<'_, Result<StreamingCredentials, ProviderError>>;
}

/// Object storage for profile photos (read) and private snapshots (read/write).
pub trait ReferenceStore: Send + Sync {
    fn read_profile_photo(&self, key: &str) -> BoxFuture<'_, Result<Vec<u8>, ProviderError>>;
    fn put_snapshot(&self, key: &str, jpeg: Vec<u8>) -> BoxFuture<'_, Result<(), ProviderError>>;
    fn read_snapshot(&self, key: &str) -> BoxFuture<'_, Result<Vec<u8>, ProviderError>>;
    fn delete_snapshot(&self, key: &str) -> BoxFuture<'_, Result<(), ProviderError>>;
}

/// Decode a JPEG/PNG/WebP photo with allocation limits and re-encode it as a
/// metadata-free JPEG small enough for CompareFaces. The declared MIME type
/// is never trusted; only the decoded content matters.
pub fn normalize_reference(bytes: &[u8]) -> Result<Vec<u8>, ProviderError> {
    if bytes.is_empty() || bytes.len() > MAX_SOURCE_BYTES {
        return Err(ProviderError::Rejected);
    }
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| ProviderError::Rejected)?;
    match reader.format() {
        Some(image::ImageFormat::Jpeg | image::ImageFormat::Png | image::ImageFormat::WebP) => {}
        _ => return Err(ProviderError::Rejected),
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8_000);
    limits.max_image_height = Some(8_000);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|_| ProviderError::Rejected)?;
    let fitted = if decoded.width() > MAX_EDGE || decoded.height() > MAX_EDGE {
        decoded.resize(MAX_EDGE, MAX_EDGE, image::imageops::FilterType::Lanczos3)
    } else {
        decoded
    };
    let mut jpeg = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 90);
    fitted
        .to_rgb8()
        .write_with_encoder(encoder)
        .map_err(|_| ProviderError::Rejected)?;
    if jpeg.len() > MAX_COMPARE_BYTES {
        return Err(ProviderError::Rejected);
    }
    Ok(jpeg)
}

/// Amazon Rekognition + STS using the server's default AWS credential chain
/// (for Fly.io prefer OIDC web identity over static keys).
pub struct AwsFaceProvider {
    rekognition: aws_sdk_rekognition::Client,
    sts: aws_sdk_sts::Client,
    stream_role_arn: String,
}

impl AwsFaceProvider {
    pub async fn new(region: String, stream_role_arn: String) -> Self {
        let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region(aws_config::Region::new(region))
            .load()
            .await;
        Self {
            rekognition: aws_sdk_rekognition::Client::new(&config),
            sts: aws_sdk_sts::Client::new(&config),
            stream_role_arn,
        }
    }

    async fn best_similarity(
        &self,
        source: Vec<u8>,
        target: Vec<u8>,
        filter: aws_sdk_rekognition::types::QualityFilter,
    ) -> Result<Option<f32>, ProviderError> {
        use aws_sdk_rekognition::{primitives::Blob, types::Image};
        let output = self
            .rekognition
            .compare_faces()
            .source_image(Image::builder().bytes(Blob::new(source)).build())
            .target_image(Image::builder().bytes(Blob::new(target)).build())
            .similarity_threshold(0.0)
            .quality_filter(filter)
            .send()
            .await
            .map_err(|error| classify(&error))?;
        Ok(output
            .face_matches()
            .iter()
            .filter_map(|matched| matched.similarity())
            .reduce(f32::max))
    }
}

fn classify<E: aws_sdk_rekognition::error::ProvideErrorMetadata, R>(
    error: &aws_sdk_rekognition::error::SdkError<E, R>,
) -> ProviderError {
    use aws_sdk_rekognition::error::SdkError;
    match error {
        // Throttling is a busy service, not a verdict on the image.
        SdkError::ServiceError(service) => match service.err().code() {
            Some(
                "ThrottlingException"
                | "ProvisionedThroughputExceededException"
                | "LimitExceededException"
                | "InternalServerError",
            ) => ProviderError::Transient,
            _ => ProviderError::Rejected,
        },
        _ => ProviderError::Transient,
    }
}

/// Inline session policy: even if the role grows, these credentials can only
/// stream a liveness check.
const STREAM_SESSION_POLICY: &str = r#"{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"rekognition:StartFaceLivenessSession","Resource":"*"}]}"#;

impl FaceProvider for AwsFaceProvider {
    fn create_session(
        &self,
        request_token: &str,
        challenge: Challenge,
    ) -> BoxFuture<'_, Result<String, ProviderError>> {
        let token = request_token.to_owned();
        Box::pin(async move {
            use aws_sdk_rekognition::types::{
                ChallengePreference, ChallengeType, CreateFaceLivenessSessionRequestSettings,
            };
            let kind = match challenge {
                Challenge::MovementAndLight => ChallengeType::FaceMovementAndLightChallenge,
                Challenge::Movement => ChallengeType::FaceMovementChallenge,
            };
            let preference = ChallengePreference::builder()
                .r#type(kind)
                .build()
                .map_err(|_| ProviderError::Rejected)?;
            let settings = CreateFaceLivenessSessionRequestSettings::builder()
                .audit_images_limit(0)
                .challenge_preferences(preference)
                .build();
            let output = self
                .rekognition
                .create_face_liveness_session()
                .client_request_token(token)
                .settings(settings)
                .send()
                .await
                .map_err(|error| classify(&error))?;
            Ok(output.session_id().to_owned())
        })
    }

    fn session_results(
        &self,
        session_id: &str,
    ) -> BoxFuture<'_, Result<LivenessResult, ProviderError>> {
        let session_id = session_id.to_owned();
        Box::pin(async move {
            use aws_sdk_rekognition::types::{ChallengeType, LivenessSessionStatus};
            let output = self
                .rekognition
                .get_face_liveness_session_results()
                .session_id(session_id)
                .send()
                .await
                .map_err(|error| match &error {
                    aws_sdk_rekognition::error::SdkError::ServiceError(service)
                        if service.err().is_session_not_found_exception() =>
                    {
                        ProviderError::NotFound
                    }
                    _ => classify(&error),
                })?;
            let status = match output.status() {
                LivenessSessionStatus::Succeeded => LivenessStatus::Succeeded,
                LivenessSessionStatus::Failed => LivenessStatus::Failed,
                LivenessSessionStatus::Expired => LivenessStatus::Expired,
                LivenessSessionStatus::InProgress => LivenessStatus::InProgress,
                _ => LivenessStatus::Created,
            };
            let reference_image = output
                .reference_image()
                .and_then(|image| image.bytes())
                .map(|blob| blob.as_ref().to_vec());
            // Anything but the light challenge counts as the weaker check.
            let challenge = output
                .challenge()
                .map(|challenge| match challenge.r#type() {
                    ChallengeType::FaceMovementAndLightChallenge => Challenge::MovementAndLight,
                    _ => Challenge::Movement,
                });
            Ok(LivenessResult {
                status,
                confidence: output.confidence(),
                reference_image,
                challenge,
            })
        })
    }

    fn compare(
        &self,
        source: Vec<u8>,
        target: Vec<u8>,
    ) -> BoxFuture<'_, Result<Option<f32>, ProviderError>> {
        Box::pin(self.best_similarity(
            source,
            target,
            aws_sdk_rekognition::types::QualityFilter::Auto,
        ))
    }

    fn detect_gesture(
        &self,
        frame: Vec<u8>,
        eyes: bool,
    ) -> BoxFuture<'_, Result<GestureFrame, ProviderError>> {
        Box::pin(async move {
            use aws_sdk_rekognition::{
                primitives::Blob,
                types::{Attribute, FaceDetail, Image},
            };
            // DEFAULT always includes pose, bounding box and quality.
            let mut request = self
                .rekognition
                .detect_faces()
                .image(Image::builder().bytes(Blob::new(frame)).build())
                .attributes(Attribute::Default);
            if eyes {
                request = request.attributes(Attribute::EyesOpen);
            }
            let output = request.send().await.map_err(|error| classify(&error))?;
            let finite = |value: Option<f32>| value.filter(|v| v.is_finite());
            let width = |detail: &FaceDetail| {
                finite(detail.bounding_box().and_then(|bounds| bounds.width())).unwrap_or(0.0)
            };
            let detected: Vec<&FaceDetail> = output
                .face_details()
                .iter()
                .filter(|detail| {
                    detail.confidence().is_some_and(|c| c >= 80.0) && width(detail) >= 0.03
                })
                .collect();
            let face = detected
                .iter()
                .copied()
                .max_by(|a, b| width(a).total_cmp(&width(b)));
            // A small face far behind the person (a poster, a passer-by) is
            // not a second person taking part.
            let faces = face.map_or(0, |face| {
                detected
                    .iter()
                    .filter(|detail| width(detail) >= width(face) * 0.5)
                    .count()
            });
            let pose = face.and_then(|face| face.pose());
            // A missing angle never reads as "looking straight".
            let angle = |value: Option<f32>| finite(value).unwrap_or(f32::NAN);
            let bounds = face.and_then(|face| face.bounding_box());
            Ok(GestureFrame {
                faces,
                yaw: angle(pose.and_then(|pose| pose.yaw())),
                pitch: angle(pose.and_then(|pose| pose.pitch())),
                roll: angle(pose.and_then(|pose| pose.roll())),
                eyes_open: face
                    .and_then(|face| face.eyes_open())
                    .and_then(|state| Some((state.value(), state.confidence()?))),
                face_width: finite(bounds.and_then(|bounds| bounds.width())),
                face_center: bounds.and_then(|bounds| {
                    Some((
                        finite(bounds.left())? + finite(bounds.width())? / 2.0,
                        finite(bounds.top())? + finite(bounds.height())? / 2.0,
                    ))
                }),
                brightness: finite(
                    face.and_then(|face| face.quality())
                        .and_then(|quality| quality.brightness()),
                ),
            })
        })
    }

    fn match_gesture(
        &self,
        snapshot: Vec<u8>,
        frame: Vec<u8>,
    ) -> BoxFuture<'_, Result<Option<f32>, ProviderError>> {
        // The automatic quality bar drops turned faces as extreme poses.
        Box::pin(self.best_similarity(
            snapshot,
            frame,
            aws_sdk_rekognition::types::QualityFilter::None,
        ))
    }

    fn streaming_credentials(
        &self,
        attempt_id: &str,
    ) -> BoxFuture<'_, Result<StreamingCredentials, ProviderError>> {
        let session_name = format!("liveness-{}", &attempt_id[..attempt_id.len().min(32)]);
        Box::pin(async move {
            let output = self
                .sts
                .assume_role()
                .role_arn(&self.stream_role_arn)
                .role_session_name(session_name)
                .duration_seconds(900)
                .policy(STREAM_SESSION_POLICY)
                .send()
                .await
                .map_err(|_| ProviderError::Transient)?;
            let credentials = output.credentials().ok_or(ProviderError::Transient)?;
            let expiration = DateTime::<Utc>::from_timestamp(credentials.expiration().secs(), 0)
                .ok_or(ProviderError::Transient)?;
            Ok(StreamingCredentials {
                access_key_id: credentials.access_key_id().to_owned(),
                secret_access_key: credentials.secret_access_key().to_owned(),
                session_token: credentials.session_token().to_owned(),
                expiration,
            })
        })
    }
}

/// Cloudflare R2 through its S3-compatible API. Profile photos are read by
/// key from the media bucket; snapshots go to a separate private bucket.
pub struct R2ReferenceStore {
    client: aws_sdk_s3::Client,
    media_client: aws_sdk_s3::Client,
    media_bucket: String,
    snapshot_bucket: String,
}

impl R2ReferenceStore {
    pub fn new(
        endpoint: String,
        access_key_id: String,
        secret_access_key: String,
        media_access_key_id: String,
        media_secret_access_key: String,
        media_bucket: String,
        snapshot_bucket: String,
    ) -> Self {
        use aws_sdk_s3::config::{
            Builder, Credentials, Region, RequestChecksumCalculation, ResponseChecksumValidation,
        };
        let config = |access_key_id, secret_access_key| {
            Builder::new()
                .behavior_version(aws_sdk_s3::config::BehaviorVersion::latest())
                .region(Region::new("auto"))
                .endpoint_url(&endpoint)
                .credentials_provider(Credentials::new(
                    access_key_id,
                    secret_access_key,
                    None,
                    None,
                    "r2",
                ))
                .force_path_style(true)
                .request_checksum_calculation(RequestChecksumCalculation::WhenRequired)
                .response_checksum_validation(ResponseChecksumValidation::WhenRequired)
                .build()
        };
        Self {
            client: aws_sdk_s3::Client::from_conf(config(access_key_id, secret_access_key)),
            media_client: aws_sdk_s3::Client::from_conf(config(
                media_access_key_id,
                media_secret_access_key,
            )),
            media_bucket,
            snapshot_bucket,
        }
    }

    async fn read(
        &self,
        client: &aws_sdk_s3::Client,
        bucket: &str,
        key: &str,
    ) -> Result<Vec<u8>, ProviderError> {
        let output = client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|error| match error.as_service_error() {
                Some(service) if service.is_no_such_key() => ProviderError::NotFound,
                Some(_) => ProviderError::Rejected,
                None => ProviderError::Transient,
            })?;
        if output
            .content_length()
            .is_some_and(|length| length < 0 || length as usize > MAX_SOURCE_BYTES)
        {
            return Err(ProviderError::Rejected);
        }
        let bytes = output
            .body
            .collect()
            .await
            .map_err(|_| ProviderError::Transient)?
            .into_bytes();
        if bytes.len() > MAX_SOURCE_BYTES {
            return Err(ProviderError::Rejected);
        }
        Ok(bytes.to_vec())
    }
}

impl ReferenceStore for R2ReferenceStore {
    fn read_profile_photo(&self, key: &str) -> BoxFuture<'_, Result<Vec<u8>, ProviderError>> {
        let key = key.to_owned();
        Box::pin(async move {
            self.read(&self.media_client, &self.media_bucket, &key)
                .await
        })
    }

    fn put_snapshot(&self, key: &str, jpeg: Vec<u8>) -> BoxFuture<'_, Result<(), ProviderError>> {
        let key = key.to_owned();
        Box::pin(async move {
            // Snapshot keys are unique per attempt and never overwritten.
            self.client
                .put_object()
                .bucket(&self.snapshot_bucket)
                .key(key)
                .content_type("image/jpeg")
                .if_none_match("*")
                .body(aws_sdk_s3::primitives::ByteStream::from(jpeg))
                .send()
                .await
                .map(|_| ())
                .map_err(|_| ProviderError::Transient)
        })
    }

    fn read_snapshot(&self, key: &str) -> BoxFuture<'_, Result<Vec<u8>, ProviderError>> {
        let key = key.to_owned();
        Box::pin(async move { self.read(&self.client, &self.snapshot_bucket, &key).await })
    }

    fn delete_snapshot(&self, key: &str) -> BoxFuture<'_, Result<(), ProviderError>> {
        let key = key.to_owned();
        Box::pin(async move {
            self.client
                .delete_object()
                .bucket(&self.snapshot_bucket)
                .key(key)
                .send()
                .await
                .map(|_| ())
                .map_err(|_| ProviderError::Transient)
        })
    }
}

/// In-memory doubles for tests. Never wired into production configuration.
#[doc(hidden)]
pub mod testing {
    use super::*;
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Mutex,
        },
    };

    /// Scripted Rekognition behaviour, settable per test.
    pub struct Script {
        pub status: LivenessStatus,
        pub confidence: Option<f32>,
        pub reference_image: Option<Vec<u8>>,
        pub similarity: Option<f32>,
        pub results_error: Option<ProviderError>,
        pub create_error: Option<ProviderError>,
        /// Challenge reported by results; `None` = AWS omitted it.
        pub challenge: Option<Challenge>,
        /// Gesture frames: similarity to the snapshot when a frame showed the
        /// movement, and face count.
        pub gesture_similarity: Option<f32>,
        pub gesture_faces: usize,
        pub gesture_error: Option<ProviderError>,
        /// Replaces the pose read from a `gesture_frame` fixture.
        pub gesture_override: Option<GestureFrame>,
    }

    impl Default for Script {
        fn default() -> Self {
            Self {
                status: LivenessStatus::Succeeded,
                confidence: Some(99.0),
                reference_image: Some(sample_jpeg()),
                similarity: Some(99.0),
                results_error: None,
                create_error: None,
                challenge: None,
                gesture_similarity: Some(99.0),
                gesture_faces: 1,
                gesture_error: None,
                gesture_override: None,
            }
        }
    }

    #[derive(Default)]
    pub struct FakeFaceProvider {
        pub script: Mutex<Script>,
        pub creates: AtomicUsize,
        pub results: AtomicUsize,
        pub compares: AtomicUsize,
        /// DetectFaces calls on gesture frames, and CompareFaces on the ones
        /// that showed the movement.
        pub gestures: AtomicUsize,
        pub gesture_matches: AtomicUsize,
        pub last_challenge: Mutex<Option<Challenge>>,
    }

    /// Gesture names and the solid colour that stands for each in fixtures.
    const GESTURE_COLOURS: [(&str, [u8; 3]); 5] = [
        ("CENTER", [230, 30, 30]),
        ("BLINK", [30, 230, 30]),
        ("TURN_LEFT", [30, 30, 230]),
        ("TURN_RIGHT", [230, 230, 30]),
        ("NOD_DOWN", [30, 230, 230]),
    ];

    /// A frame the fake provider reads as someone performing `gesture`.
    pub fn gesture_frame(gesture: &str) -> Vec<u8> {
        let colour = GESTURE_COLOURS
            .iter()
            .find(|(name, _)| *name == gesture)
            .map_or([128, 128, 128], |(_, colour)| *colour);
        let image = image::RgbImage::from_pixel(64, 64, image::Rgb(colour));
        let mut jpeg = Vec::new();
        image::DynamicImage::ImageRgb8(image)
            .write_to(&mut Cursor::new(&mut jpeg), image::ImageFormat::Jpeg)
            .unwrap();
        jpeg
    }

    /// Pose a person shows for each fixture colour; unknown colours face front.
    fn pose_of(frame: &[u8]) -> (f32, f32, bool) {
        let pixel = image::load_from_memory(frame)
            .map(|image| image.to_rgb8().get_pixel(32, 32).0)
            .unwrap_or([128, 128, 128]);
        let distance = |colour: &[u8; 3]| -> i32 {
            colour
                .iter()
                .zip(pixel)
                .map(|(a, b)| (i32::from(*a) - i32::from(b)).pow(2))
                .sum()
        };
        let nearest = GESTURE_COLOURS
            .iter()
            .min_by_key(|(_, colour)| distance(colour))
            .filter(|(_, colour)| distance(colour) < 3_000)
            .map_or("", |(name, _)| *name);
        match nearest {
            "BLINK" => (0.0, 0.0, false),
            "TURN_LEFT" => (32.0, 0.0, true),
            "TURN_RIGHT" => (-32.0, 0.0, true),
            "NOD_DOWN" => (0.0, -22.0, true),
            _ => (0.0, 0.0, true),
        }
    }

    impl FakeFaceProvider {
        pub fn set(&self, update: impl FnOnce(&mut Script)) {
            update(&mut self.script.lock().unwrap());
        }
    }

    impl FaceProvider for FakeFaceProvider {
        fn create_session(
            &self,
            request_token: &str,
            challenge: Challenge,
        ) -> BoxFuture<'_, Result<String, ProviderError>> {
            let id = format!("aws-{request_token}");
            Box::pin(async move {
                self.creates.fetch_add(1, Ordering::SeqCst);
                *self.last_challenge.lock().unwrap() = Some(challenge);
                match self.script.lock().unwrap().create_error {
                    Some(error) => Err(error),
                    None => Ok(id),
                }
            })
        }

        fn session_results(
            &self,
            _session_id: &str,
        ) -> BoxFuture<'_, Result<LivenessResult, ProviderError>> {
            Box::pin(async move {
                self.results.fetch_add(1, Ordering::SeqCst);
                let script = self.script.lock().unwrap();
                if let Some(error) = script.results_error {
                    return Err(error);
                }
                Ok(LivenessResult {
                    status: script.status,
                    confidence: script.confidence,
                    reference_image: script.reference_image.clone(),
                    challenge: script.challenge,
                })
            })
        }

        fn compare(
            &self,
            _source: Vec<u8>,
            _target: Vec<u8>,
        ) -> BoxFuture<'_, Result<Option<f32>, ProviderError>> {
            Box::pin(async move {
                self.compares.fetch_add(1, Ordering::SeqCst);
                // Give racing requests a chance to interleave.
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                Ok(self.script.lock().unwrap().similarity)
            })
        }

        fn detect_gesture(
            &self,
            frame: Vec<u8>,
            eyes: bool,
        ) -> BoxFuture<'_, Result<GestureFrame, ProviderError>> {
            Box::pin(async move {
                self.gestures.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                let script = self.script.lock().unwrap();
                if let Some(error) = script.gesture_error {
                    return Err(error);
                }
                if let Some(frame) = script.gesture_override {
                    return Ok(frame);
                }
                let (yaw, pitch, open) = pose_of(&frame);
                Ok(GestureFrame {
                    faces: script.gesture_faces,
                    yaw,
                    pitch,
                    roll: 0.0,
                    eyes_open: eyes.then_some((open, 98.0)),
                    face_width: Some(0.45),
                    face_center: Some((0.5, 0.45)),
                    brightness: Some(60.0),
                })
            })
        }

        fn match_gesture(
            &self,
            _snapshot: Vec<u8>,
            _frame: Vec<u8>,
        ) -> BoxFuture<'_, Result<Option<f32>, ProviderError>> {
            Box::pin(async move {
                self.gesture_matches.fetch_add(1, Ordering::SeqCst);
                let script = self.script.lock().unwrap();
                match script.gesture_error {
                    Some(error) => Err(error),
                    None => Ok(script.gesture_similarity),
                }
            })
        }

        fn streaming_credentials(
            &self,
            _attempt_id: &str,
        ) -> BoxFuture<'_, Result<StreamingCredentials, ProviderError>> {
            Box::pin(async move {
                Ok(StreamingCredentials {
                    access_key_id: "ASIATESTONLY".into(),
                    secret_access_key: "test-secret".into(),
                    session_token: "test-token".into(),
                    expiration: Utc::now() + chrono::Duration::minutes(15),
                })
            })
        }
    }

    #[derive(Default)]
    pub struct FakeReferenceStore {
        pub photos: Mutex<HashMap<String, Vec<u8>>>,
        pub snapshots: Mutex<HashMap<String, Vec<u8>>>,
        pub photo_reads: AtomicUsize,
    }

    impl ReferenceStore for FakeReferenceStore {
        fn read_profile_photo(&self, key: &str) -> BoxFuture<'_, Result<Vec<u8>, ProviderError>> {
            let key = key.to_owned();
            Box::pin(async move {
                self.photo_reads.fetch_add(1, Ordering::SeqCst);
                self.photos
                    .lock()
                    .unwrap()
                    .get(&key)
                    .cloned()
                    .ok_or(ProviderError::NotFound)
            })
        }

        fn put_snapshot(
            &self,
            key: &str,
            jpeg: Vec<u8>,
        ) -> BoxFuture<'_, Result<(), ProviderError>> {
            let key = key.to_owned();
            Box::pin(async move {
                let mut snapshots = self.snapshots.lock().unwrap();
                if snapshots.contains_key(&key) {
                    return Err(ProviderError::Rejected);
                }
                snapshots.insert(key, jpeg);
                Ok(())
            })
        }

        fn read_snapshot(&self, key: &str) -> BoxFuture<'_, Result<Vec<u8>, ProviderError>> {
            let key = key.to_owned();
            Box::pin(async move {
                self.snapshots
                    .lock()
                    .unwrap()
                    .get(&key)
                    .cloned()
                    .ok_or(ProviderError::NotFound)
            })
        }

        fn delete_snapshot(&self, key: &str) -> BoxFuture<'_, Result<(), ProviderError>> {
            let key = key.to_owned();
            Box::pin(async move {
                self.snapshots.lock().unwrap().remove(&key);
                Ok(())
            })
        }
    }

    /// A small valid JPEG (solid colour) for fixtures.
    pub fn sample_jpeg() -> Vec<u8> {
        let image = image::RgbImage::from_pixel(64, 64, image::Rgb([200, 160, 120]));
        let mut jpeg = Vec::new();
        image::DynamicImage::ImageRgb8(image)
            .write_to(&mut Cursor::new(&mut jpeg), image::ImageFormat::Jpeg)
            .unwrap();
        jpeg
    }

    pub fn shared() -> (Arc<FakeFaceProvider>, Arc<FakeReferenceStore>) {
        (Arc::default(), Arc::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_photos_are_decoded_and_re_encoded() {
        let jpeg = testing::sample_jpeg();
        let normalized = normalize_reference(&jpeg).unwrap();
        assert_eq!(&normalized[..3], &[0xff, 0xd8, 0xff]);
        assert_eq!(
            normalize_reference(b"<html>not an image</html>"),
            Err(ProviderError::Rejected)
        );
        assert_eq!(normalize_reference(&[]), Err(ProviderError::Rejected));
        let gif = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;";
        assert_eq!(normalize_reference(gif), Err(ProviderError::Rejected));
        assert!(normalize_reference(&vec![0xff; MAX_SOURCE_BYTES + 1]).is_err());
    }

    #[test]
    fn large_photos_are_resized_under_the_compare_limit() {
        let image = image::RgbImage::from_fn(3000, 2000, |x, y| {
            image::Rgb([(x % 251) as u8, (y % 241) as u8, 90])
        });
        let mut png = Vec::new();
        image::DynamicImage::ImageRgb8(image)
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let normalized = normalize_reference(&png).unwrap();
        let decoded = image::load_from_memory(&normalized).unwrap();
        assert!(decoded.width() <= MAX_EDGE && decoded.height() <= MAX_EDGE);
        assert!(normalized.len() <= MAX_COMPARE_BYTES);
    }

    #[test]
    fn streaming_policy_allows_only_liveness_streaming() {
        let policy: serde_json::Value = serde_json::from_str(STREAM_SESSION_POLICY).unwrap();
        let statements = policy["Statement"].as_array().unwrap();
        assert_eq!(statements.len(), 1);
        assert_eq!(
            statements[0]["Action"],
            "rekognition:StartFaceLivenessSession"
        );
        assert_eq!(statements[0]["Effect"], "Allow");
    }
}
