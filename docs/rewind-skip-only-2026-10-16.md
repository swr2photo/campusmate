# Skip-only rewind — 2026-10-16

Skip A, skip B, like C -> rewind B, then A. Likes are never eligible. Both backends enforce current decision ownership, membership, blocks and privacy. The app no longer vetoes rewind from its last local action or membership cache. Server decision state includes canRewind and reauthorized rewoundProfiles with server-owned priority; existing matchingSignals / Rust events trigger refetches on other devices.

Firebase project campusmate-7f1ab: recordDiscoveryAction, rewindDiscoveryAction and getMyDecisionState were deployed, reported ACTIVE and returned 401 UNAUTHENTICATED without credentials. Revision evidence: artifacts/rewind-live-function-status.json. entries index undoReason ASC / undoneAt DESC (CICAgLiIkYMK) is READY. Only these three APIs were deployed from the snapshot hashed in artifacts/rewind-deploy-manifest.json. Unrelated pending photo, plan, visibility and automatic recycling changes were excluded from that deployment snapshot.

Verification:
- 29 client checks passed: 18 interaction regressions and 11 discovery-client tests.
- Firestore emulator transaction checks passed: concurrent devices consume distinct skips, receipts are idempotent, restored cards survive a reload, hidden/blocked/deleted profiles stay unavailable, and an old skip outside a 300-row client page is restored while 320 likes remain unchanged.
- Rust disposable CI af874c88-f0cc-4cee-92aa-1eec195bf0d1 passed 161 tests and clippy.
- Isolated release CI 92a45480-57dd-46d3-8fdd-2a13bd65b1cb passed all 159 tests and clippy, including consistent timestamps between mutation and later snapshots.
- Windows Hermes bytecode export crashed after Metro bundled 3,120 modules. A JS-only export was stopped after slow startup. Disk D subsequently became full; only an own temporary source archive was removed to restore space. Native/export/device verification is not complete. The user has not yet tested the Metro flow.

Rust Fly deployment is complete. Active Machine 7812564c460648 in sin uses sha256:3c8705de3361cf3ef0b1c8b2b0900d895c38523cc1e192ee7565e3c7a91706bb. The release database check passed. Live /healthz returned 200 with ready:true; unauthenticated /v1/matching/rewind and /v1/rpc/getMyDecisionState returned 401. The previous API Machine was replaced by bluegreen deployment. The release uses a tracked baseline plus matching/decision-state changes, without schema changes. Manifest: artifacts/rewind-rust-release-manifest.json. Rust base image is pinned to sha256:114c7a4425406451c2866b6aafe69fe29b1b298832db1277d411ac73c82d04d6 after a prior build connection dropped. Camera probe 185e262f6650d8 must stay stopped and excluded from rollout.

Reload the Metro app to load the new client. Older installed APKs retain their old client gate until updated JavaScript is delivered.

Camera probe 185e262f6650d8 was verified stopped after deployment. Device testing is still pending, as confirmed by the user. Deploy log: C:/Users/This PC/AppData/Local/Temp/campusmate-rewind-20261016/fly-deploy.log.

Post-deploy check-database returned READINESS_CHECK_METADATA_OK, READINESS_CHECK_IDENTITY_OK, READINESS_CHECK_PRIVILEGES_OK, PostgreSQL major 18 and READINESS_OK. The dedicated builder d8d5324a579138 was stopped after publishing the image to reduce cost.
