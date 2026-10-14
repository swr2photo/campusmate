# Apple HIG source of truth — iOS 26 / iOS 27 × Expo SDK 58

> **Mandatory reference, updated 2026-10-12.** For every iOS design decision, identify whether it comes from **[APPLE] official Apple HIG/design resources**, **[EXPO] official Expo SDK 58 docs**, or **[PRODUCT] CampusMate-specific design choice**. Do not falsely attribute arbitrary sizes, timing or colors to Apple. At execution time recheck both official documentation and installed package types.

## 0. Source-of-truth order and proof policy

1. **Apple HIG, Apple Design Resources, Apple accessibility/design updates, Apple WWDC** decide what a native-feeling iOS experience should do.
2. **Expo SDK 58 documentation + installed TypeScript declarations** decide what can actually be implemented in React Native and how to call it.
3. **CampusMate architecture, product intent and existing code** decide routes, brand, content and contracts.
4. A third-party article, Dribbble screenshot or speculative UI pattern **never overrides** official guidance.
5. Distinguish `Apple guidance`, `Expo implementation`, `CampusMate decision`, `proposed test target` in design audits and PR summaries.
6. **No Apple endorsement claim.** HIG alignment is a design goal; Apple does not certify or rate this product “S-tier”.

### Authoritative Apple references

| Ref | Official URL | Required use |
|---|---|---|
| [APPLE-01] Design principles | https://developer.apple.com/design/human-interface-guidelines/design-principles | Agency, purpose, clarity and delightful interactions |
| [APPLE-02] Designing for iOS | https://developer.apple.com/design/human-interface-guidelines/designing-for-ios | iPhone ergonomics, device behavior and content hierarchy |
| [APPLE-03] Materials / Liquid Glass | https://developer.apple.com/design/human-interface-guidelines/materials | What should and should not become glass |
| [APPLE-04] Tab bars | https://developer.apple.com/design/human-interface-guidelines/tab-bars | Navigation semantics, labels and icons |
| [APPLE-05] Searching | https://developer.apple.com/design/human-interface-guidelines/searching | Search entry point and discovery |
| [APPLE-06] Search fields | https://developer.apple.com/design/human-interface-guidelines/search-fields | Dedicated search tab versus in-content search |
| [APPLE-07] Color | https://developer.apple.com/design/human-interface-guidelines/color | Semantic/dynamic colors, emphasis and contrast |
| [APPLE-08] Branding | https://developer.apple.com/design/human-interface-guidelines/branding | Accent restraint, avoid omnipresent logo |
| [APPLE-09] Accessibility | https://developer.apple.com/design/human-interface-guidelines/accessibility | Dynamic Type, VoiceOver, hit targets, contrast |
| [APPLE-10] Layout | https://developer.apple.com/design/human-interface-guidelines/layout | Safe areas, adaptive layouts and resizing |
| [APPLE-11] Motion | https://developer.apple.com/design/human-interface-guidelines/motion | Meaningful and optional motion |
| [APPLE-12] Privacy | https://developer.apple.com/design/human-interface-guidelines/privacy | Permission timing, user control |
| [APPLE-13] SF Symbols | https://developer.apple.com/design/human-interface-guidelines/sf-symbols | Platform-appropriate symbols and licensing |
| [APPLE-14] App icons | https://developer.apple.com/design/human-interface-guidelines/app-icons | Layered 1024px icon and visual variants |
| [APPLE-15] Design kits | https://developer.apple.com/design/resources/ | Official iOS 27/iPadOS 27 Figma/Sketch kits |
| [APPLE-16] New design system, WWDC25 | https://developer.apple.com/videos/play/wwdc2025/356/ | Intent and organization of system chrome |
| [APPLE-17] SwiftUI new design, WWDC25 | https://developer.apple.com/videos/play/wwdc2025/323/ | Tab/toolbar/search/sheet native behavior |
| [APPLE-18] What's new in SwiftUI, WWDC26 | https://developer.apple.com/videos/play/wwdc2026/269/ | Updated iOS 27 Liquid Glass and adaptable layout |
| [APPLE-19] iPhone Duo layout | https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo | iOS 27 dual-display/resizable layout cases |
| [APPLE-20] What's new in Apple design | https://developer.apple.com/design/whats-new/ | Date of latest changes and UI kit updates |

