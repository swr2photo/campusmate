---
name: campusmate-face-verification-rekognition
description: Audit, secure, implement, or review CampusMate profile-photo verification using existing Amazon Rekognition Face Liveness + CompareFaces, React Native Expo SDK 58 native iOS/Android integrations, Rust Axum SQLx, Neon PostgreSQL, and Cloudflare R2. Use whenever working on verification badge, camera/liveness, selfie consent, AWS session, face comparison, anti-replay, IAM, risk thresholds, data retention, or identity privacy.
---

# CampusMate — Amazon Rekognition Face Verification Security Skill

**FIRST READ** `references/verification-blueprint.md` in full. It is the authoritative end-to-end blueprint and threat model. Its status is a **target/audit specification**, NOT proof that current source code is safe.

## Mission & priorities

- **Existing system**: Amazon Rekognition **Face Liveness + CompareFaces** already in use. Audit and preserve working implementation rather than replace provider, auth, media storage or mobile screens.
- **Baseline stack**: React Native + Expo SDK 58, iOS 26–27, Android Material 3, Rust/Axum/Tokio/SQLx, Fly.io Singapore, Neon PostgreSQL, Cloudflare R2.
- The result proves **liveness + similarity with pinned photo**, **not** legal identity/student status. Keep `PHOTO_VERIFIED`, `UNIVERSITY_VERIFIED` and `ACCOUNT_VERIFIED` independent and don't grant login privileges for photo verification.
- Verification decisions are **server-side only** from `GetFaceLivenessSessionResults` + `CompareFaces` by Rust. Ignore any client `verified` flag or arbitrary client image path.
- AWS liveness streaming must use properly scoped short-lived credentials; ensure Create/Get/Compare AWS permissions remain server-only. Forbid permanent keys in mobile clients.
- Bind AWS session to authenticated user, pinned immutable approved photo ID/SHA256, session expiry, region and policy version. Enforce replay/duplicate protection and rate limit.
- Read approved reference photo from **private R2 as bytes**, then pass valid image Bytes into AWS CompareFaces; R2 `S3Object` cannot be used as an AWS S3 source. Don't make verification photos public.
- Consent, biometric retention/deletion, privacy notices, accessibility alternative and appeal/review path must be production release gates. No raw selfie/score in logs or client responses.
- Never invent thresholds. Calibrate confidence decisions on representative consented test pairs and document review process for ambiguity.

## Work sequence

1. **Audit** actual React Native/Expo packages, AWS calls, native bridges, Rust API, IAM, JWT binding, R2 access, Neon tables, and badge issuance; write an actionable gap matrix before editing.
2. **Implement** smallest server-side changes first: DB migration, owned session, idempotency, immutable R2 reference, AWS result retrieval and CompareFaces Bytes, revocation. Do not hold DB locks during AWS call.
3. **Mobile**: platform-aware consent and native capture UX. Follow iOS skill `../campusmate-ios26-27-expo58/SKILL.md` and Android skill `../campusmate-android-material3-expo58/SKILL.md`. Verify Expo 58 plugin/native ABI support with device builds; don't claim Expo Go works.
4. **Security QA**: wrong owner, replay, expiry, concurrent complete, upload swap, spoofed client success, AWS/DB/R2 errors, accessibility and privacy deletion, region latency/cost.
5. **Report** changed files, commands, migration effects, tests with PASS/FAIL/NOT RUN, unresolved blockers and rollback plan. No unapproved production deployment or biometric data mutations.

## Release gate

A profile photo may receive `PHOTO_VERIFIED` **only** when the Rust server has validated a fresh, owned, successful liveness result, pinned-photo comparison under an approved decision policy, and persisted the authorization-safe outcome. The session/capture UX **must never** set a verified badge on its own.

See `references/verification-blueprint.md` for SQL starter schema, contracts, state machine, and official AWS/Expo citations.
