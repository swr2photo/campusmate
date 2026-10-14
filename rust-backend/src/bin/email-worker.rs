//! Private, opt-in authentication email consumer. Never run this binary in an
//! API container. `--send` enables delivery; tests never contact a mail service.
//! Resend deduplicates retries by outbox ID. SMTP provides at-least-once
//! delivery: a process crash after relay acceptance can cause a duplicate.
use chrono::{DateTime, Utc};
use lettre::{
    message::{Mailbox, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    Address, AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use reqwest::{redirect::Policy, Client, Url};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::{env, time::Duration};
use uuid::Uuid;

const MAX_ATTEMPTS: i32 = 8;
const SEND_TIMEOUT: Duration = Duration::from_secs(20);
const LEASE_SECONDS: i32 = 90;

// These errors contain only fixed codes. Never attach an SMTP/HTTP/database
// error, payload, address, URL, token or provider response to logs or errors.
#[derive(Debug)]
enum WorkerError {
    Config(&'static str),
    Database,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ActionKind {
    VerifyEmail,
    ResetPassword,
    ChangeEmail,
    DeleteAccountOtp,
}

impl ActionKind {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "verify_email" => Some(Self::VerifyEmail),
            "reset_password" => Some(Self::ResetPassword),
            "change_email" => Some(Self::ChangeEmail),
            "delete_account_otp" => Some(Self::DeleteAccountOtp),
            _ => None,
        }
    }

    fn path(self) -> &'static str {
        match self {
            Self::VerifyEmail | Self::ChangeEmail | Self::DeleteAccountOtp => "/auth/verify-email",
            Self::ResetPassword => "/auth/reset-password",
        }
    }

    fn subject(self) -> &'static str {
        match self {
            Self::VerifyEmail => "ยืนยันอีเมลบัญชี CampusMate",
            Self::ResetPassword => "ตั้งรหัสผ่าน CampusMate ใหม่",
            Self::ChangeEmail => "ยืนยันอีเมลมหาวิทยาลัยสำหรับบัญชี CampusMate",
            Self::DeleteAccountOtp => "รหัสยืนยันการลบบัญชี CampusMate",
        }
    }
}

struct Configuration {
    action_origin: Url,
    from: Mailbox,
    sender: Sender,
}

enum Sender {
    Resend { client: Client, api_key: String },
    Smtp(AsyncSmtpTransport<Tokio1Executor>),
}

fn configured(name: &str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.is_empty())
}

fn action_origin(value: &str) -> Result<Url, WorkerError> {
    let url = Url::parse(value).map_err(|_| WorkerError::Config("invalid-email-action-origin"))?;
    let domain = url.domain().unwrap_or_default();
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || url.port().is_some_and(|port| port != 443)
        || !domain.contains('.')
        || domain.ends_with('.')
        || domain.eq_ignore_ascii_case("localhost")
        || domain.ends_with(".localhost")
    {
        return Err(WorkerError::Config("invalid-email-action-origin"));
    }
    Ok(url)
}