### Official Expo translation references

| Ref | Official URL | Meaning |
|---|---|---|
| [EXPO-01] SDK58 versioned docs | https://docs.expo.dev/versions/v58.0.0/ | Runtime/packages, verify actual release status |
| [EXPO-02] Router native tabs | https://docs.expo.dev/router/advanced/native-tabs/ | `expo-router/native-tabs`, system labels and Search role |
| [EXPO-03] `@expo/ui` SwiftUI | https://docs.expo.dev/versions/v58.0.0/sdk/ui/swift-ui/ | Native controls from React using Host |
| [EXPO-04] `@expo/ui` Universal | https://docs.expo.dev/versions/v58.0.0/sdk/ui/universal/ | Shared native iOS/Android controls |
| [EXPO-05] Glass Effect | https://docs.expo.dev/versions/v58.0.0/sdk/glass-effect/ | Native iOS 26+ effect, capability and fallback |
| [EXPO-06] Native Tabs module | https://docs.expo.dev/versions/v58.0.0/sdk/router/native-tabs/ | Native tab API support in SDK58 |
| [EXPO-07] SDK58 beta release note | https://expo.dev/changelog/sdk-58-beta | SDK58's 2026-09-15 beta baseline; recheck stability |

## 1. Apple philosophy, translated to CampusMate

- **[APPLE] Content is primary**: place profile imagery, interests, messages and readable labels in the content layer; affordances are subordinate.
- **[APPLE] Familiar navigation**: a tab changes top-level destination; Like/Pass/Compose/Send are actions and therefore NOT navigation tabs.
- **[APPLE] Consistent system gestures**: native swipe back, standard sheet dismissal, clear selection feedback, contextual menus anchored to their controls.
- **[PRODUCT] CampusMate**: warm, social, welcoming aesthetic with quiet brand color accents and visible trust/safety controls; never imitate Apple's stock apps pixel-for-pixel.
- **[PRODUCT] No manipulative engagement**: consent-based profile discovery; explicit choices; do not hide Block/Report or force users to share location/contacts to proceed.

## 2. Liquid Glass: system layer, not a card style

**[APPLE-03]** Liquid Glass is a **functional layer above content** for bars/navigation/floating controls; standard materials or opaque surfaces support content. **DO NOT put Liquid Glass on the content layer** simply for decoration. System components adopt the material automatically; custom glass is rare and should identify an important function.

**Allowed candidate placements**:
- Native tab bar, navigation header/toolbar, contextual floating controls.
- Native menus, presentations, relevant search affordances as automatically rendered by the OS.
- A small custom floating photo action when no system equivalent exists AND an opaque fallback remains readable.

**Not allowed as a default**:
- All profile cards, chat bubbles, full-screen gradients, backgrounds of every form field, stacked nested glass borders, destructive confirmation dialogs.
- Custom glass that blurs text, lowers contrast or blocks content behind bars.

**[APPLE-03, APPLE-07]** Choose regular as a starting point. Clear is only justified above visually rich imagery where legibility remains excellent; don't tint every control. Glass appearance changes with content, dark mode, user system settings and updates between iOS 26/27. Avoid hard-coded blur radii and screenshots masquerading as system material.

**[APPLE-18] iOS 27 updates**: revised Liquid Glass appearance and responsiveness are native OS behaviors. Let built-in controls follow the OS instead of implementing a hard-coded “iOS 27 look” or guessing private APIs. Test iOS26 and iOS27 separately, including glass tint/transparency preferences if available on test devices.

