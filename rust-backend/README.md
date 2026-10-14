# CampusMate native Rust backend

This service owns its identity and PostgreSQL data. It has no Firebase runtime dependency. It is a migration foundation; **CampusMate has not been switched off Firebase**. The full contract inventory and cutover gates are in [the migration document](../docs/rust-backend-migration.md).

## Implemented HTTP contracts

All app features are served. Besides the routes below, `POST /v1/rpc/{name}` with `{"data": ...}` answers every legacy Firebase callable by name with the same input and output, plus the operations the app used to perform as direct Firestore reads/writes (see `src/rpc.rs`). `GET /v1/events` streams change signals over SSE. `PUT /v1/media/avatar|gallery` and `POST /v1/media/moderate` take raw image bodies. `POST /v1/webhooks/revenuecat` receives membership events. Cutover steps are in [the runbook](../docs/rust-cutover-runbook.md).

| Route | Behavior |
| --- | --- |
| `GET /healthz` | Checks the database connection; returns 503 when unavailable |
| `POST /v1/auth/signup`, `/login` | Argon2id passwords, opaque access/refresh tokens, native account IDs |
| `POST /v1/auth/refresh`, `/logout` | Serialized rotation, replay family revocation, logout revocation |
| `GET /v1/auth/me` | Current account; fresh verification/suspension/deletion checks |
| `POST /v1/auth/verify-email`, `/request-verification` | Single-use verification challenges and transactional email outbox |
| `POST /v1/auth/forgot-password`, `/reset-password` | Generic request response, single-use reset, revoke existing sessions |
| `GET /auth/verify-email`, `/auth/reset-password` | Pages behind email links. The token stays in the URL fragment, is stripped from the address bar on load and is POSTed only after the person confirms, so link scanners cannot consume it. Same-origin assets under `/auth/assets/`, strict CSP (`form-action 'none'`, no inline script), `no-referrer` |
| `GET`, `PUT /v1/me/profile` | Own data, writable field allowlist and optimistic revision check |
| `PUT /v1/me/visibility` | Public/incognito/hidden mode, server-controlled Plus gate |
| `PUT`, `DELETE /v1/me/blocks/{id}` | Own block list |
| `GET /v1/me/membership` | Server-authoritative entitlement features |
| `POST /v1/profiles/visible` | At most 50 profiles; rechecks visibility, restrictions and both block directions |
| `POST /v1/discover` | At most 30 results; immutable ranked ID pages, signed user/filter-bound cursors, fresh authorization |
| `POST /v1/matching/actions`, `/respond`, `/cancel`, `/unmatch`, `/rewind` | Like/skip with idempotent receipts, like responses, cancel, unmatch and rewind in PostgreSQL transactions (`tests/matching.rs`: concurrent mutual likes, acceptance racing rewind, privacy/block/membership rechecks) |
| `PUT`, `DELETE /v1/me/encryption-devices/{device_id}` | Publish/remove the caller's chat device keys |
| `GET /v1/conversations/{id}`, `PUT …/encryption`, `POST …/encryption-profiles` | Direct-room metadata, room key envelopes and member device keys, authorized by room membership |
| `POST …/messages/page`, `PUT …/messages/{message_id}` | Encrypted message pages and idempotent sends; sender and time are server-authoritative and plaintext is rejected (`tests/chat.rs`) |

Business routes require a verified university email. New signup requires a ten-digit student email at `psu.ac.th`; imported Gmail accounts cannot use business routes until the campus-email migration flow is ported. `src/bin/email-worker.rs` sends the queued verification/reset messages, but it is not deployed or configured yet, so production signup/reset mail is not delivered. Its `NATIVE_AUTH_EMAIL_ORIGIN` must be this API's public HTTPS origin: the email pages POST to `/v1/auth/*` on the same origin. Challenges must never be returned from public endpoints or extracted from a production outbox for manual bypass. The matching and direct-chat routes above are wired and tested at the API level only; the app does not call them yet. Google OAuth, group chat, calls, media, push, payments, admin services and app integration still require migration. Unsupported routes return 501. Setting a URL does not make those features ready.

