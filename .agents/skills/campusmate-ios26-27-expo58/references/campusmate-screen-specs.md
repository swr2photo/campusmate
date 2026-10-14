# Campusmate Screen Specs

> **Apple HIG authority (mandatory):** Read [`apple-hig-ios26-27-source-of-truth.md`](apple-hig-ios26-27-source-of-truth.md) and cite Apple HIG source IDs when deciding iOS appearance, navigation, accessibility, motion or privacy. Prefer native behavior over visual imitation; iOS 27 behavior must be checked against current Apple and Expo docs.

> Reference for the `campusmate-ios26-27-expo58` skill. Read when the task touches these areas. Always verify Expo 58 APIs against current docs and installed types.

## 6. Screen-level design specification

### 6.1 Welcome / onboarding

**Goal:** show product value and boundaries quickly; make account creation easy without manipulative prompts.

- Hero: simple authentic imagery or illustrations already licensed/owned; three short benefits max.
- Primary CTA: Continue / Sign in; respect Sign in with Apple and other providers if currently implemented.
- Ask only necessary permissions at the moment of need (notifications/location/photos), with clear rationale.
- Separate legal consent from marketing consent; provide privacy/terms links.
- Profile completion progress visible and resumable; do not ask for precise location unless essential and consented.
- Keyboard, password managers, automatic content type, loading and auth errors work.

### 6.2 Discover / find friends — highest visual priority

**Hierarchy:** context heading → filters/search → one featured candidate or readable list → clear Like/Pass/View Profile.

- Photo-first candidate card with consistent aspect ratio; render R2 image via `expo-image`, not through API base64.
- Name, approximate commonalities, relevant interests. Never reveal unconsented exact location or sensitive attributes.
- Contextual profile details in opaque readable panels; floating toolbar may use native glass if appropriate.
- Like/Pass buttons at least 44 pt, with accessible labels and haptics; provide button equivalents to swipe gestures.
- Prevent double-submission. Optimistic reaction only if rollback/error recovery is implemented.
- Empty states: no candidates, all seen, filters too restrictive, offline.
- Preload only next 1–2 **authorized public** profile image variants; avoid large unbounded prefetch.

### 6.3 Likes / matches

- Distinguish inbound Likes (if product supports showing them), mutual Matches and pending state.
- Match card includes avatar, shared interests, recency and entry to conversation.
- A matched state never means chat permission remains valid after Unmatch or Block.
- Realtime match notification opens exact safe route, with expiry/authorization recheck.
- Empty state encourages healthy profile completion, not fake urgency.

### 6.4 Chat list

- Sort by latest message or actual product behavior; show unread count, time, last text preview and avatar.
- Read states must be from actual server acknowledgements, not assumed after UI renders.
- Long content truncates gracefully; larger text reflows.
- Lazy pagination and image recycling; avoid loading all conversations/messages at once.
- Safe options: mute (if supported), unmatch, block, report.

### 6.5 One-to-one chat — highest engineering priority

- Message layout: sender grouping, timestamps, image previews, delivered/read/failed states.
- Composer: reliable keyboard avoidance, multiline expansion, attachment picker, send enable/disabled states, VoiceOver labels.
- Optimistic message appears as **sending**; server ACK changes to **sent**; failures have manual Retry.
- Deduplicate on `client_message_id`; reconnect recovers missed messages using server cursor/sequence.
- Dynamic height and keyboard behavior on iPhone sizes and iOS 27 resizable views.
- Virtualize long history; preserve scroll position on loading older messages; do not jump on keyboard opening.
- Typing indicator is ephemeral and rate-limited. Presence is approximate, not a guarantee of real-world activity.
- Image attachments open secure viewer; private content must honor cache/access rules.
- Blocked/unmatched conversation disables composer appropriately and explains status without leaking private data.
- No client-only promises of end-to-end encryption unless actually implemented and security reviewed.

### 6.6 Profile and edit profile

- Header: representative photo, name, bio, interests; real content hierarchy.
- Editing flow: live character count if constrained, validation, save/cancel, error and retry.
- Image upload: local preview → permission/validation → obtain upload URL from Rust → upload to R2 → verify/complete via API → update state; display pending and failed processing.
- Do not claim upload success based only on receiving a presigned URL.
- Respect image crop, EXIF policy and image transformation pipeline. Do not embed R2 access keys.
- Privacy: profile visibility, who can message, discoverability, clear report/block options.

### 6.7 Settings / privacy / safety

- Use platform-native grouped settings with readable section headers and destructive action styles.
- Notification settings, Blocked Users, Account Privacy, Contact Support, Export/Delete Account (when supported).
- Support confirmations for blocking, account deletion and reporting; do not use an endless forced confirmation chain.
- Security-sensitive states should use clear opaque surfaces; minimize glass ornament.

---
