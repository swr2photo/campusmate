# CampusMate — S-Tier Face & Profile Verification Blueprint

**Version:** 1.1 (integrated; opaque AWS session ID) • **Date:** 2026-10-12 • **Implementation target:** Claude Code / engineering team  
**Current context:** React Native + Expo SDK 58, Rust + Axum + Tokio + SQLx on Fly.io (Singapore), Neon PostgreSQL, Cloudflare R2, Amazon Rekognition Face Liveness + CompareFaces.  
**Scope:** Design and audit specification; **not** a source-code audit or a claim that production security has been validated.

## 0. Engineering mission and non-negotiables

Upgrade the existing CampusMate face verification without rewriting established mobile, authentication, image-storage or backend functionality. Inspect the current repository and cloud configuration before editing. The server alone decides verified status. Never treat a native UI callback, uploaded selfie, mobile-supplied confidence, or `verified: true` flag as proof. Face Liveness + CompareFaces proves a live session resembles an approved face image; it does **not** establish legal name, date of birth, student affiliation, or government identity. Keep `photo_verified`, `university_verified`, and `account_verified` semantically separate.

**Do not** save AWS root/IAM access keys in React Native, expose raw similarity scores to clients, make biometric media public, log selfie bytes, or assume a Cloudflare R2 object reference is an Amazon S3 `S3Object` accepted by Rekognition. Avoid facial search collections unless separately justified and reviewed. Authentication and verification must remain separate: a photo verification badge does not grant account access.

## 1. Final target architecture

```text
React Native / Expo 58 (iOS & Android)
  ├── Current login provider (preserve)
  ├── Consent + accessibility + camera instructions
  ├── Native Face Liveness SDK bridge [SwiftUI / Jetpack Compose]
  │    └── AWS Rekognition StartFaceLivenessSession (signed client stream)
  └── HTTPS → Rust Axum on Fly.io Singapore
              ├── Auth middleware → current provider JWT verification
              ├── Verification session ownership, throttling, risk controls
              ├── AWS SDK: CreateFaceLivenessSession
              ├── AWS SDK: GetFaceLivenessSessionResults
              ├── R2 SDK: fetch immutable approved reference image as bytes
              ├── AWS SDK: CompareFaces (image bytes, not R2 S3Object)
              ├── Decision engine: versioned thresholds, review policy
              └── Neon PostgreSQL:
                    verification_attempts + photo_verifications + audit_events
Cloudflare R2: approved profile image and app media (separate private boundaries)
AWS S3 (optional): temporary service output **only if needed**, same AWS Region
```

Start with one Rust identity verification module, not a separate microservice. Do not use Redis as the source of truth for verification or allow background jobs to outlive the AWS liveness session lifetime. Consider AWS Rekognition Thailand (`ap-southeast-7`) as a candidate after measuring end-to-end speed and checking every desired API/SDK operation in the target region. AWS documents Face Liveness in Thailand; Singapore is not in the current Face Liveness support list.

## 2. Correct end-to-end verification sequence

