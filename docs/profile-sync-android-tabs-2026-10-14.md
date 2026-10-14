# Live owner profile and Android tabs — 2026-10-14

The same signed-in account on another device kept its old photo/name because AppContext loaded the full owner profile once, then subscribed only to face-verification changes. Although that subscription received the full owner document, its callback merged only verification fields. The avatar revision never reached the second device's rendered profile.

## Implementation

- Add a normalized full owner-profile subscription using the existing authenticated Firestore document listener and Rust profile/account live query. Only committed server snapshots are accepted; cached and pending-write snapshots cannot revoke a just-completed verification.
- Start live refresh after initial bootstrap, so a late one-off read cannot overwrite it. Unsubscribe on identity/network/retry changes. Revision and identity checks discard late queue reads and callbacks from a departed account.
- Overlay only queued edits from the current device, retaining server-owned verification and owner ID. Remote removed fields and a cleared meetup replace the old cached record.
- Refresh the complete fast-boot profile and saved-account photo/name metadata, including avatar revision. Existing image requests already include that revision, so same-URL photo replacements invalidate image caches.
- Android automatically resolves solid-color platform variants for segmented controls, search fields and compact activity toolbars. Selected tabs use the existing blue primary/onPrimary theme; tracks use neutral tonal surfaces. Prismatic gradients and glass blur remain in the existing iOS variants.
- The Android selected capsule follows the controlled index with native RN Animated timing. It has no pan recognizer: the shared glass component's `onBegin` sets a drag lock for a simple touch, while its `onEnd` does not run if the pan fails to activate; this leaves later taps unable to move the capsule. Buttons and selection now stay synchronized without that lock. Targets are at least 48 logical pixels; tabs expose selected accessibility state.

The installed Expo UI 58.0.15 Compose segmented button API was inspected. Its per-button selected fill does not provide the requested sliding capsule or the existing RN icon/badge content contract. These Android variants keep the existing RN component interface and avoid changing the native dependency graph. This is a focused correction rather than a new navigation system.

## Evidence

- Build 91 Nox baseline: tapping “จับคู่แล้ว” changes the summary, label and content, but the rainbow capsule stays under “ถูกใจคุณ” (`tabs91-current.png`, `tabs91-accepted.png`).
- Build 91 chat baseline: switching from unread to all changes the label/content while the capsule remains under unread (`tabs91-chat.png`, `tabs91-chat-all.png`).
- 56/56 owner-sync, verification-persistence, music/filter, discovery, app and UI regression tests pass. Sync cases cover avatar/name changes, same-URL revisions, removal, unsent local edits, verification revocation, asynchronous ordering, sign-out, unsubscribe and queue-read failure.
- Disposable Firestore emulator with the repository's owner rules: two independent SDK clients authenticated as the same owner received name and same-URL avatar revision edits in both directions. Detach/reconnect fetched a missed revision. No production user record or photo was changed. This proves client/listener integration, not two physical-device rendering.
- Android/iOS Hermes exports pass (3116/3045 modules); Android config matches 12 fields/11 permissions; animation-runtime integrity passes. No native dependencies changed.

## Internal build

Build `2e3f35b5-bfff-4df5-8d5a-544540fd95a0`, preview Firebase APK, version `3.1.3 / 92`, is FINISHED.

