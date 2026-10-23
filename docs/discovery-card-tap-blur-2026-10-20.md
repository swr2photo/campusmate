# Discovery card: stronger lower blur and full-card navigation

Date: 20 October 2026.

The home discovery card now opens `/discover-profile` through its existing profile action when tapped on its photo, name, summary, or surrounding card area. Both home implementations disable the carousel's invisible side-tap controls so a tap consistently opens the profile; horizontal photo paging and accessibility next/previous actions remain available. The explicit rewind and image-retry controls keep their own actions.

The iOS card's photo and information now share one `RNHostView`. Its informational overlay uses `pointerEvents="none"`, while the controls use `box-none` containers, so the name and lower panel cannot intercept the photo's full-card press target. This replaces the separate SwiftUI metadata and native blur layers that could cover it. The photo host retains its profile/focus key and explicit dimensions from the image-return repair. The same carousel also handles a missing main photo or a gallery-only profile.

The user subsequently reported that the entire iOS card disappeared. The consolidation had removed the enclosing fixed-height SwiftUI frame while leaving the hosted view in parent-fill mode. Under the vertical `ScrollView`, this left no independent height owner. The correction restores an explicit width/height on the outer card, uses `RNHostView matchContents`, and supplies a direct `View collapsable={false}` child with the same pixel dimensions. The regression test now requires all three parts of this sizing contract; the earlier tests and bundle exports did not check it.

The bottom blur covers 46% of the preview, bounded to 180–280 layout units. The opted-in carousel footer uses a 44-point same-source image blur and a gradual dark scrim reaching 90% opacity at the bottom. Its mask fades from clear to opaque; the upper photo stays sharp. The shared footer also improves the detail card where blur was already enabled. The blur/scrim layers ignore pointer events, and loading/retry overlays remain above the photo navigation target.

These sizes and opacity levels are product choices. No navigation destinations, profile permissions, backend requests, or package versions changed.

## Verification

- Focused regression tests: 34/34 passed in `D:/Temp/discovery-card-tap-blur-tests.log`. Updated checks cover card-info tap-through, direct navigation versus rewind/retry, retained horizontal paging/accessibility actions, stronger footer, and the previous return-to-card recovery.
- Changed-file whitespace check passed.
- iOS and Android JavaScript exports both passed at `D:/Temp/campusmate-discovery-card-tap-blur-ios-20261020` and `D:/Temp/campusmate-discovery-card-tap-blur-android-20261020`. Logs: `D:/Temp/discovery-card-tap-blur-ios-export.log` and `D:/Temp/discovery-card-tap-blur-android-export.log`. Exports use `--no-minify --no-bytecode` for JavaScript bundle validation.
- The four source/test files matched `D:/Temp/discovery-card-tap-blur-source-hashes.json` after export; no source drift was detected.
- No device was available in the preceding check. Physical-device touch/render verification is still required; source/tree tests and bundle exports do not establish native hit testing or visual quality on hardware.
- The existing wider-test fixture failures and missing React declarations documented in `discovery-photo-return-fix-2026-10-20.md` are outside this UI follow-up.

## iOS height correction

- Focused regression tests passed 34/34 again, including the finite outer frame, content-sized host, retained RN measurement root, focus recovery, tap behavior, and blur. Log: `D:/Temp/discovery-ios-card-height-tests.log`.
- Affected-file whitespace checks and the corrected iOS JavaScript export passed. Output: `D:/Temp/campusmate-discovery-ios-card-height-20261020`; log: `D:/Temp/discovery-ios-card-height-export.log`. The iOS screen hash matched its pre-export snapshot. This correction changes only the iOS screen and regression checks; Android implementation files are unchanged.
- Native iPhone rendering is still unverified here; this fixes the identified measurement contract without claiming hardware reproduction.
