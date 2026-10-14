---
name: campusmate-ios26-27-expo58
description: Design and implement CampusMate React Native Expo SDK 58 UI/UX across iOS 26–27 and Android using official Apple HIG and Google Material 3 Expressive. Use for Liquid Glass, native tabs, onboarding, discovery, matching, chat, accessibility, responsive layouts, animations, and production UI QA.
---

# CampusMate — iOS 26–27 × Expo SDK 58 UI/UX Engineering Skill

**Target agent:** Claude Code / Claude Opus (or equivalent coding agent)  
**Project:** CampusMate — social discovery, friendship matching, one-to-one chat  
**Target stack:** existing React Native + TypeScript + Expo; iOS 26–27 first, Android first-class  
**Document date:** 2026-10-12  
**Scope:** UI/UX, design system, navigation, mobile implementation, performance and accessibility. **Do not replace the existing backend.**

> **Release gate:** On 2026-10-12 the latest dated official Expo SDK 58 announcement identified SDK 58 as **beta** (2026-09-15), targeting iOS 27 / React Native 0.88. Before installing/upgrading, verify the current SDK release status and exact project dependencies. The Expo 58 versioned API pages may exist before a stable release. Do not misrepresent beta as stable, and do not force an SDK upgrade without showing migration impact.

## Apple HIG authority — required for this skill

**Platform authority rule:** iOS follows Apple HIG and Android follows Google Material 3 Expressive. For Android-specific work use the complete companion reference in this file and the separate Claude skill included in ZIP.

**Platform authority rule:** iOS follows Apple HIG and Android follows Google Material 3 Expressive. For Android-specific work use the complete companion reference in this file and the separate Claude skill included in ZIP.

**Apple-first rule:** Follow **Apple Human Interface Guidelines + official iOS 26/27 Apple Design Resources** for iOS visual/interaction decisions; follow **Expo SDK 58 versioned docs and installed types** for implementation feasibility. For the complete evidence-based interpretation and test matrix, read `references/apple-hig-ios26-27-source-of-truth.md` **before any visual work**.

**Non-negotiable Apple-aligned design gates**:

1. **Liquid Glass [Apple HIG Materials]:** System navigation and controls form a functional layer above content. Do **not** give every profile card, chat bubble, form or content background a glass effect. Prefer native system bars; guard custom glass for iOS26+, accessibility Reduce Transparency, and Android fallback.
2. **Native navigation [Apple Tab bars / Searching]:** Tabs change top-level sections, never act as buttons. Use descriptive one-word tab labels with SF Symbols (when verified), native back gestures and a clear search entry point. Do not automatically add a Search tab without product justification.
3. **Visual semantics [Apple Color / Branding]:** Dynamic system colors, meaningful contrast, brand accents sparingly, no imitation Apple logo, no forced pixel-copy of native UI; content (profiles/chat) remains primary.
4. **Accessibility [Apple Accessibility]:** at least **44×44 pt iOS** interactive targets; test text scaling near **200%**, VoiceOver, Reduce Motion, Reduce Transparency, Increase Contrast, Dark Mode, Thai/English mixed text. Smaller normal text generally **4.5:1** contrast, qualifying large/bold text **3:1**.
5. **Layout [Apple Layout / iPhone Duo]:** safe areas, keyboard, resizable scenes, iPad layouts, iOS27 iPhone Duo inner/outer display and reserved regions; no fixed portrait-only cards.
6. **Motion and privacy [Apple Motion / Privacy]:** purposeful and cancelable animations, native sheets, just-in-time permission prompts, visible Block/Report, no precise location disclosure by default.
7. **iOS 27 visual system [WWDC26 / Apple iOS27 UI Kit]:** allow native Liquid Glass updates and tint/system preferences to render naturally; do not fake OS styles via blur/opacity. Compare actual iOS26 and 27 behavior.
8. **Icons and assets [Apple App Icons / SF Symbols]:** create original layered icon art at 1024×1024 design size; verify supported system variants and Expo asset export. Never redistribute Apple font files.
9. **Platform honesty:** iOS design can use `expo-router/native-tabs`, `@expo/ui` with `Host`, and `expo-glass-effect` guarded by documented capability checks. Android uses its own appropriate Material behavior.
10. **Traceable review:** every design task ends with `[APPLE] official link → [EXPO] versioned API → code file(s) → tested state → PASS/FAIL/NOT TESTED`. Never claim device tests not run.

