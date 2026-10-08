# Appointment Firestore Rules Review

Date: 2026-09-06

## Scope

Reviewed the appointment data flow in `src/context/AppContext.js`,
`src/services/firestoreService.js`, `src/screens/MeetupScreen.js`,
`src/screens/MeetupScreen.ios.js`, `src/screens/AppointmentHistoryScreen.js`,
and `firestore.rules`.

## Finding and fix

The appointment history listener used an `array-contains` query on
`participants`, while the reported device log showed a `permission-denied`
listener error. The listener now uses two equality queries, `hostId == auth.uid`
and `guestId == auth.uid`, merges them by appointment ID, and removes stale
documents from each query snapshot. The rules now allow list reads only when a
query is constrained to one of those two participant fields.

The app also repairs an older accepted conversation that has no appointment
document yet. The repair is initiated from the guest device, reads the host's
current public meetup, and writes the same validated appointment shape as a
new acceptance.

## Access review

- `get`: signed-in users must be present in an existing appointment's
  participants list. A missing-document read is allowed only so the
  deterministic first-acceptance transaction can distinguish create from
  update; it returns no appointment data.
- `list`: signed-in users can only query appointments where they are `hostId`
  or `guestId`.
- `create`: remains restricted to the guest, an accepted conversation state,
  the host's stored meetup, and a validated appointment shape.
- `update`: remains limited to participant cancellation/reactivation rules;
  schedule and participant identity stay immutable.
- `delete`: remains denied to clients.

## Devil's-advocate review

The list rule does not grant collection-wide reads: a query that is not
constrained by `hostId == auth.uid` or `guestId == auth.uid` must fail the
Firestore rules proof. Both client queries use the authenticated Firebase UID,
and the merged result is de-duplicated by document ID. No schedule or message
data was made public by this change. The missing-document `get` exception can
reveal whether an arbitrary appointment ID exists, but it returns no document
data and is required by the client's create-or-update transaction; appointment
IDs are deterministic from a conversation and host UID rather than secret
random identifiers.

## Validation

`pnpm exec firebase deploy --only firestore:rules --dry-run` compiled the rules
successfully for project `campusmate-7f1ab`.
