# Account deletion hotfix — 2026-10-14

## Trigger and diagnosis

The user reported `undefined is not a function` after confirming deletion in Android `3.1.3 / 87`. EAS identifies that version as production build `bd78b742-64ef-4db9-9b24-13debd70921e`, using the legacy Firebase path.

`accountSecurityService.js` imported `requireAuth` from `authService.js`, but that function was private. Exporting it fixes the missing callable during password and OTP operations. The regression tests link the actual ES modules rather than mocking this export.

There was a second blocker: both deletion OTP functions returned 404 when described in the deployed Firebase project. The client swallowed those errors, generated a local OTP, and reported success without sending an email. That fallback has been removed. Negative or unavailable OTP results now stop the operation.

## Changes

- Password verification preserves significant spaces and uses the existing signed-in Firebase user or native Rust RPC.
- Firebase OTP creation, verification and authorization run in `accountDeletionFunctions.js` / `accountDeletionOtp.js`. Codes use cryptographic randomness and salted hashes, expire after 10 minutes, allow five guesses, and throttle resends to one minute. SMTP handoff failures cannot return `sent: true`.
- The server-only `accountDeletionChallenges` collection is separate from the legacy client-writable OTP documents. Authorization requires a verified unexpired challenge for the current email and Firebase authentication within five minutes. `purgeAt` is a Firestore TTL timestamp.
- The avatar Worker request runs on the server after authorization, forwards the validated caller token to a fixed HTTPS origin, and rejects redirects. An avatar cleanup failure stops the account cascade.
- The client waits for server confirmation before clearing local state. It no longer hides profiles or deletes decisions before server authorization. Cache failures cannot skip the remaining cleanup or sign-out. A sign-out failure after successful remote deletion is identified explicitly.
- Android build number is 88; app and runtime version remain 3.1.3. This is an internal APK, with Store publication still pending.
- Metro and EAS exclude local artifacts and backend source directories from mobile work. This avoids scanning or uploading the isolated deployment bundle and its dependency junction.

## Isolated deployment

`node scripts/prepare-account-deletion-deploy.mjs` prepares a source bundle containing only the three deletion endpoints and their dependencies. It copies no dotenv files. Source hashes are written to ignored `artifacts/deletion-deploy-manifest.json`.

```powershell
npx -y firebase-tools@latest deploy --config artifacts/deletion-deploy.firebase.json --project campusmate-7f1ab --only functions:sendAccountDeletionOtp,functions:verifyAccountDeletionOtp,functions:deleteUserData --non-interactive
```

The sender binds the existing `CAMPUSMATE_ADMIN_SMTP_CONFIG` GCP secret. Values resolve inside Cloud Functions; no secret values are printed or copied into the deployment source. The other two endpoints do not bind this secret.

## Validation

- Client deletion tests: 12/12, including actual Auth module linking, wrong passwords, unavailable OTP, negative verification, failed server deletion, cache failures and sign-out failures.
- Functions tests: 240/240, including six OTP/media authorization cases.
- App regression tests: 12/12.
- Auth, Firestore and Storage emulators: complete deletion of a disposable identity, profile, both decision directions, conversation/messages and gallery object; peer profile preserved. Missing verification causes no avatar request or cascade. No real email or cloud data writes occur in these tests.
- Emulator rules were also tested against the deployed Firestore ruleset `eec68008-dccb-49e2-849c-96a8a07ed4e6`, SHA-256 `66a4f72855597469b92a5a6ee1b6b9e58d80d2c9bc52e56d8af6375101d1e13a`. Both owner and other clients are denied reads/writes of the new authorization collection.
- The live `requests.requesterId` collection-group index is READY, as required by the cascade.
- Rust regression Cloud Build `692c7e81-d54d-4822-9933-3e07cfd2b83e`: clippy and 157 tests passed, including deletion with a disposable login using the deployed API role grants. No runtime Rust changes are needed for this client export defect.
- Android Hermes export passed (3450 modules); iOS Hermes export passed (3379 modules). An iOS export is not an Xcode/native-device build.

## Release evidence and remaining checks

Live readback confirmed all three functions ACTIVE and their anonymous callable requests rejected with HTTP 401 / UNAUTHENTICATED:

| Endpoint | Revision | Secret binding |
| --- | --- | --- |
| sendAccountDeletionOtp | sendaccountdeletionotp-00001-rez | CAMPUSMATE_ADMIN_SMTP_CONFIG |
| verifyAccountDeletionOtp | verifyaccountdeletionotp-00001-sig | none |
| deleteUserData | deleteuserdata-00011-hey | none |

`deleteUserData` has a 300-second timeout. The Firestore TTL policy for `accountDeletionChallenges.purgeAt` is ACTIVE. The existing compute service identity has the project Editor role, and the sender has accessor permission on the single SMTP secret. Node.js can reach the avatar Worker's OPTIONS route (200); authenticated avatar deletion has not been exercised against real media.

Internal Android build `9b2641d9-f4ce-4e43-9e44-7cd32bc7fa8a` targets Firebase, profile `preview`, version `3.1.3 / 88`, and is FINISHED. Its downloaded APK has package `com.campusmate.app`, versionCode 88 and versionName 3.1.3; APK Signature Scheme v2 verifies. SHA-256 `7f1224fb03afe3b44e6feb7a29c9458be5e9d2e7f2ee8e5b82f3793dd977366f`; signer certificate SHA-256 `1e4e5d22936e5723a6c0a581411701a357fed9e1c9854ea11a9f8735b9c98e62`.

The later combined build 90 (`8321fd77-28e2-4dc7-8905-9a88e32768a5`) also includes music and Android filter fixes and is FINISHED. Prefer the [verified 3.1.3 / 90 APK](https://expo.dev/artifacts/eas/s0UMq52l1Sv8xruRkJXQ7C47-SR8bggLhdlAGSG1grc.apk) for testing all three reported bugs; see `music-filter-hotfix-2026-10-14.md` for hash/signature and native QA limits. Builds 89 and the first build 90 attempt failed before producing an APK.

Physical-device deletion and real email receipt are not established by emulator or bundle results. No real account was deleted during this investigation. The production database migration, data import, Firebase write shutdown and Store publication remain outside this hotfix.
