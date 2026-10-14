use anyhow::{ensure, Result};
use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions, PgSslMode},
    PgPool,
};
use std::{path::PathBuf, str::FromStr, time::Duration};

fn checked_url(value: &str) -> Result<()> {
    let parsed =
        url::Url::parse(value).map_err(|_| anyhow::anyhow!("invalid database configuration"))?;
    ensure!(
        matches!(parsed.scheme(), "postgres" | "postgresql"),
        "invalid database configuration"
    );
    for (key, value) in parsed.query_pairs() {
        // SQLx 0.8 ignores unknown parameters and logs their values. Reject
        // them before parsing, including security options it cannot enforce.
        let supported = matches!(
            key.as_ref(),
            "sslmode"
                | "ssl-mode"
                | "sslrootcert"
                | "ssl-root-cert"
                | "ssl-ca"
                | "sslcert"
                | "ssl-cert"
                | "sslkey"
                | "ssl-key"
                | "statement-cache-capacity"
                | "host"
                | "hostaddr"
                | "port"
                | "dbname"
                | "user"
                | "password"
                | "application_name"
                | "options"
        ) || (key.starts_with("options[") && key.ends_with(']'));
        if key == "channel_binding" && value == "require" {
            anyhow::bail!("SQLx does not enforce channel_binding=require; configure verified TLS without this unsupported option");
        }
        ensure!(supported, "unsupported database parameter");
    }
    Ok(())
}

fn neon_host(options: &PgConnectOptions) -> bool {
    options
        .get_host()
        .trim_end_matches('.')
        .to_ascii_lowercase()
        .ends_with(".neon.tech")
}

pub fn transaction_pool(options: &PgConnectOptions) -> bool {
    let host = options
        .get_host()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    neon_host(options)
        && host
            .split('.')
            .next()
            .is_some_and(|part| part.ends_with("-pooler"))
}

