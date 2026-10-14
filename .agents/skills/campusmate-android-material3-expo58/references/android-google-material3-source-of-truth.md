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
