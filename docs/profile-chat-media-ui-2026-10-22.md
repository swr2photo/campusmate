# Profile and chat media UI — 2026-10-22

## Audit and scope

- Profile activities force every chip wrapper to 50% width, and the shared chip does not enforce a single-line label. Replace only this editor's activity control, preserving other chip uses.
- Spotify add is a solid primary button, competing with Save. Song removal is a small red icon. Use a secondary tonal action and separate 48-point play/remove targets.
- The editor already has a scroll-edge gradient. Add indicator insets and retain content padding so its cards soften at the viewport edge.
- TrackShareCard clips its entire scene and places the footer absolutely in a fixed square. Keep clipping on the background/artwork only, reserve stage padding, and let the text determine card height at large font sizes.
- The focus overlay has no track renderer, so the original song card remains under the backdrop while other message types are redrawn above it. Reuse the actual track card in focus, and anchor the backdrop to the modal root independently of the animated message/action layer.
- Protected images lack a subtitle and lock badge surface. Preserve existing open-once, screenshot protection, and media authorization paths.
- The floating blue gear comes from Expo's development host. The root already hides it on startup; reapply when returning to the foreground without disabling the standard development menu.

## Platform rules

iOS: continuous corners and existing native controls; Liquid Glass remains on functional chrome with existing opaque fallbacks. Android: tonal surfaces, distinct filter-chip selection, rounded corners, and 48dp controls. No package, backend, or SDK changes.

References: [Apple materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Material filter chips](https://developer.android.com/develop/ui/compose/components/chip), [Expo SDK 58 BlurView](https://docs.expo.dev/versions/v58.0.0/sdk/blur-view/).

## Validation

- PASS: 47 existing focused checks (`test-discovery-profile-music`, `test-chat-discovery-followup`, `test-profile-photo-editor`, `test-liquid-glass`). Log: `../artifacts/profile-chat-ui-20261022/focused-tests.log`.
- PASS: 4 focused render/handler regressions in `scripts/test-chat-media-focus.mjs`: song copied above the full modal backdrop, no duplicate caption, tonal fallback, protected-image focus preview, and consumed once-only image cannot reopen. Log: `../artifacts/profile-chat-ui-20261022/focus-tests.log`.
- PASS: `node scripts/test-chat-video.mjs` checks video policy, encryption, fail-closed uploads, concurrent loading, HTTP retry, missing/wrong keys, and JSX parsing. Log: `../artifacts/profile-chat-ui-20261022/protected-media-tests.log`.
- PASS: Babel transforms of edited components and both iOS/Android JavaScript exports (no native binary build). Final export log: `../artifacts/profile-chat-ui-20261022/export-final.log`.
- PASS, browser layout fixture only: 360px dark Android and iOS media layout; 320px light iOS with 2× text; Android media with 2× text. Standard chips measure 48px high; enlarged chips all measure 66px, with intrinsic widths and no horizontal page overflow. The media card grows from 220px to 243px high at 2× text instead of clipping its footer.
- Browser fixture uses actual components, sample artwork, mocked icons/native APIs, and simulated text scaling. It verifies geometry, not native SwiftUI, blur, font rendering, or device accessibility. Screenshots: [profile Android](../artifacts/profile-chat-ui-20261022/profile-android-layout.png), [profile iOS large text](../artifacts/profile-chat-ui-20261022/profile-ios-font2-layout.png), [media iOS](../artifacts/profile-chat-ui-20261022/media-ios-layout.png), [media Android large text](../artifacts/profile-chat-ui-20261022/media-android-font2-layout.png).

### Broader suite findings

The initial 65-check run including `test-interaction-regressions.mjs` passed 59 and failed 6. Failures concern rewind fixture globals (`sharedProfiles`, `rewindPending`, `rewindEntering`), a removed discovery source snippet, and profile-photo error/approval fixtures (`isCommittedProfilePhoto` and an error-message expectation). This task did not edit those handlers. They remain unresolved; the focused run above excludes that file. Full log: `../artifacts/profile-chat-ui-tests-20261022.log`.

### Device follow-up

NOT TESTED: physical iOS/Android, VoiceOver/TalkBack, native Reduce Transparency, system-bar coverage during focus, and foreground transitions in Expo Go/development client. Android uses a full-window tonal scrim; iOS 26+ uses native blur where available and permitted by Reduce Transparency. This does not introduce an Android cross-window blur target.

The gear is the development host's floating tools button. `ExpoDevMenu.setToolsButtonVisible(false)` is verified in the installed SDK 58 source and reapplied at startup/foreground. Hosts without that native method need an updated host build; JavaScript cannot remove an unsupported host control. No new dependencies were added.