/// Direct TCP always verifies the server. Only the named, local Cloud Run
/// Cloud SQL socket may rely on the platform's authenticated encrypted tunnel.
pub fn options(url: &str, mode: &str, cloud_sql: Option<&str>) -> Result<PgConnectOptions> {
    checked_url(url)?;
    let parsed = PgConnectOptions::from_str(url)
        .map_err(|_| anyhow::anyhow!("invalid database configuration"))?;
    if matches!(mode, "development" | "test") && !neon_host(&parsed) {
        return Ok(parsed);
    }
    if let Some(socket) = parsed.get_socket() {
        let connection = cloud_sql.ok_or_else(|| {
            anyhow::anyhow!("CLOUD_SQL_CONNECTION_NAME required for production socket")
        })?;
        let parts: Vec<&str> = connection.split(':').collect();
        ensure!(
            parts.len() == 3
                && parts.iter().all(|part| !part.is_empty()
                    && part
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')),
            "invalid Cloud SQL connection name"
        );
        ensure!(
            socket == &PathBuf::from(format!("/cloudsql/{connection}")),
            "untrusted production database socket"
        );
        return Ok(parsed.ssl_mode(PgSslMode::Disable));
    }
    Ok(parsed.ssl_mode(PgSslMode::VerifyFull))
}

pub fn configured_migration_options(url: &str) -> Result<PgConnectOptions> {
    let options = configured_options(url)?;
    ensure!(
        !transaction_pool(&options),
        "migrations require a direct database endpoint; set DATABASE_DIRECT_URL"
    );
    Ok(options)
}

pub fn migration_url() -> Result<String> {
    std::env::var("DATABASE_DIRECT_URL")
        .or_else(|_| std::env::var("DATABASE_URL_UNPOOLED"))
        .or_else(|_| std::env::var("DATABASE_URL"))
        .map_err(|_| anyhow::anyhow!("DATABASE_DIRECT_URL required"))
}

/// `LISTEN` needs a session connection. Neon serves the same login on the
/// direct endpoint, so a pooler `DATABASE_URL` maps to it by dropping
/// `-pooler`; `DATABASE_LISTEN_URL` overrides that.
pub fn listen_url(database_url: &str) -> Option<String> {
    std::env::var("DATABASE_LISTEN_URL")
        .ok()
        .or_else(|| direct_neon_url(database_url))
}

fn direct_neon_url(url: &str) -> Option<String> {
    let mut parsed = url::Url::parse(url).ok()?;
    let host = parsed
        .host_str()?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    let (first, rest) = host.split_once('.')?;
    let endpoint = first.strip_suffix("-pooler")?;
    if !rest.ends_with(".neon.tech") {
        return None;
    }
    parsed.set_host(Some(&format!("{endpoint}.{rest}"))).ok()?;
    Some(parsed.into())
}

#[derive(Clone, Debug)]
pub struct PoolSettings {
    pub maximum: u32,
    pub minimum: u32,
    pub acquire_seconds: u64,
    pub idle_seconds: u64,
    pub lifetime_seconds: u64,
}
impl PoolSettings {
    pub fn from_environment(mail: bool) -> Result<Self> {
        fn value(name: &str, default: u64, min: u64, max: u64) -> Result<u64> {
            let number = match std::env::var(name) {
                Ok(value) => value
                    .parse()
                    .map_err(|_| anyhow::anyhow!("invalid database pool setting"))?,
                Err(std::env::VarError::NotPresent) => default,
                Err(_) => anyhow::bail!("invalid database pool setting"),
            };
            ensure!(
                (min..=max).contains(&number),
                "database pool setting outside permitted range"
            );
            Ok(number)
        }
        let settings = Self {
            maximum: value("DB_MAX_CONNECTIONS", if mail { 2 } else { 16 }, 1, 64)? as u32,
            minimum: value("DB_MIN_CONNECTIONS", 0, 0, 64)? as u32,
            acquire_seconds: value("DB_ACQUIRE_TIMEOUT_SECONDS", 8, 1, 15)?,
            idle_seconds: value("DB_IDLE_TIMEOUT_SECONDS", 60, 10, 900)?,
            lifetime_seconds: value("DB_MAX_LIFETIME_SECONDS", 900, 60, 3600)?,
        };
        ensure!(
            settings.minimum <= settings.maximum,
            "database minimum exceeds maximum connections"
        );
        Ok(settings)
    }
}

pub fn pool_options(settings: &PoolSettings, pooled: bool) -> PgPoolOptions {
    PgPoolOptions::new()
        .max_connections(settings.maximum).min_connections(settings.minimum)
        .acquire_timeout(Duration::from_secs(settings.acquire_seconds))
        .idle_timeout(Duration::from_secs(settings.idle_seconds))
        .max_lifetime(Duration::from_secs(settings.lifetime_seconds))
        .after_connect(move|connection,_|Box::pin(async move {
            if pooled {
                let row=sqlx::query_as::<_,(i64,String)>("SELECT setting::bigint,source FROM pg_settings WHERE name='statement_timeout'").fetch_one(connection).await?;
                if !(1..=5000).contains(&row.0)||!matches!(row.1.as_str(),"user"|"database user") {
                    return Err(sqlx::Error::Protocol("transaction pool requires statement_timeout at the login-role level".into()));
                }
            }else {
                sqlx::query("SET statement_timeout = '5000ms'").execute(connection).await?;
            }
            Ok(())
        }))
}

pub async fn runtime_pool(url: &str, mail: bool) -> Result<PgPool> {
    let options = configured_options(url)?;
    let auto = transaction_pool(&options);
    let pooled = match std::env::var("DB_POOL_MODE").as_deref() {
        Ok("transaction") => true,
        Ok("direct") => {
            ensure!(!auto, "Neon pooler cannot use direct session settings");
            false
        }
        Ok("auto") | Err(std::env::VarError::NotPresent) => auto,
        _ => anyhow::bail!("invalid DB_POOL_MODE"),
    };
    pool_options(&PoolSettings::from_environment(mail)?, pooled)
        .connect_with(options)
        .await
        .map_err(|_| anyhow::anyhow!("database connection or pool readiness failed"))
}

pub fn configured_options(url: &str) -> Result<PgConnectOptions> {
    options(
        url,
        &std::env::var("APP_ENV").unwrap_or_else(|_| "production".into()),
        std::env::var("CLOUD_SQL_CONNECTION_NAME").ok().as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn neon_pooler_url_maps_to_its_direct_endpoint_for_listen() {
        let pooled = "postgres://a:p@ep-x-pooler.c-4.aws.neon.tech/db?sslmode=verify-full";
        let direct = "postgres://a:p@ep-x.c-4.aws.neon.tech/db?sslmode=verify-full";
        assert_eq!(direct_neon_url(pooled).as_deref(), Some(direct));
        assert!(configured_migration_options(direct).is_ok());
        for url in [
            direct,
            "postgres://a:p@db-pooler.example.test/db",
            "not a url",
        ] {
            assert_eq!(direct_neon_url(url), None);
        }
    }
    #[test]
    fn neon_pool_detection_and_security_options_fail_closed() {
        let pooled=options("postgres://u:p@ep-campus-pooler.ap-southeast-1.aws.neon.tech/campusmate?sslmode=disable","test",None).unwrap();
        assert!(transaction_pool(&pooled));
        assert!(matches!(pooled.get_ssl_mode(), PgSslMode::VerifyFull));
        let uppercase=options("postgres://u:p@EP-CAMPUS-POOLER.AP-SOUTHEAST-1.AWS.NEON.TECH./campusmate?sslmode=disable","test",None).unwrap();
        assert!(transaction_pool(&uppercase));
        assert!(matches!(uppercase.get_ssl_mode(), PgSslMode::VerifyFull));
        assert!(configured_migration_options(
            "postgres://u:p@ep-campus-pooler.ap-southeast-1.aws.neon.tech/campusmate"
        )
        .is_err());
        for query in [
            "channel_binding=require",
            "sslnegotiation=direct",
            "unknown-secret=private",
        ] {
            let error = options(
                &format!("postgres://u:private@db.example.test/campusmate?{query}"),
                "production",
                None,
            )
            .unwrap_err()
            .to_string();
            assert!(!error.contains("private") && !error.contains("db.example.test"));
        }
        assert!(!transaction_pool(
            &options(
                "postgres://u:p@ep-campus.ap-southeast-1.aws.neon.tech/campusmate",
                "production",
                None
            )
            .unwrap()
        ));
        assert!(!transaction_pool(
            &options(
                "postgres://u:p@ep-campus-pooler.example.test/campusmate",
                "production",
                None
            )
            .unwrap()
        ));
    }
    #[test]
    fn production_tcp_cannot_disable_certificate_verification() {
        for suffix in ["disable", "prefer", "require"] {
            assert!(matches!(
                options(
                    &format!("postgres://u:p@db.example.test/campusmate?sslmode={suffix}"),
                    "production",
                    None
                )
                .unwrap()
                .get_ssl_mode(),
                PgSslMode::VerifyFull
            ));
        }
    }
    #[test]
    fn socket_exception_is_scoped_to_the_explicit_cloud_sql_mount() {
        let name = "campusmate-7f1ab:asia-southeast1:campusmate-7f1ab-instance";
        let url = format!("postgres://u:p@localhost/campusmate?host=/cloudsql/{name}");
        assert!(matches!(
            options(&url, "production", Some(name))
                .unwrap()
                .get_ssl_mode(),
            PgSslMode::Disable
        ));
        assert!(options(&url, "production", None).is_err());
        assert!(options(
            "postgres://u:p@localhost/campusmate?host=/tmp/unsafe",
            "production",
            Some(name)
        )
        .is_err());
        assert!(options(&url, "production", Some("../bad:region:instance")).is_err());
    }
}