impl Configuration {
    fn load() -> Result<Self, WorkerError> {
        let origin = configured("NATIVE_AUTH_EMAIL_ORIGIN")
            .ok_or(WorkerError::Config("native-auth-email-origin-required"))?;
        let from_address =
            configured("CAMPUS_EMAIL_FROM").unwrap_or_else(|| "noreply@getcampusmate.app".into());
        let address: Address = from_address
            .parse()
            .map_err(|_| WorkerError::Config("invalid-campus-email-from"))?;
        let name = configured("CAMPUS_EMAIL_FROM_NAME").unwrap_or_else(|| "CampusMate".into());
        if name.len() > 100 || name.chars().any(char::is_control) {
            return Err(WorkerError::Config("invalid-campus-email-from-name"));
        }
        let from = Mailbox::new(Some(name), address);
        let sender = if let Some(api_key) = configured("RESEND_API_KEY") {
            if api_key.len() > 512 || api_key.chars().any(char::is_whitespace) {
                return Err(WorkerError::Config("invalid-resend-api-key"));
            }
            let client = Client::builder()
                .https_only(true)
                .redirect(Policy::none())
                .no_proxy()
                .connect_timeout(Duration::from_secs(5))
                .timeout(SEND_TIMEOUT)
                .build()
                .map_err(|_| WorkerError::Config("mail-http-client-unavailable"))?;
            Sender::Resend { client, api_key }
        } else {
            let host = configured("SMTP_HOST").unwrap_or_else(|| "smtp.gmail.com".into());
            if host.is_empty()
                || host.len() > 253
                || !host
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b))
            {
                return Err(WorkerError::Config("invalid-smtp-host"));
            }
            let port = configured("SMTP_PORT")
                .unwrap_or_else(|| "587".into())
                .parse::<u16>()
                .map_err(|_| WorkerError::Config("invalid-smtp-port"))?;
            let builder = match port {
                465 => AsyncSmtpTransport::<Tokio1Executor>::relay(&host),
                587 => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host),
                _ => return Err(WorkerError::Config("smtp-port-must-be-465-or-587")),
            }
            .map_err(|_| WorkerError::Config("invalid-smtp-tls-configuration"))?;
            let user = configured("SMTP_USER")
                .or_else(|| configured("GMAIL_SMTP_USER"))
                .ok_or(WorkerError::Config("smtp-user-required"))?;
            let pass = configured("SMTP_PASS")
                .or_else(|| configured("GMAIL_SMTP_PASS"))
                .or_else(|| configured("GMAIL_APP_PASSWORD"))
                .ok_or(WorkerError::Config("smtp-password-required"))?;
            Sender::Smtp(
                builder
                    .port(port)
                    .credentials(Credentials::new(user, pass))
                    .timeout(Some(Duration::from_secs(10)))
                    .build(),
            )
        };
        Ok(Self {
            action_origin: action_origin(&origin)?,
            from,
            sender,
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChallengePayload {
    email: String,
    #[serde(default)]
    token: String,
    #[serde(default)]
    code: String,
}

struct Job {
    id: Uuid,
    lease: Uuid,
    user_id: String,
    kind: String,
    payload: Value,
    attempts: i32,
    created_at: DateTime<Utc>,
}

struct DeliveryFailure {
    code: &'static str,
    retry: bool,
    retry_after: u32,
}

fn valid_token(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn link(origin: &Url, kind: ActionKind, token: &str) -> Result<String, DeliveryFailure> {
    if !valid_token(token) {
        return Err(DeliveryFailure {
            code: "invalid-payload",
            retry: false,
            retry_after: 0,
        });
    }
    let mut result = origin.clone();
    result.set_path(kind.path());
    // Auth pages must remove this fragment immediately and POST to the API.
    // A GET must never consume the one-time token (mail scanners follow links).
    result.set_fragment(Some(&format!("token={token}")));
    Ok(result.to_string())
}

fn valid_code(code: &str) -> bool {
    code.len() == 6 && code.bytes().all(|b| b.is_ascii_digit())
}

fn message_text(kind: ActionKind, action: &str) -> String {
    if kind == ActionKind::DeleteAccountOtp {
        return format!(
            "สวัสดี

รหัสยืนยันการลบบัญชี CampusMate อย่างถาวรของคุณคือ {action}

รหัสมีอายุ 10 นาที หากคุณไม่ได้เป็นผู้ขอลบบัญชี กรุณาเปลี่ยนรหัสผ่านทันทีและอย่าเปิดเผยรหัสนี้แก่ผู้ใด

CampusMate"
        );
    }
    let introduction = match kind {
        ActionKind::VerifyEmail => "กรุณายืนยันว่าคุณเป็นเจ้าของอีเมลที่ใช้สมัครบัญชี CampusMate",
        ActionKind::ResetPassword => "เราได้รับคำขอตั้งรหัสผ่านบัญชี CampusMate ใหม่",
        ActionKind::ChangeEmail => "กรุณายืนยันอีเมลมหาวิทยาลัยนี้เพื่อใช้กับบัญชี CampusMate ของคุณ",
        ActionKind::DeleteAccountOtp => "",
    };
    format!("สวัสดี\n\n{introduction}\n\nเปิดลิงก์นี้: {action}\n\nลิงก์ใช้ได้ครั้งเดียวและมีวันหมดอายุ หากไม่ได้เป็นผู้ดำเนินการ สามารถละเว้นอีเมลนี้ได้\n\nCampusMate")
}

fn http_failure(status: u16, retry_after: Option<&str>) -> DeliveryFailure {
    DeliveryFailure {
        code: "email-provider-rejected",
        retry: status == 408 || status == 409 || status == 429 || status >= 500,
        retry_after: retry_after
            .and_then(|v| v.parse().ok())
            .unwrap_or(0)
            .min(3600),
    }
}

impl Configuration {
    async fn send(
        &self,
        job: &Job,
        kind: ActionKind,
        payload: &ChallengePayload,
    ) -> Result<(), DeliveryFailure> {
        let action = if kind == ActionKind::DeleteAccountOtp {
            if !valid_code(&payload.code) {
                return Err(DeliveryFailure {
                    code: "invalid-payload",
                    retry: false,
                    retry_after: 0,
                });
            }
            payload.code.clone()
        } else {
            link(&self.action_origin, kind, &payload.token)?
        };
        let recipient: Address = payload.email.parse().map_err(|_| DeliveryFailure {
            code: "invalid-payload",
            retry: false,
            retry_after: 0,
        })?;
        let text = message_text(kind, &action);
        let future = async {
            match &self.sender {
                Sender::Resend { client, api_key } => {
                    let response = client
                        .post("https://api.resend.com/emails")
                        .bearer_auth(api_key)
                        .header("Idempotency-Key", format!("campusmate-auth/{}", job.id))
                        .json(&json!({
                            "from": self.from.to_string(), "to": [payload.email],
                            "reply_to": self.from.email.to_string(), "subject": kind.subject(),
                            "text": text,
                            "headers": { "X-Auto-Response-Suppress": "OOF, AutoReply" }
                        }))
                        .send()
                        .await
                        .map_err(|_| DeliveryFailure {
                            code: "email-provider-unreachable",
                            retry: true,
                            retry_after: 0,
                        })?;
                    if response.status().is_success() {
                        Ok(())
                    } else {
                        // Do not read or log provider bodies; they may include PII.
                        Err(http_failure(
                            response.status().as_u16(),
                            response
                                .headers()
                                .get("Retry-After")
                                .and_then(|v| v.to_str().ok()),
                        ))
                    }
                }
                Sender::Smtp(transport) => {
                    let email = Message::builder()
                        .from(self.from.clone())
                        .reply_to(self.from.clone())
                        .to(Mailbox::new(None, recipient))
                        .subject(kind.subject())
                        .date(job.created_at.into())
                        .message_id(Some(format!(
                            "<campusmate-auth-{}@{}>",
                            job.id,
                            self.from.email.domain()
                        )))
                        .multipart(MultiPart::alternative().singlepart(SinglePart::plain(text)))
                        .map_err(|_| DeliveryFailure {
                            code: "invalid-mail-message",
                            retry: false,
                            retry_after: 0,
                        })?;
                    transport
                        .send(email)
                        .await
                        .map(|_| ())
                        .map_err(|error| DeliveryFailure {
                            code: "smtp-delivery-failed",
                            retry: !error.is_permanent(),
                            retry_after: 0,
                        })
                }
            }
        };
        tokio::time::timeout(SEND_TIMEOUT, future)
            .await
            .unwrap_or(Err(DeliveryFailure {
                code: "email-provider-timeout",
                retry: true,
                retry_after: 0,
            }))
    }
}

async fn claim(pool: &PgPool) -> Result<Option<Job>, WorkerError> {
    // Recover crashed final attempts; their sensitive payload must not remain.
    sqlx::query("UPDATE outbox SET payload='{}'::jsonb,finished_at=now(),lease_id=NULL,locked_until=NULL,last_error_code='attempt-limit' WHERE kind IN ('verify_email','reset_password','change_email','delete_account_otp') AND finished_at IS NULL AND delivered_at IS NULL AND attempts>=$1 AND (locked_until IS NULL OR locked_until<=now())")
        .bind(MAX_ATTEMPTS).execute(pool).await.map_err(|_| WorkerError::Database)?;
    let lease = Uuid::new_v4();
    let row = sqlx::query("WITH candidate AS (SELECT id FROM outbox WHERE kind IN ('verify_email','reset_password','change_email','delete_account_otp') AND finished_at IS NULL AND delivered_at IS NULL AND attempts<$1 AND next_attempt_at<=now() AND (locked_until IS NULL OR locked_until<=now()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE outbox o SET lease_id=$2,locked_until=now()+make_interval(secs=>$3),attempts=o.attempts+1 FROM candidate c WHERE o.id=c.id RETURNING o.id,o.user_id,o.kind,o.payload,o.attempts,o.created_at")
        .bind(MAX_ATTEMPTS).bind(lease).bind(LEASE_SECONDS as f64)
        .fetch_optional(pool).await.map_err(|_| WorkerError::Database)?;
    row.map(|row| {
        Ok(Job {
            id: row.try_get("id").map_err(|_| WorkerError::Database)?,
            lease,
            user_id: row.try_get("user_id").map_err(|_| WorkerError::Database)?,
            kind: row.try_get("kind").map_err(|_| WorkerError::Database)?,
            payload: row.try_get("payload").map_err(|_| WorkerError::Database)?,
            attempts: row.try_get("attempts").map_err(|_| WorkerError::Database)?,
            created_at: row
                .try_get("created_at")
                .map_err(|_| WorkerError::Database)?,
        })
    })
    .transpose()
}

async fn still_valid(
    pool: &PgPool,
    job: &Job,
    payload: &ChallengePayload,
) -> Result<bool, WorkerError> {
    if job.kind == "delete_account_otp" {
        let digest = Sha256::digest(payload.code.as_bytes()).to_vec();
        return sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM outbox o JOIN accounts a ON a.id=o.user_id JOIN account_otps t ON t.user_id=a.id AND t.purpose='delete_account' WHERE o.id=$1 AND o.lease_id=$2 AND o.locked_until>now() AND o.finished_at IS NULL AND o.delivered_at IS NULL AND a.id=$3 AND a.email=$4 AND NOT a.suspended AND a.deleted_at IS NULL AND t.code_hash=$5 AND t.used_at IS NULL AND t.expires_at>now()+interval '30 seconds')")
            .bind(job.id).bind(job.lease).bind(&job.user_id).bind(&payload.email).bind(digest)
            .fetch_one(pool).await.map_err(|_| WorkerError::Database);
    }
    if job.kind == "change_email" {
        let digest = Sha256::digest(payload.token.as_bytes()).to_vec();
        return sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM outbox o JOIN accounts a ON a.id=o.user_id JOIN auth_challenges c ON c.user_id=a.id AND c.kind='change_email' WHERE o.id=$1 AND o.lease_id=$2 AND o.locked_until>now() AND o.finished_at IS NULL AND o.delivered_at IS NULL AND o.created_at>now()-interval '23 hours' AND a.id=$3 AND c.new_email=$4 AND NOT a.suspended AND a.deleted_at IS NULL AND c.token_hash=$5 AND c.used_at IS NULL AND c.expires_at>now()+interval '30 seconds' AND NOT EXISTS(SELECT 1 FROM accounts x WHERE x.email=$4 AND x.id<>a.id))")
            .bind(job.id).bind(job.lease).bind(&job.user_id).bind(&payload.email).bind(digest)
            .fetch_one(pool).await.map_err(|_| WorkerError::Database);
    }
    let digest = Sha256::digest(payload.token.as_bytes()).to_vec();
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM outbox o JOIN accounts a ON a.id=o.user_id JOIN auth_challenges c ON c.user_id=a.id AND c.kind=o.kind WHERE o.id=$1 AND o.lease_id=$2 AND o.locked_until>now() AND o.finished_at IS NULL AND o.delivered_at IS NULL AND o.created_at>now()-interval '23 hours' AND a.id=$3 AND a.email=$4 AND NOT a.suspended AND a.deleted_at IS NULL AND c.token_hash=$5 AND c.used_at IS NULL AND c.expires_at>now()+interval '30 seconds' AND (o.kind<>'verify_email' OR NOT a.email_verified))")
        .bind(job.id).bind(job.lease).bind(&job.user_id).bind(&payload.email).bind(digest)
        .fetch_one(pool).await.map_err(|_| WorkerError::Database)
}

