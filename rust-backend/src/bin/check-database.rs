//! Read-only database readiness checks. This executable reads PostgreSQL
//! metadata only, never account records, token columns or mail payloads.

use std::{env, time::Duration};

use campusmate_backend::database;
use sqlx::{postgres::PgPoolOptions, PgConnection, PgPool, Row};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Api,
    Mail,
    Owner,
}

impl Kind {
    fn parse(args: &[String]) -> Result<Self, Failure> {
        if args.len() != 2 || args[0] != "--kind" {
            return Err(Failure::Arguments);
        }
        match args[1].as_str() {
            "api" => Ok(Self::Api),
            "mail" => Ok(Self::Mail),
            "owner" => Ok(Self::Owner),
            _ => Err(Failure::Arguments),
        }
    }
    fn capability(self) -> Option<&'static str> {
        match self {
            Self::Api => Some("campusmate_api"),
            Self::Mail => Some("campusmate_mail"),
            Self::Owner => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Failure {
    Arguments,
    Configuration,
    Connection,
    Metadata,
    Identity,
    Capability,
    Ownership,
    Privileges,
    Timeout,
}
impl Failure {
    fn label(self) -> &'static str {
        match self {
            Self::Arguments => "READINESS_ERROR_ARGUMENTS",
            Self::Configuration => "READINESS_ERROR_CONFIGURATION",
            Self::Connection => "READINESS_ERROR_CONNECTION",
            Self::Metadata => "READINESS_ERROR_METADATA",
            Self::Identity => "READINESS_ERROR_IDENTITY",
            Self::Capability => "READINESS_ERROR_CAPABILITY",
            Self::Ownership => "READINESS_ERROR_OWNERSHIP",
            Self::Privileges => "READINESS_ERROR_PRIVILEGES",
            Self::Timeout => "READINESS_ERROR_TIMEOUT",
        }
    }
}
impl From<sqlx::Error> for Failure {
    fn from(_: sqlx::Error) -> Self {
        Self::Metadata
    }
}

// Every name below is a source-controlled constant. PostgreSQL privilege
// functions consult ACL metadata; no SELECT/UPDATE on these relations runs.
const IDENTITY_TABLES: [&str; 5] = [
    "public.face_verification_attempts",
    "public.user_photo_verifications",
    "public.identity_review_requests",
    "public.identity_verification_audit_events",
    "public.identity_alternative_requests",
];
const IDENTITY_COLUMNS: [(&str, &[&str], &[&str]); 5] = [
    (
        "public.face_verification_attempts",
        &[
            "id",
            "user_id",
            "aws_region",
            "challenge",
            "reference_source",
            "reference_key",
            "reference_sha256",
            "replacement_base",
            "consent_version",
            "consented_at",
            "policy_version",
            "state",
            "expires_at",
            "gesture_sequence",
        ],
        &[
            "state",
            "failure_code",
            "finished_at",
            "updated_at",
            "reference_purge_after",
            "reference_deleted_at",
            "aws_session_id",
            "expires_at",
            "evidence_key",
            "evidence_stored",
            "gesture_step",
            "gesture_failures",
            "gesture_turn_sign",
            "gesture_lease_until",
            "gestures_passed_at",
        ],
    ),
    (
        "public.user_photo_verifications",
        &[
            "user_id",
            "latest_attempt_id",
            "verified_reference_source",
            "verified_reference_sha256",
            "status",
            "method",
            "policy_version",
            "verified_at",
            "revoked_at",
            "revoke_reason",
            "updated_at",
        ],
        &[
            "latest_attempt_id",
            "verified_reference_source",
            "verified_reference_sha256",
            "status",
            "method",
            "policy_version",
            "verified_at",
            "revoked_at",
            "revoke_reason",
            "updated_at",
        ],
    ),
    (
        "public.identity_review_requests",
        &["attempt_id", "user_id", "note"],
        &[
            "note",
            "status",
            "decided_by",
            "decided_at",
            "viewed_by",
            "viewed_at",
        ],
    ),
    (
        "public.identity_verification_audit_events",
        &[
            "user_id",
            "attempt_id",
            "event_type",
            "actor_type",
            "actor_id",
            "policy_version",
        ],
        &[],
    ),
    (
        "public.identity_alternative_requests",
        &["user_id", "reason", "note"],
        &["note", "status", "resolved_by", "resolved_at"],
    ),
];

async fn table(db: &mut PgConnection, name: &str, privilege: &str) -> Result<bool, Failure> {
    Ok(sqlx::query_scalar(
        "SELECT COALESCE(has_table_privilege(current_user,to_regclass($1),$2),false)",
    )
    .bind(name)
    .bind(privilege)
    .fetch_one(db)
    .await?)
}
async fn column(
    db: &mut PgConnection,
    name: &str,
    field: &str,
    privilege: &str,
) -> Result<bool, Failure> {
    Ok(sqlx::query_scalar(
        "SELECT COALESCE(has_column_privilege(current_user,to_regclass($1),$2,$3),false)",
    )
    .bind(name)
    .bind(field)
    .bind(privilege)
    .fetch_one(db)
    .await?)
}
async fn any_column(db: &mut PgConnection, name: &str, privilege: &str) -> Result<bool, Failure> {
    Ok(sqlx::query_scalar(
        "SELECT COALESCE(has_any_column_privilege(current_user,to_regclass($1),$2),false)",
    )
    .bind(name)
    .bind(privilege)
    .fetch_one(db)
    .await?)
}
async fn capability(db: &mut PgConnection, name: &str) -> Result<bool, Failure> {
    Ok(sqlx::query_scalar("SELECT COALESCE((SELECT pg_has_role(current_user,oid,'USAGE') FROM pg_roles WHERE rolname=$1),false)")
        .bind(name).fetch_one(db).await?)
}

async fn identity(db: &mut PgConnection, kind: Kind) -> Result<(), Failure> {
    let own: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user)")
            .fetch_one(&mut *db)
            .await?;
    if !own {
        return Err(Failure::Identity);
    }
    if kind == Kind::Owner {
        return Ok(());
    }
    let elevated:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE (pg_has_role(current_user,oid,'USAGE') OR pg_has_role(session_user,oid,'USAGE')) AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='neon_superuser' AND (pg_has_role(current_user,oid,'MEMBER') OR pg_has_role(session_user,oid,'MEMBER')))")
        .fetch_one(&mut *db).await?;
    if elevated {
        return Err(Failure::Identity);
    }
    let expected = kind.capability().expect("runtime");
    let opposite = if kind == Kind::Api {
        "campusmate_mail"
    } else {
        "campusmate_api"
    };
    if !capability(&mut *db, expected).await? || capability(&mut *db, opposite).await? {
        return Err(Failure::Capability);
    }
    Ok(())
}