**[EXPO-05] implementation order**:
1. Native `expo-router/native-tabs` and native stack/toolbar (system-rendered glass).
2. Existing React Native content components with semantic/dynamic backgrounds.
3. For a unique custom functional control, `expo-glass-effect` on iOS26+ with `isGlassEffectAPIAvailable()` / `isLiquidGlassAvailable()` runtime checks and `AccessibilityInfo.isReduceTransparencyEnabled()` fallback.
4. `@expo/ui/swift-ui` + `Host` when truly needed; verify installed modifiers and API availability; no invented modifiers.
5. Android receives its own Material-appropriate surface, **not** a fake clone of Apple's glass.

### Mandatory tests for glass

- iOS26/27 light + dark + increase contrast + reduce transparency; photo background bright, complex, dark.
- Verify tab/header labels and controls on top of R2 imagery, no unreadable on-image badges.
- Scrolling profile feed and chat list: no unstable scroll-edge transparency, overlay clipping or keyboard overlap.
- Avoid parent `opacity` animations that make glass render incorrectly; use documented component animation hooks.

## 3. Native navigation and search

**[APPLE-04]** Tabs represent stable top-level sections; tab label should be easy to understand (prefer one word), with familiar SF Symbols. Distinguish a badge for unread chats from a main action. Preserve navigation state when switching tabs. Don't make tabs disappear unpredictably.

