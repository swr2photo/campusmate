# CampusMate matching service (Rust)

> Migration note (2026-10-12): this earlier prototype still depends on Firebase Auth and Firestore, and its listener cache does not establish fresh authorization for every response. It has not been validated for production deployment. The selected full migration uses [`../rust-backend/`](../rust-backend/README.md) with native identity and PostgreSQL. Do not use this deployment recipe as the full migration or enable it in the app before a separate security review.

Ranked friend discovery for the app. It replaces the unranked
`getDiscoveryPage` callable when `EXPO_PUBLIC_MATCHING_URL` is set; the app
falls back to the callable automatically if this service is down.

## What it does

- **Security** — every request carries a Firebase ID token (verified against
  Google's JWKS: RS256, audience/issuer = project, expiry). Optional Firebase
  App Check (`APP_CHECK_PROJECT_NUMBER`). Privacy rules are ported from
  `functions/profileVisibilityPolicy.js` (face verification, blocks both ways,
  incognito, plan checks) and only the allowlisted `discoveryProfiles`
  projection is returned. Distances keep the 0.7 km privacy floor. Read-only
  Firestore access, per-user rate limit, 16 KB body limit, signed stateless
  cursors bound to the user and the filters.
- **Matching** — a 0–100 `compatibility` score from shared activities (30),
  activity details such as running pace and level (10), overlapping free time
  on upcoming dates (25), distance (15), same faculty / nearby year (10) and
  profile quality + recent activity (10). Up to three `matchReasons`
  (e.g. "ชอบวิ่งเหมือนกัน", "ว่างตรงกัน 2 วัน") explain each result.
- **Speed** — Firestore listeners keep users, discovery projections,
  visibility, entitlements, decisions, blocks and conversations in memory.
  A page is filtered, scored and sorted in memory: one Firestore read per
  request (the caller's entitlement, for the paywall) instead of roughly
  300 reads per 30-profile page in the callable.

## Deploy (Cloud Run, same project as Firebase)

```bash
PROJECT=campusmate-7f1ab
REGION=asia-southeast1
SA=matching-svc@$PROJECT.iam.gserviceaccount.com

gcloud iam service-accounts create matching-svc --project $PROJECT
gcloud projects add-iam-policy-binding $PROJECT --member serviceAccount:$SA --role roles/datastore.viewer
openssl rand -base64 48 | gcloud secrets create matching-cursor-secret --data-file=- --project $PROJECT
gcloud secrets add-iam-policy-binding matching-cursor-secret --member serviceAccount:$SA \
  --role roles/secretmanager.secretAccessor --project $PROJECT

gcloud run deploy campusmate-matching --source matching-service --project $PROJECT --region $REGION \
  --service-account $SA --allow-unauthenticated \
  --min-instances 1 --max-instances 3 --no-cpu-throttling --memory 512Mi --concurrency 80 \
  --set-env-vars FIREBASE_PROJECT_ID=$PROJECT \
  --set-secrets CURSOR_SECRET=matching-cursor-secret:latest
```

`--allow-unauthenticated` only opens the HTTPS endpoint, the same as callable
functions; every request is still authenticated with the Firebase ID token.
`--min-instances 1` and `--no-cpu-throttling` keep the listeners connected so
the in-memory pool stays warm. Each instance loads the collections once on
start, then pays only for changed documents.

Then set the app's environment and rebuild:

```bash
EXPO_PUBLIC_MATCHING_URL=https://campusmate-matching-xxxxx.asia-southeast1.run.app
```

## Develop

```bash
cargo test
FIREBASE_PROJECT_ID=campusmate-7f1ab CURSOR_SECRET=$(openssl rand -hex 32) cargo run
```

`GET /healthz` returns 200 once every listener has synced (503 while warming).

## Limits

The whole discoverable population lives in memory, which suits a campus-sized
user base (tens of thousands of users and their decisions in well under
512 MiB). Beyond that, move ranking to a precomputed index.