async fn ownership(db: &mut PgConnection, kind: Kind) -> Result<(), Failure> {
    let schema=sqlx::query("SELECT has_schema_privilege(current_user,'public','USAGE') AS usage,has_schema_privilege(current_user,'public','CREATE') AS create,has_database_privilege(current_user,current_database(),'CREATE') AS database_create")
        .fetch_one(&mut *db).await?;
    if !schema.get::<bool, _>("usage") {
        return Err(Failure::Ownership);
    }
    if kind == Kind::Owner {
        if !schema.get::<bool, _>("create") {
            return Err(Failure::Ownership);
        }
        return Ok(());
    }
    let owner:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='public' AND (pg_has_role(current_user,nspowner,'USAGE') OR pg_has_role(session_user,nspowner,'USAGE'))) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (pg_has_role(current_user,c.relowner,'USAGE') OR pg_has_role(session_user,c.relowner,'USAGE'))) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (pg_has_role(current_user,p.proowner,'USAGE') OR pg_has_role(session_user,p.proowner,'USAGE')))")
        .fetch_one(&mut *db).await?;
    if owner || schema.get::<bool, _>("create") || schema.get::<bool, _>("database_create") {
        return Err(Failure::Ownership);
    }
    Ok(())
}

async fn permissions(db: &mut PgConnection, kind: Kind) -> Result<(), Failure> {
    if kind == Kind::Owner {
        return Ok(());
    }
    if any_column(&mut *db, "public.migration_documents", "SELECT").await? {
        return Err(Failure::Privileges);
    }
    identity_permissions(&mut *db, kind).await?;
    match kind {
        Kind::Api => {
            if column(&mut *db, "public.outbox", "payload", "SELECT").await?
                || column(&mut *db, "public.outbox", "payload", "UPDATE").await?
            {
                return Err(Failure::Privileges);
            }
            for name in [
                "accounts",
                "profiles",
                "entitlements",
                "sessions",
                "auth_challenges",
                "blocks",
                "decisions",
                "action_receipts",
                "conversations",
                "encrypted_messages",
                "encryption_devices",
                "rate_limits",
                "discovery_snapshots",
                "matching_history",
                "user_app_settings",
                "user_presence",
            ] {
                if !table(&mut *db, &format!("public.{name}"), "SELECT").await? {
                    return Err(Failure::Privileges);
                }
            }
            for name in ["accounts", "profiles"] {
                for privilege in ["INSERT", "UPDATE"] {
                    if !table(&mut *db, &format!("public.{name}"), privilege).await? {
                        return Err(Failure::Privileges);
                    }
                }
            }
            for name in [
                "sessions",
                "auth_challenges",
                "blocks",
                "decisions",
                "action_receipts",
                "conversations",
                "encrypted_messages",
                "encryption_devices",
                "rate_limits",
                "discovery_snapshots",
                "matching_history",
                "user_app_settings",
                "user_presence",
            ] {
                for privilege in ["INSERT", "UPDATE", "DELETE"] {
                    if !table(&mut *db, &format!("public.{name}"), privilege).await? {
                        return Err(Failure::Privileges);
                    }
                }
            }
            for name in [
                "decisions_sequence_seq",
                "matching_history_sequence_seq",
                "encrypted_messages_sequence_seq",
            ] {
                let allowed:bool=sqlx::query_scalar("SELECT COALESCE(has_sequence_privilege(current_user,to_regclass($1),'USAGE'),false)").bind(format!("public.{name}")).fetch_one(&mut *db).await?;
                if !allowed {
                    return Err(Failure::Privileges);
                }
            }
            if !table(&mut *db, "public.outbox", "INSERT").await? {
                return Err(Failure::Privileges);
            }
            for field in ["id", "kind", "user_id", "created_at"] {
                if !column(&mut *db, "public.outbox", field, "SELECT").await? {
                    return Err(Failure::Privileges);
                }
            }
            let cleanup:bool=sqlx::query_scalar("SELECT COALESCE(has_function_privilege(current_user,to_regprocedure('public.scrub_auth_outbox()'),'EXECUTE'),false)").fetch_one(&mut *db).await?;
            if !cleanup {
                return Err(Failure::Privileges);
            }
        }
        Kind::Mail => {
            if column(&mut *db, "public.accounts", "password_hash", "SELECT").await?
                || any_column(&mut *db, "public.accounts", "UPDATE").await?
            {
                return Err(Failure::Privileges);
            }
            for privilege in [
                "SELECT",
                "INSERT",
                "UPDATE",
                "DELETE",
                "TRUNCATE",
                "REFERENCES",
                "TRIGGER",
            ] {
                if table(&mut *db, "public.sessions", privilege).await? {
                    return Err(Failure::Privileges);
                }
            }
            for privilege in ["SELECT", "INSERT", "UPDATE", "REFERENCES"] {
                if any_column(&mut *db, "public.sessions", privilege).await? {
                    return Err(Failure::Privileges);
                }
            }
            for field in ["id", "email", "email_verified", "suspended", "deleted_at"] {
                if !column(&mut *db, "public.accounts", field, "SELECT").await? {
                    return Err(Failure::Privileges);
                }
            }
            for field in ["user_id", "kind", "token_hash", "expires_at", "used_at"] {
                if !column(&mut *db, "public.auth_challenges", field, "SELECT").await? {
                    return Err(Failure::Privileges);
                }
            }
            if !table(&mut *db, "public.outbox", "SELECT").await? {
                return Err(Failure::Privileges);
            }
            for field in [
                "payload",
                "attempts",
                "next_attempt_at",
                "lease_id",
                "locked_until",
                "finished_at",
                "last_error_code",
                "delivered_at",
            ] {
                if !column(&mut *db, "public.outbox", field, "UPDATE").await? {
                    return Err(Failure::Privileges);
                }
            }
        }
        Kind::Owner => {}
    }
    Ok(())
}