**Canonical Apple sources**: [HIG](https://developer.apple.com/design/human-interface-guidelines/) · [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) · [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) · [iOS 27 design kits](https://developer.apple.com/design/resources/) · [WWDC26 SwiftUI](https://developer.apple.com/videos/play/wwdc2026/269/) · [iPhone Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo).

---

## ANDROID COMPANION — READ FOR ALL ANDROID CHANGES

For Android screens, navigation, theme, notifications, or tablet/foldable: read the appended **Official Android Source of Truth**, **Android Screen Specifications**, and **Android Engineering Runbook** below. These are sourced from official Google Android Developers and Expo SDK58 docs. Android target size >=48dp, Material3 Expressive and edge-to-edge rules supersede iOS-only visual patterns.

---

## ANDROID COMPANION — READ FOR ALL ANDROID CHANGES

For Android screens, navigation, theme, notifications, or tablet/foldable: read the appended **Official Android Source of Truth**, **Android Screen Specifications**, and **Android Engineering Runbook** below. These are sourced from official Google Android Developers and Expo SDK58 docs. Android target size >=48dp, Material3 Expressive and edge-to-edge rules supersede iOS-only visual patterns.

---

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
| **Apple HIG Materials (glass is a functional layer)** | https://developer.apple.com/design/human-interface-guidelines/materials |
| **Apple iOS/iPadOS 27 design kits** | https://developer.apple.com/design/resources/ |
| **Apple WWDC26 iOS 27 refinement** | https://developer.apple.com/videos/play/wwdc2026/269/ |
| **Apple iPhone Duo adaptive layouts** | https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo |
| Apple branding and semantic color | https://developer.apple.com/design/human-interface-guidelines/branding |
| Apple privacy and permissions | https://developer.apple.com/design/human-interface-guidelines/privacy |
| Apple app icons and SF Symbols | https://developer.apple.com/design/human-interface-guidelines/app-icons |
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

## 2. Product principles — premium without being flashy

CampusMate is a trust-sensitive social app. Deliver a clear, warm and approachable experience with tasteful native refinement.

1. **Content-first:** real profiles, photos, interests and messages are the heroes; UI chrome recedes.
2. **Human connection:** design for respectful discovery, mutual interest and safe conversations, not manipulative infinite swiping.
3. **Obvious hierarchy:** one primary action per screen; progressive disclosure for secondary actions.
4. **Calm motion:** transitions communicate cause/effect; avoid looping glows, gratuitous 3D and constant shimmer.
5. **Native authenticity:** SF Symbols/system navigation on iOS; Material icons/navigation and touch states on Android.
6. **Data integrity in UI:** honest message sending/sent/failed/read states; distinguish UI optimism from server confirmation.
7. **Trust by default:** privacy choices visible, location never displayed precisely without purpose/consent, block/report easy to find.
8. **Localization ready:** Thai and English, long names, variable line breaks and international fonts; do not hardcode per-language width.
9. **Accessible at default and enlarged settings:** Dynamic Type, contrast, screen readers, reduced transparency/motion.
10. **Battery and bandwidth conscious:** efficient media dimensions, virtualized lists and restrained background activity.

### Suggested visual direction (adapt to existing brand if present)

- **Personality:** premium, youthful, friendly, clean, calm, trustworthy.
- **Typography:** system font on each OS by default (SF family through iOS system styles, Android platform font); respect Thai rendering and Dynamic Type. Do not bundle proprietary Apple font files.
- **Color:** semantic tokens; avoid hardcoding colors in component implementations. Suggested *starting point*, not a mandated brand redesign:

```ts
// src/theme/tokens.ts — sample only; merge with existing tokens
export const palette = {
  light: {
    canvas: '#F7F9FC', surface: '#FFFFFF', surfaceRaised: '#F0F4FA',
    text: '#101828', secondaryText: '#475467', accent: '#4338CA',
    positive: '#067647', warning: '#B54708', danger: '#B42318',
    border: '#D0D5DD', chatMine: '#E9E7FF', chatOther: '#FFFFFF',
  },
  dark: {
    canvas: '#0B1020', surface: '#171D31', surfaceRaised: '#222A40',
    text: '#F9FAFB', secondaryText: '#CBD5E1', accent: '#A5B4FC',
    positive: '#6CE9A6', warning: '#FEC84B', danger: '#FDA29B',
    border: '#344054', chatMine: '#302C59', chatOther: '#20283B',
  },
} as const;

export const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, huge: 40 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;
```

Validate all token combinations against real contrast testing and provide Increase Contrast variants. Color sample does **not** establish contrast conformance automatically.

### Layout / grid / density

- Use an 8-point spacing rhythm, with 4-point refinements.
- Typical content horizontal padding: 16–24 logical points based on viewport and density; responsive instead of fixed.
- Primary tap areas **at least 44×44 pt on iOS**, **48×48 dp recommended on Android**; keep destructive actions spatially separated.
- Favor comfortable reading line lengths, measured card widths and generous whitespace; avoid excessive elevation.
- Do not use fixed heights for translated text, dynamic headlines or large accessibility text.
- Keep interactive controls inside usable safe areas, except intentional edge-to-edge backgrounds.

---

## 3. iOS 26–27: Liquid Glass implementation policy

Apple's Liquid Glass is a **system material**, not an opaque acrylic overlay. Apply with intention and native APIs.

### Correct placement

**Use/consider native system rendering for:**
- Native tab bar and navigation bar.
- Toolbars and floating action groups.
- Small contextual controls over imagery, only when readable.
- Sheets and system popovers/menus where native controls supply it.

**Avoid in:**
- Every profile card, discover feed card, long-form settings rows and message bubbles.
- Large overlapping glass surfaces or endlessly nested glass containers.
- High-density information views where blur reduces reading clarity.
- Sensitive privacy dialogs where predictable opaque contrast is preferable.

### Prefer native system components first

1. Expo Router **Native Tabs** for primary top-level navigation on mobile (`expo-router/native-tabs` in SDK 58; `unstable-native-tabs` belongs to prior versions).
2. Native Stack for push/back gestures and native headers.
3. `@expo/ui` Universal when native cross-platform controls fit the requirement.
4. `@expo/ui/swift-ui` for focused iOS-specific controls, with `Host` at the React Native ↔ SwiftUI boundary, plus an Android implementation.
5. `expo-glass-effect` `GlassView`/`GlassContainer` only for custom **functional** controls requiring real glass.
6. Plain React Native surfaces if native glass unavailable or Reduce Transparency is enabled. Never fake glass with complex transparent layers by default.

**Platform guards:** `GlassView` supports native liquid glass on iOS 26+ and falls back on unsupported platforms; guard fragile code paths with `isGlassEffectAPIAvailable()` and `isLiquidGlassAvailable()` per versioned docs. Consider `AccessibilityInfo.isReduceTransparencyEnabled()` when selecting an opaque alternative. Guard before rendering, not only inside event handlers.

**Important:** iOS 26 native system tab bars derive glass tint from **content behind the bar**. Do not try to fix native iOS 26 tab backgrounds with props that only work on iOS 18 and earlier. Use proper underlying screen backgrounds.

**Do not adopt** `UIDesignRequiresCompatibility` as a long-term fix: official Expo Router docs note iOS 27 removes this compatibility escape hatch. Fix layouts for the new native design instead.

**Glass-specific bug prevention:** avoid animating parent opacity below 1 on `GlassView`; use supported `glassEffectStyle` animation when applicable. Test screen switches, header flicker, transparency reduction and iOS 26/27 real devices.

### Minimal capability-aware wrapper example

```tsx
// src/components/ui/GlassActionSurface.tsx — pattern; validate installed SDK/types
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, ViewProps } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';

type Props = ViewProps & { children: React.ReactNode };

export function GlassActionSurface({ children, style, ...rest }: Props) {
  const [reduceTransparency, setReduceTransparency] = useState(true);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
      if (active) setReduceTransparency(value);
    }).catch(() => {
      if (active) setReduceTransparency(true);
    });
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
    return () => { active = false; sub.remove(); };
  }, []);

  const glass = Platform.OS === 'ios'
    && isLiquidGlassAvailable()
    && isGlassEffectAPIAvailable()
    && !reduceTransparency;

  if (!glass) {
    return <View style={[styles.fallback, style]} {...rest}>{children}</View>;
  }
  return <GlassView style={[styles.glass, style]} glassEffectStyle="regular" {...rest}>{children}</GlassView>;
}

const styles = StyleSheet.create({
  fallback: { borderRadius: 22, backgroundColor: '#ECEFF5' },
  glass: { borderRadius: 22 },
});
```

> The wrapper is a **design example**. In production connect it to resolved theme tokens (including dark and high-contrast fallback). Validate exact types/event signatures against installed React Native SDK. Prefer native tab/header controls instead of wrapping them needlessly.

---

## 4. Navigation architecture

**Default main tabs:** Discover, Likes/Matches, Chats, Profile. If a dedicated Search is central, use `role="search"` on its native tab where supported; do not create a fifth tab without demonstrated benefit.

### Suggested routes; map onto the existing tree

```text
src/app/
  _layout.tsx                      # providers, fonts, theme, safe auth gate
  (auth)/
    welcome.tsx
    sign-in.tsx
    complete-profile.tsx
  (tabs)/
    _layout.tsx                    # NativeTabs, OS-aware label/icon
    discover/index.tsx
    likes/index.tsx
    chats/index.tsx
    profile/index.tsx
  user/[id].tsx                    # profile detail
  chat/[id].tsx                    # immersive conversation, composer
  settings/index.tsx
  settings/privacy.tsx
  safety/report/[id].tsx
  modal/filters.tsx
  modal/attachment-preview.tsx
```

**Use routes as intent, not an instruction to delete current pages.** Reconcile conflicts and preserve deep links, notification routes, current navigation state and tab counts.

### Expo Router SDK 58 native tab API illustration

```tsx
import { NativeTabs } from 'expo-router/native-tabs';

export default function TabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="discover">
        <NativeTabs.Trigger.Label>Discover</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'safari', selected: 'safari.fill' }} md="explore" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="likes">
        <NativeTabs.Trigger.Label>Likes</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'heart', selected: 'heart.fill' }} md="favorite" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chats">
        <NativeTabs.Trigger.Label>Chats</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} md="chat" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

**Verify example in the current versioned Native Tabs guide and installed types before using it.** Icon/Label exports, `name`, route structure and platform fallback may differ from the existing app. Make icons legible in dynamic light/dark glass. Prefer `PlatformColor`/`DynamicColorIOS` as supported by native-tabs docs when setting native icon tint.

### Navigation interaction standards

- Native swipe-back, correctly labeled Back actions, restoration of scroll position where appropriate.
- Keep primary navigation stable; avoid modal stacks for ordinary detail pages.
- Match found: use restrained celebratory animation, allow dismissal and chat CTA.
- Settings and destructive account actions must have a clear return path.
- Deep links to chat/profile must resolve authentication and authorization safely.
- Content extends beneath native chrome only where it stays readable with scroll-edge treatment and safe insets.
- On iOS 27 resizable scenes, respond to layout changes rather than assuming full-screen phone portrait.

---

## 5. Components and state model

Build a small **semantic design system**, not a generic 100-component framework.

```text
src/
  theme/
    tokens.ts
    semantic-colors.ts
    typography.ts
    useAppTheme.ts
  components/
    ui/
      AppText.tsx
      AppButton.tsx
      IconButton.tsx
      Avatar.tsx
      ProfileImage.tsx
      InputField.tsx
      FormField.tsx
      EmptyState.tsx
      ErrorState.tsx
      LoadingSkeleton.tsx
      GlassActionSurface.tsx
      AccessibleSheet.tsx
    discover/
      DiscoveryCard.tsx
      InterestChip.tsx
      MatchActions.tsx
    chat/
      MessageBubble.tsx
      MessageComposer.tsx
      DeliveryIndicator.tsx
      ConversationRow.tsx
  features/
    auth/
    discovery/
    matching/
    chat/
    profile/
    safety/
  services/
    api/
    media/
    websocket/
  hooks/
```

**For all screens** implement deliberate states: initial loading, pull-to-refresh if useful, empty, filtered empty, error + retry, offline, partial data, permission denied, blocked, and optimistic pending. Skeletons should match layout geometry and not strobe indefinitely.

**For all reusable components:** typed props, semantic color roles, pressed/focus/disabled/loading variants, testID, accessibilityLabel/Hint/Role/State as appropriate, large content support, reduced-motion behavior and no secret/private values in analytics.

---

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

## 7. Platform-specific adaptivity: iOS 26 / iOS 27 / Android

| Dimension | iOS 26–27 | Android |
|---|---|---|
| Primary tabs | Expo Router Native Tabs; native glass where OS renders it | Native/Material tab behavior and color |
| Icons | SF Symbols in native tabs/buttons as supported | Material icons or vector asset fallback |
| Sheets | Native presentation and detents where supported | Android-correct sheets/dialogs |
| Context menus | Native menus; native glass style when appropriate | Android native/context actions |
| Back | Native swipe-back/system back | Android system back/predictive back if supported |
| Typography | Dynamic Type and SF system styles | Font scaling and native styles |
| Haptics | System haptics at meaningful events | Appropriate Android haptics, not iOS imitation |
| Safe areas | Notch/island/home indicator + native bar | Status/navigation bar insets + keyboard |
| Glass | Only when supported, with transparency fallback | Opaque/platform surface or Material-native approach |
| Large screen | iOS 27 resizable; iPad and split/multitask layout | Foldables/tablets/multi-window where feasible |

**No fragile OS checks:** use feature availability, capability detection and current SDK docs first. A version number alone does not prove a native effect is available in the built binary.

### Accessibility acceptance criteria

- Screen reader can navigate all primary flows with logical focus order and descriptive controls.
- Text responds to Dynamic Type / font scaling at least through common large accessibility settings without lost actions or clipped forms.
- Minimum hit areas as above; meaningful text contrast generally >=4.5:1 (normal) and >=3:1 (large) using WCAG AA checks.
- Visually significant animations respect Reduce Motion; important status not conveyed only by animation, haptic or color.
- Reduce Transparency yields readable solid alternatives.
- Control state (disabled/selected/busy) is conveyed semantically.
- Images include meaningful labels when informative; decorative images are hidden from the accessibility tree.
- Focus returns appropriately when a sheet/dialog closes; errors are announced understandably.
- Thai long names and English long labels do not clip at 200% text sizing where practically supported.

---

## 8. Animation & interaction standards

- Prefer **native** navigation transitions and gestures. Add custom animation only when it reinforces intent.
- Use `react-native-reanimated` if it is already present / verified compatible with Expo 58; install with `npx expo install`, not random version pins.
- Short state-feedback transitions: roughly 120–220 ms; larger content transitions: roughly 250–450 ms **as design starting points**, adjusted by platform and user preferences.
- Use springs for direct manipulation, avoid bouncing every control or animated gradients behind text.
- Profile swipe: gesture tracks touch, threshold clear, cancel restores card. Provide accessible Like/Pass buttons.
- Match celebration: brief and dismissible, optional reduced-motion path; do not freeze input or block back navigation.
- Use `expo-haptics` sparingly for committed Like/Match/Send events. Avoid haptic on each scroll tick.
- Avoid expensive blur updates, continuous translucent layers, JS-thread driven per-frame rerenders and UI animations tied to repeated network requests.
- Follow battery-saving settings and reduced-motion where appropriate.

---

## 9. Data fetching, media, offline and perceived performance

### API and client state

- Respect current HTTP client, state/query library and typed API schemas. Prefer existing TanStack Query if installed; do not add a second query cache.
- Separate **server state** (profiles, matches, chats) from **ephemeral UI state** (modal open, swipe displacement, composer draft).
- Paginate discovery, conversations and chat messages with cursors. Use optimistic UX sparingly, with rollback and request idempotency.
- Show cached content when offline when safe; do not expose private data from another account after sign-out.
- Restore per-screen scroll position and avoid unnecessary full feed refetch on tab switching.

### Cloudflare R2 + images

- Maintain user R2 integration. Public profile media: optimized variant + suitable cache. Private chat media: signed/authorized retrieval, no unrestricted public bucket or persistent unbounded shared cache.
- Use `expo-image` for optimized rendering; verify `cachePolicy`, `contentFit`, `transition`, `recyclingKey` and placeholders against installed SDK.
- Use resized server-generated variants (e.g., avatar, discovery, full view) rather than downloading full-size originals to a list item.
- Placeholder / BlurHash or ThumbHash when available; predictable fallback when a signed URL expires.
- Re-check access after blocking or account changes. Never log signed URL query strings or private media URLs.
- Do not assume R2 alone is an image transformation/CDN pipeline: configure and verify how transformations and caching are actually delivered.

### Performance budgets (engineering targets, not promises)

- Responsiveness: tap acknowledgement visibly within ~100 ms in a healthy state (local feedback only).
- Lists/gestures: target 60 fps on representative mid-range devices; characterize jank under photo loads.
- No O(N) full-chat rerenders per message; profile JS rerender counts and memory.
- Measure cold/warm startup, first meaningful screen, navigation transition, image completion and crashes using real hardware/production builds.
- Cache only appropriate nonsecret data; clear per-account cached data on logout and block/private-content invalidations.

---

## 10. Mobile security and user trust UI requirements

1. Never save secret API keys in the app; Rust signs R2 uploads and validates session identity.
2. Store application-owned sensitive session material only with the existing secure auth strategy; `expo-secure-store` is an option when appropriate, not a replacement for auth-provider token management.
3. Distinguish authentication from authorization. UI hiding is not permission enforcement; server checks profile/chat access.
4. Implement block/report entry points from profile and conversation. Confirm outcome from real API; refresh UI to honor changed access.
5. Prevent double-like, double-send and accidental repeated destructive actions.
6. Never show full phone/email/precise location unless explicit consent and product need.
7. Prevent exposure through push previews where privacy preferences disallow message text; handle notification deep links with auth + access checks.
8. Photo permissions should use system pickers and clear rationale; do not request broad photo library permission without need.
9. Use meaningful empty/error states without showing stack traces or backend internals to end users.
10. Confirm privacy policy, community guidelines, moderation/abuse flows and account deletion handling before calling launch-ready.

---

## 11. SDK 58-specific engineering and migration gates

Check the **actual SDK state** as of task execution. If SDK 58 is beta, use a branch, document native compatibility and avoid an unreviewed production upgrade.

### Expo Router

- SDK 58 supports stable `expo-router/native-tabs`; prior SDK 54–57 uses `unstable-native-tabs`.
- In modern Router, verify the import surface for stack, headless UI and tabs; avoid mixing unsupported external `@react-navigation/*` imports with Router.
- If native tabs cannot meet an essential custom interaction, evaluate headless `expo-router/ui` with explicit trade-off and platform parity; do not replace native tabs simply to paint fake glass.
- Validate the system tab bar against light/dark content, sheet presentation, keyboard and badge states.

### Expo UI

- `@expo/ui` Universal supports shared native components; SwiftUI-only imports belong inside iOS-specific components; Android may use `@expo/ui/jetpack-compose` where useful.
- Every Expo UI primitive must be placed inside its appropriate `Host`; React Native Flexbox styling doesn't automatically apply to SwiftUI/Compose **inside** Host.
- Keep platform-specific trees small and intentional. Favor shared screen logic.
- iOS-specific menu glass uses supported native button style/modifier, not a handcrafted translucent view on each menu item.

### Expo Glass Effect

- `expo-glass-effect` is a native iOS 26+ enhancement; use capabilities and accessibility guards.
- No opacity hacks; no massive glass panels; no blind tint/blur overlays for content.

### iOS 27 scene and sizing

- Recheck app scene lifecycle and custom native entry point integration.
- Make layout responsive to dimension changes; test multitasking/resizable behavior rather than orientation locks.
- iOS 27 design isn't permission to invent unreleased APIs: use only documented availability.

### Native builds

- For native module changes, prefer verified **development builds** and EAS Build workflow. Expo Go is not proof of all push/native/integration scenarios.
- For notifications, distinguish Expo push tokens from device native APNs/FCM tokens, and make server delivery match the actual token type.
- For app store readiness, review entitlements, iOS privacy manifests and platform policy with current official documents.

---

## 12. Reference implementation patterns (copy only after audit)

### 12.1 Responsive spacing and readable UI

```tsx
import React from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function ResponsiveContent({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const gutter = width >= 768 ? 32 : 20;
  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: gutter,
        paddingTop: 16,
        paddingBottom: Math.max(insets.bottom, 16) + 16,
        width: '100%',
        maxWidth: 920,
        alignSelf: 'center',
      }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}
```

Do not add a second bottom safe-area padding if the actual navigator/layout already handles it. Layout ownership must be explicitly verified to prevent doubled insets.

### 12.2 Fast R2-backed profile image

```tsx
import { Image } from 'expo-image';

export function ProfilePhoto({ uri, label }: { uri: string; label: string }) {
  return (
    <Image
      source={{ uri }}
      style={{ width: '100%', aspectRatio: 4 / 5, borderRadius: 20 }}
      contentFit="cover"
      transition={180}
      accessibilityLabel={label}
    />
  );
}
```

Use server-approved URL only. For private chat media choose a deliberate cache and expiry policy; do **not** reuse public profile cache rules.

### 12.3 Accessible touch target

```tsx
import { Pressable, Text } from 'react-native';

export function LikeAction({ onPress, disabled }: {
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="ถูกใจโปรไฟล์"
      accessibilityHint="ส่งการกดถูกใจไปยังผู้ใช้นี้"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({
        minHeight: 48, minWidth: 48,
        alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: 16, borderRadius: 24,
        backgroundColor: pressed ? '#3730A3' : '#4338CA',
      })}
    >
      <Text style={{ color: 'white', fontWeight: '700' }}>ถูกใจ</Text>
    </Pressable>
  );
}
```

These examples illustrate design intent and are not a mandate to replace existing production components. Refactor to theme tokens and proper localized strings in actual implementation.

---

## 13. Automated and manual QA matrix — no exception for visuals

### Static checks

```bash
npx expo install --check
npx expo-doctor
npx tsc --noEmit
# Then run project-provided scripts, e.g. npm run lint && npm test
```

Only report checks as passed if executed and recorded. If no typecheck/lint/test script exists, propose an appropriate one without masking existing failures.

### Device/OS matrix

| Environment | Required test |
|---|---|
| iOS 26, light | Native tabs/header glass, scrolling, navigation, contrast |
| iOS 26, dark | Native glass readability, status bar, icons, header flicker |
| iOS 27, light/dark | Scene resizing, safe area, app resume, native tab changes |
| iOS older than 26 (if supported) | Opaque/fallback appearance and navigation |
| Android current + mid-range device | Material semantics, keyboard, back, notifications, performance |
| Large text / VoiceOver / TalkBack | Focus, labels, scroll, form entry, navigation, actions |
| Reduce Transparency / Reduce Motion | Solid glass fallback and essential animation-free usability |
| Slow 3G/high latency/offline | Loading, Retry, partial results, message pending and reconnect |
| Real low-memory device | Image cache limits, chat list recycling and crash-free scrolling |

### Screen state matrix

For **each screen**, verify: happy path, initial loading, empty, 401/403, 404, 429, 5xx, offline, slow response, rapid repeated tap, screen rotation/resizing, dark mode, increased font, back/deep link and restoration. For chat additionally test duplicate message delivery, reconnect recovery, ordering, media expiry, block during conversation and interrupted uploads.

### Screenshot-based review rubric (0–5 each)

Score the **actual implemented UI** (not speculative):

1. Native platform fidelity.
2. Visual hierarchy / content readability.
3. Consistency of spacing, typography and color.
4. Accessibility and interactive affordances.
5. Motion/haptics polish without distractions.
6. Performance on representative devices.
7. Correct data/error/empty states.
8. Privacy/safety controls.
9. Responsive layouts and iOS 27 scene behavior.
10. Component/API maintainability.

**Release gate:** no category under 4, no P0/P1 bugs; track score with evidence, screenshots or reproducible test results. A score alone is not proof of production quality.

---

## 14. Execution workflow for Claude (mandatory sequence)

### Phase A — audit / baseline

1. Inventory versions, routes, UI component libraries, assets, colors/fonts, current behavior and known bugs.
2. Read `CampusMate_S_Tier_Full_System_Spec_for_Claude_Opus_5_5.md` if it exists; use its existing backend API/security contracts as source of truth unless superseded by current repository code or an explicit user instruction.
3. Produce a **concise audit table**: current -> recommended -> compatibility risk -> files involved.
4. Explain SDK 58 beta/stable status as checked *today* and whether a migration is justified.
5. Create `docs/mobile-design-decisions.md` in the repo only if documentation location exists/is appropriate.

### Phase B — foundations

1. Introduce/align semantic tokens and responsive typography; light/dark/increase-contrast support.
2. Navigation layout preserving routes; native tabs and stack with iOS 26 glass behavior verified.
3. Shared core components (buttons, cards, avatar, inputs, Empty/Error/Loading) with accessibility.
4. Configure image use from R2 without leaking credentials; test authorized URLs.

### Phase C — user journeys

Implement screen by screen in this order (adjust to preexisting complete modules):

1. Welcome/login/onboarding.
2. Discover and profile detail.
3. Like/Pass and Matches.
4. Chat list and conversation.
5. Profile editing and R2 upload status.
6. Privacy/settings/report/block.

For each: audit -> component changes -> real data and navigation -> loading/error/offline -> accessibility -> platform QA -> typecheck/test -> report.

### Phase D — polish and stability

- Tune transitions/haptics, selective glass, typography/spacing, loading placeholders, adaptive backgrounds.
- Test startup, list/image/frame pacing, leaks, reconnect, keyboard, notification deep links.
- Collect QA screenshots if device/simulator tools are available; fix visual issues instead of only listing them.
- Verify no unintended backend schema/API changes and no private R2 exposure.

### Phase E — handoff

Produce in the final coding-agent answer:

```text
1. Audit findings and SDK version actually in use
2. Architecture/design decisions and any deviations from this skill
3. Changed files with concise purpose
4. Screens finished + interactions wired
5. Verification performed and its outcome (not fabricated)
6. Known limitations / manual tests / SDK beta risks
7. Next prioritized implementation steps
```

**Do not claim full completion if only designs, mocks or some screens were implemented.**

---

## 15. Definition of done — screen and release

### Single-screen DONE checklist

- [ ] Functional for real data and navigation; no dead controls.
- [ ] Native iOS 26/27 look with sensible Android variant.
- [ ] Light/dark dynamic colors and readable glass fallback.
- [ ] Correct loading/empty/error/offline/permission states.
- [ ] VoiceOver/TalkBack labels, reading order, keyboard usability and touch size.
- [ ] Dynamic text and compact/large/resizable layout verified.
- [ ] Stable, nonblocking animation and Reduce Motion.
- [ ] No leaking tokens or private images in logs/URLs/analytics.
- [ ] Types/lint/tests relevant to changes pass, or failures disclosed.
- [ ] Screenshots/device verification when tools are available; otherwise clearly marked unverified.

### Production-release DONE checklist

- [ ] SDK 58 stable/beta status and native compatibility risk reviewed.
- [ ] Authentication / R2 / API / WebSocket integration preserved and verified.
- [ ] Push token handling and deep links tested in development/release build as needed.
- [ ] Accessibility acceptance criteria verified on real devices.
- [ ] Crash/ANR/error monitoring and privacy-safe analytics configured.
- [ ] Data deletion, user block/report and safety controls reviewed.
- [ ] Performance on representative devices and slow network measured.
- [ ] No critical security or UX blockers in backlog.

---

## 15A. Apple HIG crosswalk: CampusMate screen-by-screen (mandatory)

**Audit policy:** Label each statement `[APPLE]` (official Apple link), `[EXPO]` (versioned Expo API), `[PRODUCT]` (this app's choice), or `[TARGET]` (unverified test objective). HIG is design guidance, not an Apple-certified S-tier score. Document iOS26, iOS27, Android and accessibility test status separately. The following traceability table must accompany implementation.

| Screen / concern | Apple HIG rule or intent | Expo 58 approach | Acceptance test |
|---|---|---|---|
| Discover | [APPLE](https://developer.apple.com/design/human-interface-guidelines/materials): content not glass | React Native + optimized image | Photos remain readable under native chrome; buttons accessible |
| Likes/Matches | [APPLE](https://developer.apple.com/design/human-interface-guidelines/motion): purposeful motion | native transition + optional short celebration | Reduce Motion, no gesture-only Like/Pass |
| Chats | [APPLE](https://developer.apple.com/design/human-interface-guidelines/tab-bars): tabs navigate only | `expo-router/native-tabs` | Tab label + unread badge + state preservation |
| Conversation | [APPLE](https://developer.apple.com/design/human-interface-guidelines/accessibility): readable and operable | RN list/keyboard safe areas | Thai mixed text @ 200%, VoiceOver, retry states |
| Profile/Settings | [APPLE](https://developer.apple.com/design/human-interface-guidelines/privacy): privacy control when needed | native menus/sheets or `@expo/ui` | Block/Report/delete reachable, safe confirmations |
| Search | [APPLE](https://developer.apple.com/design/human-interface-guidelines/searching): findable entry | native Search tab/field only if justified | keyboard focus and search empty/error |
| Floating controls | [APPLE](https://developer.apple.com/design/human-interface-guidelines/materials): sparing glass | guarded `expo-glass-effect` if needed | reduce transparency / light / dark |
| Safe area / resizing | [APPLE](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo): adapt to available space | `useWindowDimensions`, safe-area, native layout | compact/large/iPad/iPhone Duo if available |
| Colors/icons | [APPLE](https://developer.apple.com/design/human-interface-guidelines/color): semantic colors, restraint | native/dynamic colors, validated symbols | Dark/Increase Contrast/iOS27 visuals |
| App icon | [APPLE](https://developer.apple.com/design/human-interface-guidelines/app-icons): layered and supported variants | verify native export & Expo pipeline | previews for Default/Dark/Tinted where supported |

**iOS27-specific audit**: compare real/native iOS26 vs iOS27 Liquid Glass behavior based on [Apple WWDC26](https://developer.apple.com/videos/play/wwdc2026/269/) and the [Apple iOS27 UI Kit](https://developer.apple.com/design/resources/). Do not claim iOS27 visual fidelity by checking only an iOS26 simulator. **Expo Native Tabs caution:** FlatList scroll-edge and tab minimize behaviors have documented limitations; use [Expo native tabs](https://docs.expo.dev/router/advanced/native-tabs/) guidance before choosing custom workarounds.

**Handoff format**: for each route include `[APPLE] official source`, `[EXPO] current API`, `change`, `accessibility check`, `iOS26 verified?`, `iOS27 verified?`, `Android verified?`, `NOT TESTED reason`, `remaining blockers`. No unverified PASS.

---

## 16. Canonical prompt to invoke this skill

> **Use `campusmate-ios26-27-expo58` and `campusmate-android-material3-expo58` where their platforms apply.** Inspect this existing CampusMate React Native repository, verify Expo SDK 58 compatibility/status, preserve the Rust API, Neon PostgreSQL, Cloudflare R2 and current authentication. Follow official **Apple HIG and iOS 27 UI Kit/WWDC26** as design authority, document HIG-to-Expo traceability for each screen, and design and implement a premium native-feeling iOS 26–27 experience using Expo Router Native Tabs, Apple HIG/Liquid Glass only where appropriate, semantic design tokens, responsive/dynamic typography, polished Discover/Matching/Chat/Profile flows and Android-native adaptations. Apply accessibility, security, performance and QA acceptance criteria in this skill. Work incrementally on real files and show exactly what was implemented and tested. Never fabricate APIs, screenshots or test outcomes.

---

## 17. External reference and update policy

At execution, check official documentation above. If this file conflicts with **current Expo SDK 58 versioned docs, installed TypeScript definitions, Apple's current HIG, actual project configuration, or explicit instructions from the user**, favor the verified source and document the deviation. The dated SDK 58 beta caveat must be refreshed when a stable release is confirmed.

This Skill governs **mobile UI and experience engineering**; it does not supersede backend security, chat reliability or database contracts defined in the architecture document.


---

# PART II — ANDROID MATERIAL 3 EXPRESSIVE / GOOGLE OFFICIAL

This part supplements, not replaces, the iOS Apple HIG skill above. Preserve shared React Native business logic and platform-appropriate native experiences.

# Official Android Source of Truth — CampusMate (Material 3 Expressive × Expo SDK 58)

**Snapshot:** 2026-10-12. **Authority:** Android Developers / Material Design official documentation for UX and OS behavior, Expo SDK 58 versioned documentation + installed TypeScript types for RN implementation, the real repository for availability. Links are live references; revalidate at execution time.

> This is a design-and-implementation guide for **React Native**, not instructions to rewrite CampusMate in Kotlin. When a source uses Jetpack Compose Kotlin, apply the **design principles** using RN or verified `@expo/ui/jetpack-compose` bindings. Never paste native-Kotlin-only APIs into TypeScript.

## 1. Official references and evidence hierarchy

| ID | Canonical source | Required reading when |
|---|---|---|
| G-M3 | [Android Developers: Material Design 3 in Compose](https://developer.android.com/develop/ui/compose/designsystems/material3) | Material You / M3 Expressive, typography, shapes, components, motion |
| G-LAYOUT | [Android mobile layout & navigation patterns](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns) | App bars, nav bars/rails, actions, destinations |
| G-COLOR | [Android mobile color](https://developer.android.com/design/ui/mobile/guides/styles/color) | Material color roles, light/dark, dynamic color + static fallback |
| G-A11Y | [Android design accessibility](https://developer.android.com/design/ui/mobile/guides/foundations/accessibility) | 48dp targets, TalkBack, Switch Access, Voice Access, gesture alternatives |
| G-EDGE | [Edge-to-edge in Android Views](https://developer.android.com/develop/ui/views/layout/edge-to-edge) | Insets, status/nav bars, Android 15 target 35 behavior |
| G-WIN | [Android window size classes](https://developer.android.com/develop/adaptive-apps/guides/use-window-size-classes) | Compact, medium, expanded widths & dynamic resizing |
| G-SIZE | [Support different display sizes](https://developer.android.com/develop/adaptive-apps/guides/support-different-display-sizes) | Tablet/foldable/multiwindow, large screen policies |
| G-FOLD | [Make your app fold-aware](https://developer.android.com/develop/adaptive-apps/guides/foldables/make-your-app-fold-aware) | Hinges, postures, content occlusion |
| G-CANON | [Canonical layouts](https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts) | Chat list/detail on wide screens |
| G-BACK | [Custom back / predictive back](https://developer.android.com/guide/navigation/custom-back) | System Back handling and gestures |
| E-SDK | [Expo SDK 58 docs](https://docs.expo.dev/versions/v58.0.0/) | Verify installed versions & release status |
| E-TABS | [Expo Router native tabs](https://docs.expo.dev/router/advanced/native-tabs/) | Android NativeTabs, md icons, keyboard & inset behaviors |
| E-COMPOSE | [Expo UI Jetpack Compose](https://docs.expo.dev/versions/v58.0.0/sdk/ui/jetpack-compose/) | Verified native controls, Host component |
| E-UNIVERSAL | [Expo UI universal](https://docs.expo.dev/versions/v58.0.0/sdk/ui/universal/) | Shared native-feeling components |
| E-NAVBAR | [Expo navigation bar](https://docs.expo.dev/versions/v58.0.0/sdk/navigation-bar/) | Native system navigation bar constraints |
| E-IMAGE | [Expo Image](https://docs.expo.dev/versions/v58.0.0/sdk/image/) | R2 images, cache/placeholder/recycling key |
| E-NOTIF | [Expo Notifications](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/) | Android notification channels and permissions |
| E-SPLASH | [Expo Splash Screen](https://docs.expo.dev/versions/v58.0.0/sdk/splash-screen/) | Android splash screen release build testing |

**Traceability convention:** `[GOOGLE:G-ID] rule → [EXPO:E-ID] supported API → [CODE] file/path → [TEST] pass/fail/not-run`. Do not call a project decision an Android policy. When a native platform API is unsupported in RN, document a fallback; do not fabricate an Expo export.

## 2. Material 3 Expressive: Google-first, not iOS imitation

1. **Android native shell** uses Material 3 navigation, familiar Android back behaviors, dynamic colors, readable tonal surfaces, typography and meaningful animations. No Liquid Glass imitation as the default Android surface.
2. **Brand + Material You:** CampusMate's product accent is preserved using semantic `primary`, `onPrimary`, `primaryContainer`, `onPrimaryContainer`, `secondary`, `tertiary`, `surface`, `surfaceContainer*`, `onSurface`, `outline`, `error`, `onError`. Actual RN theme token mapping is product-defined. Support user wallpaper dynamic color **when the installed library/native capability explicitly supports it**, with a manually designed static light/dark fallback. Dynamic color is an opt-in product policy, not a guaranteed Expo API.
3. **Expressive without clutter:** Clear hierarchy, generous target sizes, intentional rounded shapes, bold-but-readable headings, subtle state feedback and purposeful motion. Avoid random gradients, bounce on every tap or an oversized FAB without a primary action.
4. **System fonts / scalable type:** Prefer Android system typography and scalable text; test 1.0×, 1.5× and maximum supported font scale. Thai and English mixed line breaks/diacritics must not clip. Never force `allowFontScaling={false}` for ordinary app text.
5. **States:** Pressed/focused/selected/disabled/loading/error/success should be visually and semantically distinguishable. Never use color as the only signal.
6. **Motion:** Action-confirming transitions, consistent easing, ripple/state layers via native controls where supported, preference-sensitive reduced motion, no unnecessary heavy JS-thread work.
7. **Icons:** Use Material Symbols/Android equivalents rather than SF Symbols on Android. `NativeTabs.Trigger.Icon md` (SDK 58 documented) is the preferred native tab representation. Check exact icon names against installed packages/docs.

## 3. Navigation rules

- 3–5 peer top-level destinations → **bottom navigation bar on compact**; e.g. Discover, Likes/Matches, Chats, Profile. Keep navigation destination labels legible.
- **Adaptive nav:** medium/expanded windows can use a navigation rail, where implementation and product density warrant; do not stretch a bottom bar across an expanded desktop/tablet window. If Expo native tabs do not expose the rail you require, evaluate a dedicated wider-layout navigation variant with verified Expo Router APIs; keep consistent route IDs, state and deep links.
- Top app bar actions are secondary. Optional one FAB only for a genuinely prominent action (e.g. New Chat), not as duplicate Like/Pass/Back.
- Nested tabbed filter categories are distinct from global destinations; avoid stacked sets of tabs without hierarchy.
- Back is **system-first**: back from conversation → chat list; from detail → discover; from modal → dismiss (unless unsaved changes need clear confirmation). At top level do not surprise-exit on a tab change.
- Predictive Back: verify host navigation library + Android version + gesture integration before claiming animation support. Do not globally intercept back and break OS affordances. Test both gesture navigation and 3-button navigation.
- `expo-router/native-tabs` on SDK 58 documents Android Material icon `md`, `tabBarRespectsIMEInsets` and Android safe area policy; read versioned types before copying examples. Beware Android bottom inset handled automatically by native tabs, but top/side insets typically need own handling. Avoid double bottom padding.

## 4. Edge-to-edge and insets — release blocker

- **Google OS rule:** Android 15+ with apps targeting SDK 35+ enforces edge-to-edge. The app draws behind system bars, so content and **interactive elements** must use proper insets. Source: G-EDGE.
- Do not fake status bar padding using hardcoded `24`, `48`, etc. Use `react-native-safe-area-context` and the current navigator insets; avoid double application with native tabs/sheets.
- Handle 3-button nav scrim, transparent/translucent system bars, gesture navigation contrast, camera cutouts, curved corners, landscape and split-screen.
- Chat composer stays above IME and navigation bar; no hidden send button. On Expo Router native tabs, verify Android `tabBarRespectsIMEInsets` plus `android.softwareKeyboardLayoutMode` (`resize` as SDK docs recommend) against actual SDK/types.
- Scrim/contrast behavior is native-system-dependent. Do not repeatedly force status/navigation bar colors in ways that break Android edge-to-edge.

## 5. Adaptive screens: available window space, not `isTablet`

The **Google window-class** width guidelines are: compact `<600dp`, medium `600–839dp`, expanded `840–1199dp`, large `1200–1599dp`, extra-large `>=1600dp`. These are Android guidance breakpoints, **not an automatic React Native framework feature**. If implementing with `useWindowDimensions().width` use RN logical pixels (dp-like density-independent units) to derive a project layout policy; account for actual insets, fold/hinge, split-screen and orientation.

| Width situation | CampusMate design goal |
|---|---|
| Compact | One-column cards, 4-item bottom navigation, full-screen conversations |
| Medium | Wider content gutters or split list/detail where practical; nav rail if appropriate |
| Expanded | Two-pane chat list/detail; optional Discover list + profile detail side by side |
| Folded/unfolded | Reflow when viewport changes, preserve draft / scroll / selected chat; no content hidden behind hinges |
| Compact height | Hide/de-emphasize less essential chrome, preserve composer, controls and read focus |

For a hinge-specific layout **do not claim `useWindowDimensions` reveals the hinge bounds**. If the feature is needed, use a validated native WindowManager module or safe fallback that never places essential buttons over the possible hinge. Android 16 targeting API 36 changes large-screen orientation/resizability requirements; verify Android Developers + app target SDK and test, rather than hardcoding portrait-only assumptions.

## 6. Android accessibility — non-negotiable

- **48 × 48 dp effective touch targets minimum**, even if visual icons are smaller; adequate spacing to avoid overlaps. Compare iOS target >=44 pt separately.
- TalkBack must announce meaningful names, roles, selected state and unread counts. Decorative illustrations must be hidden from accessibility tree; meaningful photos need descriptive labels only when they convey information.
- Keyboard, Switch Access, Voice Access, external keyboard, large font, font weight and high-contrast settings must allow complete workflows.
- Give visible Like/Pass buttons as alternatives to swipes; long-press actions need an ordinary reachable menu; no gesture-only block/report controls.
- Adjust Material theme roles for light/dark and contrast; test with accessibility services. WCAG 2.2 AA contrast is a project accessibility acceptance criterion; distinguish it from a platform-specific guarantee.
- Screen reader focus after dismissing modals, opening conversation and filtering results. Never auto-read private incoming messages unexpectedly.
- Reduced-motion settings respected when detectable; where no reliable app API is available avoid excessive motion anyway.

## 7. Native control selection

**Order of preference (after repo audit):**
1. Existing tested Expo Router/RN component for cross-platform content and existing state management.
2. `@expo/ui` **universal** for shared native-looking controls if installed version exposes required component and semantics.
3. `@expo/ui/jetpack-compose` for *Android-specific* controls where user benefit is clear (chips/search/modal/switch) and confirmed; wrap Compose elements in documented `Host`.
4. Custom RN components when required by product and can be fully accessible; avoid pretending they are native M3 controls.
5. Native Android module **only if** strictly needed and user has approved native build impact. Check Expo Go vs Dev Build; custom modules require development build.

**Don't:** `@expo/ui/swift-ui` in Android module, copied SF Symbols, iOS-only blur on cards, raw HTML/CSS masquerading as native UI, or invented Expo hooks.

## 8. Screen checklist: Discover / Matches / Chats / Profile

### Discover
- Comfortable photo-first cards, protected text overlays, semantic chip/filter controls, clear actions (Like/Pass/View Profile) and loading/error/empty states.
- Material filter chips may use Compose if verified; no user profile data from unauthorized R2 image URLs.
- Optimistic likes must rollback on Rust authorization/conflict errors; prevent duplicate swipes. Announce changes via screen reader appropriately.
- Animated card transitions maintain stable focus and do not bury Back or tabs.

### Matches / Likes
- Strong separation between new likes vs mutual matches; consistent avatars (small R2 thumbnails), no fake urgency or fabricated popularity badges.
- Tap targets 48dp; unread/badge label readable by TalkBack; easy path to Unmatch, Block and Report.

### Conversation list
- Efficient list recycling and caching, safe preview privacy, unread count semantics, timestamp localization, empty/error/offline states.
- Medium/expanded layout should support list/detail where viable; preserve active chat on resizing.

### Conversation detail
- Bubbles must remain **opaque and readable**, not translucent glass. Distinguish sender/receiver without relying solely on color.
- Composer follows IME and safe area; multi-line text, attachment picker, send enabled/disabled state, retry. Large font must not overlap.
- Messages reflect real ACKs from Rust; optimistic pending/sent/read states with client IDs; reconnect and cursored catch-up are existing backend contracts.
- Preserve scroll on pagination, app background/foreground transitions and multiwindow resize. No signed R2 media URL printed to logs.
- Profile, block/report and chat exit remain reachable with system Back.

### Profile / Edit / Settings
- Material grouped settings and switches with actual state; descriptive headings; concise text; secure media flow R2 presign → upload → verified completion.
- Use native confirmation sheet/dialog where supported for destructive actions; preserve account deletion/export and report/block.
- Do not request contacts/precise location/notifications at app launch unless genuinely necessary; just-in-time explanation.

## 9. Android platform integration

### Notifications and FCM
- If app uses Firebase FCM, preserve that. Decide explicitly **Expo Push Service vs direct FCM** (not both by accident); device push token differs from Expo push token.
- Android 8+ notification channels; Android 13+ runtime notification permission behavior. Create channel **before** requesting push token on Android 13 according to E-NOTIF.
- `expo-notifications` remote push on Android requires a **development build** (not Expo Go) starting SDK 53; do not claim testing via Expo Go.
- Categories: `messages`, `matches`, `social`, with user-facing names, sensible importance, privacy-safe content. Open notification into an authorized route; Rust rechecks permission. Honor notification opt-out.

### Images / R2
- Display Cloudflare R2 image variants with `expo-image`: `cachePolicy`, `placeholder` (BlurHash/ThumbHash), `recyclingKey` for rapidly recycled lists where appropriate, and bounded prefetch.
- Profiles/public images can be cached per visibility policy. **Private chat attachments** require authorization and carefully scoped caching; never log signed GET URLs; clean up after account switch where required.
- Avoid large full-resolution images on scrolling Discover or Match grids. Optimize JPG/WebP/AVIF based on tested device and provider encoding pipeline.

### Authentication / privacy
- Android biometrics/credential provider can be enhancement **only if** existing auth architecture uses/approves it; keep current Firebase Auth or existing provider unchanged.
- Never ship client secret/R2 access key; `EXPO_PUBLIC_` env values are public. Android screenshots/recents previews of private conversations should be reviewed as a *product privacy decision*, not universally disabled without tradeoff discussion.
- Android runtime permissions requested at the moment of need, with sensible denial and retry UI. Manifest permissions reviewed for Play Store compliance.

### Android app icon/splash/deep links
- Adaptive launcher icon supports foreground/background/monochrome only where verified in installed Expo config. Do not stretch iOS app icon as Android adaptive asset.
- Verify Android 12+ system splash in a **release build**, as Expo Go/dev builds may not be accurate (E-SPLASH).
- Verify Android App Links and return-to-chat routing; untrusted deep-link parameters must not bypass server auth.

## 10. QA gate per Android version / form factor

| Surface | Must verify |
|---|---|
| Android 13 (API 33) | Notification permission, channel registration, back, large fonts |
| Android 14 (API 34) | Background/foreground events, keyboard, dynamic color and dark theme |
| Android 15 (API 35) | Edge-to-edge inset correctness on target35+, gesture and 3-button nav |
| Android 16 (API 36) | Large-screen resizing/fold/unfold; orientation assumptions; latest target policy |
| Android 17 / API 37 where available | Verify SDK compatibility/OS behavior from current Android docs; do **not** invent Android 17-specific UI features |
| Small Android / budget phone | Dense layout, font scale, low RAM, slow image/network |
| Tablet 600–839dp window | Medium layout, content gutters/navigation strategy |
| Tablet >=840dp window | List-detail, rail vs bottom nav, keyboard/mouse |
| Foldable | Fold/hinge, preserving draft and navigation state |
| TalkBack / Switch Access | Like/Pass/Chat/Block/Report/Delete can be completed |
| 3-button & gestures | System Back, IME/nav bars and no overlapped composer |

**Before claiming Android compliance:** test actual/emulated release or dev build and list device image/API, navigation mode, font scale, theme, locale, steps, screenshots/logs if produced. `NOT TESTED` is mandatory if absent.

## 11. Verified Expo SDK 58 example patterns (audit before use)

### Material native tabs (SDK58 documented compound API)

```tsx
import { NativeTabs } from 'expo-router/native-tabs';

export default function Layout() {
  return (
    <NativeTabs tabBarRespectsIMEInsets>
      <NativeTabs.Trigger name="discover">
        <NativeTabs.Trigger.Label>Discover</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="safari" md="explore" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="matches">
        <NativeTabs.Trigger.Label>Matches</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="heart" md="favorite" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chats">
        <NativeTabs.Trigger.Label>Chats</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="message" md="chat" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person" md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

> Before adoption: confirm routes actually exist; the icon IDs compile; Android 11+, `android.softwareKeyboardLayoutMode: "resize"`, and whether NativeTabs are already in use. For a platform-specific Android layout, use `*.android.tsx` if a verified app routing strategy permits it; never duplicate route definitions that break deep linking.

### Native Android control (verified `Host` boundary)

```tsx
import { Host, Button } from '@expo/ui/jetpack-compose';

export function AndroidAction() {
  return (
    <Host matchContents>
      <Button onClick={() => { /* invoke actual app action */ }}>Save</Button>
    </Host>
  );
}
```

> The installed `Button` prop/children signature may evolve. Verify SDK58 TS declarations; use existing tested UI if different.

### Responsive width policy (project implementation, not Android SDK API)

```tsx
import { useWindowDimensions } from 'react-native';

