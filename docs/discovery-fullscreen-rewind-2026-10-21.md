# Discovery fullscreen and rewind — 2026-10-21

## Result

- Discovery detail uses the measured screen viewport, with an edge-to-edge photo and floating navigation. The Home preview keeps its own finite native host sizing.
- iOS back, rewind, and safety-menu triggers use native SwiftUI glass buttons in explicitly sized 48 × 48 hosts. The three-dot trigger opens the existing report/block flow.
- Photo progress indicators and tap zones start below the floating controls. Expanding details scrolls below that header; collapsing resets the scroll offset before removing detail content.
- An empty deck exposes the server-authorized skip rewind action, and its close action stays available while loading.

## Missing cards after rewind

Two client checks could discard an otherwise authorized restored card:

1. A stale local rewind hint vetoed the server's `canRewind` state. All four Home/detail handlers now let the serialized server action authorize the rewind.
2. Privacy-filtered public profiles were checked as complete owner-registration records. Secure discovery now explicitly validates a public projection: identity, name, avatar, verification, and visibility still matter, while private demographics may be absent. The server already applies discovery preferences to the full record.

Restored cards take priority over the older route profile. The action returns the same photo-preserving object it publishes to the feed. It does not restore previously cached demographics that the server has omitted for privacy. Legacy/owner readiness checks remain strict. Server skip-only authorization, block/privacy checks, and membership enforcement are unchanged.

The route error boundary is keyed by profile and view mode so an earlier render failure cannot suppress a different profile.

## Validation

Focused tests passed **66/66** using:

```powershell
node --test --test-reporter=tap scripts/test-discovery-fullscreen-rewind.mjs scripts/test-chat-discovery-followup.mjs scripts/test-discovery-profile-music.mjs scripts/test-image-cache.mjs scripts/test-discovery-client.mjs src/utils/discoveryPresentation.test.js src/utils/rewindEligibility.test.js
```

The checks execute extracted callbacks and inspect JSX contracts, covering stale local eligibility, duplicate rewind serialization, restored candidate priority, privacy omissions, measured viewport sizing, native glass modifiers, safety actions, carousel loading/retry, and existing chat/music regressions. They are not a device interaction test.

TypeScript checking is blocked by existing TS7016 errors for missing React and `react/jsx-runtime` declarations in `modules/campus-landmarks`. No declaration packages were changed for this UI fix.

Both Metro debug exports passed with `EXPO_USE_WATCHMAN=0`, offline mode, one worker, `--no-minify --no-bytecode`:

- iOS: `D:/Temp/campusmate-discovery-fullscreen-rewind-ios-20261021`; log `D:/Temp/discovery-fullscreen-rewind-ios-export.log`.
- Android: `D:/Temp/campusmate-discovery-fullscreen-rewind-android-20261021`; log `D:/Temp/discovery-fullscreen-rewind-android-export.log`.

A SHA-256 manifest of 348 app/source/config files was recorded before exporting and compared after both exports; no source drift occurred. Manifest: `D:/Temp/discovery-fullscreen-rewind-source-manifest.json`. These outputs are JavaScript/asset bundles, not signed native builds or published updates.

No physical iOS or Android UI verification is available in this session. Reload and test photo return, empty-deck rewind, swiping, menu actions, and detail expand/collapse on a device before treating the visual behavior as verified.
