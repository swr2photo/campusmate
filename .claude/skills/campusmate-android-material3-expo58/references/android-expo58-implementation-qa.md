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
