---
name: campusmate-android-material3-expo58
description: Design, implement, and review CampusMate Android UI in React Native Expo SDK 58 using official Google Material 3 Expressive and Android guidance. Use for Android navigation, native Compose components, edge-to-edge, keyboard, predictive back, dynamic color, TalkBack, notification channels, adaptive foldable/tablet layouts, Discover, Matching, Chat, and production Android QA.
---

# CampusMate — Android Material 3 Expressive × Expo SDK 58

This is the **Android companion** to `campusmate-ios26-27-expo58`. Follow Android's own design system rather than dressing Android screens in Apple's Liquid Glass. Preserve the existing CampusMate React Native + Expo mobile app, Rust/Axum/Neon backend contracts, Cloudflare R2, established Authentication and Push configuration.

**Google-first design authority (MANDATORY):** read `references/android-google-material3-source-of-truth.md` before visual/UX code. Official Google Android Developers / Material Design → actual Expo 58 API → implementation → evidence. `@expo/ui/jetpack-compose` is optional native integration, not a mandate to rewrite the app in Kotlin.

**Snapshot 2026-10-12:** Expo SDK 58 documentation is available; its stable/beta status and supported packages must be checked at execution. Target Android 13–16 with Android 17 checks only where OS/docs/device builds actually exist. Never fabricate Android 17 visual features or SDK 58 capabilities.

## Read references by task

| Task | Required document |
|---|---|
| Every Android screen design | `references/android-google-material3-source-of-truth.md` |
| Discover, Matches, Chats, Profile, Settings | `references/android-campusmate-screen-specs.md` |
| Expo 58 native components, insets, testing, release | `references/android-expo58-implementation-qa.md` |
| Cross-platform iOS consistency | companion skill `../campusmate-ios26-27-expo58/SKILL.md` plus Apple reference when iOS changes |

## Core operating rules

1. Inspect repository, `package.json`, lockfile, routing, app config and native modules before changing code. Confirm Expo SDK and actual TypeScript API signatures; never guess them.
2. Preserve user-provided architecture: React Native, Rust API/WebSocket, Neon, R2 and existing auth/FCM. Modify mobile screens and build configuration only when justified.
3. **Android Material 3 Expressive**: native navigation patterns, tonal surfaces, semantic color, Material icon language, dynamic color when supported plus static fallback, purposeful motion, platform haptics and correctly themed light/dark.
4. **48dp touch areas**, TalkBack semantics, font scaling, keyboard accessibility, contrast, visible alternatives to swipe/long press, privacy and abuse safety are release blockers.
5. **Edge-to-edge Android 15+ targeting API35+**: no hardcoded system-bar spacers; handle top and bottom safe areas, navbar scrim, IME and gesture/3-button navigation without double padding.
6. **Android Back**: preserve system Back and test predictive back support through installed navigator/native capabilities; do not steal back button from the OS.
7. **Adaptive tablet and foldable**: use available window width classes, not `isTablet`. Handle compact `<600`, medium `600–839`, expanded `>=840` dp-like window widths; the wide Chat UX should become list-detail when beneficial. Handle hinge separately where truly needed.
8. **Expo Router SDK58 native tabs** when suitable: `expo-router/native-tabs`; Android `md` Material icon support and `tabBarRespectsIMEInsets` must be verified in installed SDK. For specific Compose controls, documented `@expo/ui/jetpack-compose` + `Host` boundary.
9. **R2**: use authorized variants and `expo-image`, private attachment authorization, presigned uploads via existing Rust API; no R2 keys or signed URLs in logs.
10. **Push:** explicit FCM vs Expo push selection, Android channels, Android 13 permission flow, notification deep-link reauthorization. Android remote push cannot be certified in Expo Go SDK58—use development build.
11. Work incrementally. Update actual files only for requested routes; preserve iOS-specific Liquid Glass and iOS HIG. Never change SDK, navigation stack or UI library wholesale without migration impact analysis.
12. No fake screenshot results, automatic ratings, invented Android API values or claims of device testing when not run. Label PASS, FAIL or NOT TESTED with evidence.

### Priority order

`User privacy/safety > Correctness > Android accessibility > Google platform conventions > performance > aesthetic polish > animations`

## Required workflow

**Audit → official rule → smallest implementation → tests → handoff**

- Phase 0: audit environment (`npx expo install --check`, `npx expo-doctor`, configured typecheck/tests), Android target SDK and current UI patterns.
- Phase 1: compare each screen against official Android UX rules, create token/migration matrix and keep shared business logic.
- Phase 2: shell with tabs, system back, safe area, keyboard and Android color; preserve native iOS shell.
- Phase 3: Discover, Matches, Chats and Settings with real data/empty/error/offline states and full accessibility.
- Phase 4: responsive wide/foldable UX, R2 image handling, FCM permission/channels, store icon and release build.
- Phase 5: tests and evidence (small Android, tablet, gesture/3-button, font scale, dark/dynamic theme, TalkBack, IME, release build).

### Definition of Done

- [ ] Android feels **Material 3 Expressive**, not a clone of iOS Liquid Glass.
- [ ] Native Android system Back, 3-button and gesture navigation work.
- [ ] Proper edge-to-edge top/bottom, tabs and chat composer IME behavior.
- [ ] At least 48dp effective targets and TalkBack-readable actions; visible swipe alternatives.
- [ ] Compact, medium and expanded layouts; no lost drafts on resize/fold.
- [ ] Authorized R2 media, genuine chat send/ACK/retry, real block/report workflows.
- [ ] Notification channels/permissions/deep links tested in supported build.
- [ ] TypeScript, lint/tests, Android development/release build, a11y/test matrix reported truthfully.

### Handoff format

`[GOOGLE] link/rule → [EXPO] verified installed SDK API → [CODE] changed files → [TEST] PASS/FAIL/NOT TESTED → [RISK] → [NEXT]` for each changed Android screen.

## Invocation prompt

> Use `campusmate-android-material3-expo58`. Read official Google Material 3 Expressive/Android source of truth and inspect the existing CampusMate React Native Expo repository. Implement the Android experience in Material 3 style with correct native tabs, Material icons, dynamic/light/dark color, edge-to-edge/keyboard/system Back, 48dp targets, TalkBack and adaptive tablet/foldable layouts. Preserve the iOS 26–27 HIG/Liquid Glass implementation, Rust backend, Neon, R2 and existing auth/FCM. Implement in small batches, verify Expo SDK 58 types and actual Android builds, report every untested case honestly.

## Face verification and profile-badge boundary (mandatory)

Existing CampusMate profile verification uses **Amazon Rekognition Face Liveness + CompareFaces**. For any verification onboarding, camera, badge, consent, settings or appeals work, **also read** `../campusmate-face-verification-rekognition/SKILL.md` and its `references/verification-blueprint.md`. Never show a verified badge from client state, never claim legal identity proof, and never log AWS/raw biometric responses. Follow the platform's native accessibility and permissions requirements.

