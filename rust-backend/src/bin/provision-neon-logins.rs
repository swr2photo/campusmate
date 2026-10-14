//! One-shot operator tool for a fresh Neon branch, never a public API.
//! Credentials arrive only through secret environment variables. Existing
//! runtime identities are always refused, including identities with no password.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use campusmate_backend::database;
use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions, PgSslMode},
    ConnectOptions, PgPool, Postgres, Transaction,
};
use std::{env, time::Duration};

const OWNER: &str = "campusmate_schema_owner";
const API: &str = "campusmate_api_login";
const MAIL: &str = "campusmate_mail_login";
const DATABASE: &str = "campusmate";
const LOGIN_SQL: &str = include_str!("../../operations/neon-runtime-logins.sql");
static MIGRATIONS: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Failure {
    Arguments,
    Configuration,
    Connection,
    Identity,
    Prerequisites,
    ExistingIdentity,
    Nonempty,
    Metadata,
    Transaction,
}
impl Failure {
    fn label(self) -> &'static str {
        match self {
            Self::Arguments => "PROVISION_NEON_ERROR_ARGUMENTS",
            Self::Configuration => "PROVISION_NEON_ERROR_CONFIGURATION",
            Self::Connection => "PROVISION_NEON_ERROR_CONNECTION",
            Self::Identity => "PROVISION_NEON_ERROR_IDENTITY",
            Self::Prerequisites => "PROVISION_NEON_ERROR_PREREQUISITES",
            Self::ExistingIdentity => "PROVISION_NEON_ERROR_EXISTING_IDENTITY",
            Self::Nonempty => "PROVISION_NEON_ERROR_NONEMPTY_DATABASE",
            Self::Metadata => "PROVISION_NEON_ERROR_METADATA",
            Self::Transaction => "PROVISION_NEON_ERROR_TRANSACTION",
        }
    }
}

// Deliberately no Debug implementation: these objects contain credentials.
struct Passwords {
    api: String,
    mail: String,
}
impl Passwords {
    fn new(api: &str, mail: &str) -> Result<Self, Failure> {
        fn valid(value: &str) -> bool {
            value.len() == 43
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
                && URL_SAFE_NO_PAD
                    .decode(value)
                    .is_ok_and(|bytes| bytes.len() == 32 && URL_SAFE_NO_PAD.encode(bytes) == value)
        }
        if !valid(api) || !valid(mail) || api == mail {
            return Err(Failure::Configuration);
        }
        Ok(Self {
            api: api.into(),
            mail: mail.into(),
        })
    }
}

struct Configuration {
    owner: PgConnectOptions,
    passwords: Passwords,
}

fn hostname(options: &PgConnectOptions) -> String {
    options
        .get_host()
        .trim_end_matches('.')
        .to_ascii_lowercase()
}

fn checked_dsn(
    value: &str,
    role: &str,
    direct: bool,
) -> Result<(PgConnectOptions, String), Failure> {
    // The shared factory rejects unknown security options before SQLx can log
    // their values, and enforces certificate plus hostname verification.
    let options = if direct {
        database::configured_migration_options(value)
    } else {
        database::configured_options(value)
    }
    .map_err(|_| Failure::Configuration)?;
    let parsed = url::Url::parse(value).map_err(|_| Failure::Configuration)?;
    let query: Vec<_> = parsed.query_pairs().collect();
    if value.len() > 4096
        || parsed.fragment().is_some()
        || parsed.path() != "/campusmate"
        || parsed.username() != role
        || parsed.password().is_none_or(str::is_empty)
        || query.len() != 1
        || query[0].0 != "sslmode"
        || query[0].1 != "verify-full"
        || options.get_username() != role
        || options.get_database() != Some(DATABASE)
        || options.get_port() != 5432
        || options.get_socket().is_some()
        || !matches!(options.get_ssl_mode(), PgSslMode::VerifyFull)
        || database::transaction_pool(&options) == direct
    {
        return Err(Failure::Configuration);
    }
    let host = hostname(&options);
    let first = host.split('.').next().ok_or(Failure::Configuration)?;
    if !host.ends_with(".neon.tech")
        || !first.starts_with("ep-")
        || !host.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'.')
        })
    {
        return Err(Failure::Configuration);
    }
    Ok((
        options.disable_statement_logging(),
        parsed.password().unwrap_or_default().into(),
    ))
}