async fn finish(
    pool: &PgPool,
    job: &Job,
    delivered: bool,
    code: Option<&str>,
) -> Result<(), WorkerError> {
    sqlx::query("UPDATE outbox SET payload='{}'::jsonb,finished_at=now(),delivered_at=CASE WHEN $3 THEN now() ELSE delivered_at END,lease_id=NULL,locked_until=NULL,last_error_code=$4 WHERE id=$1 AND lease_id=$2 AND finished_at IS NULL")
        .bind(job.id).bind(job.lease).bind(delivered).bind(code)
        .execute(pool).await.map_err(|_| WorkerError::Database)?;
    Ok(())
}

fn backoff_seconds(attempts: i32, id: Uuid, provider_delay: u32) -> i32 {
    let exponential = 60_u32.saturating_mul(1_u32 << attempts.saturating_sub(1).clamp(0, 6));
    let jitter = u32::from(id.as_bytes()[0]) % 16;
    exponential
        .saturating_add(jitter)
        .max(provider_delay)
        .min(3600) as i32
}

async fn failed(pool: &PgPool, job: &Job, failure: DeliveryFailure) -> Result<(), WorkerError> {
    if !failure.retry || job.attempts >= MAX_ATTEMPTS {
        return finish(pool, job, false, Some(failure.code)).await;
    }
    let delay = backoff_seconds(job.attempts, job.id, failure.retry_after);
    sqlx::query("UPDATE outbox SET next_attempt_at=now()+make_interval(secs=>$3),lease_id=NULL,locked_until=NULL,last_error_code=$4 WHERE id=$1 AND lease_id=$2 AND finished_at IS NULL")
        .bind(job.id).bind(job.lease).bind(delay as f64).bind(failure.code)
        .execute(pool).await.map_err(|_| WorkerError::Database)?;
    Ok(())
}