export function useCampusMateLayoutMode() {
  const { width, height } = useWindowDimensions();
  const widthClass = width < 600 ? 'compact' : width < 840 ? 'medium' : 'expanded';
  return { widthClass, isShort: height < 480 } as const;
}
```

> Android window-size-class breakpoints are applied as a project policy to RN dimensions. For fold/hinge-aware placement, add verified posture information separately; do not assume this hook detects hinge bounds.

## 12. Android deliverable / source audit template

```md
### Screen: [route]
- [GOOGLE:G-M3/G-LAYOUT/G-A11Y] Relevant rule + official link
- [EXPO:E-TABS/E-COMPOSE/E-IMAGE] Actual SDK58 API + version installed
- [CODE] Files changed and UX behavior
- [TEST] Android 13/14/15/16 (17 if available), gestures/3-button, keyboard, dark/dynamic color, TalkBack, small/large/foldable, Thai+English
- [RESULT] PASS / FAIL / NOT TESTED (evidence)
- [RISK] Permissions, R2 privacy, routes, state migration, remaining issues
```

**Definition of done:** no clipped content/IME overlap, complete keyboard/back access, 48dp targets, TalkBack functional, images and chat states truthful, Android native feel independent of iOS glass, and a verifiable test matrix. Passing TypeScript alone is insufficient.


---

# CampusMate — Android Screen & Interaction Specifications

Read `android-google-material3-source-of-truth.md` before implementing any Android screen. Preserve backend API/R2/auth while improving platform UI.

## Interaction principles

- On Android use Material 3 Expressive visual semantics, native system Back, appropriate tonal surfaces and static/dynamic light/dark color. Do NOT port iOS Liquid Glass appearance mechanically.
- No auto-swipe-only actions, no hidden destructive actions. Ensure 48dp effective hit areas and TalkBack labels.
- Source-of-truth for profiles, matches, chats and permissions remains Rust/PostgreSQL; Android is a client, never a trust boundary.

## Per-screen blueprints

| Screen | Main Android pattern | States & accessibility | Responsive behavior |
|---|---|---|---|
| Welcome/Onboarding | Material headings/buttons, explicit permissions later | loading, network error, skip/save progress, TalkBack order | compact vertical; larger screens centered constrained reading column |
| Sign in | Native fields/buttons, autofill behavior | credential errors, keyboard/screen reader, account switching | readable single column, no unnecessary stretched fields |
| Discover | Profile card, Material filter chips, strong Like/Pass actions | empty, offline, loading, disabled, blocked, accessible swipe alternative | 1-col compact; profile preview/details at wider widths |
| Matches | Avatar grid/list, important status badges | match vs like vs pending; large labels | 2+ columns based on width, never arbitrary physical-device type |
| Chats list | Material list rows, unread semantics, action overflow | cached/offline/error; accurate preview and count | one-pane compact; list-detail on expanded |
| Chat detail | High contrast bubbles; standard top app bar; composer | pending/ack/read/retry, multiline/IME, private media, blocked/unmatched | full-page compact; detail pane on expanded |
| Profile | Tonal grouped sections, media upload status | photo fail/retry, editable fields, privacy | content max-width on large screens |
| Settings | Material toggles/settings groups, safe destructive actions | explicit privacy/notifications/delete/report; a11y focus | sensible settings reading width |

## Anti-patterns to reject

1. SF Symbols/Apple-specific glass on Android tab/navigation components.
2. Transparent chat bubbles over busy photos, unreadable type, 44dp Android targets instead of the Android 48dp recommendation.
3. Hardcoded status/nav/keyboard bar spacers or custom back handlers that override gestures.
4. Bottom tab navigation stretched on very wide layouts without considering rail/list-detail.
5. `isTablet` checks instead of viewport width, stale dimensions on fold/unfold.
6. Fake read/delivered states; lost conversation scroll when keyboard appears.
7. Public R2 URL for private photos or exposing presigned keys/logs.
8. Push requests before a user-meaningful context; using Expo Go to certify Android remote push.
9. Claiming "Material 3 Expressive" only because corners are rounded; it must show hierarchy, interaction feedback, appropriate surfaces, motion and accessibility.

## Deliverable format

For EACH changed Android screen report: route, source Google reference, Expo API, file, screenshot/test evidence (if available), 48dp touch check, TalkBack labels, dark/light contrast, font scaling, system back, keyboard, insets, R2 media safety, offline/error states, and validation status.


---

# Android × Expo SDK 58 — Implementation & Test Runbook

## A. Audit existing project first

```bash
cat package.json
npx expo --version
npx expo install --check
npx expo-doctor
npx tsc --noEmit
```

Read `app.json`/`app.config.ts`, `eas.json`, installed `expo-router`, app routing, `android` folder (if prebuilt), `minSdkVersion`/`targetSdkVersion`, `android.softwareKeyboardLayoutMode`, edge-to-edge settings, `react-native-safe-area-context`, auth/R2 modules, notifications provider, app links and icons. Honor lockfile. Do not assume SDK 58 stable; check the release status as of execution date.

## B. Component policy

- Existing cross-platform RN components where proven.
- Use `expo-router/native-tabs` for native tabs if the app already uses it or migration passes review; verify actual Android `md` icon props and behavior.
- `@expo/ui` universal/jetpack-compose for well-scoped native controls, with documented `Host`, after checking compatibility and installed type signatures.
- Platform files: `Component.android.tsx` versus `Component.ios.tsx` only for native-specific behavior. The same data hook and backend contract feed both.
- Do not replace every RN component with Compose or make duplicate business logic per platform.

## C. Theme tokens

Implement platform-adapted tokens, never copy Apple RGB semantics directly:

```ts
export type SemanticColor =
  | 'background' | 'surface' | 'surfaceContainer' | 'onSurface'
  | 'primary' | 'onPrimary' | 'primaryContainer' | 'onPrimaryContainer'
  | 'secondary' | 'onSecondary' | 'outline' | 'error' | 'onError';