fn configuration(owner: &str, api: &str, mail: &str) -> Result<Configuration, Failure> {
    let (owner, _) = checked_dsn(owner, OWNER, true)?;
    let (api, api_password) = checked_dsn(api, API, false)?;
    let (mail, mail_password) = checked_dsn(mail, MAIL, false)?;
    let direct_host = hostname(&owner);
    let (endpoint, suffix) = direct_host.split_once('.').ok_or(Failure::Configuration)?;
    let pool_host = format!("{endpoint}-pooler.{suffix}");
    if hostname(&api) != pool_host || hostname(&mail) != pool_host {
        return Err(Failure::Configuration);
    }
    Ok(Configuration {
        owner,
        passwords: Passwords::new(&api_password, &mail_password)?,
    })
}

struct Target<'a> {
    database: &'a str,
    owner: &'a str,
    api: &'a str,
    mail: &'a str,
}
impl Target<'_> {
    fn validate(&self) -> Result<(), Failure> {
        for value in [self.database, self.owner, self.api, self.mail] {
            if value.is_empty()
                || value.len() > 63
                || value.as_bytes()[0].is_ascii_digit()
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            {
                return Err(Failure::Configuration);
            }
        }
        if self.api == self.mail || self.api == self.owner || self.mail == self.owner {
            return Err(Failure::Configuration);
        }
        Ok(())
    }

    fn script(&self) -> Result<String, Failure> {
        // Strip only the trusted file's outer transaction. Its DO blocks stay
        // intact; the caller owns one transaction for grants and both passwords.
        let (_, body) = LOGIN_SQL
            .split_once("BEGIN;")
            .ok_or(Failure::Prerequisites)?;
        let body = body
            .trim()
            .strip_suffix("COMMIT;")
            .ok_or(Failure::Prerequisites)?;
        Ok(body
            .replace(API, self.api)
            .replace(MAIL, self.mail)
            .replace("'campusmate'", &format!("'{}'", self.database))
            .replace(
                "DATABASE campusmate",
                &format!("DATABASE \"{}\"", self.database),
            ))
    }
}