async fn identity_permissions(db: &mut PgConnection, kind: Kind) -> Result<(), Failure> {
    if kind == Kind::Owner {
        return Ok(());
    }
    for name in IDENTITY_TABLES {
        let exists: bool = sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
            .bind(name)
            .fetch_one(&mut *db)
            .await?;
        if !exists {
            return Err(Failure::Privileges);
        }
    }
    for (name, inserts, updates) in IDENTITY_COLUMNS {
        let audit = name == "public.identity_verification_audit_events";
        if kind == Kind::Mail {
            for privilege in [
                "SELECT",
                "INSERT",
                "UPDATE",
                "DELETE",
                "TRUNCATE",
                "REFERENCES",
                "TRIGGER",
            ] {
                if table(&mut *db, name, privilege).await? {
                    return Err(Failure::Privileges);
                }
            }
            for privilege in ["SELECT", "INSERT", "UPDATE", "REFERENCES"] {
                if any_column(&mut *db, name, privilege).await? {
                    return Err(Failure::Privileges);
                }
            }
            continue;
        }
        if audit {
            if any_column(&mut *db, name, "SELECT").await?
                || any_column(&mut *db, name, "UPDATE").await?
            {
                return Err(Failure::Privileges);
            }
        } else if !table(&mut *db, name, "SELECT").await? {
            return Err(Failure::Privileges);
        }
        for privilege in ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] {
            if table(&mut *db, name, privilege).await? {
                return Err(Failure::Privileges);
            }
        }
        if any_column(&mut *db, name, "REFERENCES").await? {
            return Err(Failure::Privileges);
        }
        for (privilege, fields) in [("INSERT", inserts), ("UPDATE", updates)] {
            for field in fields {
                if !column(&mut *db, name, field, privilege).await? {
                    return Err(Failure::Privileges);
                }
            }
            // Reject table-wide grants and writes to immutable identifiers,
            // references or consent fields that handlers never update.
            let unexpected:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass($1) AND attnum>0 AND NOT attisdropped AND NOT(attname::text=ANY($2)) AND has_column_privilege(current_user,attrelid,attname::text,$3))")
                .bind(name).bind(fields.to_vec()).bind(privilege).fetch_one(&mut *db).await?;
            if unexpected {
                return Err(Failure::Privileges);
            }
        }
    }
    if kind == Kind::Api {
        let usage:bool=sqlx::query_scalar("SELECT COALESCE(has_type_privilege(current_user,to_regtype('public.face_attempt_state'),'USAGE'),false)")
            .fetch_one(db).await?;
        if !usage {
            return Err(Failure::Privileges);
        }
    }
    Ok(())
}