```

Design static light and dark palettes first; optional Android 12+ dynamic colors only if verified native/Expo interface exists. Test contrast. Typography responds to system font scaling.

## D. Edge to edge

- Android 15 target35+ edge-to-edge is mandatory. Inspect actual insets while nav tab and modal presentation are active.
- With native tabs, bottom inset may already be consumed. Do not use `paddingBottom: insets.bottom` everywhere.
- Use `useSafeAreaInsets()` where *not* handled by navigation. Evaluate both gesture and 3-button navigation.
- Chat: inspect keyboard on focus with Android IME resize and native tab `tabBarRespectsIMEInsets` only if supported; keep send + attachment visible.
- Contrast of system status/nav icons must remain valid against dynamically changing backgrounds.

## E. Adaptive

- Base compact/medium/expanded policy on available width. Adjust at runtime on rotation, split-screen, foldable resize.
- For chat wide screen list-detail, route selection and draft state must persist when changing classes.
- Verify fold hinge separately; `useWindowDimensions()` alone is not fold geometry.
- Optional hardware keyboard/mouse support where target audience requires it.

## F. Push and media

- Create Android channels first; Android 13 permission after meaningful explanation; push is optional.
- FCM token handling rotates; handle invalid tokens and notification deep links. Expo Go does not support remote push on Android in SDK 58; use development/release build.
- R2: authorized public thumbnails cached; private chat signed GET access restricted and cache lifecycle reviewed. Use `expo-image` source cache and `recyclingKey` for reused list cells.

## G. Safety

- Block/unmatch server side immediately revokes chat eligibility, even when app remains connected.
- Report and moderation entries clearly reachable. Don't expose precise location in Discovery without explicit product permission.
- Review logging, tokens, screenshots/recents privacy tradeoff, permissions and Data Safety disclosure.

## H. Tests & release gates

| Gate | Command / validation | Exit criteria |
|---|---|---|
| Dependency integrity | `npx expo install --check`, `npx expo-doctor` | no unresolved supported package mismatch |
| Types | `npx tsc --noEmit` | pass |
| Lint and unit tests | repo's configured scripts | pass or explicit known blockers |
| Android development build | EAS or repo-native build | launch, permissions, navigation, notifications where testable |
| Android release build | Play-compatible test build | splash, adaptive icon, performance, permissions |
| Android UI | device/emulator matrix | no IME overlap, safe areas, 48dp touches, gestures, dark/light, TalkBack |
| State/Realtime | mocked + integration test with authorized API | no duplication/lost drafts; reconnection handles missed chat |
| Fold/adaptive | resize/rotate/unfold test | route + draft retained, no hinge obstruction |
| Privacy/Media | R2 private/public policy checks | unauthorized download denied, no credential logging |

## I. Work phases

1. Audit and produce risks + feature/compatibility matrix.
2. Define shared product tokens and Android Material token mapping; preserve iOS HIG branch.
3. Fix shell/navigation, inset/IME and system-back behavior.
4. Upgrade Discover / Matches UI with working state and a11y.
5. Upgrade chat/list and offline/reconnect behavior with actual backend hooks.
6. Profile/media/settings, notification channels/deep links, permissions.
7. Cross-platform/per-device testing, visual regression, performance and release checklist.

## J. Mandatory handoff

```md
### Android work summary
- Google official rule: [link + relevant section]
- Expo SDK 58 API verified: [link + installed package/type]
- Files changed: ...
- Platform-specific behavior: Android ... / iOS preserved ...
- Verification: TS [pass/fail/not run]; Android Dev Build [...]; Android Release Build [...]; TalkBack [...]; Gesture+3-button [...]; IME [...]; Tablet/fold [...]
- Security / permissions / R2 outcomes: ...
- Gaps / blocked by unavailable emulator, account or credentials: ...
- Next safe step: ...
```


---

# Android dedicated Claude Code Skill

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

---

# CampusMate Face Verification — Cross-Platform Security Skill (Added 2026-10-12)

This extension applies to **both iOS 26–27 Apple HIG** and **Android Material 3 Expressive** design work when identity/photo verification screens are touched. Existing **Amazon Rekognition Face Liveness + CompareFaces** is confirmed. The verification badge MUST be decided exclusively by authenticated Rust endpoints after AWS server-side result retrieval and R2 pinned-photo matching. The mobile UI only starts/ends the capture flow; it never chooses `VERIFIED`.

- Design platform-native **consent, photosensitivity warning, camera instructions, permission states, loading, retry, denied/expired/appeal and accessible alternatives**. Never disguise a failed scan as success.
- **iOS:** Apple HIG, SwiftUI native liveness integration via Expo Modules (if necessary), VoiceOver, 44pt targets and Dynamic Type; Face ID device unlock is distinct from profile/photo verification.
- **Android:** Google Material 3, Android/Jetpack Compose native AWS liveness integration (if necessary), TalkBack, 48dp targets, Edge-to-Edge, Back and permission handling.
- Verify **Expo 58/native SDK version compatibility** in installed lockfile/Development Builds; do not assume web React liveness component is usable on React Native. Do not assume community wrappers support Expo 58.
- **Never put persistent AWS keys in app**, public R2 biometrics, raw similarity scores in analytics/logs, or Face ID results into account-authorization claims.
- Consult the standalone `.claude/skills/campusmate-face-verification-rekognition/SKILL.md` and its `references/verification-blueprint.md` when building any verification-related feature.

## Complete Rekognition Face Verification Implementation Blueprint

# CampusMate — S-Tier Face & Profile Verification Blueprint

**Version:** 1.1 (integrated; opaque AWS session ID) • **Date:** 2026-10-12 • **Implementation target:** Claude Code / engineering team  
**Current context:** React Native + Expo SDK 58, Rust + Axum + Tokio + SQLx on Fly.io (Singapore), Neon PostgreSQL, Cloudflare R2, Amazon Rekognition Face Liveness + CompareFaces.  
**Scope:** Design and audit specification; **not** a source-code audit or a claim that production security has been validated.

## 0. Engineering mission and non-negotiables

Upgrade the existing CampusMate face verification without rewriting established mobile, authentication, image-storage or backend functionality. Inspect the current repository and cloud configuration before editing. The server alone decides verified status. Never treat a native UI callback, uploaded selfie, mobile-supplied confidence, or `verified: true` flag as proof. Face Liveness + CompareFaces proves a live session resembles an approved face image; it does **not** establish legal name, date of birth, student affiliation, or government identity. Keep `photo_verified`, `university_verified`, and `account_verified` semantically separate.

**Do not** save AWS root/IAM access keys in React Native, expose raw similarity scores to clients, make biometric media public, log selfie bytes, or assume a Cloudflare R2 object reference is an Amazon S3 `S3Object` accepted by Rekognition. Avoid facial search collections unless separately justified and reviewed. Authentication and verification must remain separate: a photo verification badge does not grant account access.

## 1. Final target architecture

```text
React Native / Expo 58 (iOS & Android)
  ├── Current login provider (preserve)
  ├── Consent + accessibility + camera instructions
  ├── Native Face Liveness SDK bridge [SwiftUI / Jetpack Compose]
  │    └── AWS Rekognition StartFaceLivenessSession (signed client stream)
  └── HTTPS → Rust Axum on Fly.io Singapore
              ├── Auth middleware → current provider JWT verification
              ├── Verification session ownership, throttling, risk controls
              ├── AWS SDK: CreateFaceLivenessSession
              ├── AWS SDK: GetFaceLivenessSessionResults
              ├── R2 SDK: fetch immutable approved reference image as bytes
              ├── AWS SDK: CompareFaces (image bytes, not R2 S3Object)
              ├── Decision engine: versioned thresholds, review policy
              └── Neon PostgreSQL:
                    verification_attempts + photo_verifications + audit_events
