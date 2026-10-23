# Inbox read status — 2026-10-22

## Problem and change

The main inbox row rendered the latest message and its sent time but did not render the peer's read status. The conversation render signature also omitted read receipts, so receipt-only updates could be discarded as unchanged.

- `src/screens/ChatScreen.js` now renders a separate one-line read status below the latest-message snippet. Existing sent time, unread count, navigation and swipe actions are preserved. The row's existing 30-second refresh updates relative time, and accessibility text includes the status.
- `src/utils/inboxPresentation.js` derives read status from the other participant's actual receipt covering the latest outgoing message. It supports moments, minutes, hours, days, months and years. Months use 30 days and years use 365 days.
- `src/services/firestoreService.js` includes normalized read receipts and relevant delivery state in conversation deduplication, allowing receipt-only changes to reach the inbox.
- Removed unused legacy formatters that could infer reading from zero unread messages or `updatedAt`.

Examples: `อ่านแล้วเมื่อสักครู่`, `อ่านแล้วเมื่อ 5 นาทีที่แล้ว`, `อ่านแล้วเมื่อ 2 ชั่วโมงที่แล้ว`, `อ่านแล้วเมื่อ 3 วันที่แล้ว`, `อ่านแล้วเมื่อ 2 เดือนที่แล้ว`, `อ่านแล้วเมื่อ 1 ปีที่แล้ว`.

The label is shown only for direct conversations whose latest outgoing message is covered by a valid peer receipt. Incoming latest messages, missing or older receipts, pending/failed sends, deleted messages and groups do not receive a misleading read label. Read time is the receipt supplied by the server; it is not inferred from conversation activity.

## Validation

- Combined regression suite: **89 passed, 0 failed**. Log: `artifacts/inbox-ui-20261022/inbox-read-status-tests.log`.
- Inbox-specific tests: **12 passed**, including relative-time boundaries, actual server timestamp formats, absent/stale/self receipts, delivery failures, receipt-only deduplication, and rendering the real inbox row with both snippet and read status.
- Expo Babel transforms passed for iOS and Android for all three changed application modules (6 transforms).
- Scoped `git diff --check` passed.
- After Metro reload, the user confirmed the read status appears in the main chat list: **“ขึ้นแล้ว”**. This is user-reported device validation; no automated native capture was taken.

The backend already supplies read receipts and publishes conversation updates to both participants. This change requires no backend migration or deployment. No release build or OTA publication was performed for this task.