async fn timeout(db: &mut PgConnection, kind: Kind) -> Result<(), Failure> {
    if kind == Kind::Owner {
        return Ok(());
    }
    let row=sqlx::query("SELECT setting::bigint AS milliseconds,source FROM pg_settings WHERE name='statement_timeout'").fetch_one(&mut *db).await?;
    let milliseconds: i64 = row.get("milliseconds");
    let source: String = row.get("source");
    if !(1..=5000).contains(&milliseconds) || !matches!(source.as_str(), "user" | "database user") {
        return Err(Failure::Timeout);
    }
    Ok(())
}

async fn check(pool: &PgPool, kind: Kind) -> Result<u32, Failure> {
    let mut tx = pool.begin().await?;
    sqlx::query("SET TRANSACTION READ ONLY")
        .execute(&mut *tx)
        .await?;
    let server: i32 = sqlx::query_scalar("SELECT current_setting('server_version_num')::integer")
        .fetch_one(&mut *tx)
        .await?;
    identity(&mut tx, kind).await?;
    ownership(&mut tx, kind).await?;
    permissions(&mut tx, kind).await?;
    timeout(&mut tx, kind).await?;
    tx.commit().await?;
    u32::try_from(server / 10000).map_err(|_| Failure::Metadata)
}

async fn run(args: &[String]) -> Result<u32, Failure> {
    let kind = Kind::parse(args)?;
    let url = if kind == Kind::Owner {
        database::migration_url().map_err(|_| Failure::Configuration)
    } else {
        env::var("DATABASE_URL").map_err(|_| Failure::Configuration)
    }?;
    let options = if kind == Kind::Owner {
        database::configured_migration_options(&url)
    } else {
        database::configured_options(&url)
    }
    .map_err(|_| Failure::Configuration)?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .min_connections(0)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(options)
        .await
        .map_err(|_| Failure::Connection)?;
    let result = check(&pool, kind).await;
    pool.close().await;
    result
}