Cloudflare R2: approved profile image and app media (separate private boundaries)
AWS S3 (optional): temporary service output **only if needed**, same AWS Region
```

Start with one Rust identity verification module, not a separate microservice. Do not use Redis as the source of truth for verification or allow background jobs to outlive the AWS liveness session lifetime. Consider AWS Rekognition Thailand (`ap-southeast-7`) as a candidate after measuring end-to-end speed and checking every desired API/SDK operation in the target region. AWS documents Face Liveness in Thailand; Singapore is not in the current Face Liveness support list.

## 2. Correct end-to-end verification sequence

1. Logged-in user sees verification purpose, risks, camera notice, consent, accessibility alternatives, and any photosensitivity warning; record consent version/time before processing.
2. Backend identifies the authenticated user and approved **immutable** profile media ID; revalidates ownership, moderation status, acceptable photo quality and privacy classification. Generate a unique image object key and content hash for approved snapshot; reject any client-selected arbitrary URL.
3. `POST /v1/identity/photo-verifications` under JWT, per-user/device/IP rate limiting and concurrency guard. Backend inserts a `CREATING` attempt record, calls AWS `CreateFaceLivenessSession`, then stores AWS session ID (unique), user ID, photo asset ID/hash, AWS Region, expiry, policy version and `CREATED` state. Do not leave an active attempt without cleanup/reconciliation.
4. Client receives only `{verificationId, sessionId, region, expiresAt, state}` plus the **required narrowly scoped AWS authorization mechanism** for streaming. `StartFaceLivenessSession` is done by the official native AWS component, not a homemade selfie upload. Client AWS credentials, if any, must be temporary and least privileged: only the liveness streaming operation; **never** `CompareFaces`, `CreateFaceLivenessSession`, `GetFaceLivenessSessionResults`, or general R2/S3 access. Use AWS Cognito Identity Pool or a rigorously controlled custom temporary credentials provider. Review its IAM policies and session-binding risks.
5. Native component prompts user through the challenge; the client callback only says the stream step ended. It is not an authoritative success verdict.
6. Immediately call `POST /v1/identity/photo-verifications/{verificationId}/complete` (authenticated). Rust checks user ownership and transitions atomically `CREATED/IN_PROGRESS → PROCESSING` to prevent duplicate evaluation.
7. Rust calls `GetFaceLivenessSessionResults(awsSessionId)` **itself** while the AWS result is still available. Require `Status = SUCCEEDED`, an acceptable liveness confidence under the current calibrated risk policy, and a valid returned `ReferenceImage`. Handle missing image as retry/indeterminate rather than verified.
8. Rust retrieves the pinned photo bytes from the private R2 object associated with the attempt; check its stored digest, media type, size, single-face policy and immutability; compare AWS liveness reference image to that image via `CompareFaces` `Bytes` inputs. Rekognition can also accept **Amazon S3** objects; a Cloudflare R2 key is **not** an Amazon S3 bucket for the `S3Object` field. AWS image byte inputs are limited to 5 MB; implement a safe image-transcoding path before compare when necessary.
9. Evaluate **liveness and similarity independently** and use a three-outcome decision policy: `VERIFIED`, `REVIEW_REQUIRED`, or `FAILED/RETRY_ALLOWED`. Never equate AWS confidence 95 with a mathematically guaranteed 95% identity probability. Version and calibrate thresholds using representative consented test pairs and measure false accepts/rejects; give humans a review path for ambiguous cases.
10. Save final outcome with a conditional DB update; commit verification proof linked to the **exact approved photo ID and SHA-256**. Do not expose raw confidence, face vectors or AWS reference image to the mobile client. Reply with `{status, badge, verifiedAt}` or safe retry instructions, not raw scores.
11. Failed/incomplete/expired attempts remain non-verified. A recovery job may reconcile attempts promptly but must never infer a pass from client evidence or retry calls after AWS results expire. User can retry via a **new session**, with abuse throttling.
12. Changing or deleting the approved reference photo makes the **photo verification badge invalid**, unless a defined re-verification flow approves the new photo. Do not revoke unrelated university or email verification states.

**Timing:** AWS states the `SessionId` expires three minutes after being sent, and session data becomes unavailable. Create the AWS session only when the camera flow is ready. Invoke `GetFaceLivenessSessionResults` immediately following native completion; never put this lookup behind a long asynchronous queue. Enforce a safety margin when showing `expiresAt`; failures require a new session.

## 3. Robust state machine

```text
CREATING → CREATED → IN_PROGRESS → PROCESSING
  ├── VERIFIED       (valid liveness + face match + policy)
  ├── REVIEW_REQUIRED (ambiguous/quality needs manual review)
  ├── FAILED         (valid completed session but insufficient proof)
  └── EXPIRED        (session or result no longer available)

