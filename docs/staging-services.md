# Staging services — 2026-10-13

Production cutover remains gated on successful staging and physical-device tests.
The authorized email test recipient is recorded in the private task conversation;
do not add recipient addresses or resolved credentials to this document.

## Scope and secret transport

`scripts/staging-services.py` pins AWS project `502731779521`, AWS resource Region
`ap-southeast-7`, GCP project `campusmate-7f1ab`, and the exact API/mail staging apps.
Caller-supplied confirmation arguments cannot change these targets. The internal
Fly import child repeats target, envelope, and key validation before any import.

Inventory emits key names and enabled GCP secret-version numbers only:

```powershell
python scripts/staging-services.py inventory --gcp-metadata
python scripts/staging-services.test.py
python scripts/check-staging-providers.test.py
```

Use a real Python 3 runtime, not the Windows Store launcher. The local Codex
bundled runtime was used for validation. No packages are required by these scripts.

Publish captures only approved GCP/local values in a subprocess, creates a private
temporary AWS CLI input file, and removes it in `finally`. It never prints values.
Import accepts one whole-bundle dynamic reference through the unmodified official
`asm-exec` wrapper and sends the resulting Fly dotenv through stdin with `--stage`.
The wrapper must be inspected and pinned to upstream commit
`a8e8edb1f80075238a77f7521554aecdb7c7c29b`, SHA-256
`05a9f8164b63b286bcf88bf4223c95b799e0ecaada45ddcd805567f57b20299f`.
Its local path is `artifacts/tooling/aws-secrets-manager/references/asm-exec`.
Direct AWS secret-value reads are forbidden by the repository's secret rule.

Provider checks never create RevenueCat customers, LiveKit rooms, purchases, or
email messages. SMTP authenticates and sends NOOP only. Places uses a billable
autocomplete query; Spotify obtains a short-lived client-credentials token.
Missing configuration and inconclusive checks return nonzero readiness status.

## Verified progress and remaining blockers

- Cloud Build `480695e5-2edd-4944-9ba7-d750211a9bb1`: SUCCESS, clippy with
  warnings denied, 157 tests passed. Only formatted `src/notify.rs` was copied back.
- Backend IAM inline policy `CampusMateFaceVerificationThailand` now includes
  `rekognition:DetectModerationLabels`. Live readback matched the intended policy;
  IAM simulation allowed Thailand and denied Sydney. This does not establish
  successful image moderation from a phone.
- Secret transport regression tests: 15 passed. Provider contract, redaction,
  readiness, and no-send tests: 9 passed. Export/media-copy tests: 20 passed.
- API release gate now runs `check-database --kind api`. API source configuration
  keeps one machine running for push delivery, receipt checks, and expiry sweeps.
- Mail configuration has no public HTTP service and uses the restricted mail
  database login; no mail app or mail delivery has been claimed as complete.
- AWS Secrets Manager `ListSecrets` and exact-name `DescribeSecret` in Thailand
  were explicitly denied by organization SCP `p-oh1dnpq7`. The project role cannot
  read that SCP. Do not modify organization policy from the repository backup.
- Free Tier plan-state reads return `ResourceNotFoundException` / missing data.
  AWS Settings Billing confirms advanced features are active and billing is now
  managed through the management project. The publisher remains fail-closed until
  its plan preflight can be satisfied by verified current evidence.
- All six required GCP secret names have enabled versions. LiveKit key/secret/URL
  were absent from local `.env` key inventories and the deployed `getLiveKitToken`
  environment. Do not invent replacement credentials.
- After the owner signed in, LiveKit Cloud confirmed project `campusmate`
  (`p_1ed956ceda1`) has two existing API keys, including `campusmate-mobile`.
  Only descriptions and issuance metadata were inspected. No key/secret was
  revealed or copied, and no provider authentication check has run yet.
- RevenueCat project ID is needed for its safe v2 read-only authentication probe;
  a v1 subscriber GET must never be used as a probe because it can create customers.

## Deployment verification

The API image built from the tested source is
`registry.fly.io/campusmate-backend-502731779521@sha256:7f1d8181ff4ae4ff99794edc39758b18bd6906a1ceb332356b3ae05271be8c1b`.
The previous rollback image is
`registry.fly.io/campusmate-backend-502731779521@sha256:ad5bc8c44e1c859f08847402aa695d540b469b655af83dfa7498ef42328894b7`.
Exclude stopped diagnostic machine `185e262f6650d8` from API deployment.
Deployment completed using bluegreen replacement. New API machine
`2872127c523e28` is started in `sin`, with the exact image digest above,
`autostop=false`, and `min_machines_running=1`. Its HTTP health check is passing;
`/healthz` returns `{"ready":true}`. Unauthenticated requests to `/v1/auth/me`,
`/v1/me/profile`, and `/v1/admin/identity-reviews` each return 401.
The release command and a second runtime `check-database --kind api` both passed
identity/privilege checks against PostgreSQL 18. Runtime diagnostics returned:

```text
RUST_FLY_OIDC_STS_OK
RUST_THAILAND_CREATE_GET_STREAM_CREDENTIALS_OK
RUST_PRIVATE_R2_WRITE_READ_DELETE_OK
IDENTITY_DEPENDENCIES_OK
```

The prior stateless API machine was replaced by Fly's bluegreen deployment.
The excluded diagnostic machine `185e262f6650d8` remains stopped and unchanged.
These checks exercise session creation and streaming credentials, not a live
camera stream or logged-in mobile user flow.

After the secret blockers are resolved: stage API/mail bundles, deploy the API,
verify provider authentication, then create/deploy the private mail worker from
the same immutable image. Verify provider acceptance for the authorized email test.
Public signup accepts PSU student email only; do not weaken that rule to test Gmail.
Use an explicit staging provider delivery test or a purpose-built isolated job.

Before production migration, use `rust-cutover-runbook.md`: freeze every writer,
export with checksums, verify media copies before importing URLs, rehearse on a
disposable branch, and validate physical-device flows before opening Rust writes.
