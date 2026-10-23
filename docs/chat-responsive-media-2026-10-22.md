# Responsive chat media and long-press preview — 2026-10-22

This follow-up replaces the earlier large vertical song presentation with the requested compact horizontal card. Earlier inbox, notification and profile changes are described in [the inbox audit](chat-inbox-ui-2026-10-22.md).

## Implementation

- Shared `chatMediaLayout.js` calculates media dimensions from current window width. Photos/GIFs use at most 55% of the window, capped at 180px below 360px window width and 220px otherwise; natural aspect ratios are preserved under a 260px height limit. Protected photos always have explicit square width and height, independent of image loading. Preview images/GIFs are 140×140.
- `ChatProtectedImageBubble` has a finite non-shrinking surface, clipped continuous corners, neutral lock badge and explanatory subtitle. iOS embeds it in a measured `RNHostView`. Previewing remains non-opening: it neither consumes a once-only photo nor records a view. Existing encryption, screenshot protection and consumed-state checks remain in place.
- `TrackShareCard` is horizontal, width `min(windowWidth * .65, 250)`, height 84px, 20px corners, 10px padding, 64px artwork with a small vinyl edge, single-line metadata and a 36px play control. Existing audio status and Reduce Motion handling remain. It is shared by Android, iOS's measured RN host, preview and message focus overlay.
- GIF placeholders are filtered from caption/text rendering on both chat implementations. A small GIF badge is positioned directly on the image at bottom-left. Ordinary user captions remain.
- Single photos, image-link previews and stacked-photo decks recalculate their geometry for window changes. Full-screen viewers retain their existing sizing and behavior.
- The composer has a left `+`, flexible text field and right camera/microphone controls (send replaces these while typing). GIF/music are available inside the existing attachment sheet. Existing permissions and Spotify availability checks remain.
- Removed the additional iOS header blur mask, retaining the native header controls and glass composer. Message lists have 24px top clearance in addition to the measured iOS header height.
- The bounded preview retains its opaque platform card/header/actions, explicitly passes `isPreview`, bottom-aligns short history, scrolls to the latest item after content measurement and adds a 24px top fade. Unknown presence is omitted; known offline presence says “ออฟไลน์”. Outside tapping, accessibility escape and Android back dismiss the modal; the header X is removed.

## Verification

- **60 client tests passed**, including responsive dimensions across 320/360/375/390/430/768 windows, aspect ratios, media placeholders, finite protected-image geometry, non-opening once-only preview, GIF badge, focus layering, preview action ordering and inbox presentation. Log: `../artifacts/inbox-ui-20261022/responsive-media-tests.log`.
- **22 Babel transforms passed** using the installed Expo preset: all 11 affected source modules under both Android and iOS callers. Log: `../artifacts/inbox-ui-20261022/responsive-babel.log`.
- The standalone chat-video suite passed: encryption, fail-closed uploads, concurrent loading, retry and missing/wrong keys. Its expected failure-path logs are not failed assertions.
- Browser fixtures render the actual shared RN components with sample data and mocked native APIs/icons. Observed: 320px window gives 176px square photos; 430px window gives 220px photos, a 250×84px song and 36×36px play control. Preview is 324px wide in a 360px window and its GIF is 140×140. Four sample messages (text, song, GIF, text) fit the default preview. At 2× text on a 320px window, the action menu stays inside the window and history remains scrollable.

### Visual evidence (layout fixtures)

- [Small-screen media](../artifacts/inbox-ui-20261022/responsive-media-android-320.png)
- [Larger-screen media](../artifacts/inbox-ui-20261022/responsive-media-ios-430.png)
- [Four-message preview](../artifacts/inbox-ui-20261022/responsive-preview-ios-360.png)
- [Small-screen preview at 2× text](../artifacts/inbox-ui-20261022/responsive-preview-android-320-font2.png)

## Limits

- No physical iOS/Android device or native simulator run was available. Browser fixtures cannot validate SwiftUI measurement, Liquid Glass rendering, keyboard behavior, native scrolling/scroll-to-end timing, TalkBack/VoiceOver or real GIF animation. The fixture uses static sample artwork for GIF geometry and mocks icon glyphs.
- The complete Expo release export was not confirmed: attempts stalled after Metro startup and were stopped. Individual source transforms and the regression suite pass; this does not establish a passing full release build.
- No app-store build, EAS Update, backend migration, rule deployment or Fly deployment was performed for this UI follow-up. Earlier pin/manual-unread backend work remains prepared locally as recorded in the inbox audit.
