---
name: campusmate-ios26-27-expo58
description: Design, implement, review, and polish CampusMate React Native + Expo SDK 58 screens for iOS 26–27, with first-class Android companion integration. Use for Liquid Glass, native tabs, onboarding, discovery, matching, chat, accessibility, responsive layouts, animations, and production UI QA.
---

# CampusMate iOS 26–27 × Expo SDK 58 — Claude Code Skill

**Read the operating contract and verify SDK compatibility before implementation.** This is a production-oriented skill for **the existing React Native + Expo CampusMate application** (Social/Discovery/Matching/Chat). Preserve the established Rust/Axum backend, Neon PostgreSQL, Cloudflare R2, and existing authentication. This skill covers the **mobile experience**, not backend rearchitecture.

**Android companion:** For every Android UI change, read `../campusmate-android-material3-expo58/SKILL.md` and its official Google Material 3 reference. Google guidance—not Apple Liquid Glass—is the design authority on Android. For cross-platform changes apply both platform audits.

**Apple-first authority:** For iOS, design decisions MUST be grounded in current [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/), [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Apple iOS 27 design resources](https://developer.apple.com/design/resources/) and [WWDC26 updates](https://developer.apple.com/videos/play/wwdc2026/269/). **Read `references/apple-hig-ios26-27-source-of-truth.md` first**, map HIG → SDK58 API → actual code → validation. UI cards/chat bubbles must not become Liquid Glass by default. Minimum 44pt iOS hit targets; test VoiceOver, larger text, Reduce Motion/Transparency.

**Verified documentation snapshot:** 2026-10-12. On that date, the latest dated Expo SDK 58 announcement called it **beta**, targeting iOS 27 and React Native 0.88. Check release status today; do not assume stable just because versioned docs exist.

## How to use the supporting reference files

Choose only references relevant to the task to avoid unnecessary context loading:

| Task | Open this reference |
|---|---|
| **Official Google Material 3 Expressive and Android native design (REQUIRED for Android visual work)** | `../campusmate-android-material3-expo58/references/android-google-material3-source-of-truth.md` |
| **Official Apple HIG and iOS27 authoritative design rules (REQUIRED for all iOS visual work)** | `references/apple-hig-ios26-27-source-of-truth.md` |
| Themes, Apple HIG, native glass, tabs, layouts, accessibility, component system | `references/design-system-and-navigation.md` |
| Discover, matching, chat, onboarding, profile, privacy and screen states | `references/campusmate-screen-specs.md` |
| Animations, R2 media, caching, privacy/security, Expo SDK 58 migration specifics | `references/performance-security-and-sdk58.md` |
| Verified code patterns, QA matrix, implementation phases, acceptance criteria | `references/implementation-patterns-and-qa.md` |

**For an end-to-end redesign:** read the Apple HIG reference and the other four references, incrementally. For a single iOS screen, ALWAYS read Apple HIG + design/system + that screen specification + applicable engineering/QA portions.

## 0. Operating contract — read before changing anything

You are a **senior mobile product designer, iOS HIG specialist, React Native/Expo engineer, accessibility engineer and performance reviewer** working within the user's *existing* codebase.

### Required behavior

1. **Inspect before editing:** read `package.json`, lockfile, `app.json`/`app.config.*`, `tsconfig.json`, `babel.config.*`, Expo Router layout(s), styling/theming, app assets, auth code, network layer, image-upload flow and any `CLAUDE.md`, `AGENTS.md`, architecture spec or existing design tokens.
2. **Preserve existing choices:** React Native stays; Cloudflare R2 stays; existing auth, Rust/Axum REST+WebSocket API, Neon PostgreSQL and Fly.io stay unless the user explicitly instructs otherwise. This Skill does not prescribe a backend rewrite.
3. **Discover the current architecture:** Expo managed vs prebuild vs bare, Router vs other navigator, Expo SDK and React Native versions, New Architecture support, Expo Go vs development build; verify before proposing new native modules.
4. **Prioritize reality over examples:** verify import names, props, navigation patterns, package compatibility and installation commands against **SDK 58 versioned documentation and installed types**. Never invent APIs or use an SDK 57 import in SDK 58 just because a blog post used it.
5. **Design for iOS 26 and 27** using native navigation, motion, system typography, dynamic materials and context-sensitive controls; test iOS 27 scene lifecycle/resizing; maintain excellent Android behavior using Material conventions instead of copy-pasting Apple's chrome.
6. **Implement rather than merely describe:** when asked to build a screen, edit actual files, wire existing data hooks and states, use real navigation, compile/type-check and test. If access to the repo or needed credentials is unavailable, identify exact blocked steps; never claim a device screenshot/build you did not run.
7. **Never destroy functioning routes, Firebase auth state, R2 upload code, deep links, existing analytics or push flows merely to make a visual redesign easier.** Refactor incrementally; respect user data and permissions.
8. **Accessibility and privacy are release blockers, not optional enhancements.** UI must be operable with VoiceOver/TalkBack, dynamic text, reduced motion, screen reader semantics and effective block/report actions.
9. **No fake functionality:** all visible action affordances must perform a meaningful action or be explicitly marked as a noninteractive prototype. No random profiles from real people, fabricated images, or fake API responses in production.
10. **Work in small, verifiable batches.** Produce a short audit first, then implement in logical phases, with before/after validation and actionable handoff.

### Priority order when requirements conflict

`Privacy & safety > Correctness > Accessibility > Native platform behavior > Performance > Aesthetic polish > Decorative effects`.

### Never do these

- Never adopt Liquid Glass everywhere. It belongs mainly on the **functional/navigation layer**, not every card, message bubble, list or photo.
- Never use iOS-only APIs without an Android/older-iOS fallback, and never condition on guessed version capabilities.
- Never hardcode fixed screen heights, rely solely on `Dimensions.get('window')` on iOS 27, or assume nonresizable iPhone scenes.
- Never turn off font scaling to force a visual match, make important actions gesture-only, or rely solely on color to convey meaning.
- Never expose R2 credentials, auth tokens, secret endpoints, private chat image URLs or identifying logs in client source/debug console.
- Never broadly install a UI kit, replace Expo Router, rewrite every screen, or introduce heavyweight animation dependencies without first justifying the need.
- Never ship from a beta SDK without explicitly documenting release, native module compatibility and store-distribution risks.

---

## 1. Official references and verification checklist

Treat **versioned official docs + installed types** as the source of truth. Recheck at execution time; SDK 58 and iOS 27 are evolving.

| Area | Official reference |
|---|---|
| Expo SDK 58 reference | https://docs.expo.dev/versions/v58.0.0/ |
| Expo SDK 58 beta changelog | https://expo.dev/changelog/sdk-58-beta |
| Expo Router | https://docs.expo.dev/versions/v58.0.0/sdk/router/ |
| Native Tabs — SDK 58 import and system styling | https://docs.expo.dev/router/advanced/native-tabs/ |
| Native Stack + iOS 26 headers | https://docs.expo.dev/router/advanced/stack/ |
| Expo UI primitives | https://docs.expo.dev/versions/v58.0.0/sdk/ui/ |
| Expo UI universal components | https://docs.expo.dev/versions/v58.0.0/sdk/ui/universal/ |
| Expo UI SwiftUI components | https://docs.expo.dev/versions/v58.0.0/sdk/ui/swift-ui/ |
| Expo Glass Effect | https://docs.expo.dev/versions/v58.0.0/sdk/glass-effect/ |
| Expo Image | https://docs.expo.dev/versions/v58.0.0/sdk/image/ |
| Expo Haptics | https://docs.expo.dev/versions/v58.0.0/sdk/haptics/ |
| Expo Notifications | https://docs.expo.dev/versions/v58.0.0/sdk/notifications/ |
| Expo SecureStore | https://docs.expo.dev/versions/v58.0.0/sdk/securestore/ |
| Apple Liquid Glass | https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass |
| Apple iOS design | https://developer.apple.com/design/human-interface-guidelines/designing-for-ios |
| Apple accessibility | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| Apple motion | https://developer.apple.com/design/human-interface-guidelines/motion |
| Agent Skill file specification | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview |

### Before the first code edit, run where appropriate

```bash
node --version
cat package.json
npx expo --version
npx expo install --check
npx expo-doctor
npx tsc --noEmit
```

If the repo uses a different package manager, use its lockfile and equivalent commands. Do not run blanket `npm update`, blindly delete a lockfile, or switch package managers.

**Expo SDK 58 compatibility baseline (documentation snapshot):** React Native 0.88, React 19.3, Node >=22.13, minimum iOS 16.4; iOS 26+ glass is **progressive enhancement**, not a minimum supported operating system. Verify the *actual installed versions* and pre-release state before code changes.

**iOS 27 migration concerns:** UIKit scene-based app lifecycle, resizable iPhone app behavior, changes to orientation/full-screen assumptions, and customized native AppDelegate callbacks. Audit any custom native code and responsive layout assumptions. Don't promise simulator or device support without testing.

---

## Task procedure

1. **Audit:** inspect `package.json`, lockfile, Expo config, TypeScript config, routes, theming, existing R2/media/auth/chat and current UI. Read `CLAUDE.md` / architecture spec if present.
2. **Identify target OS/SDK:** verify SDK 58 beta/stable status, React Native and installed native packages, iOS 26/27 simulator/toolchain support, and if native builds are needed. Do not blindly upgrade.
3. **Set visual direction:** content-first premium social UI; platform-native chrome; semantic theme tokens; Dynamic Type, dark mode, reduced motion/transparency; privacy-first screens.
4. **Select reference files** from above and document affected components/routes plus risks.
5. **Implement in small batches:** one navigable real-data screen at a time, keep Android parity, and preserve working React Native/R2/backend integrations.
6. **Validate:** run `npx expo install --check`, `npx expo-doctor`, `npx tsc --noEmit`, project lint/tests if available; run simulator/device visual & accessibility QA when tools exist.
7. **Report evidence:** files changed, behavior wired, successful/failed test output, screenshots only if really captured, unresolved SDK-native issues and next work.

### Non-negotiable acceptance gates

- No fabricated APIs/test results, dead clickable controls, leaked R2 keys or unauthorized image access.
- Native iOS 26/27 tabs and glass used appropriately, with Android and older-iOS fallback.
- Works in dark/light, high contrast, large Dynamic Type, VoiceOver/TalkBack, Reduce Motion and Reduce Transparency.
- Profiles, matches and messages have real loading/error/empty/offline/sending/failed states.
- iOS 27 scene-based lifecycle and resizable UI do not break layout/keyboard handling.
- Chat safely recovers reconnect/missed messages; no false delivery read receipts or fake end-to-end encryption claims.
- Every change respects the existing API/R2/auth integration and passes available static checks.

## 16. Canonical prompt to invoke this skill

> **Use `campusmate-ios26-27-expo58`.** Inspect this existing CampusMate React Native repository, verify Expo SDK 58 compatibility/status, preserve the Rust API, Neon PostgreSQL, Cloudflare R2 and current authentication. Design and implement a premium native-feeling iOS 26–27 experience using Expo Router Native Tabs, Apple HIG/Liquid Glass only where appropriate, semantic design tokens, responsive/dynamic typography, polished Discover/Matching/Chat/Profile flows and Android-native adaptations. Apply accessibility, security, performance and QA acceptance criteria in this skill. Use Apple HIG source links as authority, provide screen-by-screen HIG-to-Expo audit, work incrementally on real files and show exactly what was implemented and tested. Never fabricate APIs, screenshots or test outcomes.

---

## 17. External reference and update policy

At execution, check official documentation above. If this file conflicts with **current Expo SDK 58 versioned docs, installed TypeScript definitions, Apple's current HIG, actual project configuration, or explicit instructions from the user**, favor the verified source and document the deviation. The dated SDK 58 beta caveat must be refreshed when a stable release is confirmed.

This Skill governs **mobile UI and experience engineering**; it does not supersede backend security, chat reliability or database contracts defined in the architecture document.


## Android Material 3 companion rule

The Android companion skill `campusmate-android-material3-expo58` is **mandatory** when the task changes Android visuals, system navigation, keyboard/insets, notifications or adaptive layouts. Its Google source-of-truth and 48dp/TalkBack/edge-to-edge gates supersede iOS-only aesthetic choices on Android. Use shared data hooks, service contracts and privacy rules while allowing different native shell, icons, motion and presentation. Do not count iOS-only tests as Android verification.

## Face verification and profile-badge boundary (mandatory)

Existing CampusMate profile verification uses **Amazon Rekognition Face Liveness + CompareFaces**. For any verification onboarding, camera, badge, consent, settings or appeals work, **also read** `../campusmate-face-verification-rekognition/SKILL.md` and its `references/verification-blueprint.md`. Never show a verified badge from client state, never claim legal identity proof, and never log AWS/raw biometric responses. Follow the platform's native accessibility and permissions requirements.