Authentication uses a 15-minute access token and a rotating 30-day refresh token. Only their SHA-256 digests enter `sessions`; Argon2id uses unique salts, 19 MiB, two iterations and one lane. Password work is bounded to four blocking jobs per instance. Replay of a used refresh token revokes its whole family, so clients must not independently retry refresh in parallel. The optional client in `src/services/rustBackendClient.js` uses one refresh operation, SecureStore on native devices, memory-only access tokens and guarded account changes. It is not wired into the existing Firebase contexts yet.

Public projections omit exact GPS, email, keys, role and verification scores. Hidden profile attributes do not affect compatibility reasons or scores. Distance requires both participants' sharing permissions and rounds up to whole kilometers, with a minimum of 1 km. Score weights are shared activities 30, activity details 10, upcoming overlapping time 25, coarse proximity 15, faculty/year 10 and profile quality/recency 10. This heuristic is tested, not calibrated against user outcomes. It is not a prediction of the chance that a friendship succeeds.

Only the next 14 calendar days count as dated availability. Overlapping/duplicate intervals are merged, elapsed time today is excluded using Bangkok time, invalid/expired dates are ignored, and weekly recurrence requires an explicit flag. A combined weekday and time-period filter must match the same future interval. Model `native-v3` prevents reuse of snapshots from older availability semantics. Ranked snapshots expire after 15 minutes and include profile revisions; a change that could make ordering stale returns 409 and requires a new search. New blocks and restrictions are checked on subsequent pages. Ranking has an explicit 5,000 eligible-profile bound before user filters and two concurrent jobs per instance; CPU scoring runs outside Tokio's network workers. A larger population needs measured indexed candidate narrowing before raising that bound.

## Run and test

Use Rust 1.99 and PostgreSQL 18. Set development environment variables from `.env.example`, using an actual random cursor secret. Keep credentials in the process environment or Secret Manager, never in source or command arguments.

```powershell
# DATABASE_URL, CURSOR_SECRET and APP_ENV=development must already be set.
cargo run --manifest-path rust-backend/Cargo.toml --bin campusmate-backend

# DATABASE_URL must point to a disposable PostgreSQL database whose role can CREATE DATABASE.
cargo test --manifest-path rust-backend/Cargo.toml --locked --all-targets
cargo clippy --manifest-path rust-backend/Cargo.toml --locked --all-targets -- -D warnings
node --test scripts/test-rust-backend-client.mjs scripts/test-native-export.mjs scripts/test-native-auth-pages.mjs

# Compile/test only; starts PostgreSQL inside a disposable Cloud Build worker.
gcloud builds submit rust-backend --project campusmate-7f1ab --config rust-backend/cloudbuild.test.yaml
# Build/boot the container against a disposable database; publishes nothing.
gcloud builds submit rust-backend --project campusmate-7f1ab --config rust-backend/cloudbuild.container.yaml
```

`sqlx::test` creates separate test databases. Never give it a production connection string. The Cloud Build configuration creates no production database or service. Its password is for the disposable local CI container only. Build source uploads use an allowlist that excludes environment files and exports.

`node scripts/benchmark-native-backend.mjs --help` describes a bounded staging discovery workload. It takes credentials only from the process environment, blocks redirects, prints no profiles/tokens and reports successful throughput, p50/p95/p99, every HTTP status and network errors. It has only received syntax/help checks so far; no live latency or throughput result has been claimed. Use a dedicated synthetic university-verified account and a production-sized staging dataset. Also measure cold starts, pool waits, CPU/RAM and query plans before choosing instance/concurrency limits.

## Production connection and schema

The selected PostgreSQL provider is **Neon**. A dedicated CampusMate Rust project
(`icy-wildflower-47757369`, PostgreSQL 18, Singapore, 0.25 CU) was created on
2026-10-12. The default `staging` branch is `br-wispy-mouse-b30rf7e3`; schema
validation uses its isolated child `schema-check-20261012`
(`br-lively-cell-b3piehmz`). Both were confirmed empty before schema work.
The unrelated assessment project is not a migration target.

Use [the Neon operations runbook](operations/neon-operations.md) and
[the server-only environment template](operations/.env.neon.example).
Neon hosts PostgreSQL; the Rust API and email worker still need their own compute
host. CampusMate retains its native Rust authentication implementation.