VERIFIED → REVOKED   (user request, badge policy change, verified photo changed,
                      confirmed abuse, moderation/admin review)
```

A terminal result may only be created once. An **idempotent** retry of `complete` on the same valid attempt returns the saved terminal decision rather than performing another comparison. Transition with SQL `UPDATE ... WHERE state IN (...) RETURNING id` or row locks. Never hold an SQL transaction open during an external AWS network call. Use bounded processing, retry classification and crash recovery. Session IDs may be seen by the client: ownership is guaranteed by the backend's DB binding, not by secrecy of Session ID.

## 4. SQL starting schema (refine to match the actual repository)

```sql
CREATE TYPE face_attempt_state AS ENUM (
  'CREATING', 'CREATED', 'IN_PROGRESS', 'PROCESSING',
  'VERIFIED', 'REVIEW_REQUIRED', 'FAILED', 'EXPIRED', 'REVOKED'
);

CREATE TABLE face_verification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  aws_session_id TEXT UNIQUE,
  aws_region TEXT NOT NULL,
  reference_media_id UUID NOT NULL, -- FK to project's existing media table
  reference_sha256 TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  state face_attempt_state NOT NULL DEFAULT 'CREATING',
  failure_code TEXT,                 -- code only; no raw images
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  CHECK (finished_at IS NULL OR finished_at >= created_at)
);
CREATE INDEX face_attempts_user_recent
  ON face_verification_attempts(user_id, created_at DESC);