async fn process_one(pool: &PgPool, config: &Configuration) -> Result<bool, WorkerError> {
    let Some(job) = claim(pool).await? else {
        return Ok(false);
    };
    let Some(kind) = ActionKind::parse(&job.kind) else {
        finish(pool, &job, false, Some("invalid-kind")).await?;
        return Ok(true);
    };
    let payload: ChallengePayload = match serde_json::from_value(job.payload.clone()) {
        Ok(value) => value,
        Err(_) => {
            finish(pool, &job, false, Some("invalid-payload")).await?;
            return Ok(true);
        }
    };
    let secret_valid = if kind == ActionKind::DeleteAccountOtp {
        valid_code(&payload.code)
    } else {
        valid_token(&payload.token)
    };
    if !secret_valid || payload.email.len() > 254 || !still_valid(pool, &job, &payload).await? {
        finish(pool, &job, false, Some("challenge-cancelled-or-expired")).await?;
        return Ok(true);
    }
    // No expiry/revocation is modified. A concurrent revocation after this
    // authorization check may produce an email containing an already-invalid
    // link, which the API will reject. Sending never revives a challenge.
    match config.send(&job, kind, &payload).await {
        Ok(()) => finish(pool, &job, true, None).await?,
        Err(failure) => failed(pool, &job, failure).await?,
    }
    Ok(true)
}

