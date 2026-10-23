# Discovery photo recovery after returning from a profile

Date: 20 October 2026.

The subsequent full-card tap/blur follow-up consolidates the iOS photo and metadata into one hosted React Native subtree, retaining the focus/profile key described below. See `discovery-card-tap-blur-2026-10-20.md` for the final card structure and newer bundle evidence.

## Findings and changes

The reported iOS card renders its photo inside `RNHostView`, while the name and summary are SwiftUI siblings. The screen stays mounted during profile navigation; its focus callback previously incremented an unused state value, so returning did not recreate the hosted photo. The fix uses that focus generation as the photo host's React key. Each return recreates the hosted image subtree with its existing explicit dimensions, without changing the candidate, refetching the deck, altering signed URLs, or clearing the native image cache. This is a targeted recovery for the reported lifecycle; the native failure itself has not been reproduced on hardware here.

The shared carousel also had two concrete recovery defects:

- For photos with explicit dimensions, loading and error UI were suppressed. Other error overlays were placed in normal flow after a full-height image and could be clipped. Loading and retry now render as overlays within the existing photo bounds for both measured and unmeasured cards.
- A single-photo component could reuse its loaded/failed state when its URI or profile changed. Its photo is now keyed by the source, profile, and revision, so the new photo starts with fresh state.

The retry target is above the photo's navigation target and stops propagation; the redundant SwiftUI tap gesture was removed to avoid opening a profile when retrying. The fixed dimensions are also applied to the iOS blur host. Gallery-only public profiles now pass the same photo selector as the carousel instead of being gated solely on `avatarUri`.

Existing photo paging, invisible next/previous tap targets, bottom blur, profile actions, and private-cache invalidation remain in use. No backend, upload, dependency, or authorization policy changes are included.

## Validation

- Focused tests: 34/34 passed (`scripts/test-discovery-profile-music.mjs`, `scripts/test-image-cache.mjs`, `src/utils/discoveryPresentation.test.js`). They exercise repeated return/focus generations, stable candidate/cache URL, gallery-only selection, single-photo source changes, measured-image retry above navigation, photo paging, and cache privacy.
- Wider regression run: 79/87 passed. Eight checks in `scripts/test-interaction-regressions.mjs` fail because their VM fixtures omit current dependencies (`sharedProfiles`, `isCommittedProfilePhoto`, `rewindEligibleProfileId`) or look for a callback that has changed in `AppContext`. Those handlers were not changed by this fix; these wider checks are not reported as passing.
- Repository TypeScript check is blocked by missing React declaration packages in the current checkout (`TS7016` in `modules/campus-landmarks`). No dependency changes were made to hide this result.
- `agent-device open com.campusmate.app --platform android --foreground` returned `DEVICE_NOT_FOUND`. No physical iOS/Android UI result is claimed. Device checks must repeat Home → profile → Back several times, switch tabs, change the displayed profile/photo, and retry after a network failure.
- Both JavaScript exports passed using `--no-minify --no-bytecode`: `D:/Temp/campusmate-discovery-image-return-ios-20261020` and `D:/Temp/campusmate-discovery-image-return-android-20261020`. Logs: `D:/Temp/discovery-image-return-ios-export.log` and `D:/Temp/discovery-image-return-android-export.log`. These are JavaScript exports, not installation or device proof. Export used the repository's supported `EXPO_USE_WATCHMAN=0` option after the Windows Watchman startup stalled; this does not change app source or production behavior.
- Source hashes for the two implementation files and focused regression file are recorded in `D:/Temp/discovery-image-return-source-hashes.json`; the final check found no source changes during platform export. The affected-file whitespace check passed.

Implementation uses the installed `expo-image` API and its existing persistent cache. Official reference: [Expo SDK 58 Image](https://docs.expo.dev/versions/v58.0.0/sdk/image/).
