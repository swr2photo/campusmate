# CampusMate — Android Screen & Interaction Specifications

Read `android-google-material3-source-of-truth.md` before implementing any Android screen. Preserve backend API/R2/auth while improving platform UI.

## Interaction principles

- On Android use Material 3 Expressive visual semantics, native system Back, appropriate tonal surfaces and static/dynamic light/dark color. Do NOT port iOS Liquid Glass appearance mechanically.
- No auto-swipe-only actions, no hidden destructive actions. Ensure 48dp effective hit areas and TalkBack labels.
- Source-of-truth for profiles, matches, chats and permissions remains Rust/PostgreSQL; Android is a client, never a trust boundary.

## Per-screen blueprints

| Screen | Main Android pattern | States & accessibility | Responsive behavior |
|---|---|---|---|
| Welcome/Onboarding | Material headings/buttons, explicit permissions later | loading, network error, skip/save progress, TalkBack order | compact vertical; larger screens centered constrained reading column |
| Sign in | Native fields/buttons, autofill behavior | credential errors, keyboard/screen reader, account switching | readable single column, no unnecessary stretched fields |
| Discover | Profile card, Material filter chips, strong Like/Pass actions | empty, offline, loading, disabled, blocked, accessible swipe alternative | 1-col compact; profile preview/details at wider widths |
| Matches | Avatar grid/list, important status badges | match vs like vs pending; large labels | 2+ columns based on width, never arbitrary physical-device type |
| Chats list | Material list rows, unread semantics, action overflow | cached/offline/error; accurate preview and count | one-pane compact; list-detail on expanded |
| Chat detail | High contrast bubbles; standard top app bar; composer | pending/ack/read/retry, multiline/IME, private media, blocked/unmatched | full-page compact; detail pane on expanded |
| Profile | Tonal grouped sections, media upload status | photo fail/retry, editable fields, privacy | content max-width on large screens |
| Settings | Material toggles/settings groups, safe destructive actions | explicit privacy/notifications/delete/report; a11y focus | sensible settings reading width |

## Anti-patterns to reject

1. SF Symbols/Apple-specific glass on Android tab/navigation components.
2. Transparent chat bubbles over busy photos, unreadable type, 44dp Android targets instead of the Android 48dp recommendation.
3. Hardcoded status/nav/keyboard bar spacers or custom back handlers that override gestures.
4. Bottom tab navigation stretched on very wide layouts without considering rail/list-detail.
5. `isTablet` checks instead of viewport width, stale dimensions on fold/unfold.
6. Fake read/delivered states; lost conversation scroll when keyboard appears.
7. Public R2 URL for private photos or exposing presigned keys/logs.
8. Push requests before a user-meaningful context; using Expo Go to certify Android remote push.
9. Claiming "Material 3 Expressive" only because corners are rounded; it must show hierarchy, interaction feedback, appropriate surfaces, motion and accessibility.

## Deliverable format

For EACH changed Android screen report: route, source Google reference, Expo API, file, screenshot/test evidence (if available), 48dp touch check, TalkBack labels, dark/light contrast, font scaling, system back, keyboard, insets, R2 media safety, offline/error states, and validation status.
