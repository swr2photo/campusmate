# Gesture verification continuation — 2026-10-21

## Gaps found before editing

| Gap | Change |
| --- | --- |
| Fallback camera waits 1.6–2.2 seconds and asks people to hold every pose | Serial probe captures; no countdown, movement is submitted as soon as detected on native |
| Server distance hints are discarded | Show near/far guidance from native detection and the server |
| Delayed retries and completions survive leaving the camera | Disposable runner, pause in background, cancel pending gesture handoff on dismissal |
| Camera capture cache files remain on device | Delete the temporary camera/manipulator files after extracting the frame |
| Fixed layout crowds short screens; close target is 40 | Scrollable content, adaptive camera size, 48-point close target |

## Boundaries

The Rust probe implementation already exists in this checkout. It keeps identity mismatch and multiple-face retry penalties; an unobserved movement in probe mode does not consume retries. Server acknowledgement remains required for every step. These gestures do not issue a verification badge; official AWS liveness and the backend decision still follow.

Native movement detection uses one qualifying update for turns, nods and blinks; looking straight uses two updates (about 80 ms apart). Builds without the native tracker use serial server probes: detection latency includes capture and network time, and a blink between sampled frames may need repeating. No promise of offline or instantaneous server verification.

## UI sources and implementation

- [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility): scalable text and reduced motion. Existing custom camera overlay remains a product choice, not an Apple Face ID implementation.
- [Android accessibility](https://developer.android.com/design/ui/mobile/guides/foundations/accessibility): 48 dp touch targets, labels and non-color state cues.
- [Expo SDK 58 Camera](https://docs.expo.dev/versions/v58.0.0/sdk/camera/): wait for camera readiness; captures use the app cache. Installed file-system legacy `deleteAsync` removes only returned temporary capture files.

## Implementation and validation

`FaceGestureStage.js` now uses a disposable serial runner (`faceGestureRunner.mjs`). Native qualifying events trigger capture immediately. The fallback samples only after camera readiness, sends `probe: true`, and keeps the current instruction visible during the request. A server acknowledgement is required to advance exactly one step. Pausing stops new captures; an acknowledgement received in the background is retained but cannot launch AWS until the app returns. Leaving the sheet cancels its pending gesture handoff and ignores late responses.

Both native camera modules now attach a `frameId` to an analysed frame and offer `captureFrame(frameId)`. This returns the detected frame, rather than waiting for the next one after the person has already relaxed. Up to four copied frames are held in memory; capture rejects frames older than 500 ms and camera shutdown clears the buffer. iOS copies the image instead of retaining camera-pool buffers; Android copies before closing `ImageProxy` and only JPEG-encodes the requested frame. Older binaries without `frameId` keep their existing capture method.

| Check | Result |
| --- | --- |
| `node --test scripts/test-face-gesture-detector.mjs scripts/test-face-gesture-runner.mjs scripts/test-photo-verification-client.mjs` | PASS, 36 tests; includes exact-frame forwarding, first-update movement, server distance hints, probe payloads, opposite turns, cancellation, background pause, late replies, finite retries, invalid step rejection and AWS/badge boundary |
| Babel transform of both screens and native JS wrapper | PASS |
| Expo Android and iOS JS export (`--no-bytecode`, debugging validation only) | PASS; artifacts under `artifacts/face-gesture-20261021/export` |
| `android/gradlew.bat :face-gesture-camera:compileDebugKotlin --console=plain` | PASS; module compilation, not an APK/runtime test |
| Browser fixture using the actual screen and mocked camera/permissions/icons | PASS for 360×640 normal text and 320×568 at 200% text, near/far guidance, header wrapping and scrolling to all five steps; screenshot in `artifacts/face-gesture-20261021/ui-distance-far.png` |
| Physical Android device | NOT RUN; `adb devices -l` reports no device |
| Swift compilation / physical iOS / VoiceOver / TalkBack | NOT RUN; requires Mac and devices |
| New backend deploy or real biometric request in this continuation | Not performed; existing Rust probe implementation preserved |

Reload Metro to use the screen/probe changes. Exact detected-frame capture requires a new native build; Metro cannot add the new Swift/Kotlin method to an installed binary. Expo Go samples through the server and may miss a brief blink between frames; the screen tells the person to blink slowly again. Device QA must verify both distance hints, one natural turn/nod/blink, cancellation during a request, and background/resume before calling the real-camera flow verified.
