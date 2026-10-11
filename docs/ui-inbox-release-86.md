# CampusMate UI and notification inbox — build 86

Release artifacts built on 9 October 2026 use versionName `3.1.2` and versionCode `86`.

## Changes

- Refine the shared white/charcoal theme, Thai typography, responsive forms and iOS layouts. Home uses the notification bell; party discovery lives under Activities.
- Keep a private notification history for 90 days with pagination, read state across sessions/devices, and a durable offline queue for read receipts. A face-verification reminder has one server-owned record per account.
- Store generic encrypted-chat notification text and destination IDs without copying decrypted chat content. Opening a notification does not mark the chat itself as read.
- Deny direct client reads of other users' `profiles` and all `discoveryProfiles`. Owner profile edits remain available, and verification metadata remains server-owned. Current clients use authenticated visibility APIs.
- Add `getConversationEncryptionProfiles`: existing room members receive only public device keys and IDs, even if a member is not face verified. Outsiders and suspended callers are denied. Refresh keys without hydrating public profile metadata.
- Preserve cached conversation lists until an authoritative server result arrives; handle cached-empty to server-empty metadata updates.

## Validation and deployment

- Functions: 213 tests passed. Client inbox: 45 tests passed. UI interaction flows: 13 tests passed.
- Firestore emulator: profile/projection read isolation, immutable verification fields, notification ownership/read state, gallery editing, and existing unverified chat participant access passed.
- Actual conversation encryption resolver and encrypted media regression tests passed, including retired device refresh, HTTP retry, and missing/wrong keys.
- Layout fixtures passed 60 cases for inbox, bell, party banner and empty states at widths 320/360/393/430/768, font scales 1/1.3/2, and light/dark themes. This does not cover every screen or native rendering.
- Rules/indexes and 14 related functions were deployed. Post-deploy checks confirmed the live rules match the source and all 14 functions are ACTIVE. Unauthenticated callable requests returned HTTP 401.
- Signed Android AAB/APK builds succeeded. Manifest checks confirmed `com.campusmate.app`, `3.1.2`, `86`. Packaged mascot PNGs retain alpha.
- Android source map: 235 shipping source files match. iOS Hermes export: 225 shipping source files match. The 273-file source/config snapshot was unchanged during the final build.

## Artifact hashes

Build binaries and private deployment logs are kept outside Git.

| Artifact | SHA-256 |
| --- | --- |
| CampusMate-3.1.2-86-ui-inbox.aab | `D2A5369CEF6BBB7AEB0FCD99B05247047A3082F8C911FE3B30F0FCBB8E7DB105` |
| CampusMate-3.1.2-86-ui-inbox.apk | `BBE276BD10C77B682435C33AC21CA8D86B45E39B25AE430B56564A993D7E1B5D` |

## Remaining acceptance work

No physical Android device was connected for the final build. Every screen/form/modal still needs native checks across the planned widths, enlarged text, keyboard and dark mode. iOS validation is a JavaScript/Hermes export, not an Xcode/native build. Real face capture, purchases, push delivery and cross-device offline/account-switch flows remain device QA work.

Older clients that read profile projections directly must update to an API-based version. Previously downloaded data cannot be recalled from old client caches. The staged `firestore.secure.rules` was not deployed wholesale and legacy decision writes were not changed.

No Play Store upload or publication was performed.
