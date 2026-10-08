# R2 media delivery rollout

CampusMate keeps upload authorization in Firebase Functions. Protocol 2 clients
use a five minute HMAC capability to upload through a Worker with an R2 binding.
The optional legacy route uses S3 PUT signatures. Downloads use a separate delivery
domain. Images are resized and compressed on the device before encryption;
Cloudflare must serve the resulting `.enc` bytes unchanged.

## Application changes

- New clients send `uploadProtocolVersion: 2` to `getR2ChatUploadUrl` and use the
  entire `uploadHeaders` returned by that callable for PUT requests. Worker
  uploads require the returned `Authorization` capability; S3 signatures include
  `Content-Type` and `Cache-Control`. Refreshing a signature also refreshes
  these headers.
- Encrypted objects (`application/octet-stream` with `.enc` extension) use
  `Cache-Control: public, max-age=31536000, immutable` and unique timestamp/UUID
  object keys. Legacy plaintext uses `private, max-age=86400, immutable` so it is
  cached only by the requesting client. The Firebase callable fallback uses the
  same policy.
- Existing clients that omit the version continue to use the previous signed PUT
  contract; their uploads do not gain the new cache metadata.
- `CLOUDFLARE_R2_CDN_DOMAIN` (or `R2_CDN_DOMAIN`) selects the delivery endpoint,
  ahead of the existing `CLOUDFLARE_R2_PUBLIC_DOMAIN`/`R2_PUBLIC_DOMAIN` variables.
  It must be an HTTPS URL without credentials or query parameters. The S3 API
  domain cannot be used as an unauthenticated public download fallback.

## Infrastructure requirements

On October 2, `campusmate-avatars` was connected to `images.getcampusmate.app`
and Worker `campusmate-media` was deployed on `media.getcampusmate.app` with an
R2 binding to `campusmate-chat-media`. Both domains were verified with TLS and
repeated cache hits. The older `pub-*.r2.dev` fallback remains for old clients.

Use separate domains because profile avatars and encrypted chat files are in
different R2 buckets: `images.getcampusmate.app` for the existing public avatar
bucket and `media.getcampusmate.app` for `campusmate-chat-media`. Confirm the
avatar bucket's name in Cloudflare before applying a new setup. The live names
above were confirmed through Cloudflare. The Worker hostname must not also be
attached directly to the chat bucket.

### Active Worker route

`r2-worker/wrangler.jsonc` declares the custom domain, R2 binding and exact web
origins. Firebase Secret Manager and Worker secrets hold `R2_UPLOAD_SIGNING_KEY`;
the key is never stored in the app, upload URL or source. Functions enable this
route with `CAMPUSMATE_R2_WORKER_ENABLED=true` and
`CAMPUSMATE_R2_WORKER_DOMAIN=https://media.getcampusmate.app`. Both deployed
callables are ACTIVE; `getR2ChatUploadUrl` was verified to bind secret version 1
and the enabled Worker environment. The Firebase fallback needs no signing
secret. A live unauthenticated callable request returned 401 and no upload URL.
The callable always declares the established signing secret so Firebase's
endpoint discovery cannot silently omit it before loading deployment `.env`.
Create that secret first when provisioning another Firebase project.

The callable checks membership and key rotation before creating a capability
bound to one unique `.enc` object, a five minute expiry and a 25 MiB size limit.
The client forwards the full `uploadHeaders`, including `Authorization`. The
Worker upload request uses `Cache-Control: no-store`; immutable caching applies
to downloads and stored object metadata, never to upload capabilities. The
Worker verifies HMAC with Web Crypto, bounds upload size, prevents overwrites,
and serves only `.enc` paths with `application/octet-stream` metadata. Ciphertext
downloads stream from R2 or Cache API. Only complete successful GETs are cached;
errors, missing objects and plaintext routes are never cached. No encryption
keys reach the Worker. Missing keys or encryption failure stop client uploads.

