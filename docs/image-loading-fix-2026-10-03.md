# Image loading fixes — October 3, 2026

## Changes

- Matching and friend discovery cards on both platforms display the versioned CDN URL directly through expo-image. iOS no longer waits for an intermediate file path before mounting the image.
- Avatars use the same CDN/version URL as prefetch and display. They no longer start with an unversioned URL and then switch to a local cache path.
- The profile deck prefetches up to three upcoming avatars, at most two requests at a time. Obsolete decks stop scheduling new requests.
- Public images use the native memory/disk cache, no fade delay, bounded retries, and retry on returning to the foreground after a failed load. Source changes reset the image and retry state.
- Chat preview starts warming up to two ordinary images on press-in. Encrypted images share the existing download/decryption cache, scoped to the key. Disappearing and deleted media are excluded.
- Preview message reads and key retrieval run concurrently. Every image bubble receives the shared conversation key. Switching rooms/accounts or clearing history hides fetched previews from the previous identity.
- Preview supports a first image supplied only through mediaUrls.
- Failed chat images can be tapped to retry. Changing image identity immediately hides the previous URI and displays the correct loading state.
- Activity location cards and campus banners use the same native cache. Removed the 280 ms delay before mounting the remaining bundled banner photos and the 150 ms fades.

## Verification

- `node --test scripts/test-image-cache.mjs scripts/test-app-bug-regressions.mjs`: 25/25 passed.
- `node scripts/test-conversation-order.mjs`: passed.
- `node scripts/check-android-config.mjs`: passed, 12 fields and 10 permissions.
- Android Metro/Hermes generated the changed release bundle (10,782,488 bytes). The first bytecode attempt failed during memory pressure; the later release bundle succeeded.
- iOS Expo/Hermes export passed: `tmp/image-fix-export/ios`, 12,316,485-byte bytecode artifact.
- The first local APK attempt failed in `:expo:mergeReleaseJavaResource`: the Thai Java locale produced a Buddhist-calendar year outside the ZIP date range. The build uses `-Duser.language=en -Duser.country=US` on retry.
- Android release APK build passed: 1,344 tasks, 7m 54s; artifact is 201,540,565 bytes. Saved as `artifacts/android/campusmate-2.1.7-v77-image-fix.apk` with a SHA-256 file alongside it. Its sourcemap contains the new CachedImage/chatPreviewMedia modules and the latest preview mediaUrls fallback.
- The previous Nox app was versionCode 76. An update using `adb install -r` was rejected with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` because the signing certificates differ. After the user explicitly approved uninstalling the old app, uninstall and installation of the new APK both returned `Success`.
- Nox package metadata confirms versionCode 77 / versionName 2.1.7. The user completed login after reinstall. A replacement build (described below) is installed and the authenticated UI was tested.
- The agent-device UI controller initially had an orphaned old daemon claim for this workspace. Stopping that verified old controller allowed automatic claim recovery; UI testing then used agent-device. ADB verified installation, package version, startup UI and native error logs.
- Android image first-paint timings and iOS native runtime have not been measured. Visible image rendering and successful route transitions are smoke-test evidence, not a quantified speed improvement.

## White screen discovered during Nox validation

- The user completed login. ADB and agent-device screenshots showed the profile image on the friend discovery deck (`tmp/image-fix-restart.png`, `tmp/image-fix-real-discovery.png`).
- Opening another route then left a white screen. The user independently reproduced this by clicking the Chat tab. Native ReactHost logs report `[Worklets] Tried to synchronously call a Remote Function`, from `pnpm_mutablesNativeTs3`; the React instance was destroyed, explaining the absence of an ordinary ReactNativeJS fatal error.
- Inspection found 14 locally modified source/module files in Worklets 0.13.0 and Reanimated 4.7.0. These modifications included a plain JavaScript fallback for `createShareable` and a dummy native Reanimated proxy. The fallback's `modify` function cannot run on the UI runtime.
- Restored those files from the exact published package archives, verified against the npm registry SHA-512 integrity values. Previous files are retained in `tmp/animation-runtime-backup`.
- Enabled Metro `inlineRequires`, preserving other transform options, to avoid the Worklets initialization cycle. Reference: [upstream issue 9445](https://github.com/software-mansion/react-native-reanimated/issues/9445) and [Worklets troubleshooting](https://docs.swmansion.com/react-native-worklets/docs/guides/troubleshooting/).
- Added `pnpm check:animation-runtime`: verifies the pinned versions, 14 original source/module hashes, and the Metro option. Both Android release commands run this gate before versioning/building. The gate passes locally.
- Replacement release build passed in 8m 3s (1,344 tasks; 76 executed). The first `campusmate-2.1.7-v77-image-fix.apk` is superseded because it contains the modified animation runtime. Use `artifacts/android/campusmate-2.1.7-v77-image-runtime-fix.apk` (201,642,221 bytes; SHA-256 `ff064db4e2fcc848e365539124e5cbeeabf059521aa61d3c4549919f64b175d0`). `adb install -r` returned `Success`; login was preserved.
- The replacement bundle sourcemap confirms the real `createShareable` and `NativeReanimated` implementations, without the dummy fallback/proxy.

## Replacement APK runtime results

Nox Android 7.1.2 / API 25, device `127.0.0.1:62025`:

| Flow | Observed result | Evidence in `artifacts/android/image-runtime-fix-smoke` |
| --- | --- | --- |
| Friend discovery deck | Profile photo visible; returning from another tab keeps it visible | `discovery.png` |
| Detailed matching profile | Full profile photo visible; open/back works | `profile.png` |
| Already matched | Both matched profile photos visible | `matches.png` |
| Activity locations | Campus banner and location card photos visible; scroll works | `activity.png`, `place-cards.png` |
| Chat preview | Opens/closes in both existing rooms; avatars visible; no white screen | `preview.png`, `preview-second.png` |

- The two old rooms report that their encrypted messages cannot be decrypted after the approved uninstall removed the old local key storage. Therefore encrypted image bubbles from those rooms cannot be used to verify the new preview image path on this installation. No messages were sent during these checks. The automated media tests verify download deduplication, key scoping and preview selection, but do not replace a device test with accessible encrypted image history.
- Native log check for the replacement app process (PID 6398) found no `handleHostException`, synchronous remote Worklets error, fatal exception, or fatal JS type/reference/invariant error during these route and preview checks.
- iOS Metro/Hermes export with the restored animation runtime and new Metro configuration passed (`tmp/image-runtime-fix-ios`, exit 0 at 13:22:15 on October 3). Bundle: `_expo/static/js/ios/index-2807f58db7028b9dd52e4d0c801f2fd2.hbc`. This is compilation evidence; iOS device rendering remains unverified.
- No Play Console release has been uploaded with these changes. The previous AAB and first APK must not be treated as the replacement release.

## Device checks

Install the new build, open matching and friend discovery with cold and warm caches, advance several cards, reopen chat preview, and scroll activity location cards. Verify slow/offline networks, recovery, changed avatars, and that recycled cards never display another person's image. Check both platforms and measure image first paint on the same device/network before reporting a speed improvement. No CDN provider, plaintext upload policy, or disappearing-media rules were changed.
