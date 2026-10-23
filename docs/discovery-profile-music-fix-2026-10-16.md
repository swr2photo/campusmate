# Discovery photos, cooldown, details and music — 2026-10-16

The discovery client now receives `nextRecycleAt` and server-confirmed `recycledProfileIds` from the Firebase discovery API. When the exhausted pool contains a pending skipped profile, Home and profile details show the remaining wait instead of an unmatched-profile message. The countdown uses an absolute server deadline, rechecks on foreground, and refreshes the current subscription at expiry without destroying its existing card. Server-confirmed recycling also clears the detail screen's session exclusion and immediately refreshes the outgoing ใdecision snapshot, so neither local cache can keep a returned card hidden. The old independent iOS 24-hour reset counter is removed. Accepted matches and pending likes are not automatically recycled.

Profile details use a single photo collection containing the public avatar and public gallery. Left/right buttons wrap through the collection and show its position. iOS image hosts receive explicit dimensions; photo loading and failure have visible feedback and retry. Revision, gallery and favorite-track updates now participate in discovery list equality, so refreshed profile media is not ignored. Details can collapse; the introduction has a separate full-text control. Both platforms use a 48-point play button with contrasting fill and text.

Music requests are tied to the selected track and cancelled when stopped, replaced or unmounted. The selected native seek finishes before playback. Full-song passages outside the provider preview use the full-song player; a failed resolution cannot silently play the wrong passage from zero. The YouTube bridge queues commands until ready, reports readiness when replacing its placeholder, ignores messages for an older video and keeps the loaded player paused for replay. A connection timeout and visible failure/retry replace an endless spinner.

## Verification

Run:

```powershell
node --test --test-concurrency=1 --test-reporter=spec scripts/test-discovery-profile-music.mjs functions/autoRecycleSkips.test.js scripts/test-discovery-client.mjs scripts/test-music-filter-regressions.mjs scripts/test-interaction-regressions.mjs
```

All 56 tests passed. Evidence is saved in `artifacts/discovery-profile-music-final-tests.log`. The tests exercise cooldown expiry and foreground recovery, the server's five-minute boundary, preservation of a visible card during background refresh, photo navigation and error recovery, cancelled lookups, native seek ordering, bridge readiness and reuse of a paused YouTube player. Source parsing and scoped `git diff --check` also passed.

## Remaining release checks

- No backend deployment or app update was published. The Firebase `getDiscoveryPage` deployment must include the `nextRecycleAt` response before an updated client can show the server cooldown.
- Hermes exports were attempted but failed with native compiler memory errors. Subsequent JavaScript-only exports did not complete while local disk space was critically low; the task's export processes were stopped. The partial export folders are not release artifacts.
- The installed Android app could be opened, but it was an existing release binary. It does not validate these source changes. iPhone/iPad photo layout, actual audio output, slow-network recovery and five-minute recycling still require an updated app and deployed backend on a device.
- Automatic approval review rejected removal of this task's partial export folders with `blocked by policy`; they remain on disk.
