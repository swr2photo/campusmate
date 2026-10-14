//! One-shot staging diagnostics. Prints fixed labels, never credentials/images.
use campusmate_backend::identity_provider::{
    AwsFaceProvider, Challenge, FaceProvider, LivenessStatus, R2ReferenceStore, ReferenceStore,
};

async fn check() -> anyhow::Result<()> {
    let required =
        |name| std::env::var(name).map_err(|_| anyhow::anyhow!("missing diagnostic configuration"));
    let region = required("AWS_REGION")?;
    anyhow::ensure!(
        region == "ap-southeast-7",
        "Thailand configuration required"
    );
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new(region.clone()))
        .load()
        .await;
    let identity = aws_sdk_sts::Client::new(&config)
        .get_caller_identity()
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("STS diagnostic failed"))?;
    anyhow::ensure!(
        identity.arn().is_some_and(
            |arn| arn.starts_with("arn:aws:sts::502731779521:assumed-role/campusmate-backend/")
        ),
        "unexpected workload principal"
    );
    println!("RUST_FLY_OIDC_STS_OK");
    let provider = AwsFaceProvider::new(region, required("FACE_LIVENESS_STREAM_ROLE_ARN")?).await;
    let request = uuid::Uuid::new_v4().to_string();
    let session = provider
        .create_session(&request, Challenge::Movement)
        .await
        .map_err(|_| anyhow::anyhow!("create diagnostic failed"))?;
    let result = provider
        .session_results(&session)
        .await
        .map_err(|_| anyhow::anyhow!("results diagnostic failed"))?;
    anyhow::ensure!(
        result.status == LivenessStatus::Created,
        "unexpected diagnostic session state"
    );
    let credentials = provider
        .streaming_credentials(&request)
        .await
        .map_err(|_| anyhow::anyhow!("stream credentials diagnostic failed"))?;
    anyhow::ensure!(
        credentials.expiration > chrono::Utc::now(),
        "expired streaming credentials"
    );
    println!("RUST_THAILAND_CREATE_GET_STREAM_CREDENTIALS_OK");
    let store = R2ReferenceStore::new(
        required("R2_ENDPOINT")?,
        required("R2_ACCESS_KEY_ID")?,
        required("R2_SECRET_ACCESS_KEY")?,
        required("R2_MEDIA_ACCESS_KEY_ID")?,
        required("R2_MEDIA_SECRET_ACCESS_KEY")?,
        required("R2_MEDIA_BUCKET")?,
        required("R2_VERIFICATION_BUCKET")?,
    );
    let key = format!("diagnostics/{request}.jpg");
    // Synthetic, non-face JPEG. No real biometric data is used in this check.
    let bytes = campusmate_backend::identity_provider::testing::sample_jpeg();
    store
        .put_snapshot(&key, bytes.clone())
        .await
        .map_err(|_| anyhow::anyhow!("private snapshot write failed"))?;
    let read = store.read_snapshot(&key).await;
    let deleted = store.delete_snapshot(&key).await;
    anyhow::ensure!(
        read.map(|v| v == bytes).unwrap_or(false),
        "snapshot integrity diagnostic failed"
    );
    anyhow::ensure!(deleted.is_ok(), "snapshot deletion diagnostic failed");
    anyhow::ensure!(
        matches!(
            store.read_snapshot(&key).await,
            Err(campusmate_backend::identity_provider::ProviderError::NotFound)
        ),
        "snapshot remains after deletion"
    );
    println!("RUST_PRIVATE_R2_WRITE_READ_DELETE_OK");
    Ok(())
}

#[tokio::main]
async fn main() {
    match tokio::time::timeout(std::time::Duration::from_secs(90), check()).await {
        Ok(Ok(())) => println!("IDENTITY_DEPENDENCIES_OK"),
        _ => {
            eprintln!("IDENTITY_DEPENDENCIES_FAILED");
            std::process::exit(1);
        }
    }
}