async fn apply(
    tx: &mut Transaction<'_, Postgres>,
    target: &Target<'_>,
    passwords: &Passwords,
) -> Result<(), Failure> {
    target.validate()?;
    sqlx::raw_sql("SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='2000ms'; SET LOCAL password_encryption='scram-sha-256'; SET LOCAL search_path=pg_catalog,public;")
        .execute(&mut **tx).await.map_err(|_| Failure::Transaction)?;
    let (db, current, session, owns_db, schema_usage, schema_create): (
        String,
        String,
        String,
        bool,
        bool,
        bool,
    ) = sqlx::query_as(
        "SELECT current_database(),current_user::text,session_user::text,
         datdba=current_user::regrole,has_schema_privilege(current_user,'public','USAGE'),
         has_schema_privilege(current_user,'public','CREATE')
         FROM pg_catalog.pg_database WHERE datname=current_database()",
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| Failure::Metadata)?;
    if db != target.database
        || current != target.owner
        || session != target.owner
        || !owns_db
        || !schema_usage
        || !schema_create
    {
        return Err(Failure::Identity);
    }
    let migrated: bool = sqlx::query_scalar(
        "SELECT to_regclass('public._sqlx_migrations') IS NOT NULL
         AND to_regclass('public.accounts') IS NOT NULL",
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| Failure::Metadata)?;
    if !migrated {
        return Err(Failure::Prerequisites);
    }
    for migration in MIGRATIONS.iter() {
        if migration.migration_type.is_down_migration() {
            continue;
        }
        let valid: Option<bool> = sqlx::query_scalar(
            "SELECT success AND checksum=$2 FROM public._sqlx_migrations WHERE version=$1",
        )
        .bind(migration.version)
        .bind(migration.checksum.as_ref())
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| Failure::Metadata)?;
        if valid != Some(true) {
            return Err(Failure::Prerequisites);
        }
    }
    let grants_ready: bool = sqlx::query_scalar(
        "SELECT count(*)=2 AND bool_and(NOT rolcanlogin AND NOT rolsuper
         AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
         FROM pg_catalog.pg_roles WHERE rolname IN ('campusmate_api','campusmate_mail')",
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| Failure::Metadata)?;
    if !grants_ready {
        return Err(Failure::Prerequisites);
    }
    let capability_inherits: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_roles child
         JOIN pg_catalog.pg_roles parent ON child.oid<>parent.oid
         AND pg_has_role(child.oid,parent.oid,'MEMBER')
         WHERE child.rolname IN ('campusmate_api','campusmate_mail'))",
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| Failure::Metadata)?;
    if capability_inherits {
        return Err(Failure::Prerequisites);
    }
    let grants_ready: bool = sqlx::query_scalar(
        "SELECT has_schema_privilege('campusmate_api','public','USAGE')
         AND has_schema_privilege('campusmate_mail','public','USAGE')
         AND has_table_privilege('campusmate_api','public.accounts','SELECT')
         AND has_table_privilege('campusmate_mail','public.outbox','SELECT')
         AND NOT has_column_privilege('campusmate_mail','public.accounts','password_hash','SELECT')",
    ).fetch_one(&mut **tx).await.map_err(|_| Failure::Metadata)?;
    if !grants_ready {
        return Err(Failure::Prerequisites);
    }
    // The exclusive table lock prevents a first account from racing the empty
    // branch check. No account columns or credentials are read.
    sqlx::query("LOCK TABLE public.accounts IN ACCESS EXCLUSIVE MODE")
        .execute(&mut **tx)
        .await
        .map_err(|_| Failure::Transaction)?;
    if sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM public.accounts)")
        .fetch_one(&mut **tx)
        .await
        .map_err(|_| Failure::Metadata)?
    {
        return Err(Failure::Nonempty);
    }
    sqlx::query("SELECT pg_advisory_xact_lock(7498196128811)")
        .execute(&mut **tx)
        .await
        .map_err(|_| Failure::Transaction)?;
    let existing: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=$1 OR rolname=$2)",
    )
    .bind(target.api)
    .bind(target.mail)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| Failure::Metadata)?;
    if existing {
        return Err(Failure::ExistingIdentity);
    }
    // Unconditional CREATE is essential: roles are cluster-wide while advisory
    // locks are database-scoped. A competing database's CREATE must abort this
    // transaction instead of making the guarded SQL script reuse its identity.
    for role in [target.api, target.mail] {
        sqlx::raw_sql(&format!("CREATE ROLE \"{role}\" LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"))
            .execute(&mut **tx).await.map_err(|_| Failure::Transaction)?;
    }
    sqlx::raw_sql(&target.script()?)
        .execute(&mut **tx)
        .await
        .map_err(|_| Failure::Transaction)?;
    for (role, password) in [(target.api, &passwords.api), (target.mail, &passwords.mail)] {
        // Both identifiers and secrets are strictly validated ASCII. PostgreSQL
        // role DDL cannot bind a password parameter; no arbitrary SQL is accepted.
        sqlx::raw_sql(&format!("ALTER ROLE \"{role}\" PASSWORD '{password}'"))
            .execute(&mut **tx)
            .await
            .map_err(|_| Failure::Transaction)?;
    }
    Ok(())
}

async fn provision(
    pool: &PgPool,
    target: &Target<'_>,
    passwords: &Passwords,
) -> Result<(), Failure> {
    let mut tx = pool.begin().await.map_err(|_| Failure::Transaction)?;
    if let Err(error) = apply(&mut tx, target, passwords).await {
        let _ = tx.rollback().await;
        return Err(error);
    }
    tx.commit().await.map_err(|_| Failure::Transaction)
}

async fn run() -> Result<(), Failure> {
    if env::args_os().nth(1).is_some() {
        return Err(Failure::Arguments);
    }
    let configuration = configuration(
        &env::var("DATABASE_DIRECT_URL").map_err(|_| Failure::Configuration)?,
        &env::var("NEON_API_DATABASE_URL").map_err(|_| Failure::Configuration)?,
        &env::var("NEON_MAIL_DATABASE_URL").map_err(|_| Failure::Configuration)?,
    )?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .min_connections(0)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(configuration.owner)
        .await
        .map_err(|_| Failure::Connection)?;
    let result = provision(
        &pool,
        &Target {
            database: DATABASE,
            owner: OWNER,
            api: API,
            mail: MAIL,
        },
        &configuration.passwords,
    )
    .await;
    pool.close().await;
    result
}

