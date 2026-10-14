# Production release gates

Keep the production mobile feature flag off until every required gate has real evidence. A passed browser stream proves that stream, not native operation or identity.

| Gate | Evidence required | Current boundary |
| --- | --- | --- |
| Current login | Valid Firebase token, wrong project/signature, expiry, disabled account and revocation checked; native business routes reject Firebase tokens | Backend bridge uses RS256 and fresh account lookup; valid real-user staging login still required |
| Approved photo | Owned primary avatar, moderation approval, immutable snapshot/hash; changing photo revokes old proof | R2 avatar path supported; Firebase Storage gallery URLs require an approved media adapter before use |
| AWS | Actual Rust process uses Fly OIDC; Thailand Create/Get/Compare and client stream | Prior browser stream passed; current Rust diagnostic records dependency checks separately |
| Private evidence | No public URL/CORS; scoped credentials; read/write/deletion and failed-deletion recovery | Staging bucket private, 15-day lifecycle; backend policy expires review evidence in 14 days |
| Human review | Named authorized reviewers, recent strong auth/MFA, audit, self-review denied, evidence accessed before approval | Server review endpoints and tests exist; production reviewer identity/operations not approved |
| Native camera | Android and iOS builds, actual foreground/background/cancel/network/permission tests | No physical device or Mac/EAS available in this session |
| Accessibility | TalkBack/VoiceOver, large text, no-flash route, camera alternative | Must be tested on real devices; compilation alone is insufficient |
| Legal/privacy | Controller/contact, age policy, consent wording, withdrawal, processor agreements and cross-cloud transfers approved by owner/legal adviser | Draft below; no claim of legal approval |
| Automatic decisions | Consented representative same/different-person pairs, documented FAR/FRR, approved policy version and thresholds | Automatic decisions disabled; manual mode only |
| AWS trust | Remove the `LocalBootstrapFromProjectAdministrator` statement from the `campusmate-backend` trust policy so only Fly Machines can assume it | Still present (used for local bootstrap) |
| Badge mirror | Deploy `syncPhotoVerification` with `IDENTITY_BACKEND_URL` set to the approved API origin; confirm a VERIFIED decision appears in Firestore and a revocation removes it | Code and tests ready; not deployed |
| Rollout/cost | Quotas, attempts/user/day, failure/retry monitoring, load/latency and rollback tested | Single staging instance with zero minimum running machines |

## Consent draft for owner/legal review

The optional check verifies that a live person resembles the approved primary profile photo. It does not verify a legal identity or student status. Declining or withdrawing consent must leave ordinary app access available.

Video goes directly to Amazon Rekognition in Thailand (`ap-southeast-7`). The Rust API runs on Fly.io Singapore and metadata is stored in the isolated Neon Singapore branch. Reference snapshots and review evidence are private in Cloudflare R2; the current staging bucket location is APAC, not a guarantee of storage in Thailand. Do not describe this workflow as Thailand-only processing.

AWS session results are temporary. Application reference/evidence is deleted when the decision or withdrawal permits it, and review evidence expires after 14 days. A 15-day R2 lifecycle is a recovery safety net, not a promise that user-requested deletion waits 15 days. Failed object deletions must remain visible to operators and retry until confirmed.

Before release, fill the actual controller name/contact, lawful basis for biometric processing, minimum age/guardian rules, processor list, rights request channel, appeal response target and retained audit metadata duration. These are business/legal decisions, not values inferred by engineering.

## Calibration evidence

Use consented samples with varied devices, lighting, pose and accessibility contexts. Store raw scores only in a separately authorized evaluation environment; never in app logs or client replies. Measure false accepts and false rejects independently for both challenges. Select four thresholds only after the approved evaluation; set `FACE_POLICY_VERSION` to identify the actual evaluation. No demonstration score is an approved threshold.

## Staging rollback

1. Set `FACE_VERIFICATION_ENABLED=false`, deploy the known-good image/config and verify identity creation is unavailable.
2. Keep the mobile production flag off. Do not flip the whole app to the Rust backend URL.
3. Stop staging Machines when testing ends. Keep IAM/OIDC/app resources as requested.
4. Withdraw test verification through its authenticated DELETE route and confirm private objects are gone. Retain minimal test audit metadata only under the agreed policy.
5. Never drop/reset the Neon branch or revoke credentials as an automatic rollback; those are separate destructive operations requiring a named target.