For Neon, every environment enforces TLS certificate and hostname verification.
Use a direct owner URL for migrations/imports and pooled restricted login URLs
for API/mail. `migrate` and `import-export --apply` accept `DATABASE_DIRECT_URL`,
then `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`, and reject a Neon pooler.
Production API startup never migrates schema. Development auto-migration also
refuses a Neon pooler endpoint.

`DB_POOL_MODE=auto` detects Neon `-pooler` hosts; `transaction` explicitly opts
into transaction-pool semantics. The application validates a 1–5,000 ms
`statement_timeout` set on the actual login role instead of session `SET`.
`DB_MAX_CONNECTIONS` defaults to 16 for API and 2 for mail (permitted 1–64),
`DB_MIN_CONNECTIONS` to 0, acquire timeout to 8 seconds, idle timeout to 60
seconds and connection lifetime to 900 seconds. Set instance/pool limits from
measured load rather than treating these bounds as a capacity claim.

SQLx 0.8 does not enforce `channel_binding=require`. Unsupported URL parameters
are rejected before SQLx can log their values. Explicitly remove this parameter
from a Neon-provided URL and retain `sslmode=verify-full`; this is verified TLS,
not a claim of SCRAM channel-binding enforcement. See
[Neon pooling](https://neon.com/docs/connect/connection-pooling),
[Neon roles](https://neon.com/docs/manage/roles) and
[secure connections](https://neon.com/docs/connect/connect-securely).

Production defaults to PostgreSQL `verify-full` even if a URL asks to disable TLS. A specifically named `/cloudsql/<connection-name>` Unix socket is supported only when `CLOUD_SQL_CONNECTION_NAME` names that exact mounted socket. In this mode the local socket connects to the Cloud SQL Auth Proxy, which provides the authenticated encrypted remote connection. Do not expose an unauthenticated TCP proxy or substitute an arbitrary socket. See [Google's Cloud Run connection documentation](https://docs.cloud.google.com/sql/docs/postgres/connect-run) and [Auth Proxy security documentation](https://docs.cloud.google.com/sql/docs/postgres/connect-auth-proxy).

Run schema migrations separately, with a DDL identity, before starting a production API:

```powershell
cargo run --manifest-path rust-backend/Cargo.toml --locked --bin migrate
```

The runtime identity must not own the schema, create roles, modify role grants, or read `migration_documents`. Apply [operations/runtime-grants.sql](operations/runtime-grants.sql) after migrations, then bind separate login identities to its `campusmate_api` and `campusmate_mail` NOLOGIN capability roles. The API can INSERT outbox records and SELECT cooldown metadata, but cannot SELECT their payload tokens. A fixed, schema-qualified `SECURITY DEFINER` cleanup function lets it scrub invalid tokens without reading them; PUBLIC has no EXECUTE permission. The mail role cannot read password/session hashes or modify accounts. These denials and the cleanup function are exercised in `tests/database_roles.rs`; no production roles have been created. The API image runs as UID 65532. It has a 64 KiB body limit, 20-second request timeout, 128 concurrent requests, an SQL pool cap and per-subject database rate counters. Public ingress also needs a verified client-IP rate limit; subject limits are insufficient against distributed signup abuse.

Chat writes, matching mutations and block/unblock share deterministic pair locks. Chat and profile writes recheck the native session after acquiring the account lock, so a waiting request observes committed logout/reset revocation. Blocks prevent new sends/key-envelope writes; established room members can still read their encrypted history without passing public profile or face-verification checks. Direct-room support does not include group epochs, reactions, read receipts, media view limits or live subscriptions yet.

## Email worker

Run the separate `email-worker` binary with its own database identity and secret-manager configuration from `email-worker.env.example`. `--check-config` validates configuration without connecting or sending. Delivery requires the explicit `--send` flag; `--send --once` handles at most one queued item. `RESEND_API_KEY` selects Resend, otherwise SMTP uses verified implicit TLS on 465 or mandatory STARTTLS on 587. `NATIVE_AUTH_EMAIL_ORIGIN` must be the real public HTTPS origin of this API, since the action pages POST to the same origin.

Jobs use `SKIP LOCKED`, a 90-second lease, at most eight attempts and bounded retry backoff. Sending is bounded to 20 seconds and rechecks challenge expiry, account status and email ownership. Delivered/cancelled/terminal payloads are scrubbed; API maintenance also scrubs invalid challenges when the sender is stopped. Provider errors log fixed codes only. Resend uses a stable outbox idempotency key; SMTP provides at-least-once delivery and a crash after relay acceptance can duplicate mail. No actual mail delivery or sender-domain configuration has been validated by these tests.

Read-only inspection on 2026-10-12 found an existing PostgreSQL 18 instance `campusmate-7f1ab-instance` in `asia-southeast1`, with only the `postgres` database listed. Automatic backups were disabled and the instance allowed unencrypted connections. No settings, databases, users or production records were changed. Enable/validate backups and restore, access controls, encrypted connections and a capacity plan before importing real data. Do not assume an existing instance is ready for cutover.

## Offline migration import

`import-export` validates the exact project/version/completed flag, safe file names, SHA-256, byte lengths, row counts, duplicate UIDs/emails/paths and bounded JSONL rows before any write. Dry-run is the default and requires no database:

```powershell
cargo run --manifest-path rust-backend/Cargo.toml --locked --bin import-export -- --manifest artifacts/rust-migration/RUN/manifest.json
# Against an explicitly prepared EMPTY staging target only:
cargo run --manifest-path rust-backend/Cargo.toml --locked --bin import-export -- --manifest artifacts/rust-migration/RUN/manifest.json --apply
```

`--apply` uses an exclusive empty-target gate and one transaction. It rechecks the bytes actually imported before commit and rolls back on failure. Source documents, Auth metadata and object references stay in private `migration_documents`. Email identities retain the original UID, have no password hash, receive no admin grant and have hidden, unverified profiles. Auth disabled flags and restriction/deletion tombstones take precedence. Identities without email remain staged for provider-specific reconciliation. No profile, entitlement, block, decision, chat or media is activated by this importer. Those contract-specific transformations, reference validation and real export reconciliation remain cutover gates. A hash is integrity evidence, not evidence of source consistency or a backup of media bytes.

## Verification status

Earlier verification baseline on 2026-10-12 (before Neon and photo-verification additions):

- Cloud Build [d94e2210-f9f9-414e-b53c-b435d59fe58b](https://console.cloud.google.com/cloud-build/builds/d94e2210-f9f9-414e-b53c-b435d59fe58b?project=865275661439): **SUCCESS**, Rust format check, **65/65 tests**, Clippy for all targets with warnings denied, and optimized release binaries. Test counts: library 35, email worker 6, importer 3, chat 7, database roles 1, discovery 7, matching 6.
- Cloud Build [c078078b-28ea-442e-b91d-3427d3a9a16f](https://console.cloud.google.com/cloud-build/builds/c078078b-28ea-442e-b91d-3427d3a9a16f?project=865275661439): **SUCCESS**, actual Docker image built, UID `65532:65532` checked, API booted against disposable PostgreSQL, real HTTP `/healthz` returned 200 with `ready:true`, and email configuration-only check passed. No image was published, service deployed or email delivered.
- Local Node tests: **24/24** (native transport 12, offline exporter 6, email-page behavior 6). The existing Functions suite passed **215/215** after a legacy encrypted-preview privacy fix and repairing the stale gallery test harness to inject its existing eight-photo limit. Node syntax checks and `git diff --check` passed.

The SHA-256 of the sorted path/content-hash manifest for 37 Rust source, migration, test, web, operations and Cargo files is `3e3a1a77445a45bc51b4fa81324543acad5c8d42c9a903433aa421a698b29fbd`. Documentation and build configuration are outside this source digest.

The legacy client now uses a generic preview for new encrypted messages, and the pending legacy notification code suppresses old encrypted plaintext previews/media URLs. These source changes have **not** been deployed or released to devices; old stored previews were not modified. Native Android/iOS, actual email delivery, real dataset migration, app integration, production deployment and latency/load validation remain pending. No live personal data has been exported or imported by these synthetic tests.
