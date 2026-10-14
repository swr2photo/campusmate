# Music and Android filter hotfix — 2026-10-14

**Native QA follow-up:** build 90 reproduced the persistent filter-confirmation white screen in Nox. Build 91 fixes the Fabric ScrollView re-parenting crash and is now built, signature-verified and installed. Five confirmation cycles, reversible distance changes, X cancellation and Android Back passed on the same Nox guest with no native host failure. Use [APK 3.1.3 / 91](https://expo.dev/artifacts/eas/z9OOPOvatKJvzllPJcICyCKOBcrg8It-slzWIW8Y7HA.apk); evidence and physical-device limits are in `android-filter-native-crash-2026-10-14.md`. The build 90 artifact below remains the historical reproduction baseline. Native music/audio and account-deletion/email QA are still pending.

The user reported flickering music UI and a white screen after confirming matching filters on Android. The affected Android build reported earlier in this task is `3.1.3 / 87` (Firebase). No connected device was available for reproducing the native white screen.

## Changes

- The music search mini-player no longer pulses a white wash every 150–250 ms or animates its background color. Album-derived color remains static until the selected album changes.
- Audio and Back callbacks are initialized before the close handler/effect uses them. A first-render regression test reproduced `Cannot access 'player' before initialization` before reordering and passes after the fix.
- `useTrackLyrics` loads by song metadata and explicit retry, independently of playback time and trim endpoints. Song changes invalidate old results immediately; late responses cannot show the previous song's lyrics.
- The trim view does not reset a manual range when late lyrics, hook metadata or playback duration arrive. Duration changes may clamp endpoints; selecting a different song initializes a new range.
- Android matching filters use an opaque native Stack modal. The previous transparent modal plus custom JS sheet animation has been removed. This eliminates the transparent screen layer as a possible source of blank content during dismissal; native reproduction remains pending.
- A successful filter save explicitly dismisses to `/home` using the installed Expo Router `dismissTo` API, which pops to an existing route or replaces the modal for direct entry. Failure preserves the screen and draft; departed/unfocused screens cannot navigate after an asynchronous save.
- AppContext applies preferences only after the backend or offline queue acknowledges them, and rejects applying results to a different active identity. Failed writes cannot replace the underlying discovery feed with an uncommitted filter.
- Confirm/close targets are 48dp. Android system Back is delegated to the native stack except during a pending save. Existing iOS formSheet presentation remains configured.
- Android build code is 90, app/runtime 3.1.3. The new internal APK includes the account deletion hotfix. No Store submission or Rust production cutover is part of this build.
- Gradle explicitly selects `RNGMA_ANDROID_BACKEND=classic`, preserving the module's default SDK. RNGMA 17.2's JSON fallback reads an absent `googleMobileAdsJson` extension when the Expo project has no top-level Ads JSON config. The supported backend property bypasses that failing fallback without enabling ads or altering app IDs.

## Validation and limits

Behavior tests exercise the actual filter handlers, preference action and lyric hook. Cases cover duplicate taps, failure/retry, leaving before completion, account switch, queued saves, 100 playback/trim renders, stale requests, explicit lyric retry, and preservation of manual trim ranges.

The existing UI test harness was updated for its new schedule validators with a fixed clock; the discovery test now waits for asynchronous token acquisition before switching identities. These are test harness changes, not additional production behavior changes.

Android config, dependency integrity and focused regression checks passed: 44/44 app/music/filter/discovery/UI tests and 12/12 deletion client tests. Final build 90 Android/iOS Hermes exports passed (3115/3044 modules), including the initialization-order fix. The optional all-platform export failed on the pre-existing native-only Ads module imported by web; native exports succeeded separately. Local offline Gradle configuration was blocked by the absent Java 17 toolchain cache, before evaluating the app. Exports and mocked behavior tests do not establish that the reported native white screen is resolved on a physical device.

`agent-device open com.campusmate.app --platform android --foreground` returned `DEVICE_NOT_FOUND`. Automatic approval review rejected the subsequent attempt to launch the existing Android Emulator with `blocked by policy`, without a more specific reason. Native visual, accessibility and audio checks therefore remain NOT TESTED.

## Device validation

1. Install the combined internal build and confirm `3.1.3 / 90` in settings.
2. In music search, play/pause a track, open trim and move the range repeatedly. The mini-player should remain steady, lyrics should remain visible, and late loading should not move a manual range. Switch tracks and verify old lyrics disappear.
3. Open matching filters from Home, change filters and confirm. Home should return with results, an explicit empty state, or an error/retry state. Reopen filters to verify persistence. Cancel and use Android system Back to verify draft cancellation; repeat with slow/offline connectivity.
4. Use only a disposable account for deletion QA. Verify wrong password/OTP are rejected and a valid email OTP permits deletion. Do not use a real account solely to validate this fix.

## Artifacts

The intermediate build 89 (`50bd374b-39ce-4253-bdf3-26cba3c17e97`) and first build 90 (`a675135e-bbfc-411e-ad83-23fb68bbdb5e`) failed during Gradle configuration of `react-native-google-mobile-ads` because `googleMobileAdsJson` did not exist; no APK was produced. The build 90 retry `8321fd77-28e2-4dc7-8905-9a88e32768a5` is FINISHED with the explicit classic SDK property. The earlier deletion-only build 88 should not be used to validate the final music fix.

- Internal Firebase APK: [Download 3.1.3 / 90](https://expo.dev/artifacts/eas/s0UMq52l1Sv8xruRkJXQ7C47-SR8bggLhdlAGSG1grc.apk).
- Downloaded local artifact: `artifacts/CampusMate-3.1.3-90-music-filter-deletion.apk`, 232,817,198 bytes.
- `aapt2 dump badging`: package `com.campusmate.app`, versionName `3.1.3`, versionCode `90`, minSdk 24, targetSdk 36, compileSdk 37.
- APK SHA-256: `8bdc046f732fa74a1fa528a81decd62676f24f63bfac812263803734487584a1`.
- `apksigner verify --verbose --print-certs`: exit 0, APK Signature Scheme v2 verified. Signer certificate SHA-256 `1e4e5d22936e5723a6c0a581411701a357fed9e1c9854ea11a9f8735b9c98e62`, matching build 88. Store signing and Store installation compatibility have not been tested.
- All 12 frozen app/config source hashes still match the uploaded snapshot. Verification logs and snapshots are saved under ignored `artifacts/`.

The backend property is supported by the installed RNGMA 17.2 config plugin (`withAndroidSdk`, `androidSdk: 'classic'`). The [upstream README](https://github.com/invertase/react-native-google-mobile-ads) identifies classic as the default Android SDK. Android native files are maintained manually in this project, so the property is recorded directly in `android/gradle.properties`.
