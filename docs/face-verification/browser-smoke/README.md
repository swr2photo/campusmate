# Browser + Fly OIDC liveness infrastructure test

This isolated test uses AWS's official React `FaceLivenessDetectorCore`, a local
loopback server, and a private Python probe on a Fly Machine. It does not deploy
the Rust API, issue CampusMate badges, access PostgreSQL/R2, or compare profile
photos. `SUCCEEDED` means AWS finished the liveness session; it is not a badge or
an approved identity decision. No confidence threshold is invented.

## Verified infrastructure

- Fly app: `campusmate-backend-502731779521`
- Fly organization: personal; OIDC issuer slug: `werachart-kaewkham`
- Probe Machine: `185e262f6650d8`, name `oidc-probe`, region `sin`, shared CPU,
  256 MB RAM, no public service, no persistent volume, restart policy `no`
- AWS APIs and STS endpoint: Thailand `ap-southeast-7`
- OIDC audience: `sts.amazonaws.com`
- Subject: `werachart-kaewkham:campusmate-backend-502731779521:oidc-probe`
- AWS backend role: `arn:aws:iam::502731779521:role/campusmate-backend`
- AWS streaming role: `arn:aws:iam::502731779521:role/campusmate-liveness-stream`

The backend role trusts this app's Machines only, with a matching audience and
Thailand STS endpoint. The existing local administrator bootstrap trust remains.
Wrong-audience rejection, real AssumeRoleWithWebIdentity and GetCallerIdentity,
and non-root UID 65532 access to `/.fly/oidc_token` passed; see
[`../iam/fly-oidc-check-evidence.json`](../iam/fly-oidc-check-evidence.json).

**Live video test passed on 2026-10-12:** the user completed the browser camera
challenge (`FaceMovementChallenge`), and the Fly backend retrieved AWS status
`SUCCEEDED` with a reference image. No image or score was saved. See the immutable
[`../iam/fly-oidc-stream-success-2026-10-12.json`](../iam/fly-oidc-stream-success-2026-10-12.json)
for the AWS request ID and timestamps. A separate real test of the default SDK
credential chain at UID 65532 also passed
([evidence](../iam/fly-default-chain-evidence.json)). This verifies infrastructure
and browser streaming, not native iOS/Android, CompareFaces, badges, or the Rust
production deployment.

The probe obtains fresh OIDC tokens from `/.fly/api`, exchanges them for
900-second backend credentials, and assumes the stream role with an additional
session policy permitting only StartFaceLivenessSession in Thailand. Only those
stream credentials reach the browser. Create and GetResults stay on Fly.

## Security and data handling

- Fly probe requires a random temporary bearer and is reachable through a local
  authenticated Fly proxy; it has no public HTTP service.
- Local HTTP server binds `127.0.0.1:4177`, verifies Host/Origin, uses an HttpOnly
  SameSite=Strict cookie, and requires consent on every create request.
- One active session and at most five create attempts per three minutes.
- Probe accepts authenticated operations for 45 minutes; Machine's temporary
  process exits after one hour and is not restarted automatically.
- AWS session uses `AuditImagesLimit=0`, no S3 output, and a movement-only challenge
  by default. The user can select the light challenge after seeing its warning.
- Images and scores are never written to files, logs, or client responses.
  AWS result images are discarded from memory after the result is reduced to
  status and whether a reference image was present.
- Result evidence contains only OIDC claims, assumed-role ARNs, request IDs,
  status, timestamps and booleans. Tokens and credentials are excluded.

## Local setup

Install/build inside this directory, without changing the mobile app packages:

```powershell
$env:npm_config_cache = 'D:\project-mobile application\artifacts\face-verification\browser-npm-cache'
npm ci
npm run build
```

`server.mjs` serves the built files. `FLY_SMOKE_CONFIG` points to an ignored local
JSON file with `{accessToken, evidencePath}`; `accessToken` must match the private
Fly probe's `/tmp/campusmate-smoke-token`. Never publish this file. After starting
the probe, run a separate local Fly proxy:

```powershell
& 'D:\project-mobile application\artifacts\face-verification\oidc-tools\flyctl.exe' proxy 4178:8080 --app campusmate-backend-502731779521 --bind-addr 127.0.0.1
$env:FLY_SMOKE_CONFIG = 'D:\project-mobile application\artifacts\face-verification\browser-smoke-private.json'
node server.mjs
```

Open `http://127.0.0.1:4177`, consent and complete the challenge yourself. The
server fetches authoritative results from AWS; the browser callback cannot
declare a pass. Retry only after cancel/completion or the three-minute AWS expiry.

The Python probe is a test fixture, not a persistent deployment: its dependencies
and source must be installed/uploaded again if the Machine filesystem resets.
The verified boto3 version is pinned in `requirements.txt`.
The production Rust config is prepared at `rust-backend/fly.toml`; production
secrets, database migrations, R2 setup and API deployment are still separate.

## Stop / rollback

The user requested stopping the probe after the successful video test. Machine
`185e262f6650d8` was stopped and verified at 23:10 on 2026-10-12 (Asia/Bangkok).
The Fly app, OIDC provider and both IAM roles are retained.
See [`../iam/fly-machine-stopped-evidence.json`](../iam/fly-machine-stopped-evidence.json).

Stop the local Node server and Fly proxy, then stop the probe Machine:

```powershell
& 'D:\project-mobile application\artifacts\face-verification\oidc-tools\flyctl.exe' machine stop 185e262f6650d8 --app campusmate-backend-502731779521
```

Keep IAM roles as requested. To undo only the Fly trust, restore
`../iam/backend-trust-before-fly-oidc.json` with IAM UpdateAssumeRolePolicy. Removing
trust does not immediately revoke credentials already issued. Do not delete an
OIDC provider until checking that no other role uses it. Deleting the Fly app or
Machine is a separate action requiring the user's choice.

References: [Fly agent setup](https://fly.io/agent-ready.md),
[Fly OIDC](https://docs.fly.io/security/openid-connect),
[AWS official liveness React component](https://ui.docs.amplify.aws/react/connected-components/liveness).
