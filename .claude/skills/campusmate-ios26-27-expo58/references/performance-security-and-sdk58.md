# Performance Security And Sdk58

> **Apple HIG authority (mandatory):** Read [`apple-hig-ios26-27-source-of-truth.md`](apple-hig-ios26-27-source-of-truth.md) and cite Apple HIG source IDs when deciding iOS appearance, navigation, accessibility, motion or privacy. Prefer native behavior over visual imitation; iOS 27 behavior must be checked against current Apple and Expo docs.

> Reference for the `campusmate-ios26-27-expo58` skill. Read when the task touches these areas. Always verify Expo 58 APIs against current docs and installed types.

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