The OAuth session lacks Cache Rules write permission, so the Worker Cache API
provides ciphertext caching. The next section describes an alternative direct
bucket/S3 configuration for accounts with the required permissions.

`EXPO_PUBLIC_PROFILE_CDN_DOMAIN=https://images.getcampusmate.app` is configured
locally and in EAS preview/production. The app rewrites only the verified legacy
avatar bucket host and keeps avatar revision query parameters. The domain
currently returns a four hour TTL; overwritten avatar keys must not gain one
year immutable caching. Old message URLs have not been migrated.

### Alternative direct bucket/S3 route

`scripts/configure-r2-cdn.mjs` creates a reviewable dry run using
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_ZONE_ID` from the
environment. The token needs access to the selected account's R2 bucket and the
zone's Cache Rules. Run `node scripts/configure-r2-cdn.mjs` for chat, or
`node scripts/configure-r2-cdn.mjs --mode avatars --domain images.getcampusmate.app --bucket <verified-avatar-bucket>`
for avatars. Add `--apply` after reviewing the dry run. The script validates the
active zone/account, attaches the domain through the R2 API, and adds or updates
only rules with its managed references. It does not replace an existing zone
ruleset or add DNS records directly. CORS changes only add headers to existing
PUT rules and preserve their origins and methods; concurrent CORS changes abort
the update. Avatar rules honor existing origin TTLs and never force immutable
one year caching on overwritten `/users/<uid>/avatar.jpg` keys. Chat rules bypass
shared caching of legacy plaintext. TLS and cache hits still need verification
after successful configuration.

1. In the Cloudflare account containing `campusmate-chat-media`, connect a custom
   domain that you own and that is in the same account's zone. Public bucket
   delivery grants access to anyone who has an object URL; do not widen access to
   other buckets or rely on CORS for authorization.
2. Add a Cache Rule scoped to that host, paths under `/chat_media/`, and the `.enc`
   extension. Mark matching responses as eligible for cache and respect origin
   `Cache-Control`. Do not override `private`/`no-store` responses. Avoid caching
   404 responses: a missing object must not remain cached after a successful PUT.
   Enable Smart Tiered Cache if available for the selected account.
3. Preserve `Content-Type: application/octet-stream` and object bytes. Do not run
   image transformations on encrypted chat files. Any Cloudflare Images variants
   must apply only to separately authorized public plaintext assets.
4. Set `CLOUDFLARE_R2_CDN_DOMAIN` in the Functions environment to the verified
   endpoint. Create Firebase secrets `CLOUDFLARE_R2_ACCESS_KEY_ID` and
   `CLOUDFLARE_R2_SECRET_ACCESS_KEY` using a freshly rotated, bucket-scoped R2
   credential. Set non-secret `CLOUDFLARE_R2_ACCOUNT_ID`,
   `CLOUDFLARE_R2_BUCKET_NAME`, and `CAMPUSMATE_R2_SECRETS_ENABLED=true` in the
   Functions environment, then deploy `getR2ChatUploadUrl` plus `uploadChatMedia`
   before the new app client. The opt-in flag binds both secrets to those
   functions; leave it disabled until both exist so Firebase-only deployments
   remain possible. Keep S3 signing on `<account>.r2.cloudflarestorage.com`.
5. If web uploads are supported, allow `Content-Type` and `Cache-Control` in R2
   CORS for the app's actual origins and `PUT` method. Expose `ETag` and cache
   preflights with `MaxAgeSeconds` as needed. Native Android/iOS requests do not
   depend on browser CORS.
6. Measure a dedicated test object with `node scripts/check-r2-delivery.mjs`.
   Inspect repeated GET latency, transferred bytes, cache status, `Age`, and
   `Cache-Control`; confirm a repeated request becomes a cache hit on the custom
   domain. Keep signed URLs, user paths, and encryption keys out of logs.
7. Existing messages retain their existing URLs. Do not rewrite their host until
   the new endpoint is verified to serve the same objects. Old uploaded objects
   do not automatically receive the new metadata. A backfill would require a
   separate dry run and immutable key verification.

## Verification

`node --test functions/r2Service.test.js` verifies delivery domain validation,
cache privacy, and the actual AWS SDK signature headers without network calls.
Client upload tests verify that signed headers are forwarded and moderation and
encryption remain required. Benchmark the same test object and network before
and after deployment; provider speed rankings cannot establish app performance.

Run `node --test scripts/configure-r2-cdn.test.mjs` to verify dry run safety,
idempotence, zone ownership checks, and preservation of CORS origins and existing
zone rules.

## Baseline measured 2026-09-30

The read-only production inventory (`scripts/inspect-media-origins.mjs`) found
five R2 avatar references and two Google profile image references among 16
profiles. The avatar R2 host is a separate `pub-*.r2.dev` endpoint from the chat
bucket. One sampled avatar was 62,189 bytes (`image/jpeg`) with
`Cache-Control: public, max-age=3600`; three repeated GETs measured TTFB of
1,371 ms, 312 ms, and 231 ms from the BKK edge. Neither `CF-Cache-Status` nor
`Age` was present. Connection/TLS warming can explain the improvement, so these
numbers do not prove CDN cache hits. The inventory prints hosts/counts and timing without exposing
user object paths or signed query parameters.

## Custom-domain verification — 2026-10-02

| Route | Edge | Repeated TTFB | Cache |
| --- | --- | --- | --- |
| Avatar, 62,189-byte JPEG | BKK | 1186 / 94 / 38 ms | MISS / HIT / HIT |
| Worker ciphertext test, 1064 bytes | NRT | 278 / 188 / 159 ms | MISS / HIT / HIT |

The live Worker probe also verified unsigned upload rejection, plaintext route
rejection, immutable overwrite rejection, unchanged encrypted bytes and
successful local decryption. These samples are not latency guarantees. Local
DNS initially retained negative responses, so the first probes used public DNS
over HTTPS with normal certificate validation. Later standard DNS probes passed:
avatar requests were HIT / HIT / HIT (1149 / 105 / 56 ms across SIN/BKK), and
ciphertext requests were MISS / MISS / HIT (233 / 217 / 62 ms across SIN/BKK).
A different edge can miss independently. Native app runtime verification is
still pending.

Run `node scripts/test-r2-worker-live.mjs` with the signing secret in the process
environment only. It writes random test ciphertext under `chat_media/cdn-probe/`
and never changes customer media. To check an existing avatar without logging its
path, run `node scripts/inspect-media-origins.mjs campusmate-7f1ab --probe --delivery-domain https://images.getcampusmate.app`
with project ADC. `CAMPUSMATE_PROBE_DOH=true` opts into the diagnostic resolver.
The probe reports `X-CampusMate-Cache` for Worker requests and `CF-Cache-Status`
for avatar requests.

The 49 delivery/client/Worker/cache tests passed on October 2. They cover exact
header forwarding, retries and bounded fallback, membership/rekey guards,
missing keys and encryption failure, moderation before upload, forged/expired
capabilities, immutable writes, cache reuse and existing CDN rules preservation.

## Native build status

- Android preview with the verified CDN environment:
  `956e162b-375e-46f2-8636-b9fe3799b1ce` (submitted October 2).
- iOS Simulator with the same environment and corrected CoreMedia parameter:
  `f9e2b52e-3416-4614-b512-c490d9e081ee` (submitted October 2).
  The previous build passed the Swift fix but failed RNFirebase's Ruby parsing
  of CSP apostrophes in `firebase.json`. JSON Unicode escaping now preserves
  the decoded CSP while allowing that build script to parse it.
- The local Android emulator cannot boot: its configured API 37.1 system image
  is missing. Android command-line SDK tools are also absent and D: has about
  4.5 GiB free, so native device testing has not been completed.
- iPhone installation still requires Apple Developer signing credentials.

## References

- [Cloudflare R2 custom domains and public development URLs](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Cloudflare Cache with R2](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/)
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
