# CampusMate native Face Liveness bridge

Source wraps AWS's official Android Compose / iOS SwiftUI components. It returns only stream completion or safe errors; Rust fetches results and decides. The module remains outside normal app autolinking until compatibility and device gates pass.

Pinned components: Android `com.amplifyframework.ui:liveness:1.12.0`; Swift package `amplify-ui-swift-liveness:1.5.0`. The React Native 0.88 installed `spm_dependency` helper was inspected; iOS compilation is still pending on Xcode 26.4+.

## Compile evidence and limits

`cloudbuild.android.yaml` creates a minimal Expo 58.0.7 / React Native 0.88.0-rc.4 host, installs the official Android SDK tools with a checked SHA-256, uses previously accepted SDK license metadata, and compiles the real local module. Google names API 37's package `platforms;android-37.0`. This job does not submit an app or certify a physical camera stream.

Local Windows attempts ran out of JVM/native memory even with one worker and a reduced heap. Do not treat those attempts as Kotlin compile results. Cloud validation and artifacts are recorded in the face-verification staging report.

## Full app development build

After compile/device approval, register `native-spikes` as the app's `expo.autolinking.nativeModulesDir` (or move the reviewed module into `modules/`), run prebuild in an isolated checkout, and create an internal development build. Do not enable iOS autolinking until its Xcode build passes. Use these public staging variables only in that test build:

```
EXPO_PUBLIC_FACE_LIVENESS=true
EXPO_PUBLIC_IDENTITY_BACKEND_URL=https://campusmate-backend-502731779521.fly.dev
EXPO_PUBLIC_FACE_CONSENT_VERSION=face-consent-2026-10
```

The identity client keeps existing Firebase login. It sends fresh tokens only to `/v1/identity/*`, discards results after account changes, and does not replace the native Rust migration client or production auth.

## Required physical-device QA

Android and iPhone: explicit camera permission, deny/retry, cancel/back, background/resume, process death, overlapping presentation, offline/timeout, three-minute session expiry, no-flash challenge, wrong owner, repeated complete, photo replacement, TalkBack/VoiceOver and large text. Verify no credential/image enters Intent extras, logs, crash reports or storage. Android uses FLAG_SECURE and a non-exported Activity.

The current user has no physical device, Mac/Xcode or EAS build access available. These checks remain pending, and the production feature flag remains off.
