# Firestore Security Audit

Rules are deployed to project `campusmate-7f1ab` and target the Standard Firestore database in `asia-southeast1`.

## Data boundaries

- `users/{uid}` is private and accessible only by its owner.
- `profiles/{uid}` contains the owner-selected public projection and requires authentication to read.
- `decisions/{fromUid_toUid}` is readable only by the sender and receiver.
- `conversations/{id}` is readable and writable only by listed participants.
- `spots/{id}` is authenticated read-only data.
- Every unlisted Firestore path is denied by default. Profile images are stored in Cloudflare R2 through an authenticated Worker.

## Mutual match assumptions

- A conversation can be created only after both directional decision documents are `like` + `accepted`.
- The app writes deterministic decision IDs using `fromUid_toUid`.
- Profile discovery requires authentication and `isDiscoverable: true`.

## Prototype limitations to review

- Conversation messages are currently stored in one bounded array; migrate to a messages subcollection before production scale.
- Conversation updates preserve the participant list and are limited to message, unread/read receipt, participant snapshot/settings, and meetup acceptance fields.
- Message objects inside the bounded array cannot be validated individually by Firestore Rules; migrate messages to a subcollection before production scale.
- Profile reads are available to every authenticated account. Add blocking/reporting documents before public launch.
- Admin writes for `spots` must be performed through trusted Admin SDK code.
- The app uploads avatars through an authenticated Cloudflare R2 Worker, so Firebase Storage rules are not configured in this project.