1. Logged-in user sees verification purpose, risks, camera notice, consent, accessibility alternatives, and any photosensitivity warning; record consent version/time before processing.
2. Backend identifies the authenticated user and approved **immutable** profile media ID; revalidates ownership, moderation status, acceptable photo quality and privacy classification. Generate a unique image object key and content hash for approved snapshot; reject any client-selected arbitrary URL.
3. `POST /v1/identity/photo-verifications` under JWT, per-user/device/IP rate limiting and concurrency guard. Backend inserts a `CREATING` attempt record, calls AWS `CreateFaceLivenessSession`, then stores AWS session ID (unique), user ID, photo asset ID/hash, AWS Region, expiry, policy version and `CREATED` state. Do not leave an active attempt without cleanup/reconciliation.
4. Client receives only `{verificationId, sessionId, region, expiresAt, state}` plus the **required narrowly scoped AWS authorization mechanism** for streaming. `StartFaceLivenessSession` is done by the official native AWS component, not a homemade selfie upload. Client AWS credentials, if any, must be temporary and least privileged: only the liveness streaming operation; **never** `CompareFaces`, `CreateFaceLivenessSession`, `GetFaceLivenessSessionResults`, or general R2/S3 access. Use AWS Cognito Identity Pool or a rigorously controlled custom temporary credentials provider. Review its IAM policies and session-binding risks.
5. Native component prompts user through the challenge; the client callback only says the stream step ended. It is not an authoritative success verdict.
6. Immediately call `POST /v1/identity/photo-verifications/{verificationId}/complete` (authenticated). Rust checks user ownership and transitions atomically `CREATED/IN_PROGRESS → PROCESSING` to prevent duplicate evaluation.
7. Rust calls `GetFaceLivenessSessionResults(awsSessionId)` **itself** while the AWS result is still available. Require `Status = SUCCEEDED`, an acceptable liveness confidence under the current calibrated risk policy, and a valid returned `ReferenceImage`. Handle missing image as retry/indeterminate rather than verified.
8. Rust retrieves the pinned photo bytes from the private R2 object associated with the attempt; check its stored digest, media type, size, single-face policy and immutability; compare AWS liveness reference image to that image via `CompareFaces` `Bytes` inputs. Rekognition can also accept **Amazon S3** objects; a Cloudflare R2 key is **not** an Amazon S3 bucket for the `S3Object` field. AWS image byte inputs are limited to 5 MB; implement a safe image-transcoding path before compare when necessary.
9. Evaluate **liveness and similarity independently** and use a three-outcome decision policy: `VERIFIED`, `REVIEW_REQUIRED`, or `FAILED/RETRY_ALLOWED`. Never equate AWS confidence 95 with a mathematically guaranteed 95% identity probability. Version and calibrate thresholds using representative consented test pairs and measure false accepts/rejects; give humans a review path for ambiguous cases.
10. Save final outcome with a conditional DB update; commit verification proof linked to the **exact approved photo ID and SHA-256**. Do not expose raw confidence, face vectors or AWS reference image to the mobile client. Reply with `{status, badge, verifiedAt}` or safe retry instructions, not raw scores.
11. Failed/incomplete/expired attempts remain non-verified. A recovery job may reconcile attempts promptly but must never infer a pass from client evidence or retry calls after AWS results expire. User can retry via a **new session**, with abuse throttling.
12. Changing or deleting the approved reference photo makes the **photo verification badge invalid**, unless a defined re-verification flow approves the new photo. Do not revoke unrelated university or email verification states.

**Timing:** AWS states the `SessionId` expires three minutes after being sent, and session data becomes unavailable. Create the AWS session only when the camera flow is ready. Invoke `GetFaceLivenessSessionResults` immediately following native completion; never put this lookup behind a long asynchronous queue. Enforce a safety margin when showing `expiresAt`; failures require a new session.

## 3. Robust state machine

```text
CREATING → CREATED → IN_PROGRESS → PROCESSING
  ├── VERIFIED       (valid liveness + face match + policy)
  ├── REVIEW_REQUIRED (ambiguous/quality needs manual review)
  ├── FAILED         (valid completed session but insufficient proof)
  └── EXPIRED        (session or result no longer available)

VERIFIED → REVOKED   (user request, badge policy change, verified photo changed,
                      confirmed abuse, moderation/admin review)
```

A terminal result may only be created once. An **idempotent** retry of `complete` on the same valid attempt returns the saved terminal decision rather than performing another comparison. Transition with SQL `UPDATE ... WHERE state IN (...) RETURNING id` or row locks. Never hold an SQL transaction open during an external AWS network call. Use bounded processing, retry classification and crash recovery. Session IDs may be seen by the client: ownership is guaranteed by the backend's DB binding, not by secrecy of Session ID.

## 4. SQL starting schema (refine to match the actual repository)