#[tokio::main]
async fn main() {
    // Never install a tracing subscriber or display SQLx errors/DSNs/secrets.
    match run().await {
        Ok(()) => println!("PROVISION_NEON_RUNTIME_LOGINS_OK"),
        Err(error) => {
            eprintln!("{}", error.label());
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn passwords() -> Passwords {
        Passwords::new(
            &URL_SAFE_NO_PAD.encode([11_u8; 32]),
            &URL_SAFE_NO_PAD.encode([23_u8; 32]),
        )
        .unwrap()
    }
    fn urls() -> (String, String, String) {
        let passwords = passwords();
        (
            "postgres://campusmate_schema_owner:synthetic-owner-secret@ep-fixture-123.c-4.ap-southeast-1.aws.neon.tech/campusmate?sslmode=verify-full".into(),
            format!("postgres://{API}:{}@ep-fixture-123-pooler.c-4.ap-southeast-1.aws.neon.tech/campusmate?sslmode=verify-full", passwords.api),
            format!("postgres://{MAIL}:{}@ep-fixture-123-pooler.c-4.ap-southeast-1.aws.neon.tech/campusmate?sslmode=verify-full", passwords.mail),
        )
    }
    #[test]
    fn matching_neon_urls_validate_without_connecting_or_exposing_secrets() {
        let (owner, api, mail) = urls();
        let configuration = configuration(&owner, &api, &mail).unwrap();
        assert!(!database::transaction_pool(&configuration.owner));
        assert!(matches!(
            configuration.owner.get_ssl_mode(),
            PgSslMode::VerifyFull
        ));
        assert_eq!(configuration.passwords.api.len(), 43);
        assert_ne!(configuration.passwords.api, configuration.passwords.mail);
        assert_eq!(
            Failure::Configuration.label(),
            "PROVISION_NEON_ERROR_CONFIGURATION"
        );
    }
    #[test]
    fn wrong_endpoints_roles_databases_options_and_passwords_are_rejected() {
        let (owner, api, mail) = urls();
        for invalid in [
            owner.replace("ep-fixture-123.", "ep-fixture-123-pooler."),
            owner.replace(OWNER, API),
            owner.replace("/campusmate?", "/other?"),
            owner.replace("verify-full", "disable"),
            format!("{owner}&channel_binding=require"),
            format!("{owner}&host=other.neon.tech"),
            format!("{owner}#private-fragment"),
        ] {
            assert!(matches!(
                configuration(&invalid, &api, &mail),
                Err(Failure::Configuration)
            ));
        }
        for invalid in [
            api.replace("ep-fixture-123-pooler", "ep-other-pooler"),
            api.replace("-pooler.c-4", ".c-4"),
            api.replace(API, MAIL),
            api.replace("/campusmate?", "/other?"),
            api.replace("verify-full", "require"),
        ] {
            assert!(matches!(
                configuration(&owner, &invalid, &mail),
                Err(Failure::Configuration)
            ));
        }
        let pass = passwords();
        for invalid in [
            "short".into(),
            "'".repeat(43),
            "A".repeat(42),
            "A".repeat(44),
        ] {
            assert!(matches!(
                Passwords::new(&invalid, &pass.mail),
                Err(Failure::Configuration)
            ));
        }
        assert!(matches!(
            Passwords::new(&pass.api, &pass.api),
            Err(Failure::Configuration)
        ));
    }

    async fn prerequisites(pool: &PgPool) {
        sqlx::raw_sql(include_str!("../../operations/runtime-grants.sql"))
            .execute(pool)
            .await
            .unwrap();
    }
    fn test_names() -> (String, String) {
        let suffix = Uuid::new_v4().simple().to_string();
        (
            format!("provision_api_{suffix}"),
            format!("provision_mail_{suffix}"),
        )
    }
    async fn roles_exist(pool: &PgPool, names: &[&str]) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM pg_roles WHERE rolname=ANY($1)")
            .bind(names)
            .fetch_one(pool)
            .await
            .unwrap()
    }
    async fn cleanup(pool: &PgPool, names: &[&str]) {
        for name in names {
            sqlx::raw_sql(&format!("DROP OWNED BY \"{name}\"; DROP ROLE \"{name}\";"))
                .execute(pool)
                .await
                .unwrap();
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn fresh_disposable_database_commits_distinct_scram_logins(pool: PgPool) {
        prerequisites(&pool).await;
        let options = pool.connect_options();
        let (api, mail) = test_names();
        let target = Target {
            database: options.get_database().unwrap(),
            owner: options.get_username(),
            api: &api,
            mail: &mail,
        };
        let passwords = passwords();
        provision(&pool, &target, &passwords).await.unwrap();
        assert_eq!(roles_exist(&pool, &[&api, &mail]).await, 2);
        for (role, capability, password) in [
            (&api, "campusmate_api", &passwords.api),
            (&mail, "campusmate_mail", &passwords.mail),
        ] {
            let valid:bool=sqlx::query_scalar("SELECT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AND rolpassword LIKE 'SCRAM-SHA-256$%' AND pg_has_role(oid,(SELECT oid FROM pg_roles WHERE rolname=$2),'USAGE') FROM pg_authid WHERE rolname=$1")
                .bind(role).bind(capability).fetch_one(&pool).await.unwrap();
            assert!(valid);
            let runtime = PgPoolOptions::new()
                .max_connections(1)
                .connect_with(options.as_ref().clone().username(role).password(password))
                .await
                .unwrap();
            let (timeout, source): (i64, String) = sqlx::query_as(
                "SELECT setting::bigint,source FROM pg_settings WHERE name='statement_timeout'",
            )
            .fetch_one(&runtime)
            .await
            .unwrap();
            assert_eq!((timeout, source), (5000, "database user".into()));
            runtime.close().await;
        }
        cleanup(&pool, &[&api, &mail]).await;
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn existing_password_and_passwordless_roles_are_never_reused(pool: PgPool) {
        prerequisites(&pool).await;
        let options = pool.connect_options();
        for existing_password in [true, false] {
            let (api, mail) = test_names();
            let target = Target {
                database: options.get_database().unwrap(),
                owner: options.get_username(),
                api: &api,
                mail: &mail,
            };
            let password_clause = if existing_password {
                " PASSWORD 'synthetic-existing-password'"
            } else {
                ""
            };
            sqlx::raw_sql(&format!("CREATE ROLE \"{api}\" LOGIN{password_clause}"))
                .execute(&pool)
                .await
                .unwrap();
            let before: Option<String> =
                sqlx::query_scalar("SELECT rolpassword FROM pg_authid WHERE rolname=$1")
                    .bind(&api)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(
                provision(&pool, &target, &passwords()).await,
                Err(Failure::ExistingIdentity)
            );
            let after: Option<String> =
                sqlx::query_scalar("SELECT rolpassword FROM pg_authid WHERE rolname=$1")
                    .bind(&api)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(before, after);
            assert_eq!(roles_exist(&pool, &[&mail]).await, 0);
            cleanup(&pool, &[&api]).await;
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn failure_rolls_back_roles_passwords_grants_and_nonempty_databases_are_refused(
        pool: PgPool,
    ) {
        prerequisites(&pool).await;
        let options = pool.connect_options();
        let (api, mail) = test_names();
        let target = Target {
            database: options.get_database().unwrap(),
            owner: options.get_username(),
            api: &api,
            mail: &mail,
        };
        let mut tx = pool.begin().await.unwrap();
        apply(&mut tx, &target, &passwords()).await.unwrap();
        assert!(sqlx::raw_sql(&format!("CREATE ROLE \"{api}\""))
            .execute(&mut *tx)
            .await
            .is_err());
        tx.rollback().await.unwrap();
        assert_eq!(roles_exist(&pool, &[&api, &mail]).await, 0);
        sqlx::query("INSERT INTO accounts(id,email) VALUES('provision-fixture','provision-fixture@psu.ac.th')")
            .execute(&pool).await.unwrap();
        assert_eq!(
            provision(&pool, &target, &passwords()).await,
            Err(Failure::Nonempty)
        );
        assert_eq!(roles_exist(&pool, &[&api, &mail]).await, 0);
    }
}
