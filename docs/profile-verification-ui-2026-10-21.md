# Profile and verification UI remediation

User request: pasted ten-screen UX analysis, 2026-10-21. Screenshots themselves were not attached; findings are checked against current source and a layout fixture.

| Screen | Verified source issue | Implementation target |
| --- | --- | --- |
| Verification consent | Consent inside body; disabled action unexplained; version code visible | Sticky consent + action, native terms sheet, retained explicit consent |
| Loading/result | Two spinners; cancel guarded while running; technical copy | Single loading state, cancellation throughout the async flow, friendly messages and alternative route |
| Gesture camera | Five extra chips, footer summary and spinner crowd instruction | Ring + current instruction/distance hint, server-confirmed success haptic |
| Profile editor | Raw RN image URL; missing addTrackButtonText style; footer double surface | Shared image pipeline with loading/retry, solid blue/white Spotify action, single functional footer |
| Preview | Hero activity text duplicates activity chips; small edit action | Single activity-chip representation, readable 48-point edit action |
| Profile hub | Six compressed photo cells, crowded actions, bottom padding lacks tab height | Horizontal photo cards, balanced wrapping actions, tab-aware bottom inset |
| Global tools | No custom floating gear found in app source | Use supported Expo DevMenu tools-button visibility API when the optional module is available |

Platform authority: [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Apple materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Android accessibility](https://developer.android.com/design/ui/mobile/guides/foundations/accessibility), [Expo UI universal](https://docs.expo.dev/versions/v58.0.0/sdk/ui/universal/), [Expo DevMenu](https://docs.expo.dev/versions/v58.0.0/sdk/dev-menu/). Glass is confined to functional chrome with opaque fallback; Android retains tonal surfaces. No backend decision, badge, consent version or retention policy changes.

## Final behavior

- Consent remains unchecked by default. Its checkbox, details link and start action are outside the body scroller. The version identifier is still sent by the protocol, but is not shown as user-facing copy. The no-flash warning has a single tonal surface and a native Expo UI switch. Terms use the platform-native Expo UI bottom sheet; closing it does not grant consent.
- The running screen has one spinner and an always-available close action. Closing aborts the current HTTP request, rejects the pending gesture handoff, and prevents a late create/gesture/result response from opening a later screen or mirroring a badge. The native AWS screen retains its own cancel control. No new backend cancellation endpoint is introduced; abandoned sessions expire server-side.
- Error messages use the safe message map. Retry and the existing alternative-review flow remain available. Only a safe reason code is logged in development; no images, scores, provider responses or credentials are logged.
- The gesture camera shows the current command and a short framing hint. Five chips, the redundant summary and the small spinner are removed. Progress has accessibility semantics; successful server acknowledgements request Android's native Confirm feedback or iOS notification feedback. Large font sizes reduce the camera diameter rather than shrinking text. Older binaries without haptics retain visual/spoken feedback. [Expo documents that iOS may suppress haptics while the camera is active or in Low Power Mode](https://docs.expo.dev/versions/v58.0.0/sdk/haptics/); vibration is best effort and is not the only success signal.
- The profile editor and hub use `ProfilePhotoThumbnail` with the existing URL/version pipeline and `CachedImage`. Loading/error/retry states replace an unexplained grey tile. This is not evidence that a specific authenticated photo has downloaded on a physical device.
- The photo heading shows title/count together and puts guidance and the gallery link on separate rows. Spotify action text/icons are white on blue, with wrapping text. Saving uses one functional footer surface; the nested grey frame is removed.
- The preview's edit action is readable and at least 48 points high. Preview activity labels are shown as chips instead of a duplicate hero text row. Hub actions share balanced width and can wrap; photo cards scroll horizontally. iOS uses automatic scroll insets for the native tab bar and avoids repeating the top safe-area inset; Android keeps the existing tab layout and bottom spacing.
- Floating debug tools are hidden through the optional host `ExpoDevMenu.setToolsButtonVisible` method. A direct `expo-dev-menu` dependency was tried and then removed after Doctor flagged it; the final implementation uses `requireOptionalNativeModule` from `expo` and tolerates older hosts. The regular profile settings button and standard developer gestures are preserved.

## Validation

| Check | Evidence / result |
| --- | --- |
| Client, identity transport, gesture runner/detector, photo editing, image cache and profile music regressions | PASS: 93 tests; `artifacts/face-gesture-20261021/ui-regression.log` |
| Cancellation coverage | Aborted before/during create, after gestures, after streaming, while fetching auth token, during fetch and during result checking; late responses do not reach a later camera/mirror |
| Babel transform of eight affected app/screens/components | PASS |
| Android and iOS JavaScript export, `--no-bytecode --max-workers 2` | PASS: `artifacts/face-gesture-20261021/ui-export-final.log`; exported files in `ui-export/`. This is a JS build check, not an APK or Swift build |
| Browser layout fixture using actual screen components with mocked data/camera/native controls | Consent unchecked with start disabled and visible; single loading spinner with close; friendly error with retry/alternative; simplified camera; 320×568 at 200% text keeps camera instructions visible and consent body scrollable; hub photo row rendered as horizontal cards |
| Screenshots | `artifacts/face-gesture-20261021/ui-consent-footer.png`, `ui-camera-large-text.png`; test fixture only, no personal face data |
| `expo install --check` | Reports 15 existing SDK patch-version mismatches. No blanket SDK upgrade performed |
| Expo Doctor | Initial run: 16/19 checks passed. Existing issues: static/dynamic config detection, direct `expo-modules-core` dependency and SDK patch drift. Its added warning about direct `expo-dev-menu` was addressed by removing that dependency; the full check was not rerun after removal |
| Physical device, VoiceOver/TalkBack, native sheet/keyboard/insets, haptic, actual authenticated image download | NOT RUN; requires device QA. No cloud deployment, store build, biometric request or policy change in this task |

Reload Metro for the UI changes. `expo-haptics` is the only new final dependency; Expo Go includes it, while a custom binary without it needs rebuilding for haptics. Visual/spoken feedback still works when that native module is absent. Check the consent sheet, no-flash control, close during preparation, photo load/retry, Spotify action and final content above the tab bar on real iOS/Android before release.
