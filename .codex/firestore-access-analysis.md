# Firestore access analysis (2026-09-06)

Target: Firebase project `campusmate-7f1ab`, database `(default)`, Standard
edition, native mode, region `asia-southeast1`.

## Client collections and access patterns

- `users/{uid}`: owner-only reads and writes. The client writes the private
  profile, GPS coordinates, privacy/matching preferences, consent state, and
  the owner's E2EE device public keys.
- `profiles/{uid}`: signed-in reads; owner-only writes. Discovery lists use
  `where('isDiscoverable', '==', true)`. Direct reads are also required for
  chat participants' E2EE public device keys.
- `decisions/{fromUid}_{toUid}`: party-only reads. Queries filter by either
  `fromUserId == auth.uid` or `toUserId == auth.uid`. The sender creates and
  changes their decision; the recipient may accept/reject a received like.
- `conversations/{id}`: participant-only reads. Lists use
  `where('participants', 'array-contains', auth.uid)`. Client updates cover
  own embedded profile/settings, own read receipt, unread counters, meetup
  acceptance, encrypted-key envelopes, and encrypted last-message metadata.
- `conversations/{id}/messages/{messageId}`: participant-only reads. Creates
  are encrypted message documents authored by the signed-in user. Updates are
  limited to reactions and per-user hiding; only the sender may delete.
- `spots/{id}`: signed-in read-only reference data.
- `pushTokens`, `notificationDeliveries`, and `pushReceipts`: server-only.

## Compatibility observed in production data

- Private profiles include a legacy `location` string and one
  `consentAcceptedAt` integer-milliseconds value.
- Profile `age` can be null while setup is incomplete.
- Conversation snapshots may omit encryption/last-message metadata until the
  E2EE migration runs.
- Embedded participant profile `updatedAt` can be either a Firestore timestamp
  or legacy integer milliseconds.
- Root `messages` arrays are legacy and must remain immutable from clients;
  current messages live in the protected subcollection.

## Security boundaries applied

- Default deny for every unlisted path.
- Document IDs and ownership fields are bound to Firebase Auth UID.
- Strict top-level schemas, bounded strings/lists/maps, and type checks are
  applied to both creates and updates. Profile input is also normalized on the
  client before it is projected into Firestore, including legacy timestamps,
  privacy flags, matching preferences, coordinates, and text/list limits.
- Conversation participants and creation time are immutable.
- One participant cannot modify the other participant's embedded profile,
  settings, read receipt, or meetup membership.
- Message bodies must be encrypted; plaintext fields are not allowed.
- New last-message IDs must refer to an encrypted message authored by the
  caller in the same atomic write.

## Rule audit follow-up (2026-09-06)

- The emulator showed that the original OR-based conversation update rule
  evaluated every branch, even when the affected fields identified one clear
  operation. Invalid profile/conversation/appointment/message requests could
  therefore reach Firestore's 1,000-expression evaluation limit and return an
  evaluation error instead of a normal deny.
- Conversation updates now use mutually exclusive conditional branches. The
  message create path validates only encrypted-message fields; reaction and
  hidden-message validation remains on update. Appointment updates reject
  unauthenticated/non-participant requests before running the full snapshot
  validator.
- Full profile writes use the canonical private shape; legacy aliases are
  removed during the projection so old fields cannot make later saves fail.
  GPS remains in the private document only, while focused location updates keep
  their own narrow owner-only rule.
- The E2EE auto-initialization path now writes the required encryption block
  and a bounded conversation-profile projection, matching the conversation
  create rule instead of being rejected as an incomplete document.
- Meetup selection/scheduling now uses a focused owner-only profile patch that
  changes only `id`, `meetup`, and `updatedAt` in `users/{uid}` and
  `profiles/{uid}`. The meetup and schedule fields remain bounded, and the
  public projection still respects `showLocation` and `showAvailability`.
- The same narrow patch is allowed on create so a new account cannot lose a
  selected meetup if the background profile bootstrap and the meetup action
  race; it still requires exactly `id`, `meetup`, and `updatedAt`.
- A complete profile containing the normal ten-field matching-preferences map
  reached Firestore's 1,000-expression limit when private and public
  projections were committed in one batch. The profile validators were
  compacted without widening ownership/public-data boundaries, and the client
  now writes the private projection first and the public projection second.
  Each projection passes its own rule evaluation budget.

## Verification

- `firebase deploy --only firestore:rules --project campusmate-7f1ab --dry-run`
  compiled successfully.
- `firebase deploy --only firestore:rules --project campusmate-7f1ab` completed
  successfully and released the rules to `cloud.firestore`.
- `firebase emulators:exec --only firestore --project demo-campusmate-rules-20260906-profile-split2
  "node scripts/firestore-rules-smoke.mjs"` completed successfully: all
  expected allow/deny cases passed, including creating before profile
  bootstrap, saving a complete profile projection, and updating a legacy
  profile's meetup projection. The complete profile case includes a full
  matching-preferences map and uses separate private/public writes, and the
  latest run completed without a 1,000-expression-limit error.
- The meetup, profile-validator, and projection changes are now deployed to
  the project's default Firestore database.
