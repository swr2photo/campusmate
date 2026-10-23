# Chat opening, immersive discovery, and Expo 58 patch update

Date: 16 October 2026. Implements the user's three-image follow-up and keeps the preceding Expo update request in scope. The third image is a layout reference; its people, profile attributes, online status, and extra product features are not copied into CampusMate.

## Chat fixes

- `ChatRoomScreen.ios.js` now calls `useSafeAreaInsets` on every render, before the missing-room return. Previously, opening a room before its conversation snapshot arrived skipped this hook; the loaded render added it, violating React's hook-order contract. This is a verified source defect capable of breaking the transition, rather than a device-reproduced diagnosis.
- The missing-room back button no longer depends on calling capability.
- Likes serialize rapid chat-opening taps and impose a 15-second connection deadline. Timeout unlocks retry; a late response cannot navigate to a room after timeout.
- Opening an existing match from discovery calls the existing authorized conversation action, without sending an additional activity invitation.
- Fixed the reported native `HStack` text error in the composer: an extra literal `) : null}` after the Spotify button conditional was being rendered as a text child of a layout view. Removed the literal instead of filtering console output. A regression traverses the chat JSX and rejects raw text outside `Text`/`RNText`.

## Discovery behavior and layout

- Both detail screens now use the measured React Native `ProfileCardView`. The previous separate SwiftUI detail tree could retain a scrolled position and bridged content sizing after collapsing; the shared tree exposes a single scroll/layout lifecycle.
- The compact card shows the large photo, name/age, activity summary and up to four public information chips. Full details are removed from layout until explicitly expanded.
- Per the user's clarification, the photo ends in one softly blurred bottom section (24% of card height, bounded to 100–190 layout units). Each carousel page supplies its own same-source, same-crop blurred layer, fading in through a mask; the remaining photo stays sharp. It is noninteractive and appears only after loading, keeping the existing retry UI available. Other carousel consumers retain their existing appearance by default.
- The header and card have separate layout areas with a 12-unit gap. The card width is measured from its container; phones show the photo across the available width, its height follows the viewport, and tablet content can grow to 820 units.
- Horizontal dragging selects/skips a profile when the compact discovery card is interactive. Vertical scrolling is enabled for expanded details or a view-only profile. Decision gestures are disabled while processing, reading expanded details, or in view-only mode.
- Photos use transparent left/right tap areas and current-image indicators. No left/right arrow icons are rendered. Discovery photo scrolling is disabled so it does not compete with the card swipe; a view-only photo gallery can still scroll horizontally. Accessibility next/previous actions remain available.
- Expanding waits for the new content layout before scrolling to its heading. Collapsing resets to offset zero before removing details. No timer or side effect inside a React state updater controls the scroll.
- The iOS header uses a fixed 48-unit safety button rather than the previously expanding hosted control. Existing report/block functionality remains.

The skip/like buttons remain explicit alternatives to gestures. No unsupported Super Like, synthetic compatibility score, fake presence badge, or automatic message action was introduced.

## Expo update

`package.json` retains the requested `expo: ~58.0.12`; the installed and locked Expo version is **58.0.12**. Related dependencies are aligned to the official bundled dependency manifest shipped inside that version, including:

| Package | Before | Installed after |
|---|---|---|
| Expo | 58.0.7 | 58.0.12 |
| React Native | 0.88.0-rc.4 | 0.88.0 |
| Expo UI | 58.0.15 | 58.0.19 |
| Expo Router | 58.0.17 | 58.0.21 |
| Reanimated | 4.7.0 | 4.7.1 |
| Keyboard Controller | 1.22.4 | 1.22.7 |

The Keyboard Controller Kotlin source-set patch was ported to 1.22.7 and verified in the installed Gradle file. Existing unrelated patches remain. The obsolete `package.json.pnpm.patchedDependencies` copy was removed; pnpm 11 uses the existing `pnpm-workspace.yaml` configuration. Supply-chain checks remain enabled; pnpm recorded exact-version release-age exceptions as part of its installer.

The animation integrity gate still checks 14 published files and Metro initialization order. Its Reanimated pin was updated only after verifying the npm archive integrity and comparing six installed files against the 4.7.1 archive. The files' expected hashes remained valid.

No clean prebuild or native-directory regeneration was run against the dirty checkout. Because native package versions changed, installed development/release binaries need a new native build; these changes should not be published as a JavaScript-only update to an older native runtime.

## Validation and evidence

Evidence directory: `C:/Users/This PC/.codex/artifacts/expo-58.0.12-upgrade/`.

- Regression tests: 71/71 passed after the footer/text fixes, including hook ordering, native layout text, per-page blur/crop, swipe modes, stable collapse order, timeout/retry, prevention of late navigation, matched-chat action semantics, countdown, photo editing, report submission, and music cancellation.
- Installed-SDK offline dependency check: dependencies are aligned to the 58.0.12 bundled manifest. Offline validation does not establish that a version is globally newest.
- Animation runtime integrity and Android configuration checks pass.
- Added the already-used React declarations as an explicit development dependency (`@types/react@19.2.18`). The repository TypeScript check now passes.
- Online Expo Doctor passes 16/19 checks. Its remaining findings cover existing dynamic/static configuration analysis, the direct core dependency used by the current verification service, and newer 58.0.13-era patches published after the user's requested 58.0.12 target. No warnings were hidden with dependency exclusions.
- Platform export/native validation results are recorded below when complete. JavaScript exports are not device evidence.

No device UI or playback latency is claimed. Physical iOS/Android verification must check the cold room-opening transition, card swipe direction, photo tap zones, expanding/collapsing after scrolling, safe areas, large text, and native report/block presentation.

## Final build checks

After the final footer/text correction, both platform JavaScript exports passed: `D:/Temp/campusmate-footer-text-ios` and `D:/Temp/campusmate-footer-text-android`. TypeScript also passed again. These exports use `--no-minify --no-bytecode` and are bundle validation, not signed builds or device runtime evidence. The source snapshot is recorded in `footer-text-source-manifest.json`. Native Kotlin compilation is being checked separately in `D:/Temp/campusmate-sdk58-native-compile.log`.
