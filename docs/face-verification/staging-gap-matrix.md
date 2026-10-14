# Staging verification audit — 2026-10-12

This is an implementation and validation record, not production approval.

| Boundary | Observed gap | Work / release gate |
| --- | --- | --- |
| AWS | Thailand stream and Fly OIDC passed; Rust runtime not exercised | Boot actual nonroot Rust image, check SDK identity and APIs |
| Neon | Isolated branch empty; secret names had no versions | Publish existing DPAPI credentials; disposable tests before migration; verify restricted API/mail roles |
| Authentication | Mobile uses Firebase; Rust accepts native opaque sessions | Verify Firebase signature, issuer, audience, expiry and revocation; identity endpoints only; no client role claims |
| Profile reference | Rust snapshot flow expects users/uid/avatar.ext; mobile also uses approved profile_gallery assets | Read existing authorized profile; allow only caller-owned approved media keys; pin and hash bytes |
| R2 | No Rust S3 credentials or private review bucket configured | Dedicated private staging bucket, scoped credentials, lifecycle safety net and deletion test |
| Android | Spike credentials provider uses incompatible suspend API | Match pinned AWS API; compile before autolinking into normal app builds |
| iOS | Spike uncompiled; no Mac/EAS/device available | Prepare bridge; Xcode build and physical-device stream remain required |
| Decisions | Manual mode implemented; no calibrated thresholds | Preserve manual mode; no automatic public badge release |
| Privacy | Draft consent/retention and appeal paths exist | Real deletion test, reviewer access test; owner/legal review remains required |
| Rollout | Existing Firebase production remains active | Dedicated staging only; feature flag stays off in production |

The user confirmed no physical Android device, Mac/Xcode or EAS build access is available now. Compilation and browser tests cannot establish physical-device accessibility, camera behavior or iOS ABI compatibility.

## Status update — 2026-10-13

| Item | Result |
| --- | --- |
| Rust tests (Cloud Build `78dea439`) | 122 passed incl. identity 27; clippy `-D warnings`; release build |
| Staging deploy | Fly app `campusmate-backend-502731779521`, Machine `d895477ae14018` (sin, shared-cpu-1x, auto-stop, min 0) |
| Runtime dependencies (`check-identity` inside the Machine) | `RUST_FLY_OIDC_STS_OK`, `RUST_THAILAND_CREATE_GET_STREAM_CREDENTIALS_OK`, `RUST_PRIVATE_R2_WRITE_READ_DELETE_OK` |
| API smoke | `/healthz` ready; missing/forged tokens → 401 |
| `FACE_VERIFICATION_ENABLED` | `true` on staging only (manual decisions); mobile production flag stays off |
| V16 fixed | The Firebase bridge synced a new `avatarUri` without revoking the badge (no DB trigger existed). Now `identity::sync_primary_photo` revokes on change; test `a_photo_change_reported_by_the_mobile_backend_revokes_the_badge` |
| Badge mirror | New callable `syncPhotoVerification` (Functions) copies only a server `VERIFIED` decision onto the exact verified photo in Firestore, and withdraws only liveness-sourced badges. 8 tests; **not deployed** (needs `IDENTITY_BACKEND_URL` param + production Functions deploy approval) |
| End-to-end with a real face | Ready: `node staging-server.mjs` → `http://127.0.0.1:4177/?rust` (owner signs in and uses the webcam). Expected result in manual mode: `REVIEW_REQUIRED` |
| Human approval on staging | Needs a native staging account with role `admin`; not created (account creation is the owner's action) |

