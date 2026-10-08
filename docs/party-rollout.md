# Party and group chat rollout

The party feed reads `parties` directly. Membership and chat epochs are written only by callable Functions. Google Places results stored in Firestore contain a Place ID only; the app resolves the name and coordinates when displayed.

## Credentials and native builds

1. Enable Places API (New), Maps SDK for Android, and Maps SDK for iOS in the intended Google Cloud project. Set `GOOGLE_PLACES_API_KEY` as a Firebase Functions secret (`firebase functions:secrets:set GOOGLE_PLACES_API_KEY`). Restrict this server key to Places API (New); keep it out of the app bundle.
2. Provide `CAMPUSMATE_ANDROID_MAPS_SDK_KEY` and `CAMPUSMATE_IOS_MAPS_SDK_KEY` to the native build environment. Restrict the Android key to Maps SDK for Android, package `com.campusmate.app`, and the signing certificate SHA-1 values for every build channel. Restrict the iOS key to Maps SDK for iOS and bundle ID `com.campusmate.app`.
3. Build a new Android/iOS native binary after adding the keys. An OTA update cannot add the `react-native-maps` native module or native key configuration to an older binary. Without a configured key, the place picker offers the curated campus list while map pinning is disabled.
4. EAS profiles `preview` and `production` load their matching remote environments. `ios-simulator` inherits `preview` and does not require Apple signing. An iPhone installable build still requires Apple Developer signing credentials. The local Android `assembleRelease` task currently uses the debug keystore, so its APK is for testing and must not be submitted to Google Play.

## Deployment order

1. Run `node --test functions/partyFunctions.test.js`, `pnpm test:party-rules`, and `pnpm test:party-functions` against the Firestore emulator. On this workstation the emulator cache can be placed on D: with `$env:FIREBASE_EMULATORS_PATH='D:\Temp\firebase-emulators'`. If the Firebase CLI reports an error only while shutting down on Windows, start `firebase emulators:start --only firestore --project demo-campusmate` in one terminal, then run `node scripts/test-party-rules.mjs` and `node scripts/test-party-functions.mjs` with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` in another.
2. Deploy `firestore.rules`, `firestore.indexes.json`, and Functions before any migration or new app release: `firebase deploy --only firestore:rules,firestore:indexes,functions --project campusmate-7f1ab`.
3. With Firebase Admin application default credentials for `campusmate-7f1ab`, review the read-only migration report with `pnpm backfill:parties`. Then run `pnpm backfill:parties --commit`. The deterministic `legacy-` document IDs make repeat runs safe. The script migrates only future public profile meetups inside 3 km and counts matching active appointment guests.
4. Release Android and iOS native builds with their respective Maps SDK keys. A migrated party with existing members creates its E2EE room when its host opens the new app, even if the appointment has since expired. If a member has not published an encryption device, the host sees a retry action after that member updates the app.

## Monitoring

- Watch Functions logs for `party_approval_failed`, `places_api_failed`, and group media upload failures.
- Watch client reports for `message_decryption_failed` and unsuccessful legacy chat activation.
- Set Cloud Billing and Places API quota alerts for the server key. The place search is invoked only for authenticated users; quota protection should be set before broad release.
- Review `parties` with `status == 'open'` and past `schedule.startsAt`. The `expirePastParties` scheduled Function changes these to `expired` every 15 minutes. The app shows active and recently expired parties from a bounded query.

## Device checks

Verify both light and dark mode and large text on Android and iOS. Search a campus place and a Google result, choose a point just inside/outside the 3 km boundary, close the picker without saving, and repeat with Places unavailable. With two signed-in users, exercise duplicate requests, final-slot contention, owner approval, old text/image decryption, and leaving/rekeying. Confirm a failed image encryption never uploads a plaintext file.