async fn run() -> Result<(), WorkerError> {
    let args: Vec<String> = env::args().skip(1).collect();
    if !matches!(args.as_slice(), [send] if send == "--send")
        && !matches!(args.as_slice(), [send, once] if send == "--send" && once == "--once")
        && !matches!(args.as_slice(), [check] if check == "--check-config")
    {
        return Err(WorkerError::Config(
            "use-check-config-or-send-optionally-once",
        ));
    }
    let config = Configuration::load()?;
    if args[0] == "--check-config" {
        eprintln!(
            "campusmate-email-worker: configuration-valid; no connection or delivery performed"
        );
        return Ok(());
    }
    let database_url =
        configured("DATABASE_URL").ok_or(WorkerError::Config("database-url-required"))?;
    let pool = campusmate_backend::database::runtime_pool(&database_url, true)
        .await
        .map_err(|_| WorkerError::Database)?;
    let once = args.len() == 2;
    // Deliberately do not initialize a tracing subscriber: RUST_LOG must never
    // enable SMTP protocol/HTTP header/database parameter logging here.
    loop {
        let work = process_one(&pool, &config).await?;
        if once {
            break;
        }
        let delay = if work {
            Duration::from_millis(250)
        } else {
            Duration::from_secs(3)
        };
        tokio::select! { _=tokio::signal::ctrl_c()=>break, _=tokio::time::sleep(delay)=>{} }
    }
    pool.close().await;
    Ok(())
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        match error {
            WorkerError::Config(code) => eprintln!("campusmate-email-worker: {code}"),
            WorkerError::Database => {
                eprintln!("campusmate-email-worker: database-operation-failed")
            }
        }
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_links_reject_untrusted_forms_and_keep_tokens_out_of_queries() {
        for value in [
            "http://example.com",
            "https://user@example.com",
            "https://example.com/path",
            "https://example.com?next=elsewhere",
            "https://example.com/#data",
            "https://127.0.0.1",
            "https://localhost",
            "https://a.localhost",
            "https://example.com:8443",
        ] {
            assert!(action_origin(value).is_err());
        }
        let origin = action_origin("https://auth.example.com").unwrap();
        let token = "a".repeat(64);
        let action = link(&origin, ActionKind::ResetPassword, &token)
            .unwrap_or_else(|_| panic!("valid link"));
        let result = Url::parse(&action).unwrap();
        assert_eq!(result.path(), "/auth/reset-password");
        assert!(result.query().is_none());
        assert_eq!(result.fragment(), Some(format!("token={token}").as_str()));
        assert!(link(&origin, ActionKind::VerifyEmail, "not-a-token").is_err());
    }

    #[test]
    fn retry_policy_is_bounded_and_handles_provider_backpressure() {
        for attempt in 1..=100 {
            let delay = backoff_seconds(attempt, Uuid::nil(), 0);
            assert!((60..=3600).contains(&delay));
        }
        assert_eq!(backoff_seconds(1, Uuid::nil(), 900), 900);
        assert_eq!(backoff_seconds(8, Uuid::nil(), u32::MAX), 3600);
        for status in [400, 401, 403, 404, 422, 302] {
            assert!(!http_failure(status, None).retry);
        }
        for status in [408, 409, 429, 500, 503] {
            assert!(http_failure(status, None).retry);
        }
        assert_eq!(http_failure(429, Some("999999")).retry_after, 3600);
    }

    async fn enqueue(pool: &PgPool) -> Uuid {
        let uid = Uuid::new_v4().to_string();
        let email = format!("{uid}@example.test");
        let token = "a".repeat(64);
        sqlx::query("INSERT INTO accounts(id,email) VALUES($1,$2)")
            .bind(&uid)
            .bind(&email)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO auth_challenges(user_id,kind,token_hash,expires_at) VALUES($1,'verify_email',$2,now()+interval '1 hour')")
            .bind(&uid).bind(Sha256::digest(token.as_bytes()).to_vec()).execute(pool).await.unwrap();
        sqlx::query_scalar(
            "INSERT INTO outbox(user_id,kind,payload) VALUES($1,'verify_email',$2) RETURNING id",
        )
        .bind(&uid)
        .bind(json!({"email":email,"token":token}))
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn concurrent_claims_cannot_send_the_same_active_lease(pool: PgPool) {
        enqueue(&pool).await;
        let (first, second) = tokio::join!(claim(&pool), claim(&pool));
        assert_ne!(first.unwrap().is_some(), second.unwrap().is_some());
        assert!(claim(&pool).await.unwrap().is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn used_expired_and_changed_email_challenges_are_cancelled(pool: PgPool) {
        enqueue(&pool).await;
        let job = claim(&pool).await.unwrap().unwrap();
        let payload: ChallengePayload = serde_json::from_value(job.payload.clone()).unwrap();
        assert!(still_valid(&pool, &job, &payload).await.unwrap());
        sqlx::query("UPDATE auth_challenges SET used_at=now() WHERE user_id=$1")
            .bind(&job.user_id)
            .execute(&pool)
            .await
            .unwrap();
        assert!(!still_valid(&pool, &job, &payload).await.unwrap());
        sqlx::query("UPDATE auth_challenges SET used_at=NULL,expires_at=now()-interval '1 second' WHERE user_id=$1").bind(&job.user_id).execute(&pool).await.unwrap();
        assert!(!still_valid(&pool, &job, &payload).await.unwrap());
        sqlx::query(
            "UPDATE auth_challenges SET expires_at=now()+interval '1 hour' WHERE user_id=$1",
        )
        .bind(&job.user_id)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE accounts SET email='changed@example.test' WHERE id=$1")
            .bind(&job.user_id)
            .execute(&pool)
            .await
            .unwrap();
        assert!(!still_valid(&pool, &job, &payload).await.unwrap());
        finish(&pool, &job, false, Some("challenge-cancelled-or-expired"))
            .await
            .unwrap();
        let row = sqlx::query("SELECT payload,finished_at IS NOT NULL AS finished,delivered_at IS NULL AS undelivered FROM outbox WHERE id=$1").bind(job.id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.get::<Value, _>("payload"), json!({}));
        assert!(row.get::<bool, _>("finished") && row.get::<bool, _>("undelivered"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delivery_scrubs_tokens_and_stale_workers_cannot_finish_new_leases(pool: PgPool) {
        let id = enqueue(&pool).await;
        let stale = claim(&pool).await.unwrap().unwrap();
        sqlx::query("UPDATE outbox SET locked_until=now()-interval '1 second' WHERE id=$1")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        let current = claim(&pool).await.unwrap().unwrap();
        assert_ne!(stale.lease, current.lease);
        finish(&pool, &stale, true, None).await.unwrap();
        assert!(still_valid(
            &pool,
            &current,
            &serde_json::from_value(current.payload.clone()).unwrap()
        )
        .await
        .unwrap());
        finish(&pool, &current, true, None).await.unwrap();
        let row = sqlx::query("SELECT payload,delivered_at IS NOT NULL AS delivered,lease_id IS NULL AS released FROM outbox WHERE id=$1").bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.get::<Value, _>("payload"), json!({}));
        assert!(row.get::<bool, _>("delivered") && row.get::<bool, _>("released"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn retry_keeps_valid_payload_but_terminal_failure_scrubs_it(pool: PgPool) {
        let id = enqueue(&pool).await;
        let first = claim(&pool).await.unwrap().unwrap();
        failed(&pool, &first, http_failure(503, None))
            .await
            .unwrap();
        let row = sqlx::query("SELECT payload,next_attempt_at>now() AS delayed,finished_at IS NULL AS pending FROM outbox WHERE id=$1").bind(id).fetch_one(&pool).await.unwrap();
        assert!(row.get::<Value, _>("payload").get("token").is_some());
        assert!(row.get::<bool, _>("delayed") && row.get::<bool, _>("pending"));
        sqlx::query("UPDATE outbox SET attempts=7,next_attempt_at=now() WHERE id=$1")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        let last = claim(&pool).await.unwrap().unwrap();
        assert_eq!(last.attempts, MAX_ATTEMPTS);
        failed(&pool, &last, http_failure(503, None)).await.unwrap();
        let row = sqlx::query(
            "SELECT payload,finished_at IS NOT NULL AS finished FROM outbox WHERE id=$1",
        )
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.get::<Value, _>("payload"), json!({}));
        assert!(row.get::<bool, _>("finished"));
    }
}
