# Native iOS chat attachment menu — 2026-10-22

## Audit and installed SDK

The iOS composer previously opened the gallery immediately when `+` was tapped. The request is a floating system menu anchored to that control. Installed versions are Expo 58.0.14 and `@expo/ui` 58.0.20; its `Menu` types and native `MenuView.swift` explicitly support single-tap presentation when `onPrimaryAction` is absent. The installed universal exports do not include Menu, so this uses the existing SwiftUI chat Host.

## Design and implementation

- `src/components/ChatAttachmentMenu.ios.js` renders SwiftUI Menu with a single SF Symbol trigger. There is no nested trigger Button or primary action competing with menu presentation.
- SwiftUI owns menu material, positioning, system fonts, scrolling, accessibility and outside dismissal. Appearance follows the running iOS version and system settings. There is no painted blur, fixed popup position, custom transition or SDK upgrade.
- Menu actions are รูปภาพและวิดีโอ, กล้อง, GIF and เพลง. Each connects to an existing functioning app flow. Music is present only when the existing Spotify feature gate permits it. The screenshot informs the presentation; it does not introduce saved-item, location, drawing, sticker or AI-image product features.
- `src/screens/ChatRoomScreen.ios.js` places the menu inside the existing composer Host. Selecting an action blurs the native TextField, hides quick emoji, closes other attachment pickers and opens the selected flow. It does not clear or replace the draft. The iOS photo drawer no longer repeats the GIF/music shortcuts now offered directly in the menu.
- **Focus Restoration (Option 3)**: When `+` or an attachment picker is opened while composing, the prior focus state is recorded in `wasFocusedBeforeAttachmentRef`. Dismissing or closing any modal/sheet (`ChatMediaPickerSheet`, `ChatCameraModal`, `ChatMediaComposer`, `ChatVideoComposer`, `ChatGiphyPickerSheet`, `SpotifyTrackSearchSheet`) automatically invokes `restoreTextFieldFocus()`, returning keyboard focus to the `TextField` so the user can continue typing without re-tapping the input bar. Sending media clears the flag.
- `src/components/ChatAttachmentMenu.ios.js` memoizes native menu modifiers to prevent redundant host re-evaluations during composer typing.
- Android remains on its existing attachment flow. No backend, permissions, package dependencies or deployed configuration changed.

## Verification

- **62 client regression tests passed**. Added tests execute the real menu render and selection callback: tap-menu configuration, no picker invocation merely from rendering, isolated GIF selection, absent music action when unavailable, mutually exclusive picker state and draft-preserving blur commands. Log: `../artifacts/inbox-ui-20261022/native-attachment-menu-tests.log`.
- Both changed iOS source modules pass Babel transformation using the installed Expo preset with the iOS caller. Whitespace checks pass.
- API usage was checked against installed Menu/Image/TextField types, native SwiftUI Menu implementation and the [Expo SDK 58 Menu documentation](https://docs.expo.dev/versions/v58.0.0/sdk/ui/swift-ui/menu/). Design reference: [Apple HIG menus](https://developer.apple.com/design/human-interface-guidelines/menus).

## Device validation and release limits

No iOS device/simulator was available for agent-controlled testing. The user's targeted iPhone retest is recorded below. VoiceOver, Dynamic Type, light/dark/Reduce Transparency appearance and the complete picker flow remain unverified on device. No native screenshot or simulated-native visual is presented as proof. No release build or OTA publication was performed.

Next check on iPhone: reload from Metro, type a draft, tap `+` once, verify the floating menu and outside dismissal, then open each supported action and return to confirm the draft remains. Repeat with keyboard open and closed, large text and light/dark modes.

## Follow-up: keyboard closes immediately on tapping +

The user confirmed this happens on iPhone before selecting a menu item. The explicit `Keyboard.dismiss()` / native `blur()` calls run only after selecting an attachment action; they do not explain this earlier symptom. Native presentation/focus or layout changes within the shared SwiftUI host are a working hypothesis, not a reproduced root cause.

The menu now renders through `RNHostView` → fixed-size React Native container → a separate SwiftUI `Host`. Its host uses `ignoreSafeArea="all"` so this small control does not independently apply keyboard avoidance. The active TextField stays in the original composer host. This follows the installed package's supported RN/SwiftUI boundary; directly nesting Hosts without RNHostView is avoided. The composer glass container is no longer interactive as a whole; individual controls retain their native interactions. No programmatic focus retry loop or invented Menu open/close callback was added.

Existing attachment-selection blur and picker-close focus restoration remain in place. They are separate from merely browsing the + menu.

Verification: all **11 current media/focus tests pass**, including the separate menu host, absence of TextField in that host, no primary action, no picker/permission action during render, exclusive selection, draft preservation and existing focus restoration. Log: `../artifacts/inbox-ui-20261022/attachment-keyboard-tests.log`. Both affected iOS sources pass Expo Babel transformation.

**User-confirmed iPhone result:** after Reload from Metro, focusing the composer and tapping `+` without selecting an item, the user reported “เมนูเปิดและคีย์บอร์ดยังอยู่” (menu opens and keyboard remains visible). This confirms the reported immediate-dismissal symptom is resolved in that tested workflow. It is user-reported device verification, not an agent-observed native recording or proof of every accessibility/picker configuration.
