# Implementation Patterns And Qa

> **Apple HIG authority (mandatory):** Read [`apple-hig-ios26-27-source-of-truth.md`](apple-hig-ios26-27-source-of-truth.md) and cite Apple HIG source IDs when deciding iOS appearance, navigation, accessibility, motion or privacy. Prefer native behavior over visual imitation; iOS 27 behavior must be checked against current Apple and Expo docs.

> Reference for the `campusmate-ios26-27-expo58` skill. Read when the task touches these areas. Always verify Expo 58 APIs against current docs and installed types.

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