CREATE INDEX face_attempts_state_expiry
  ON face_verification_attempts(state, expires_at);

CREATE TABLE user_photo_verifications (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  latest_attempt_id UUID REFERENCES face_verification_attempts(id),
  verified_media_id UUID,
  verified_media_sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN
    ('UNVERIFIED','VERIFIED','REVIEW_REQUIRED','REVOKED')),
  policy_version TEXT,
  verified_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE identity_verification_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  attempt_id UUID REFERENCES face_verification_attempts(id),
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  policy_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Schema is a **starter**, not a drop-in migration: confirm existing users/media IDs, RLS/permissions, migration conventions, exact retention policy, and consistency triggers. Do not duplicate sensitive user profile fields or log raw biometric results. Restrict admin read access; never expose these tables directly to clients. Consider encrypting especially sensitive metadata/secret fields and minimizing exact scores. Define a separate short-retention, tightly controlled risk review record only if necessary.

## 5. API contract

| Endpoint | Auth | Expected behavior |
|---|---|---|
| `GET /v1/identity/photo-verification` | JWT | Return status and badge only |
| `POST /v1/identity/photo-verifications` | JWT + explicit consent | Enforce throttling; create AWS liveness session and owned attempt |
| `POST /v1/identity/photo-verifications/{id}/complete` | JWT | Fetch AWS results; compare immutable photo; persist authoritative decision |
| `GET /v1/identity/photo-verifications/{id}` | JWT | Fetch status of owned attempt only |
| `POST /v1/identity/photo-verifications/{id}/appeal` | JWT | Manual review path without raw scores |
| `DELETE /v1/identity/photo-verification` | JWT + reauth if necessary | Revoke badge and initiate data deletion under policy |
| `POST /v1/admin/identity-reviews/{id}/decision` | Strong admin auth | Audited review with least privilege and dual control where needed |

Example public response (no raw confidence):

```json
{
  "verificationId": "uuid",
  "status": "VERIFIED",
  "badge": "PHOTO_VERIFIED",
  "verifiedAt": "2026-10-12T03:45:00+07:00"
}
```

Errors are safe codes: `SESSION_EXPIRED`, `CAMERA_UNAVAILABLE`, `LOW_LIGHT`, `FACE_NOT_ALIGNED`, `RATE_LIMITED`, `REVIEW_REQUIRED`, `IMAGE_CHANGED`, `AWAITING_RESULT`. Do not reveal score cutoffs, raw face similarity or detailed fraud detection methods.