**[PRODUCT] CampusMate tabs**: `Discover`, `Likes`, `Chats`, `Profile`. If global search materially serves users, test whether it needs a fifth dedicated search tab, a search role or in-screen search (don't auto-add one).

**[APPLE-05, APPLE-06]** Primary search belongs somewhere obvious, not hidden in an overflow menu. iOS supports dedicated Search tabs and context-appropriate search fields; use the position that matches information architecture.

**[EXPO-02]** SDK58 native tabs import `NativeTabs` from `expo-router/native-tabs`; earlier SDK lines can differ. Use `NativeTabs.Trigger.Label` and `NativeTabs.Trigger.Icon` with SF symbols and Android alternatives only as current types/docs permit. For dedicated Search, check current `role="search"` support. Check `FlatList`/minimize-on-scroll limitations and `disableTransparentOnScrollEdge` documented workaround before enabling minimize behavior; never blindly promise parity with UIKit.

**[PRODUCT] Screen decisions**:
- Discover: search/filter from context, accessible Like/Pass actions; don't require swipe gesture.
- Chat detail: keep message composer out of keyboard/home-indicator regions; native back and a visible safety/report menu.
- Profile and Settings: easy return/navigation, standard destructive confirmations.

## 4. Typography, color, brand, icons

**[APPLE-07, APPLE-08]** Use semantic dynamic colors for label/background/separator states; accent color for primary or important state, not every icon and button. In RN map design tokens to actual system `PlatformColor`/`DynamicColorIOS` where supported; use theme tokens with light/dark/high-contrast variants, not “magic hex” values copied from an Apple screenshot.

**[APPLE-09]** Standard iOS body is typically 17pt; this is **not** permission to force all text to 17pt. Follow native text hierarchy and respect text scaling; aim to support enlarged text up to **200%** when feasible. Long Thai names, Latin text, multi-line chat, emoji and mixed scripts require explicit layout review. Do not bundle Apple proprietary system font files or disable scaling.

**[APPLE-13]** SF Symbols for system actions, valid system-supported version. Verify named symbols exist in the target OS and whether `sf`/`md` props accept the selected value. Don't use SF Symbols as product brand logo or app icon; respect Apple licensing and platform variants.

**[APPLE-14, APPLE-15]** Official iOS27 Design Resources (Figma/Sketch) are the reference for native control dimensions and visual changes. Icons: layered `1024×1024` design sources, check system-masked/Default/Dark/Clear/Tinted appearances as applicable. Avoid manually masking the icon corners or inserting screenshots as layered source. Expo asset pipeline might expose fewer variants than native tooling: verify actual support; if missing, document/implement via native config instead of pretending it is already complete.

## 5. Accessibility: enforceable gates

**[APPLE-09]** iOS/iPadOS touch target **44×44 pt**. For text contrast, use HIG/WCAG benchmarks: **4.5:1 for smaller regular text** and **3:1 for qualifying larger or bold text**; test actual text/image combinations, not guessed token contrast. UI in Increase Contrast must remain legible.

- Full primary flows via VoiceOver / Switch Control; use accessible labels, roles, state, grouping, hints only when needed.
- Dynamic Type larger settings, at least 200% test case; no clipped CTA/field/Thai label; allow vertically growing rows and stacked horizontal layout.
- Respect Reduce Motion: disable or replace disorienting swipe/celebration/zoom motion; never convey Match or failure exclusively by animation.
- Respect Reduce Transparency: native/system + custom glass must have an opaque, contrast-safe surface when appropriate.
- Respect Bold Text/Increase Contrast/Dark Mode and explicit OS text-size changes while the app is running.
- Haptics are optional feedback, not exclusive; provide visible acknowledgement of Like/Send/Block.
- Screen reader focus after closing modals, opening a match, receiving a message; no focus trap or inaccessible overlay.

**[PRODUCT] Release blocker**: any screen where a user cannot block/report, send a message, or operate essential navigation using accessibility controls fails QA regardless of visual polish.

## 6. Adaptive iOS 27 and iPhone Duo

**[APPLE-10, APPLE-19]** Do not assume one width/height or one portrait canvas. Respond to *available space*, `useWindowDimensions()`, safe-area insets, and available size classes if implemented natively. Avoid viewport constants for swipe card widths, sheets, chat composer and keyboard. Test notch, Dynamic Island, home indicator, camera/hinge reserved regions.

**[APPLE-19]** iPhone Duo may show vertical toolbar/tab bars in constrained modes, and an outer/inner display with changing size. The principle is flexible layout **without suddenly rearranging the app's entire information architecture**. If device/simulator support is absent, mark as untested; do not invent screenshot evidence.

- Compact widths: single-column Discover, matches, chats; no controls underneath hinge, camera or system tabs.
- Regular widths: optionally two-pane chat list/detail if it improves usability and is realistically supported.
- Preserve scroll/selected match/draft when resizing or changing orientation.
- iPad: test multitasking/split display, pointer/keyboard where available, no forced fixed width phone window.
- Android: apply adaptive layouts separately; do not assume Android system bar behavior matches iOS.

## 7. Motion, sheets, feedback and privacy

**[APPLE-11]** Motion communicates hierarchy and cause; default to native navigation and system presentations. Custom swipe spring should track finger, be cancelable, and have a visible Like/Pass alternative. “Match!” may celebrate briefly but must be dismissible and Reduced Motion friendly. Never animate all cards continuously.

**[APPLE-12]** Request camera/photos/location/notifications only when user activates a feature that actually needs them. Explain purpose at point of use. Social discovery must not reveal precise location accidentally; allow pseudonymous/profile visibility choices as product needs. Use system photo picker when possible; never force unnecessary full-library access. Onboarding must permit skipping optional permissions.

**[PRODUCT] Safety operations**: accessible Block/Report, mute, hide profile, delete account entry point, explicit privacy settings, consent-based matching and meaningful error states. Don't misrepresent Apple policies or legal obligations as general HIG design preferences; verify actual App Store Review/PDPA obligations separately if implementing store submission.

## 8. Design translation matrix (mandatory in Claude handoff)

| User-facing UI | Apple direction | Expo SDK58 route | Android fallback | Test/acceptance |
|---|---|---|---|---|
| Main tabs | [APPLE-04] native tab semantics | [EXPO-02] `NativeTabs` | native Material navigation | labels, no unexpected hiding, deep-link restoration |
| Toolbar/navigation | [APPLE-03,17] functional glass | native stack/header | native/platform action bar | safe area, contrast, back gesture |
| Search | [APPLE-05,06] discoverable | native Search tab or screen | contextual search UI | keyboard focus, recent/suggested states, no forced new tab |
| Profile card | [APPLE-03] **no default glass** | RN card + `expo-image` | same content, Android surfaces | images sharp, labels readable, accessible Like/Pass |
| Chat bubble | [APPLE-03,09] solid readable content | RN chat + WebSocket hook | same message semantics | long Thai text, 200% type, offline/sent/failed |
| Match celebration | [APPLE-11] optional purposeful motion | verified animation API + reduce motion | platform-safe alternative | replay/cancel, no gesture-only action |
| Settings | [APPLE-07,09,12] grouped, clear privacy | native controls or `@expo/ui` | platform components | contrast, destructive confirmation, VoiceOver |
| Photo upload | [APPLE-12] just-in-time permission | picker → existing R2 upload client | platform picker | no public-chat leak, retry/cancel, alt content |
| Custom floating action | [APPLE-03] only if necessary | [EXPO-05] guarded `GlassView` | solid/Material surface | reduce transparency, bright/dark scene |
| App icon | [APPLE-14,15] layered/native system | Expo assets or verified native pipeline | Android adaptive icon | real platform variants and icon previews |

## 9. HIG compliance audit output template

For every touched screen, attach this small audit to the handoff:

```md
### Apple HIG / Expo audit: <screen and route>
- Reference: [APPLE-XX] link(s) + [EXPO-XX] link(s)
- Intent: <what the user should accomplish>
- Native controls used: <tabs/header/menu/search/sheet>
- Liquid Glass: <why here / why absent>
- Dynamic Type & contrast: <tested states, screenshot or not tested>
- VoiceOver: <focus order, labels, actual test result>
- iOS 26 / iOS 27: <tested device/OS / not tested>
- Android fallback: <tested or not tested>
- Layout: <compact, landscape, iPad/Duo if possible>
- Existing R2/Auth/Backend preserved: <diff evidence>
- Result: PASS | FAIL | NOT TESTED
- Blockers: <explicit remaining items>
```

Never mark a check PASS solely from reading the code. Code review ≠ real device validation.

## 10. Mandatory implementation workflow for Claude

1. **Audit existing repo** and current project version. Read app screens, tokens, navigation, animation, R2 integration, Firebase/auth and backend API hooks. Confirm whether SDK58 is stable at task execution; do not auto-upgrade beta dependencies.
2. **Read Apple references by screen goal** and document HIG source IDs from this file. Read Expo SDK58 docs and installed types to pick actual APIs.
3. **Present a short HIG gap analysis** with Apple requirement/guidance, current implementation, proposed change, impact, risks and fallbacks.
4. **Implement screen by screen**: tokens → native navigation → content state → accessible actions → feedback/motion → responsive layout; avoid redesign that breaks existing backend hooks.
5. **Run real checks**: typecheck/lint/tests, native build if environment available, Light/Dark, VoiceOver, Reduce Transparency/Motion, iOS26 and iOS27, Android. Disclose untested devices.
6. **Deliver evidence**: file diff, verified APIs, actual logs/results, screenshots only when generated/tested, HIG compliance audit. Track exact remaining issues.

## 11. Blocking errors and anti-patterns

- Using arbitrary blur views on each profile/message as “Apple Liquid Glass”.
- Borrowing SF Symbols font files, copying an Apple logo, or using Apple screenshots as assets.
- Forcing a giant title, 5 tabs, a Search tab or fixed glass bottom bar without purpose/product testing.
- Treating iOS26 behavior as identical to 27 without testing or asserting iOS27-only APIs are present in Expo.
- Failing to provide solid fallback on iOS<26, Android, or Reduce Transparency mode.
- Ignoring language/font scaling and app accessibility in favor of pixel-perfect screenshot reproduction.
- Replacing existing R2/Firebase/Rust integration while asked to adjust design only.
- Declaring App Store approved, HIG compliant, 60fps or performance-S-tier without evidence.
