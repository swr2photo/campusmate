# Firestore Security Audit

Last reviewed: 2026-09-04

The rules target project `campusmate-7f1ab` and the Standard Firestore database
in `asia-southeast1`. The rules compiled in a Firebase dry-run and were
released to Firestore after the E2EE client changes.

## Enforced boundaries

- All app data requires a signed-in, email-verified Firebase user.
- `users/{uid}` is private and owner-only. The owner cannot delete it from the
  client.
- `profiles/{uid}` is a bounded public projection. A profile is readable by
  other verified users only when `isDiscoverable == true`; private email,
  coordinates, privacy settings, and matching preferences are excluded from
  the projection.
- Decisions are directional, deterministic, party-only, and restricted to
  valid state transitions. A pending like also requires a discoverable target.
- Conversations require reciprocal accepted likes. Participants, encryption
  metadata, the other participant's profile/settings, unread counts, read
  receipts, and message metadata are protected against unauthorized mutation.
  New last-message metadata must be committed with a newly created encrypted
  message in the same Firestore transaction.
- The legacy root `messages` array is immutable for clients. New encrypted
  messages are stored in `conversations/{id}/messages/{messageId}`, where rules
  validate the sender, ciphertext fields, message size, reactions, and
  per-user hiding.
- Conversation deletion is server-owned. A user-level chat delete hides the
  room and records `participantSettings.{uid}.historyClearedAt`; the client
  filters all older legacy and encrypted messages after a later rematch.
  Account deletion uses the trusted callable function, which cascades message
  subcollections and server-owned notification records.
- Push-token, receipt, delivery, and other unlisted collections are denied to
  clients. Push registration is validated server-side and limited per user.
- `spots/{id}` is verified-user read-only. Admin/server code must perform
  writes.

## Client and transport hardening

- New chat content is encrypted locally with X25519 key agreement and
  XSalsa20-Poly1305 before it is written to Firestore. Push notifications use
  generic text and never include message plaintext.
- Offline snapshots, queued operations, and the locally cached Expo push token
  use encrypted storage on native platforms, are scoped by Firebase UID where
  applicable, and offline data is cleared on account deletion.
- Firebase Auth React Native persistence is wrapped with AES-GCM storage; the
  encryption key is kept in SecureStore/Keystore on native platforms.
- Avatar uploads go through an authenticated Cloudflare Worker. Uploads are
  UID-bound, limited to 5 MB, checked against JPEG/PNG/WebP signatures, and
  served with safe response headers.
- The map WebView validates bridge input, escapes Firestore-derived popup
  content, disables file/mixed-content access, and uses a restrictive CSP.
- Password-reset pages no longer execute Tailwind or load Google Fonts from
  third-party CDNs; the live Hosting response was checked for the expected
  security headers and CSP.
- Android release signing values are required from environment/project
  properties; release minification and resource shrinking are enabled.
- Known transitive dependency ranges were overridden in `pnpm-workspace.yaml`.

## Deployment state

- Firestore rules: baseline deployed successfully on 2026-09-04. The follow-up
  for chat-history cutoffs, matching preferences, and safe reciprocal-like
  transitions was compiled, smoke-tested, and released on 2026-09-05.
- Firebase Hosting security headers and reset pages: deployed successfully on
  2026-09-04.
- Browser Firebase API key: restricted to the production Hosting origins and
  local development origins. The Android key still needs the Play/EAS release
  SHA-1 restriction.
- Cloud Functions: source is hardened but deployment is blocked while the
  Firebase project is on the Spark plan. Enable Blaze billing manually before
  deploying Functions; no billing change was made automatically.
- Cloudflare R2 Worker: hardened source is present in `r2-worker/`, but a
  Wrangler deployment could not be verified because Wrangler is not installed
  locally and the package registry request timed out.

## Remaining actions requiring an explicit operational decision

1. Legacy plaintext root-array messages found during this audit were purged on
   2026-09-04. Final verification found zero plaintext root messages and zero
   private-field or coordinate leaks in public/participant snapshots. Any
   remaining legacy root arrays are ciphertext-only and read-only for clients;
   they can be removed later if the retention policy requires it.
2. The revoked Play service-account key was removed from the working tree and
   replaced with an ignored local key. The old key is revoked, but its blob
   remains in Git history; removing it requires a deliberate history rewrite
   and force-push.
3. R2 public avatar URLs are intentionally public profile assets. If avatars
   must be private even when their URL is copied, move reads to authenticated
   or signed URLs and update the image-loading path.
4. Deploy Functions and the R2 Worker after the required external billing and
   Cloudflare authentication steps. Until then, push delivery and server-side
   account deletion are fail-closed rather than silently falling back to
   insecure client-side cascades.
5. Web local storage remains readable by same-origin JavaScript. The mobile
   builds use SecureStore for account/E2EE identity material; if the hosted web
   build is in scope for an XSS threat model, keep sensitive credentials out of
   browser persistence and add a separate web security review.