## 6. Expo SDK 58 integration (mandatory compatibility spike)

**Official AWS detector integrations currently documented:**
- iOS: `amplify-ui-swift-liveness` (SwiftUI component).
- Android: `com.amplifyframework.ui:liveness` (Jetpack Compose component).
- React web: `@aws-amplify/ui-react-liveness` (DOM-based; not a React Native component).

Preferred production path: **build or adapt an Expo native module** that presents the AWS-maintained SwiftUI/Compose components. Configure native cameras and AWS temporary credentials via approved plugins; bridge event completion/errors to TypeScript. Install/build with Expo Development Build/EAS; **Expo Go is not sufficient** for custom native code. Verify exact React Native/Expo 58, Gradle, Kotlin/Compose, Xcode, Swift and AWS SDK compatibility in CI with real test devices. Community package `expo-face-liveness-for-aws-amplify` documents tests on Expo 54/55, **not Expo 58**; treat as candidate for review/porting, not assumed compatible or officially supported. Do not implement custom camera-based liveness ML as a quick substitute.

Native bridge surface example (interface only, **not** a functioning library):

```ts
export interface FaceLivenessNativeBridge {
  present(options: {
    sessionId: string;
    region: string;
  }): Promise<{ streamCompleted: boolean }>;
}
```

The bridge result triggers only the Rust `complete` call. The bridge must securely obtain AWS streaming authorization using the selected identity approach; do not expose AWS long-lived credentials in JavaScript, embedded app files or logs. Ensure camera permissions, photosensitivity information, localization, screen readers, cancellation and network recovery. Test on **physical iPhones and Android devices**.

## 7. Threshold, quality, fairness and fallback policy

Use independently configurable server-side thresholds for liveness and similarity, with `policy_version`; **no hard-coded 80/90/95 threshold presented as universally safe**. CompareFaces defaults to a response filter of 80% if none is supplied, but that is **not** an endorsement of 80% for verifying a person. Calibrate FAR/FRR with consented, representative same-person and different-person samples, varied lighting, devices, poses, skin tones and accessibility contexts. Test drift after AWS SDK/model changes. Use human review in ambiguous/high-impact cases and do not lock the person out of the core social app solely because a face check fails. Provide retry instructions driven by AWS feedback codes.

For default challenge, prefer AWS `FaceMovementAndLightChallenge` where suitable; AWS says it maximizes accuracy compared with movement-only. Offer a non-flashing/alternative route for photosensitive users, as recommended by AWS. Consent must be informed and optional for nonessential verification; clear alternatives must exist.

## 8. Abuse, security and cost controls

- Limit parallel attempts: 1 active session/user, per-user/device/IP throttling, idempotency key, and expiry cleanup. AWS recommends no more than 5 failed attempts/3 min/device, then 30–60 min cooldown; consider accessibility-sensitive appeal.
- Credential security: client may only stream with short-lived, narrowly scoped AWS credentials. Server handles Create/Get/Compare; use IAM role/assume-role where possible; never `AmazonRekognitionFullAccess` in production or `AmazonS3FullAccess` on mobile.
- Verify backend JWT server-side every time. Ensure `verification_attempts.user_id == auth.sub mapping`. Treat `sessionId`, mediaId, region and callback payloads as untrusted.
- AWS liveness status check MUST be `SUCCEEDED`; result availability/size and face reference are required. Reject results for the wrong user or photo revision, or terminal/revoked session.
- Store photos in R2 only according to consent and data policy, **private** when biometric reference; per-object unique keys, read only through backend, pinned digest and no mutable overwrites. For `CompareFaces`, send bytes from backend (up to 5 MB input limit) or use Amazon S3 if explicitly provisioned. R2 S3-compatible API does not make R2 an AWS Amazon S3 storage source.
- No client score disclosure, no face images in crash/error reporting, never log signed S3/R2 URLs. Set AWS CloudTrail/audit where appropriate, and check AWS Organizations AI services opt-out for model improvement if your privacy policy requires it.
- Keep `AuditImagesLimit=0` by default; add review images only on a documented, justified need with narrow access and a fixed deletion deadline. Prefer AWS returned bytes for immediate processing rather than permanent S3 copies. AWS session transient nature does not absolve your application of retention policy.
- Callers must see camera, biometric analysis and cross-cloud transfer purposes in privacy notice. Thailand PDPA and policies for minor users must be reviewed with legal counsel before production.
- AWS charges per liveness check and separately for applicable CompareFaces operations. Alert on attempts/day, checks/user, retry amplification and anomalies; AWS budgets and service limits prevent abuse-induced bill spikes.

## 9. Threat model / adversarial QA

| Attack or fault | Required result |
|---|---|
| JS patch sends `{ verified: true }` | Rejected; server ignores value |
| User A submits User B's verification ID or AWS Session ID | Denied by ownership checks |
| Session reused | Denied / idempotent saved result; new scan requires new session |
| Session older than 3 min | New session required; no verified badge |
| Liveness failed but similarity high | Not verified |
| Liveness high but face similarity low | Not verified |
| AWS reference image absent / incomplete | Retry or review, never verified |
| Uploaded profile image swapped after pass | Photo badge revoked until re-verification |
| Another user changes R2 object or URL | Denied; immutable pinned object key/hash |
| App disconnects after video stream | Safe status recovery; no client-side assumption |
| Rust crashes after AWS check / before DB commit | Safe retry with idempotency, never silent success |
| Two calls to complete race | Exactly one processing/terminal decision |
| Brightness/glasses/head coverings/photo sensitivity | Guidance, review or alternative verification |
| Admin tries to see every selfie | Unauthorized; least privilege, short retention, audited access |
| Credential extraction / rooted device | Temporary scoped credentials + rate controls; no permanent cloud privileges |
| Huge malicious photo / forged MIME type | Server bounds, actual image decoding, safe transcoding before AWS |

## 10. Measurable S-tier acceptance criteria

- **Zero** client-controlled promotion to `PHOTO_VERIFIED`.
- **Zero** face image / biometric result disclosures through public R2 objects, analytics events, logs or client responses.
- **100%** terminal approvals have authenticated user, unique AWS session, verified result, pinned image hash and policy version (validated by automated tests).
- 100% of expired/replayed/wrong-owner sessions remain unverified.
- Completion is idempotent; errors and timeouts preserve non-verified state.
- Mobile accessibility fallback available for photosensitivity and compatible devices unable to perform the scan.
- Measure p50/p95/p99 verification completion from camera start and break down AWS stream, GetResults, R2 GET, CompareFaces, SQL. **Do not promise fixed seconds before device + region benchmark**.
- Privacy consent audit, retention/deletion test, AI opt-out review, and appeal/false rejection tests passed.
- Android and iOS release builds pass hardware integration tests; Expo 58 compat verified in CI.
- Region and cost choices validated using production-like traffic and AWS quota/budget alerts.

## 11. Implementation plan / Claude execution order

**Phase 0 — Audit only (no behavior change)**
1. Map existing Expo version, React Native native module setup, AWS Rekognition calls, secrets, Cloudflare R2 bindings, media schema and current badge logic.
2. Identify server-only vs client-side checks. Search for client `verified` write paths, public R2 URLs, unsafe AWS credentials, check for logs of biometrics.
3. Document AWS region and IAM permissions. Inventory current legal consent and retention settings.

**Phase 1 — Backend hardening**
1. Add attempts + user verification states and indexes through incremental SQLx migrations.
2. Implement Create/Get result, server decision, session-ownership guard, idempotency and bounded recovery.
3. Implement R2 immutable photo snapshot + AWS CompareFaces Bytes; deny mutable profile photos without revocation.
4. Add rate limiting, audit, safe error taxonomy and configurable calibration thresholds.

**Phase 2 — Native integration**
1. Verify actual Expo 58 native build on iOS 26/27 and Android.
2. Integrate AWS-maintained iOS/Android native liveness via Expo Modules API or a carefully audited wrapper.
3. Ensure AWS streaming authorization is short-lived and least-privileged. Add consent, permissions, liveness instructions, photosensitivity fallback.
4. Validate end-to-end capture on physical devices and handle app background/network interruption.

**Phase 3 — Privacy and production readiness**
1. Threat-model review, dynamic pen-test, replay/race tests, audit trail review.
2. Tune thresholds on representative authorized test samples; monitor false accept/reject rates and changes.
3. Deletion/retention, admin review, AWS opt-out policy and budget alerts.
4. Stage rollout behind a feature flag; measure complete workflow before enabling public badges.

**Definition of done:** Tests and artifacts demonstrate the controls above. Do not claim the system is S-Tier just because dependencies are installed. Do not deploy production or mutate real user biometric records without explicit authorization.

## 12. Copy/paste task brief for Claude

> Use this file as the implementation specification for CampusMate Amazon Rekognition Face Liveness + CompareFaces verification. Audit the existing repository first; retain React Native / Expo 58, Rust / Axum / Tokio / SQLx, Neon and Cloudflare R2. Do not replace existing authentication or media flows without proof of need. Implement the secure session lifecycle, backend decision, R2 immutable reference comparison, verification status model, privacy consent, scoped AWS streaming authorization, native SwiftUI/Jetpack Compose bridge and tests in phases. Verify Expo 58 SDK/ABI compatibility instead of assuming third-party wrappers work. Require server-side AWS outcomes and prevent replay, image swaps, cross-account requests and client-controlled badges. Provide each phase's changed files, DB migrations, commands, test evidence, unresolved risks and rollback plan. Never expose credentials or production biometric media. Stop before production deployment.

## 13. Official sources checked (2026-10-12)

- Face Liveness architecture / Session expiry (3 min): https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-diagrams.html
- Face Liveness create and results API: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CreateFaceLivenessSession.html and https://docs.aws.amazon.com/rekognition/latest/APIReference/API_GetFaceLivenessSessionResults.html
- AWS face-liveness shared responsibility: https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-shared-responsibility-model.html
- AWS usage recommendations and client scores: https://docs.aws.amazon.com/rekognition/latest/dg/recommendations-liveness.html
- Rekognition CompareFaces behavior and image input: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CompareFaces.html
- Face Liveness supported regions (includes Thailand): https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-faq.html
- Amazon Rekognition endpoints: https://docs.aws.amazon.com/general/latest/gr/rekognition.html
- AWS SwiftUI detector: https://ui.docs.amplify.aws/swift/connected-components/liveness
- AWS Android detector: https://ui.docs.amplify.aws/android/connected-components/liveness
- Expo native code / development builds: https://docs.expo.dev/workflow/customizing/
- Community Expo wrapper (currently documented tests on Expo 54/55): https://github.com/olawalethefirst/expo-face-liveness-for-aws-amplify
- AWS AI services opt-out: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_ai-opt-out.html
- Face matching responsible AI: https://docs.aws.amazon.com/ai/responsible-ai/rekognition-face-matching/overview.html