```sql
CREATE TYPE face_attempt_state AS ENUM (
  'CREATING', 'CREATED', 'IN_PROGRESS', 'PROCESSING',
  'VERIFIED', 'REVIEW_REQUIRED', 'FAILED', 'EXPIRED', 'REVOKED'
);

CREATE TABLE face_verification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  aws_session_id TEXT UNIQUE,
  aws_region TEXT NOT NULL,
  reference_media_id UUID NOT NULL, -- FK to project's existing media table
  reference_sha256 TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  state face_attempt_state NOT NULL DEFAULT 'CREATING',
  failure_code TEXT,                 -- code only; no raw images
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  CHECK (finished_at IS NULL OR finished_at >= created_at)
);
CREATE INDEX face_attempts_user_recent
  ON face_verification_attempts(user_id, created_at DESC);
CREATE INDEX face_attempts_state_expiry
  ON face_verification_attempts(state, expires_at);

CREATE TABLE user_photo_verifications (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  latest_attempt_id UUID REFERENCES face_verification_attempts(id),
  verified_media_id UUID,
  verified_media_sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN
    ('UNVERIFIED','VERIFIED','REVIEW_REQUIRED','REVOKED')),
  policy_version TEXT,
  verified_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE identity_verification_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  attempt_id UUID REFERENCES face_verification_attempts(id),
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  policy_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Schema is a **starter**, not a drop-in migration: confirm existing users/media IDs, RLS/permissions, migration conventions, exact retention policy, and consistency triggers. Do not duplicate sensitive user profile fields or log raw biometric results. Restrict admin read access; never expose these tables directly to clients. Consider encrypting especially sensitive metadata/secret fields and minimizing exact scores. Define a separate short-retention, tightly controlled risk review record only if necessary.

## 5. API contract

| Endpoint | Auth | Expected behavior |
|---|---|---|
| `GET /v1/identity/photo-verification` | JWT | Return status and badge only |
| `POST /v1/identity/photo-verifications` | JWT + explicit consent | Enforce throttling; create AWS liveness session and owned attempt |
| `POST /v1/identity/photo-verifications/{id}/complete` | JWT | Fetch AWS results; compare immutable photo; persist authoritative decision |
| `GET /v1/identity/photo-verifications/{id}` | JWT | Fetch status of owned attempt only |
| `POST /v1/identity/photo-verifications/{id}/appeal` | JWT | Manual review path without raw scores |
| `DELETE /v1/identity/photo-verification` | JWT + reauth if necessary | Revoke badge and initiate data deletion under policy |
| `POST /v1/admin/identity-reviews/{id}/decision` | Strong admin auth | Audited review with least privilege and dual control where needed |

Example public response (no raw confidence):

```json
{
  "verificationId": "uuid",
  "status": "VERIFIED",
  "badge": "PHOTO_VERIFIED",
  "verifiedAt": "2026-10-12T03:45:00+07:00"
}
```

Errors are safe codes: `SESSION_EXPIRED`, `CAMERA_UNAVAILABLE`, `LOW_LIGHT`, `FACE_NOT_ALIGNED`, `RATE_LIMITED`, `REVIEW_REQUIRED`, `IMAGE_CHANGED`, `AWAITING_RESULT`. Do not reveal score cutoffs, raw face similarity or detailed fraud detection methods.

## 6. Expo SDK 58 integration (mandatory compatibility spike)

**Official AWS detector integrations currently documented:**
- iOS: `amplify-ui-swift-liveness` (SwiftUI component).
- Android: `com.amplifyframework.ui:liveness` (Jetpack Compose component).
- React web: `@aws-amplify/ui-react-liveness` (DOM-based; not a React Native component).

Preferred production path: **build or adapt an Expo native module** that presents the AWS-maintained SwiftUI/Compose components. Configure native cameras and AWS temporary credentials via approved plugins; bridge event completion/errors to TypeScript. Install/build with Expo Development Build/EAS; **Expo Go is not sufficient** for custom native code. Verify exact React Native/Expo 58, Gradle, Kotlin/Compose, Xcode, Swift and AWS SDK compatibility in CI with real test devices. Community package `expo-face-liveness-for-aws-amplify` documents tests on Expo 54/55, **not Expo 58**; treat as candidate for review/porting, not assumed compatible or officially supported. Do not implement custom camera-based liveness ML as a quick substitute.

Native bridge surface example (interface only, **not** a functioning library):

```ts
export interface FaceLivenessNativeBridge {
  present(options: {
    sessionId: string;
    region: string;
  }): Promise<{ streamCompleted: boolean }>;
}
```

The bridge result triggers only the Rust `complete` call. The bridge must securely obtain AWS streaming authorization using the selected identity approach; do not expose AWS long-lived credentials in JavaScript, embedded app files or logs. Ensure camera permissions, photosensitivity information, localization, screen readers, cancellation and network recovery. Test on **physical iPhones and Android devices**.

## 7. Threshold, quality, fairness and fallback policy

Use independently configurable server-side thresholds for liveness and similarity, with `policy_version`; **no hard-coded 80/90/95 threshold presented as universally safe**. CompareFaces defaults to a response filter of 80% if none is supplied, but that is **not** an endorsement of 80% for verifying a person. Calibrate FAR/FRR with consented, representative same-person and different-person samples, varied lighting, devices, poses, skin tones and accessibility contexts. Test drift after AWS SDK/model changes. Use human review in ambiguous/high-impact cases and do not lock the person out of the core social app solely because a face check fails. Provide retry instructions driven by AWS feedback codes.

For default challenge, prefer AWS `FaceMovementAndLightChallenge` where suitable; AWS says it maximizes accuracy compared with movement-only. Offer a non-flashing/alternative route for photosensitive users, as recommended by AWS. Consent must be informed and optional for nonessential verification; clear alternatives must exist.

## 8. Abuse, security and cost controls

- Limit parallel attempts: 1 active session/user, per-user/device/IP throttling, idempotency key, and expiry cleanup. AWS recommends no more than 5 failed attempts/3 min/device, then 30–60 min cooldown; consider accessibility-sensitive appeal.
- Credential security: client may only stream with short-lived, narrowly scoped AWS credentials. Server handles Create/Get/Compare; use IAM role/assume-role where possible; never `AmazonRekognitionFullAccess` in production or `AmazonS3FullAccess` on mobile.
- Verify backend JWT server-side every time. Ensure `verification_attempts.user_id == auth.sub mapping`. Treat `sessionId`, mediaId, region and callback payloads as untrusted.
- AWS liveness status check MUST be `SUCCEEDED`; result availability/size and face reference are required. Reject results for the wrong user or photo revision, or terminal/revoked session.
- Store photos in R2 only according to consent and data policy, **private** when biometric reference; per-object unique keys, read only through backend, pinned digest and no mutable overwrites. For `CompareFaces`, send bytes from backend (up to 5 MB input limit) or use Amazon S3 if explicitly provisioned. R2 S3-compatible API does not make R2 an AWS Amazon S3 storage source.
- No client score disclosure, no face images in crash/error reporting, never log signed S3/R2 URLs. Set AWS CloudTrail/audit where appropriate, and check AWS Organizations AI services opt-out for model improvement if your privacy policy requires it.
- Keep `AuditImagesLimit=0` by default; add review images only on a documented, justified need with narrow access and a fixed deletion deadline. Prefer AWS returned bytes for immediate processing rather than permanent S3 copies. AWS session transient nature does not absolve your application of retention policy.
- Callers must see camera, biometric analysis and cross-cloud transfer purposes in privacy notice. Thailand PDPA and policies for minor users must be reviewed with legal counsel before production.
- AWS charges per liveness check and separately for applicable CompareFaces operations. Alert on attempts/day, checks/user, retry amplification and anomalies; AWS budgets and service limits prevent abuse-induced bill spikes.

## 9. Threat model / adversarial QA

| Attack or fault | Required result |
|---|---|
| JS patch sends `{ verified: true }` | Rejected; server ignores value |
| User A submits User B's verification ID or AWS Session ID | Denied by ownership checks |
| Session reused | Denied / idempotent saved result; new scan requires new session |
| Session older than 3 min | New session required; no verified badge |
| Liveness failed but similarity high | Not verified |
| Liveness high but face similarity low | Not verified |
| AWS reference image absent / incomplete | Retry or review, never verified |
| Uploaded profile image swapped after pass | Photo badge revoked until re-verification |
| Another user changes R2 object or URL | Denied; immutable pinned object key/hash |
| App disconnects after video stream | Safe status recovery; no client-side assumption |
| Rust crashes after AWS check / before DB commit | Safe retry with idempotency, never silent success |
| Two calls to complete race | Exactly one processing/terminal decision |
| Brightness/glasses/head coverings/photo sensitivity | Guidance, review or alternative verification |
| Admin tries to see every selfie | Unauthorized; least privilege, short retention, audited access |
| Credential extraction / rooted device | Temporary scoped credentials + rate controls; no permanent cloud privileges |
| Huge malicious photo / forged MIME type | Server bounds, actual image decoding, safe transcoding before AWS |

## 10. Measurable S-tier acceptance criteria

- **Zero** client-controlled promotion to `PHOTO_VERIFIED`.
- **Zero** face image / biometric result disclosures through public R2 objects, analytics events, logs or client responses.
- **100%** terminal approvals have authenticated user, unique AWS session, verified result, pinned image hash and policy version (validated by automated tests).
- 100% of expired/replayed/wrong-owner sessions remain unverified.
- Completion is idempotent; errors and timeouts preserve non-verified state.
- Mobile accessibility fallback available for photosensitivity and compatible devices unable to perform the scan.
- Measure p50/p95/p99 verification completion from camera start and break down AWS stream, GetResults, R2 GET, CompareFaces, SQL. **Do not promise fixed seconds before device + region benchmark**.
- Privacy consent audit, retention/deletion test, AI opt-out review, and appeal/false rejection tests passed.
- Android and iOS release builds pass hardware integration tests; Expo 58 compat verified in CI.
- Region and cost choices validated using production-like traffic and AWS quota/budget alerts.

## 11. Implementation plan / Claude execution order

**Phase 0 — Audit only (no behavior change)**
1. Map existing Expo version, React Native native module setup, AWS Rekognition calls, secrets, Cloudflare R2 bindings, media schema and current badge logic.
2. Identify server-only vs client-side checks. Search for client `verified` write paths, public R2 URLs, unsafe AWS credentials, check for logs of biometrics.
3. Document AWS region and IAM permissions. Inventory current legal consent and retention settings.

**Phase 1 — Backend hardening**
1. Add attempts + user verification states and indexes through incremental SQLx migrations.
2. Implement Create/Get result, server decision, session-ownership guard, idempotency and bounded recovery.
3. Implement R2 immutable photo snapshot + AWS CompareFaces Bytes; deny mutable profile photos without revocation.
4. Add rate limiting, audit, safe error taxonomy and configurable calibration thresholds.

**Phase 2 — Native integration**
1. Verify actual Expo 58 native build on iOS 26/27 and Android.
2. Integrate AWS-maintained iOS/Android native liveness via Expo Modules API or a carefully audited wrapper.
3. Ensure AWS streaming authorization is short-lived and least-privileged. Add consent, permissions, liveness instructions, photosensitivity fallback.
4. Validate end-to-end capture on physical devices and handle app background/network interruption.

**Phase 3 — Privacy and production readiness**
1. Threat-model review, dynamic pen-test, replay/race tests, audit trail review.
2. Tune thresholds on representative authorized test samples; monitor false accept/reject rates and changes.
3. Deletion/retention, admin review, AWS opt-out policy and budget alerts.
4. Stage rollout behind a feature flag; measure complete workflow before enabling public badges.

**Definition of done:** Tests and artifacts demonstrate the controls above. Do not claim the system is S-Tier just because dependencies are installed. Do not deploy production or mutate real user biometric records without explicit authorization.

## 12. Copy/paste task brief for Claude

> Use this file as the implementation specification for CampusMate Amazon Rekognition Face Liveness + CompareFaces verification. Audit the existing repository first; retain React Native / Expo 58, Rust / Axum / Tokio / SQLx, Neon and Cloudflare R2. Do not replace existing authentication or media flows without proof of need. Implement the secure session lifecycle, backend decision, R2 immutable reference comparison, verification status model, privacy consent, scoped AWS streaming authorization, native SwiftUI/Jetpack Compose bridge and tests in phases. Verify Expo 58 SDK/ABI compatibility instead of assuming third-party wrappers work. Require server-side AWS outcomes and prevent replay, image swaps, cross-account requests and client-controlled badges. Provide each phase's changed files, DB migrations, commands, test evidence, unresolved risks and rollback plan. Never expose credentials or production biometric media. Stop before production deployment.

## 13. Official sources checked (2026-10-12)

- Face Liveness architecture / Session expiry (3 min): https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-diagrams.html
- Face Liveness create and results API: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CreateFaceLivenessSession.html and https://docs.aws.amazon.com/rekognition/latest/APIReference/API_GetFaceLivenessSessionResults.html
- AWS face-liveness shared responsibility: https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-shared-responsibility-model.html
- AWS usage recommendations and client scores: https://docs.aws.amazon.com/rekognition/latest/dg/recommendations-liveness.html
- Rekognition CompareFaces behavior and image input: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CompareFaces.html
- Face Liveness supported regions (includes Thailand): https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-faq.html
- Amazon Rekognition endpoints: https://docs.aws.amazon.com/general/latest/gr/rekognition.html
- AWS SwiftUI detector: https://ui.docs.amplify.aws/swift/connected-components/liveness
- AWS Android detector: https://ui.docs.amplify.aws/android/connected-components/liveness
- Expo native code / development builds: https://docs.expo.dev/workflow/customizing/
- Community Expo wrapper (currently documented tests on Expo 54/55): https://github.com/olawalethefirst/expo-face-liveness-for-aws-amplify
- AWS AI services opt-out: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_ai-opt-out.html
- Face matching responsible AI: https://docs.aws.amazon.com/ai/responsible-ai/rekognition-face-matching/overview.html
