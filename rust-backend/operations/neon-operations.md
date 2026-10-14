# CampusMate Neon operations

This runbook targets the dedicated **CampusMate Rust** PostgreSQL 18 project
`icy-wildflower-47757369` in Singapore. The default staging branch is
`br-wispy-mouse-b30rf7e3`, database `campusmate`, endpoint
`ep-little-smoke-b30yyldu`. Test schema changes on an isolated child branch first.
Its branch and endpoint IDs differ; pass both explicitly to the helper below.

Neon provides PostgreSQL here. The Rust API and private email worker still require
their own compute host. Rust keeps responsibility for user authentication.

## Identity boundaries

| Process | Identity | Connection | Secrets allowed |
| --- | --- | --- | --- |
| Migration/import job | `campusmate_schema_owner` | Direct | Owner DSN |
| API | `campusmate_api_login` | Pooled | API DSN, cursor signing secret |
| Email worker | `campusmate_mail_login` | Pooled | Mail DSN, chosen email transport |
| Expo application | CampusMate user session | HTTPS API | No PostgreSQL DSN |

The Neon API-created owner is privileged. Create runtime LOGIN roles with SQL;
roles created through the Neon console/API may receive `neon_superuser`. Apply
the source-controlled migrations with the owner, then `runtime-grants.sql`.
The one-shot `provision-neon-logins` operator binary then creates the LOGIN roles,
their grants/defaults and distinct SCRAM passwords atomically. It consumes
`DATABASE_DIRECT_URL`, `NEON_API_DATABASE_URL` and `NEON_MAIL_DATABASE_URL` only
from the private process environment. Runtime passwords must encode 32 random
bytes as canonical unpadded base64url (43 characters). It refuses either existing
LOGIN role, a nonempty accounts table, incorrect ownership or migration hashes.
It never resets credentials or prints SQL, passwords, DSNs or database errors.
`neon-runtime-logins.sql` is its reviewed login/grant/default template; do not run
that file separately before the fresh-only provisioner. Never paste plaintext
password SQL into shared logs or the SQL history UI.

The API/mail roles inherit only their own NOLOGIN capability group. The readiness
binary rejects privileged memberships, ownership and unintended grants. It does
not verify a password has been assigned: its actual authenticated connection
proves that when password authentication is required.

Set `statement_timeout` on the actual LOGIN roles, scoped to the database, before
using pooled URLs. PgBouncer transaction pooling does not preserve session `SET`.
The application checks its role default rather than sending session `SET` over
the pooler. Every deployment or credential rotation should open a fresh connection
and run `check-database --kind api|mail` before routing application traffic.

## Credential helper on Windows

`neon-credentials.ps1` requires PowerShell 7.4+ and Windows. It consumes secrets
only from redirected stdin, encrypts the JSON with Windows DPAPI `CurrentUser`,
and places ciphertext under `artifacts/neon-private/` (ignored by Git). Directory
and file DACLs allow only the current Windows user and SYSTEM. Existing stores
are never overwritten. DPAPI is local operator storage; use the deployment
host's secret service for runtime access. Other processes with the same Windows
identity remain inside this trust boundary.

Register accepts one JSON object with `ownerDirectUrl` and optional
`apiPooledUrl`/`mailPooledUrl`. Use `-GenerateRuntime` only when the helper should
generate the two runtime passwords internally. Otherwise supply all three from
a trusted private process. Supply JSON
through an anonymous pipe, close stdin, capture output, and never echo the JSON
or put it in shell history. A newline after the JSON is optional.

Public command arguments (no credentials in these examples):

```powershell
# A trusted parent process supplies redirected JSON stdin to this command.
pwsh -NoProfile -NonInteractive -File operations/neon-credentials.ps1 `
  -Command Register -StoreName campusmate-staging

pwsh -NoProfile -File operations/neon-credentials.ps1 `
  -Command Inspect -StoreName campusmate-staging

# The secrets must already exist in the explicit Google Cloud project.
# Each DSN is sent to gcloud through child-process stdin, not command arguments.
pwsh -NoProfile -File operations/neon-credentials.ps1 `
  -Command PublishSecret -Credential Api -SecretName campusmate-neon-api-staging