- [Download APK 3.1.3 / 92](https://expo.dev/artifacts/eas/DDsx2ShohiJazur1foFo4llkqgBYZUCwxqit-m2VS6s.apk). Local: `artifacts/CampusMate-3.1.3-92-profile-tabs.apk`, 232,809,702 bytes; SHA-256 `2118f9c3df01c7bf386e25da565d6344042fe38f1ef938e705d25e202b6329cd`.
- Manifest confirms package `com.campusmate.app`, versionName 3.1.3, versionCode 92, minSdk 24, targetSdk 36. `apksigner verify` exits 0; certificate SHA-256 `1e4e5d22936e5723a6c0a581411701a357fed9e1c9854ea11a9f8735b9c98e62` matches build 91. All 13 frozen source hashes still match.
- ADB replacement installation succeeded; installed versionCode 92 verified. Signed-in session remained available.
- On the same Nox guest at 23:52–23:54 Bangkok time, Likes selected capsule moved left → right → left with the matching summary/content. Chat all → unread → all also moved correctly. Both use solid blue selection and neutral track; the chat search field has a solid neutral background and a plain blue focus outline. No rainbow rim is present in these tested controls.
- Search focus and Android Back worked. Matching filters opened and confirmed unchanged values, returning to visible Home without the prior white screen. PID 10556 remained alive; no native parent conflict, host failure or JS error occurred in these marked interaction windows.
- Screenshots: `tabs92-likes.png`, `tabs92-accepted.png`, `tabs92-pending-again.png`, `tabs92-chat.png`, `tabs92-chat-unread.png`, `tabs92-chat-all.png`, `tabs92-chat-focus.png`, `tabs92-filter-confirm.png` under the device evidence directory below.

Startup separately logged an existing oversized offline-cache row (`CursorWindow`) and Nox billing unavailable warnings. Online bootstrap recovered and all targeted interactions passed. Offline cache recovery and purchases are not certified by this QA. No real account deletion or production profile mutation was used to validate the tab controls. Physical Android/iPhone avatar rendering remains pending.

The user confirmed Android plus iPhone and then clarified that the iPhone uses Expo Go and there is no paid Apple Developer membership. The initially attempted internal physical-iPhone build did not submit: EAS could not find credentials suitable for internal distribution, and `eas device:list` found no Apple teams. That signed-IPA prerequisite does not apply to the user's Expo Go test path. No export-compliance declaration was invented; the app contains chat encryption.

A current-source Expo Go server is running from this checkout with `npx expo start --go --tunnel --port 8081`, with watchman disabled and CI mode. Local `/status` returns running; the externally reachable `/_expo/open?platform=ios&runtime=expo` and iOS manifest both return HTTP 200. The manifest reports SDK 58.0.0, runtime 3.1.3, CampusMate and the tunnel launch asset. QR: `artifacts/profile-sync92-expo-go-qr.png`; exact link: `artifacts/profile-sync92-expo-go-link.json`. Public host: `https://c-doralikon-4rwxw8-mv87fx3youqs2ovm.on.expo.app`. This is a temporary development link requiring this server/Windows machine to remain running. Physical iPhone launch and native-module compatibility are not yet confirmed; a manifest/export success alone does not establish them.

On continuation, the earlier server had stopped. It was relaunched as a hidden PowerShell helper (`artifacts/start-expo92.ps1`). The first restart exited because Expo's automatic TypeScript setup required a missing development-only `@types/react` dependency. The helper now sets the installed CLI's `EXPO_NO_TYPESCRIPT_SETUP=1` to serve the already-exported JavaScript without mutating dependencies. Metro recovered from an incompatible file-map cache by crawling again. The current public host is `https://c-doralikon-4rwxw8-mv8cph31hl7tkvc1.on.expo.app`, with its external iOS manifest returning HTTP 200. The QR and link JSON point to this host. Earlier hosts/QRs should no longer be used.

The externally reachable iOS launch bundle also returns HTTP 200 (`application/javascript`, 21,012,845 bytes). Metro records a successful iOS development bundle (2933 modules), saved for evidence as `C:\Temp\CampusMate-QA-92\ios-expo-go.bundle`. This remains server/bundle evidence, not a claimed physical-iPhone pass.

Source freeze: ignored `artifacts/profile-tabs92-source.json` (13 files). Logs: `artifacts/profile-tabs92-tests.log`, `artifacts/profile-sync-emulator.log`, `artifacts/profile-tabs92-android-export.log` and `artifacts/profile-tabs92-ios-export.log`. Export directories are `C:\Temp\CampusMate-QA-92\android` and `C:\Temp\CampusMate-QA-92\ios` to avoid filling the project drive. Device screenshots/logs are under `D:\Temp\Nox-HyperV-repair-2026-10-14`.

## Official references and remaining checks

[Firestore document listeners](https://firebase.google.com/docs/firestore/query-data/listen) deliver subsequent document changes and provide snapshot metadata. [Android color guidance](https://developer.android.com/design/ui/mobile/guides/styles/color) supports clear semantic surface/selection colors, and [accessibility guidance](https://developer.android.com/design/ui/mobile/guides/foundations/accessibility) informs touch targets and selected semantics.

Nox is Android 12/API 32. Physical Android/iOS cross-device photo rendering, slow/offline saves, TalkBack, maximum font scale, tablet/foldable and gesture/3-button device matrix remain unverified. Store submission and production cutover remain outside this internal-build validation.
