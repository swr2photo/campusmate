# iOS native button and card base — 2026-10-21

## Scope and implementation

The client now routes its React Native touchable imports through a platform-specific base. The source inventory finds 99 consumers of that base, 68 explicit native card surface sites, and 9 compound touchable card sites. The inventory includes shared screens and platform variants; these counts are not a count of controls mounted simultaneously on an iPhone.

- `NativeButton.ios.js`: SwiftUI text/icon buttons, roles, selected state, disabled/loading state, native progress indicators, intrinsic chip sizing, and 44 pt minimum targets. Common primary/outline buttons and chips use the native iOS implementation through `ui.ios.js`.
- `NativePressable.ios.js`: a real SwiftUI Button handles ordinary actions with existing rich labels. Yoga retains ownership of the visible content and layout. The native hit area mounts only after a positive, finite layout measurement, preserving refs, content identity, callback events, and resizing. This avoids reparenting media into a newly measured host.
- `NativeCard.ios.js`: opaque SwiftUI rounded surfaces sit below existing content, with measured bounds and per-corner radii. Images, nested controls, and scroll content retain their existing React Native tree. Content cards do not receive Liquid Glass by default.
- `NativeAnimatedCard.js`: retains the existing Reanimated transform tree while using the platform card base.
- `iosLike.ios.js`: native icon buttons and pills.
- `LiquidGlassCompactToolbar.ios.js`: native glass buttons replace the shared toolbar's decorative blur/refraction layers.
- `SearchField.ios.js`: native controlled TextField and clear/cancel buttons retain the imperative focus/blur/clear contract.
- Screens, modal controls, music/photo modules, settings groups, and the campus-landmarks fallback use the central base. Existing SwiftUI screens and native navigation retain their working native controls.

This is a native control/surface migration, not a claim that every content node was rewritten in SwiftUI. Rich media, custom layouts, and gesture content remain in React Native. Long presses, touch-coordinate tools, recording/press-in controls, unknown custom interactive children, and compound clickable containers retain their existing responder. A context prevents nested buttons from creating a second competing native tap layer inside such containers. Compound cards can still render a native background below that responder.

Android and web use their original React Native controls through adapters that strip iOS-only options. Their existing styles, ripple props, callbacks and refs are preserved. No new UI dependency or SDK version was installed.

## Native API basis

Installed API: Expo SDK 58 / `@expo/ui` 58.0.20. The implementation uses the installed component declarations and versioned [Expo SwiftUI Button documentation](https://docs.expo.dev/versions/v58.0.0/sdk/ui/swift-ui/button/). Native `glass` button styles progressively fall back through Expo on unsupported OS/toolchains. Glass belongs on functional controls; content surfaces stay opaque, following [Apple materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials).

## Validation

**121 focused tests passed**, including native adapter rendering/callback checks, finite sizing and resizing, unchanged photo identity, busy/disabled actions, nested responder isolation, VoiceOver link/selection/expanded values and custom accessibility action preservation, Android prop/ref parity, controlled native search, native toolbar actions, discovery rewind, chat/music/photo regressions, tab headers, UI flows and photo editing.

The static guard rejects new direct client imports of legacy touchables outside the platform adapters. The migration audit reports zero remaining matching button/card sites. The one-time migration saved pre-edit client sources at `D:/Temp/campusmate-ios-native-base-before-20261021`.

Test log: `D:/Temp/ios-native-base-tests-final.log`.

TypeScript checking reports the same four pre-existing TS7016 errors for missing React/JSX-runtime declarations in `modules/campus-landmarks`. The callback type required by the new adapter import was added explicitly; no new TypeScript diagnostic remains. Log: `D:/Temp/ios-native-base-typecheck-final.log`.

Both final Metro debug exports passed:

- iOS: `D:/Temp/campusmate-ios-native-base-ios-complete-20261021`; log `D:/Temp/ios-native-base-ios-export-complete.log`.
- Android: `D:/Temp/campusmate-ios-native-base-android-complete-20261021`; log `D:/Temp/ios-native-base-android-export-complete.log`.

Exports use offline mode, Watchman disabled, one worker, and `--no-minify --no-bytecode`. A SHA-256 manifest checks 361 application source/config files; the final comparison reports zero source drift. Manifest: `D:/Temp/ios-native-base-source-manifest-complete-20261021.json`. The checked diff has no whitespace errors in the affected sources; an unrelated existing blank line at the end of `app/(tabs)/_layout.ios.js` was left alone.

No physical iOS UI, VoiceOver, Dynamic Type or device performance pass has been run in this Windows session. The next device check must cover ordinary button taps, nested card controls, long presses/recording, photo return/retry, full-screen discovery, native menus, keyboard/search, and light/dark/Reduce Transparency settings. Metro exports verify JavaScript/asset bundling, not a signed native build or hardware interaction.