#[tokio::main]
async fn main() {
    match run(&env::args().skip(1).collect::<Vec<_>>()).await {
        Ok(major) => {
            println!("READINESS_CHECK_METADATA_OK");
            println!("READINESS_CHECK_IDENTITY_OK");
            println!("READINESS_CHECK_PRIVILEGES_OK");
            println!("READINESS_SERVER_MAJOR={major}");
            println!("READINESS_OK");
        }
        Err(failure) => {
            eprintln!("{}", failure.label());
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn cli_arguments_are_explicit_and_errors_are_fixed_labels() {
        for (input, kind) in [
            ("api", Kind::Api),
            ("mail", Kind::Mail),
            ("owner", Kind::Owner),
        ] {
            assert_eq!(Kind::parse(&["--kind".into(), input.into()]), Ok(kind));
        }
        for args in [
            vec![],
            vec!["api".into()],
            vec!["--kind".into(), "secret-url".into()],
            vec!["--kind".into(), "api".into(), "extra".into()],
        ] {
            assert_eq!(Kind::parse(&args), Err(Failure::Arguments));
        }
        assert_eq!(
            Failure::Configuration.label(),
            "READINESS_ERROR_CONFIGURATION"
        );
    }

    async fn runtime_pool(owner: &PgPool, kind: Kind, timeout_ms: i32) -> (PgPool, String) {
        // Only disposable SQLx databases run these mutations. No CLI path
        // creates roles, applies grants or modifies database settings.
        let mut connection = owner.acquire().await.unwrap();
        sqlx::query("SELECT pg_advisory_lock(7498196128800)")
            .execute(&mut *connection)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../../operations/runtime-grants.sql"))
            .execute(&mut *connection)
            .await
            .unwrap();
        sqlx::query("SELECT pg_advisory_unlock(7498196128800)")
            .execute(&mut *connection)
            .await
            .unwrap();
        drop(connection);
        let role = format!("readiness_{}", Uuid::new_v4().simple());
        let capability = kind.capability().unwrap();
        sqlx::raw_sql(&format!("CREATE ROLE {role} LOGIN PASSWORD 'disposable-readiness-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT {capability} TO {role}; ALTER ROLE {role} SET statement_timeout='{timeout_ms}ms';"))
            .execute(owner).await.unwrap();
        let options = owner
            .connect_options()
            .as_ref()
            .clone()
            .username(&role)
            .password("disposable-readiness-only");
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        (pool, role)
    }
    async fn cleanup(owner: &PgPool, pool: PgPool, role: &str) {
        pool.close().await;
        sqlx::raw_sql(&format!("DROP OWNED BY {role}; DROP ROLE {role};"))
            .execute(owner)
            .await
            .unwrap();
    }

    async fn denied(pool: &PgPool, statement: &str) {
        let error = sqlx::query(statement)
            .execute(pool)
            .await
            .expect_err("permission should be denied");
        assert_eq!(
            error
                .as_database_error()
                .and_then(|error| error.code())
                .as_deref(),
            Some("42501")
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn identity_lifecycle_grants_keep_reference_pins_and_audit_events_immutable(
        owner: PgPool,
    ) {
        let (api, role) = runtime_pool(&owner, Kind::Api, 5000).await;
        sqlx::query(
            "INSERT INTO accounts(id,email) VALUES('identity-fixture','fixture@psu.ac.th')",
        )
        .execute(&owner)
        .await
        .unwrap();
        let attempt = Uuid::new_v4();
        sqlx::query("INSERT INTO face_verification_attempts(id,user_id,aws_region,reference_source,reference_key,reference_sha256,consent_version,consented_at,policy_version,state,expires_at) VALUES($1,'identity-fixture','ap-southeast-1','private-synthetic-source','private-synthetic-key',$2,'test-consent',now(),'test-policy','CREATING',now()+interval '3 minutes')")
            .bind(attempt).bind(vec![7_u8;32]).execute(&api).await.unwrap();
        sqlx::query("UPDATE face_verification_attempts SET state='CREATED',aws_session_id='synthetic-session',updated_at=now(),expires_at=now()+interval '3 minutes' WHERE id=$1").bind(attempt).execute(&api).await.unwrap();
        sqlx::query("INSERT INTO user_photo_verifications(user_id,latest_attempt_id,status,policy_version) VALUES('identity-fixture',$1,'REVIEW_REQUIRED','test-policy') ON CONFLICT(user_id) DO UPDATE SET latest_attempt_id=excluded.latest_attempt_id,status='REVIEW_REQUIRED',policy_version=excluded.policy_version,updated_at=now() WHERE user_photo_verifications.status<>'VERIFIED'")
            .bind(attempt).execute(&api).await.unwrap();
        sqlx::query("INSERT INTO identity_review_requests(attempt_id,user_id,note) VALUES($1,'identity-fixture','synthetic-review') ON CONFLICT(attempt_id) DO UPDATE SET note=COALESCE(excluded.note,identity_review_requests.note) WHERE identity_review_requests.status='OPEN'")
            .bind(attempt).execute(&api).await.unwrap();
        sqlx::query("UPDATE identity_review_requests SET status='REJECTED',decided_by='identity-fixture',decided_at=now() WHERE attempt_id=$1").bind(attempt).execute(&api).await.unwrap();
        sqlx::query("INSERT INTO identity_verification_audit_events(user_id,attempt_id,event_type,actor_type,actor_id,policy_version) VALUES('identity-fixture',$1,'TEST_EVENT','system',NULL,'test-policy')")
            .bind(attempt).execute(&api).await.unwrap();
        assert!(check(&api, Kind::Api).await.is_ok());
        for statement in [
            "UPDATE face_verification_attempts SET reference_key='replacement'",
            "UPDATE face_verification_attempts SET reference_sha256=decode(repeat('00',32),'hex')",
            "UPDATE face_verification_attempts SET replacement_base='{}'::jsonb",
            "UPDATE face_verification_attempts SET consent_version='replacement'",
            "UPDATE face_verification_attempts SET user_id='identity-fixture'",
            "UPDATE user_photo_verifications SET user_id='identity-fixture'",
            "UPDATE identity_review_requests SET user_id='identity-fixture'",
            "SELECT event_type FROM identity_verification_audit_events",
            "UPDATE identity_verification_audit_events SET event_type='REWRITTEN'",
        ] {
            denied(&api, statement).await;
        }
        for name in IDENTITY_TABLES {
            denied(&api, &format!("DELETE FROM {name}")).await;
        }
        cleanup(&owner, api, &role).await;
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn checker_rejects_missing_and_excess_identity_grants_and_mail_cannot_read_them(
        owner: PgPool,
    ) {
        let (api, role) = runtime_pool(&owner, Kind::Api, 5000).await;
        sqlx::raw_sql(
            "REVOKE UPDATE(state) ON public.face_verification_attempts FROM campusmate_api",
        )
        .execute(&owner)
        .await
        .unwrap();
        assert_eq!(check(&api, Kind::Api).await, Err(Failure::Privileges));
        sqlx::raw_sql("GRANT UPDATE(state) ON public.face_verification_attempts TO campusmate_api")
            .execute(&owner)
            .await
            .unwrap();
        assert!(check(&api, Kind::Api).await.is_ok());
        sqlx::raw_sql(&format!(
            "GRANT UPDATE(reference_key) ON public.face_verification_attempts TO {role}"
        ))
        .execute(&owner)
        .await
        .unwrap();
        assert_eq!(check(&api, Kind::Api).await, Err(Failure::Privileges));
        sqlx::raw_sql(&format!("REVOKE UPDATE(reference_key) ON public.face_verification_attempts FROM {role}; GRANT SELECT(event_type) ON public.identity_verification_audit_events TO {role}")).execute(&owner).await.unwrap();
        assert_eq!(check(&api, Kind::Api).await, Err(Failure::Privileges));
        cleanup(&owner, api, &role).await;
        let (mail, role) = runtime_pool(&owner, Kind::Mail, 5000).await;
        assert!(check(&mail, Kind::Mail).await.is_ok());
        for name in IDENTITY_TABLES {
            denied(&mail, &format!("SELECT * FROM {name}")).await;
        }
        sqlx::raw_sql(&format!(
            "GRANT SELECT(reference_key) ON public.face_verification_attempts TO {role}"
        ))
        .execute(&owner)
        .await
        .unwrap();
        assert_eq!(check(&mail, Kind::Mail).await, Err(Failure::Privileges));
        cleanup(&owner, mail, &role).await;
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn runtime_roles_pass_metadata_only_and_owner_is_separate(owner: PgPool) {
        let (api, api_role) = runtime_pool(&owner, Kind::Api, 5000).await;
        assert!(check(&api, Kind::Api).await.is_ok());
        assert_eq!(check(&api, Kind::Mail).await, Err(Failure::Capability));
        assert_eq!(check(&api, Kind::Owner).await, Err(Failure::Ownership));
        let (mail, mail_role) = runtime_pool(&owner, Kind::Mail, 2000).await;
        assert!(check(&mail, Kind::Mail).await.is_ok());
        assert!(check(&owner, Kind::Owner).await.is_ok());
        assert_eq!(check(&owner, Kind::Api).await, Err(Failure::Identity));
        cleanup(&owner, api, &api_role).await;
        cleanup(&owner, mail, &mail_role).await;
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn forbidden_payload_and_session_grants_are_detected_without_reading_rows(owner: PgPool) {
        let (api, api_role) = runtime_pool(&owner, Kind::Api, 5000).await;
        sqlx::raw_sql(&format!(
            "GRANT SELECT(payload) ON public.outbox TO {api_role}"
        ))
        .execute(&owner)
        .await
        .unwrap();
        assert_eq!(check(&api, Kind::Api).await, Err(Failure::Privileges));
        cleanup(&owner, api, &api_role).await;
        let (mail, mail_role) = runtime_pool(&owner, Kind::Mail, 5000).await;
        sqlx::raw_sql(&format!(
            "GRANT SELECT(access_hash) ON public.sessions TO {mail_role}"
        ))
        .execute(&owner)
        .await
        .unwrap();
        assert_eq!(check(&mail, Kind::Mail).await, Err(Failure::Privileges));
        cleanup(&owner, mail, &mail_role).await;
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn runtime_ownership_cross_capability_and_disabled_timeout_fail_closed(owner: PgPool) {
        let (api, role) = runtime_pool(&owner, Kind::Api, 0).await;
        assert_eq!(check(&api, Kind::Api).await, Err(Failure::Timeout));
        sqlx::raw_sql(&format!("GRANT CREATE ON SCHEMA public TO {role}"))
            .execute(&owner)
            .await
            .unwrap();
        assert_eq!(check(&api, Kind::Api).await, Err(Failure::Ownership));
        sqlx::raw_sql(&format!(
            "REVOKE CREATE ON SCHEMA public FROM {role}; GRANT campusmate_mail TO {role}"
        ))
        .execute(&owner)
        .await
        .unwrap();
        assert_eq!(check(&api, Kind::Api).await, Err(Failure::Capability));
        cleanup(&owner, api, &role).await;
    }
}
