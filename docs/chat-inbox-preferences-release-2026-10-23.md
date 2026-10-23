# Chat pin and unread-reminder release — 2026-10-23

## Cause and implementation

At the original investigation, the client actions had been implemented but the live Fly image was still `face-gestures-probe-20261021`, whose `chatSettings` API rejected `isPinned` and `markedUnread`. Migration 0013 and the inbox API changes had not been deployed then. On resuming, a fresh live inspection found that Fly had independently advanced to release 15; its API already includes the inbox settings implementation. This task preserved that newer running image.

In addition, `conversationRenderSignature` omitted participant settings. That could discard a preference-only update received on a second device even after the API was updated. The signature now includes stable, normalized participant settings and the current user's settings. Inbox regression tests verify that pin/unpin and unread-reminder changes invalidate cached rows without requiring a new message, while map ordering alone does not.

Pins and unread reminders belong to the authenticated room member. Setting a reminder preserves both participants' message counts and read receipts; opening the actual room clears the caller's reminder. Previewing the chat does not mark it read. A manual reminder displays a dot rather than inventing a message count. Pinned rooms sort first.

## Release scope

The release snapshot is stored under `artifacts/inbox-release-20261022/release`, reconstructed from the previously validated inbox source archive. It contains the existing server source plus the inbox migration/API change. It excludes newer, unrelated edits in the shared working directory. Its file hashes are recorded in `artifacts/inbox-release-20261022/source-manifest.json`.

The verification blockers from the earlier run were addressed in this isolated snapshot using reviewed existing fixes: test-only availability helpers are compiled only for tests, the unused legacy filter helper has a specific dead-code annotation, the score test now reflects the existing neutral availability score, and the group-message test expects the actual newest-first order. There is no global suppression of Clippy warnings.

`rust-backend/cloudbuild.inbox-release.yaml` verifies formatting, strict Clippy, all backend tests and release compilation before running migrations. Only the migration step receives the direct schema-owner credential. The API keeps its restricted runtime credential. Migrations use the existing Neon branch and do not provision a new database or import user data.

## Validation and deployment

- Inbox and media-focus client suites: **27 passed, 0 failed**. Log: `artifacts/inbox-release-20261022/inbox-client-tests.log`.
- Expo Babel transforms: the service and inbox screen compiled for both iOS and Android (4 transforms).
- Broader client regression: **89 passed, 1 failed**. The failure is in the separate media-upload encryption/moderation fixture (`scripts/test-image-cache.mjs:130`); this release does not change media uploads. Log: `artifacts/inbox-release-20261022/client-tests.log`.
- Isolated backend snapshot: strict Clippy and **169 tests passed**, followed by optimized API, migration and readiness binaries. Build: `89e336ab-c92d-46d0-b0a5-00e630ccf0cb`, **SUCCESS**. These tests describe the isolated snapshot, not a reconstruction of the newer running image's exact source.
- Binary archive SHA-256: `c8392510ba22768063b5146c29962ed1af3fa1dc5621f5d69097d09a568c982c`.
- The migration job reported `schema migrations applied`, `READINESS_OK` and `INBOX_SCHEMA_AND_RUNTIME_OK` on the existing database. Migration application is idempotent; this output does not distinguish an already applied migration from a newly applied one.
- Live runtime inspection verified that the running binary contains the `marked_unread` and `isPinned` implementation, including the `pinned=COALESCE` write. The runtime database hostname matched the migration target without printing its connection string. The actual running API identity passed `check-database --kind api`.
- Running Fly release **15**, image `deployment-01M5J77Y56XTXWR6ZTVWSJEQDF`, created 2026-10-22 23:33:20 Asia/Bangkok. Binary SHA-256: `8104f05f8491be0045880311691fb4a63e218108d6f2a455c809feeb67a14cd6`. Evidence: `artifacts/inbox-release-20261022/live-runtime-check.log`, `releases.json` and `machines-final.json`.
- Live `/healthz`: **HTTP 200**, `ready:true`, Fly health check passing. Evidence: `artifacts/inbox-release-20261022/health-final.json`.

Classic Fly builder connectivity attempts did not complete. The Depot attempt failed before building because its configuration resolved a different Dockerfile path. No replacement image was deployed by these attempts. When the newer release was discovered, the old snapshot deployment was abandoned to preserve the current server.

The existing schema CI identity temporarily received `roles/storage.objectCreator` on the build bucket to upload the verified binary archive. This binding was removed immediately after upload; the before/after bucket-policy snapshots confirm it retains only its original object-viewer binding on this bucket. A narrowly scoped conditional binding was attempted first but rejected because the bucket does not enable uniform access; bucket access mode was not changed.

No native app build or OTA publication was performed. Metro clients need to reload to receive the cache-signature fix. The user confirmed **“ทั้งสองอย่างใช้ได้และยังอยู่หลัง Reload”**: pinning and the unread reminder both work and persist after Reload. This is user-reported device validation. The reply does not explicitly confirm a second device, so simultaneous cross-device behavior remains unconfirmed.
