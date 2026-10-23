# Chat preview, notifications, inbox and compact profile controls

Latest follow-up: [responsive compact chat media and preview](chat-responsive-media-2026-10-22.md). Its horizontal song layout and presence behavior supersede the earlier media presentation described below.

## Audit

- LiquidGlassView wraps children in a column by default. Notifications applied row styles to the outer glass surface, leaving tabs stacked inside. Set contentStyle explicitly and keep a 44px horizontal segmented control.
- ChatPreviewModal had a transparent glass sheet with no header or quick actions. Give the actual message panel a solid platform surface, 90% window width, bounded 65% window height, header, and 24px list top padding. Keep the opaque content card separate from the glass action layer.
- Conversation rows mixed message snippets, timestamps, and read states in one subtitle; rooms with multiple unread messages replaced the snippet with a count. Separate snippet, time, and unread badge.
- The requested profile sizes override the previous 48px visual controls: song controls become 36px and activity chips 38px. Retain hit slop and accessibility labels. Fixed-height chips can truncate large text; do not disable OS text scaling.
- Pin and manual unread are per-member preferences. Extend the existing settings contract; never change another participant's settings/read receipts. Reading the room clears the manual unread reminder, not the pin.
- Notification records intentionally contain no plaintext chat preview. Show an exact message already decrypted in the authorized client when available; preserve the generic fallback otherwise.

## Platform references

Apply the existing iOS continuous corners/Liquid Glass functional layer and Android tonal surfaces, using the installed Expo SDK 58 APIs. See the previous [profile/chat audit](profile-chat-media-ui-2026-10-22.md) and the platform skills' Apple HIG/Google references. No SDK upgrades or UI kit additions.

## Verification

### Final implementation

- Notifications reuse `LiquidGlassSegmentedControl` with a scoped `compact` variant. Android keeps two equal, non-wrapping 36px children in a 44px track; iOS uses the existing native SwiftUI segmented picker with a 44px host. Other screens retain their existing control sizes.
- The preview panel has an opaque content surface, continuous 24px corners, border/shadow, header, 24px list top padding and a separate action surface. Its height is at most 65% of the window and reserves the measured action-menu height so large text stays within the window. Previewing does not mark the room read. Quick actions close the modal before invoking their handler; deletion retains the existing confirmation flow.
- Messages keep the latest authorized/decrypted snippet on line two, time on the top right and unread count/dot on the bottom right. A manual reminder shows a dot rather than inventing a message count. Pins sort first. Group rows also separate time and unread state.
- Notification message text comes only from an exact message already decrypted in the client's authorized conversation cache. Missing messages, inaccessible rooms and group notifications retain their existing safe fallback. New encrypted messages never reuse an older cached snippet.
- Song controls have equal 36×36px frames with an 8px gap, neutral circular removal background, and hit slop. Activity chips have intrinsic widths, fixed 38px height, 14px horizontal padding, 19px corners, one-line labels and distinct checked selection.

### PASS

- Client regression suite: 44 checks passed before the last added preview-action test; that updated focus suite passes all 5 checks. Combined final suite is recorded in `../artifacts/inbox-ui-20261022/client-tests-combined.log`.
- Firestore emulator: **44 allow/deny checks passed**, including own inbox preferences, rejection of peer preference changes/non-booleans and atomic own read/reminder clearing. Log: `../artifacts/inbox-ui-20261022/rules-tests-final.log`. Java's Thai resource-bundle failure in the old cached emulator was resolved by using English JVM locale; this changed no application locale.
- PostgreSQL integration: `inbox_preferences_are_per_member_and_do_not_change_receipts` passed against disposable PostgreSQL in Cloud Build `daf6b95d-403f-470a-adb5-9972a1a610d5`. Checks include persistence, member isolation, unchanged peer counts/receipts, authorized list output, clear-on-read and input validation. Log: `../artifacts/inbox-ui-20261022/backend-validation-retry.log`.
- Edited UI sources pass Babel compilation. Rust files were formatted using rustfmt in Cloud Build `e51eda6e-f31d-4a69-bf1f-c010763666a4`; the formatted sources were synced back after checking for substantive changes.
- Browser fixtures use actual RN components with sample data, mocked native APIs/icons and simulated font scaling. Confirmed all 15 chips measure **38px**, both song controls **36×36px**, equal notification tab widths, preview width **324px for a 360px window**, and preview/actions staying within a 320px window at 2× text after the height fix.

### Remaining limits and release status

Update 2026-10-23: the release limitations below describe the earlier audit. The running Fly API now supports inbox preferences, migrations/readiness passed, and the client cache-signature fix has been added. See [the current validation and live-runtime evidence](chat-inbox-preferences-release-2026-10-23.md). Physical cross-device testing is still pending confirmation.

- Strict backend Clippy is **not clean**: five pre-existing dead-code diagnostics in `src/score.rs` (`slot_matches_periods`, `FULL_OVERLAP_MINUTES`, `overlap_minutes`, `text_periods`, `availability_fit`). The new PostgreSQL test passed before that stage. The combined Cloud Build therefore reports FAILURE; it must not be described as a completely passing backend pipeline.
- Migration `0013_chat_inbox_preferences.sql`, the updated Rust API and legacy Firestore rules are prepared locally. **They have not been applied/deployed to the live backend.** The running Fly image remains `face-gestures-probe-20261021`. Pin/manual-unread actions require the backend/rules update to work across devices. Client actions await server confirmation and show an error instead of displaying an unsaved preference on an older server.
- Physical iOS/Android rendering, native Liquid Glass/SwiftUI sizing, VoiceOver/TalkBack, presence service availability and real cross-device actions are **not tested**. Browser iOS-labelled fixtures demonstrate the shared RN geometry, not the native SwiftUI picker or glass rendering. Online status displays only a known presence value; otherwise it is omitted.
- Fixed-height chips preserve the user's requested 38px geometry. OS text scaling remains enabled; very large text may truncate labels. Full labels remain available to accessibility services.

### Visual evidence

- [Chat preview](../artifacts/inbox-ui-20261022/chat-preview-ios.png)
- [Preview with 2× text](../artifacts/inbox-ui-20261022/preview-ios-font2.png)
- [Notifications dark](../artifacts/inbox-ui-20261022/notifications-android.png)
- [Notifications light](../artifacts/inbox-ui-20261022/notifications-ios-light.png)
- [Messages on a 320px window](../artifacts/inbox-ui-20261022/messages-android-320.png)
- [Compact profile controls](../artifacts/inbox-ui-20261022/profile-compact-android.png)