```

For a child branch, supply `-BranchId br-... -EndpointId ep-...` on **every**
invocation. These values are pinned into the encrypted store and checked when it
is read. `Inspect` prints only public metadata and credential-presence booleans.
`PublishSecret` always targets `campusmate-7f1ab`; it creates a new version of an
existing named secret and suppresses arbitrary child output. It invokes the SDK's
bundled Python entrypoint directly so the original stdin pipe and native exit
code reach the CLI. A success label requires an ENABLED version in the creation
response and a matching independent server-side metadata read. Grant the migration
job access to the owner secret; grant API and worker identities access only to
their respective secret. Do not grant API access to the owner secret.

`CheckOwner`, `CheckApi`, `CheckMail` and `Migrate` invoke the matching release
binary from `target/release` or `-BinDirectory`. They provide credentials only in
the child's environment, clear inherited process environment except necessary
Windows/tooling paths, enforce a timeout and suppress arbitrary child output.
These commands do real database work when binaries and credentials are present;
`Migrate` changes schema and must follow the branch-first review process.

The helper emits a fixed success label (and public version number when publishing)
or `NEON_OPERATION_FAILED`. It never
prints DSNs, passwords, exception messages or arbitrary CLI output. It cannot
make an untrusted binary/SDK safe: run only the reviewed binaries and installed
Google Cloud SDK. Local helper validation used synthetic URLs/passwords and
made no network connections.

## TLS and pooling

Use the direct hostname for SQLx migrations, imports, backups and administrative
operations. Use the `-pooler` hostname for API/worker traffic. Require
`sslmode=verify-full`; the Rust database configuration enforces certificate and
hostname verification for Neon in every environment.

SQLx 0.8 does not enforce Neon's optional `channel_binding=require` URL parameter.
The application rejects unsupported parameters rather than silently ignoring
them. Explicitly normalize a console-provided connection URL to verified TLS
without this parameter before registering it; do not describe that as enforced
SCRAM channel binding. The helper accepts only the selected endpoint, role,
database and the exact `sslmode=verify-full` query.

The example environment limits each API process to 8 pooled connections, the
worker to 2, and leaves the minimum at 0. These are initial bounds, not a measured
capacity claim. Set the compute host's maximum instance count, then measure
cold-start and sustained workloads with realistic data before raising either
limit. Background maintenance/polling can keep an otherwise idle database awake.

Reference: [Neon pooling](https://neon.com/docs/connect/connection-pooling),
[Neon database roles](https://neon.com/docs/manage/roles), and
[Neon secure connections](https://neon.com/docs/connect/connect-securely).

## Isolated verification on 2026-10-12

The child branch is `schema-check-20261012` (`br-lively-cell-b3piehmz`), endpoint
`ep-young-bonus-b3777j39`. Its database was confirmed empty, connected as
`campusmate_schema_owner`, PostgreSQL server version 18.6. The default staging
branch remains a separate target. No assessment-project rows were read or copied.

`campusmate-schema-check.dpapi` was registered with generated API/mail passwords.
The three DSNs were published via stdin as Secret Manager version 1 under
`CAMPUSMATE_NEON_SCHEMA_CHECK_OWNER`, `CAMPUSMATE_NEON_SCHEMA_CHECK_API` and
`CAMPUSMATE_NEON_SCHEMA_CHECK_MAIL`. The dedicated
`campusmate-rust-schema-ci@campusmate-7f1ab.iam.gserviceaccount.com` identity has
access to those secrets, read access to the Cloud Build source bucket, and log
write access. It has no Cloud Run deploy role and is not the API runtime identity.

`cloudbuild.neon-stage.yaml` gates all live schema work behind disposable tests,
Clippy and release compilation. Its owner step migrates/provisions only the
isolated branch. The runtime step receives only the API/mail secrets and checks
both roles, then boots the API using only its own DSN for HTTP health and an
unauthenticated-request denial. The job does not import users, send email,
publish an image, deploy a public service or change Expo configuration.
See [Google's secret injection documentation](https://docs.cloud.google.com/build/docs/securing-builds/use-secrets)
and [user-managed build identities](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts).
