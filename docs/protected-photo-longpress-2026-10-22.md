# Protected-photo long press — 2026-10-22

The user reported that long-pressing sent once-only/replay photos on iPhone failed to show the menu or appeared to freeze.

## Changes

- `ChatProtectedImageBubble.js` explicitly uses the existing gesture surface for both the original card and its disabled focus preview. The readonly preview no longer mounts an additional SwiftUI button over its RN content.
- A long press is latched until a fresh press begins. Releasing the original touch cannot also open the photo or record a view. Preview, consumed-photo and upload guards remain enforced.
- The protected-card handler forwards its square dimensions and touch-derived window coordinates. Both chat implementations carry this metadata to the focus menu; the Android fallback does not wait for another measurement when valid coordinates are supplied.
- `InstagramMessageOverlay.js` uses the square protected-card geometry instead of the natural photo's aspect ratio. It skips the separate clipboard decode for protected photos. The focused copy remains `previewOnly`; protected-image copy/save restrictions remain intact.

Gesture behavior was checked against [React Native Pressable](https://reactnative.dev/docs/pressable) and the installed NativePressable adapter. Server view tracking, encryption, screenshot protection and once-only consumption rules are preserved.

## Verification

- **14 focus/media tests passed**, including sender/recipient × once/replay long presses with zero viewer/view-record calls, a subsequent fresh tap, forwarding geometry on both platforms, readonly protected focus, existing consumed-photo denial and clipboard-decode omission.
- **84 combined client regression tests passed**: `../artifacts/inbox-ui-20261022/protected-photo-regressions.log`.
- All four affected source modules pass Expo Babel transformation under both iOS and Android callers (8 transforms). Whitespace checks pass.
- **User-confirmed iPhone retest after Reload from Metro:** both once-only and replay sent-photo menus work. The tested question covered opening/dismissing the menu without freezing or opening the photo itself. This is user-reported device verification, not an agent-recorded native video.

No native rebuild, OTA publication, backend change or deployment was performed. Device coverage beyond the user's iPhone retest and the existing automated policy checks is not claimed.
