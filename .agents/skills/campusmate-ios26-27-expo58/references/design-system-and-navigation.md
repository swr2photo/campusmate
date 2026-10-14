# Design System And Navigation

> **Apple HIG authority (mandatory):** Read [`apple-hig-ios26-27-source-of-truth.md`](apple-hig-ios26-27-source-of-truth.md) and cite Apple HIG source IDs when deciding iOS appearance, navigation, accessibility, motion or privacy. Prefer native behavior over visual imitation; iOS 27 behavior must be checked against current Apple and Expo docs.

> Reference for the `campusmate-ios26-27-expo58` skill. Read when the task touches these areas. Always verify Expo 58 APIs against current docs and installed types.

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
