# Interaction and photo audit — 2026-10-15

| Area | Source finding | Change / verification needed |
| --- | --- | --- |
| Plus rewind | A returned profile is inserted into the derived deck only; a refresh replaces it, old decisions can hide it, and daily selection chooses a different person. | Keep authorized restored profiles separately, prioritize the latest restored card, revalidate visibility, serialize rewind. |
| Reopening chat | Empty cache snapshots replace cached messages before the server arrives; Android also sets list opacity to zero during entry anchoring. | Ignore empty cache snapshots, preserve key-ready decryption transitions, keep list visible. |
| Party updates | Rust RPC mutations wait for SSE or its 15-second outage poll before subscribers reload. Feed retry clears all loaded rows. | Invalidate local subscribers after acknowledgement; preserve loaded content on retry. No server latency claim without measurement. |
| Photo upload | Gallery uploads are sequential; owner save waits for every conversation projection; photo grid requests main image without its revision. | Bounded parallel upload, nonblocking derived projection synchronization, revision-aware image request. |
| Main-photo publication | Screen saves and publishes the new main photo before opening verification. | Stage a candidate; keep the published main unchanged until the server approves the exact candidate. Reject direct replacement writes on the server. |
| Real-time face check | `FaceVerificationModal` silently selects legacy manual selfie comparison when the optional native liveness bridge/config is absent. Native spike is not part of the installed modules. | Do not describe the legacy photo comparison as real-time liveness. Native AWS detector and physical-device validation remain required. Expo Go cannot add this custom bridge. |

This audit is based on current source, not a production runtime trace. No user biometric record or production data was changed.
