# Chat video

Select **วิดีโอ** in the chat attachment picker. The composer shows a thumbnail timeline with draggable start/end handles. Clips longer than 60 seconds can be trimmed to any range up to 60 seconds, and the speaker button removes audio from the exported file before upload. A low-resolution rendition is encrypted and sent first so the conversation is usable immediately.

The sender keeps the original source in private device storage and queues encrypted quality upgrades. When the app is active and the network is available it uploads medium (720p) and then high (1080p) renditions. The recipient prefers the best available rendition and falls back to the original low-resolution message while upgrades are pending. The server never receives an unencrypted source or media URL.

- `chat`: keep in chat; ordinary player controls and repeat viewing.
- `replay`: repeat viewing in a protected viewer.
- `once`: one opening per participant, including the sender. Closing, finishing playback, or leaving the app ends that opening. An online Firestore transaction must claim an immutable receipt before playback. A failed playback after claiming remains consumed.

Video bytes and media URLs use the existing conversation encryption. Video uploads fail if encryption is unavailable. Duration and mode are also stored as immutable message metadata for Firestore validation. Once-viewing receipts live under `conversations/{conversationId}/messages/{messageId}/videoViews/{viewerId}`. Replies omit video URLs and the forwarding menu omits videos.

Protected viewing acquires Expo screen-capture protection before creating the player modal, disables native fullscreen/PiP/frame analysis, closes on inactivity, and removes the decrypted cache on exit. Unsupported protection prevents opening. This is application-level viewing control; shared-key media is not DRM against modified clients. The duration limit uses picker metadata and is checked again at upload and message-write boundaries; the server validates duration metadata, not encrypted video contents.

## Release requirements

Build fresh Android and iOS binaries with `expo-video` and `expo-screen-capture`. An OTA JavaScript update alone cannot add these native modules. The updated `firestore.rules` were successfully deployed to `campusmate-7f1ab` / `(default)` on 2026-09-14 using `firebase deploy --only firestore:rules --project campusmate-7f1ab --non-interactive`. Firebase confirmed compilation and release. Rules SHA-256: `6ef6778e6f49edf5f1eb35acd52d8b333420e5680fb6d95a39f7cf84b1b0e931`.

## Verification

`node scripts/test-chat-video.mjs` checks boundaries, real message encryption, reply privacy, fail-closed upload failures, and JSX syntax.

With Firestore Emulator running, `node scripts/test-chat-video-rules.mjs` verifies valid/invalid messages, participant access, immutable receipts, and simultaneous claims using the actual service. `node scripts/firestore-rules-smoke.mjs` checks existing rule behavior. Both passed locally.

Android and iOS Metro/Hermes exports passed. Physical-device verification remains: send each mode between accounts; reject 60.001-second clips; try screenshot and screen recording during both protected modes; test background/app switcher and rapid closing; confirm receipt persistence after restart and across devices. Native playback, capture protection, and complete upload/download were not exercised on a device in this session.
