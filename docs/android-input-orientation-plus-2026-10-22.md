# Android typing, portrait lock and granted Plus access — 2026-10-22

## Findings and fixes

### Disappearing draft

`ChatRoomScreen.js` reset the composer in an effect depending on `[chat?.id, scrollToLatest]`. `scrollToLatest` changed identity whenever `isListAnchored` changed. The room-reset effect itself set anchoring false, then true after its 80ms safety timer. This re-triggered the reset and cleared typed characters without changing rooms.

The scroll callback now has a stable identity and reads the current anchoring value from a ref. A new room still resets its own draft; settling layout or re-rendering the current room does not. Input composition, Thai text, existing send/retry behavior and iOS's separately implemented composer are preserved.

### Unexpected rotation

`screenOrientation.js` passed literal `1` to the native orientation lock, incorrectly labeling it PORTRAIT_UP. In the installed SDK that value is ALL; PORTRAIT_UP is 3. The helper now resolves the public `OrientationLock.PORTRAIT_UP` enum after checking native-module availability. Root startup and foreground reapply the preference. The existing portrait app configuration and Android manifest are retained; missing native modules fail without crashing and iPad remains exempt.

Reference: [Expo SDK 58 ScreenOrientation](https://docs.expo.dev/versions/v58.0.0/sdk/screen-orientation/) and installed `ScreenOrientation.types.ts`.

### Granted Plus incorrectly offered store management

The user confirmed their Plus access comes from an admin/test grant. A customer or expired subscription can retain a management URL even though that URL does not represent the source of current Plus access.

`membershipManagement.js` exposes management only for an active verified Plus record with a recognized purchase store and matching HTTPS store URL. MembershipContext uses that result instead of forwarding any stored URL. MembershipScreen's primary action for admin access is “เริ่มใช้งาน Plus”. If an admin separately holds a real active store subscription, an additional action keeps management of that purchased subscription reachable. Feature entitlements and backend authorization are unchanged.

## Verification

- **81 tests passed** across chat state/focus/media/cache, inbox, profile music and membership paywall. Log: `../artifacts/inbox-ui-20261022/android-input-plus-orientation-tests.log`.
- New regression coverage executes the actual scroll callback and room-reset effect across initial anchoring, typing, repeated renders and a room switch; it verifies text survives in the same room. Orientation tests use the installed enum, handle missing native modules and foreground restoration. Membership tests cover admin grants, expired/promotional/unknown stores, supported stores and independent purchased subscriptions.
- Six affected modules pass Expo Babel transformation with the Android caller; five shared modules also pass with the iOS caller. Changed tracked files pass whitespace checks.
- `agent-device` is installed, but opening `com.campusmate.app` returned DEVICE_NOT_FOUND; no device was available for agent-controlled native inspection.
- **User-confirmed Android retest after Reload from Metro:** all three checks work: Thai draft remains, tilting the phone keeps portrait, and granted Plus shows “เริ่มใช้งาน Plus” without opening Play Store. This is reported by the user, not an agent-recorded native screenshot.

## Release limits

No native build, store submission, OTA or backend deployment was performed. The separate native-config check does not pass: `scripts/check-android-config.mjs` reports `Missing native config field: runtimeVersion`. That release/configuration issue was observed during validation; this patch does not change native version/update configuration. Full native accessibility, large-screen orientation behavior and purchase/cancellation transactions were not exercised.
