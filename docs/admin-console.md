# CampusMate admin console

Production URL: https://campusmate-7f1ab.web.app/admin.html

Owner account: `doralaikon.th@gmail.com`. Provisioned with the `admin: true` Firebase custom claim. The initial email-only account is not marked verified; the owner must sign in using Google to prove mailbox ownership. No password was created for the owner.

## Supported operations

- Counts of profile documents and report statuses.
- Read reports, paginate 30 at a time, inspect submitted text, review status and notes. Closing requires a reason; stale revisions are rejected.
- Display unencrypted image attachments from approved storage hosts, with a full-size viewer and load failure/retry state. Encrypted `.enc` attachments show an explicit explanation; the console cannot decrypt participant device keys.
- Load all Auth accounts before search in automatic 100-account pages, including accounts without profiles. Filter locally by name/email/UID/faculty/student ID and open detailed profiles, gallery, membership, visibility, account status, and aggregate report/conversation counts.
- Show the profile avatar/name with an expanded viewer and fallback for missing/unavailable photos.
- Send branded verification links, password reset links, Google-only sign-in instructions, and resend a previously requested campus-email change. Destinations are taken from Auth or the existing server-owned change record. No existing passwords or action links are returned to the admin browser.
- Verify SMTP connectivity without sending a message.
- Suspend or restore non-admin Auth accounts with a mandatory reason. Suspension revokes refresh tokens and Firestore rules enforce the server restriction even with an existing token. This does not remove profiles, messages, or subscriptions.
- Edit the app's existing `app_config/version` fields, with validation and conflict detection.
- Validate and publish typed default values for existing non-secret Remote Config parameters, including parameter groups, with ETag conflict detection. Existing conditional values remain in place; app fetch intervals still apply.
- Collapse/expand the desktop sidebar with a locally remembered preference.
- Select feature testers and custom notification recipients from searchable profile lists with avatars, names, email and faculty, without copying UIDs. Existing UID/email allowlists are preserved; manual entry remains available under advanced controls.
- Preview and send custom announcements to selected users or eligible users across all accounts within a configurable recipient cap. Persist the announcement, send Expo Push to registered devices, and inspect ticket/receipt results. Disabled accounts and users who turned off notifications are excluded.
- Configure server-enforced announcement enablement, recipient cap, announcement cooldown, and admin email cooldown, with revision checks and audit records.
- Delete a non-admin account after a server-owned preview, an exact typed UID, a mandatory reason and final confirmation. Remove Auth, profiles, membership entitlement, discovery state/cursors, decisions, push registrations and user notification deliveries. Shared chats, reports, media and audit history remain; store subscriptions must be cancelled separately.
- View all Remote Config parameters and the admin audit history.

SMTP/R2/billing credentials and server environment flags are managed through server deployment/secret management. They are not returned to the browser. Email timestamps alone are not delivery receipts. Password reset timestamps can represent requests that intentionally did not send a message.

Admin email sending uses the `CAMPUSMATE_ADMIN_SMTP_CONFIG` Secret Manager secret, explicitly bound to `adminConsole`. Provision it using the existing local SMTP configuration without printing credentials:

```powershell
node --env-file=functions/.env scripts/configure-admin-mail-secret.mjs --apply
```

Each send reserves a UUID operation and per-user/type cooldown (60 seconds by default, configurable in operational settings) in a transaction. Duplicate requests return the stored result without sending again. SMTP acceptance is recorded with message ID and audit state; acceptance does not establish Inbox delivery. Uncertain network/persistence results are retained as unknown to discourage blind retries. Existing verification/password reset/change timestamp records are updated after SMTP acceptance. Google instructions are only available for Google-only accounts; disabled accounts cannot receive mail from this menu.

## Access model

Every callable operation requires a verified Firebase token with boolean `admin: true`. The server rechecks current Auth claims and disabled state on every operation, so revoked admin claims cannot continue using an old token. Browser checks are for presentation only. The console uses the Admin SDK on the server; existing Firestore rules do not grant clients general access to reports or audit documents. This console does not let administrators grant admin claims to other accounts.

Report/version changes and their audit records are atomic Firestore transactions. External Auth/Remote Config operations record started/completed/failed audit states. Original report evidence is preserved.

## Build and deploy

```powershell
pnpm --dir web exec tsc --noEmit
pnpm --dir web build
node --test functions/adminPolicy.test.js
node scripts/deploy-admin-console.mjs --deploy
firebase deploy --only hosting --project campusmate-7f1ab --non-interactive
```

The isolated function deployment only targets `adminConsole`; it does not deploy unrelated endpoints or their secrets. The main functions entry also exports the console for subsequent full deployments. Hosting CSP permits the Firebase callable and Google login endpoints.

## Verification, 2026-10-05

- TypeScript check and production build passed.
- Three policy tests passed: admin claims, report closure validation, version and URL validation.
- Live SDK smoke passed: overview, reports, settings, audit, review transaction, stale revision rejection, audit insertion, revoked admin denial.
- Live browser smoke on the hosted production URL passed: email/password login using a disposable test administrator, overview, report review using a disposable report, real user lookup, settings read, audit read, mobile layout, anonymous HTTP 401.
- No browser runtime errors or document overflow in the tested flows.
- Temporary accounts, reports, and their review audit entries were removed in cleanup.
- Production version/feature values were not changed by the verification. Settings publication and the owner's first Google login remain untested interactively.
- Image preview, expanded image viewer, and the encrypted-image notice passed on production in a browser. Report `HDukx69uWwZnSsjzqM9y` references a reachable 245646-byte `application/octet-stream` `.enc` object. Its stored message ID is a temporary ID not present as a server message document. No plaintext evidence image is stored in that report. No report evidence or conversation key was modified.
- Avatar rendering and expansion for an existing account and live SMTP verification passed on the hosted console. The email menu request/confirmation/result flow was tested with its send HTTP response stubbed so no user received test mail.
- Five admin email template/provider tests passed, plus the existing mailer/policy/media tests (26 total). A live Auth/Firestore test with SMTP stubbed verified verification/reset requests, duplicate suppression, cooldowns, audit records and timestamp updates. Zero external emails were sent during verification. Temporary fixtures were cleaned up.

```powershell
node functions/adminConsole.smoke.mjs --live
$env:ADMIN_QA_URL='https://campusmate-7f1ab.web.app/admin.html'
node functions/adminWeb.smoke.mjs --live
```

The browser smoke uses the bundled Playwright path on this machine. Local localhost Auth requests are rejected by the existing API key referrer policy; use the hosted URL for authenticated verification.

## User directory, announcements and advanced settings, 2026-10-05

Detailed profiles use an explicit field allowlist and remove nested credentials, encryption material, and precise latitude/longitude. Conversation/report summaries are aggregate counts. Accounts without profile documents remain visible in the directory.

Announcement previews freeze the audience for five minutes. The send operation reserves a unique job and per-admin cooldown, rechecks current account status/preferences, persists announcements, and sends eligible devices in Expo batches. Duplicate sends return the stored result; uncertain results prevent blind retries. Invalid device registrations are disabled, with a token-hash check when processing receipts so a replacement token is preserved. Receipt success indicates handoff to Apple/Google, not reading or device display.

The announcement popup and navigation handler are implemented in the mobile source. Android JavaScript/Hermes export passed, but this work has not produced or published a new mobile release and the listener has not been checked on a physical device. Existing installed apps retain their existing OS Push behavior.

Validation: 31 operations/policy/email/media unit tests passed. The Auth/Firestore emulator exercised 106 accounts across pages, detailed profile projection, policy revision checks, notification exclusions, 125-device chunking, duplicate prevention, cooldown/expiry/disable checks, ticket/receipt errors and invalid-device cleanup. No external notifications were sent by these tests.

Deployed browser QA passed all 16 extension flows: all users before search, local search, detailed profile and gallery, secret exclusion, persisted sidebar state, recipient selection from profile, preview/cancellation, real server announcement persistence for a disposable account without devices, history, operational settings, Firebase Remote Config validation, cancelled publication and mobile layout. No browser runtime errors or mobile document overflow occurred. Production settings writes and external Push sends were zero; temporary accounts, announcements, previews, locks and audit fixtures were cleaned up. Existing login/report/image/avatar/SMTP/settings/audit/anonymous-access regression flows also passed; email sending remained simulated. Evidence screenshots are in `artifacts/admin-all-users.png`, `admin-detailed-user-profile.png`, `admin-custom-notifications.png`, `admin-detailed-settings.png` and `admin-directory-mobile.png`.

```powershell
firebase emulators:exec --config firebase.admin-qa.json --only 'firestore,auth' --project demo-campusmate 'node functions/adminOperations.emulator.mjs'
node functions/adminExtensionsWeb.smoke.mjs --live
```

## Report moderation and account enforcement, 2026-10-05

Account deletion and readable profile update: nested profile data renders as labelled Thai rows, activity tags, date/time cards and toggle states rather than JSON. Deletion disables access and writes a restriction before removing data, then deletes Auth last. Failed cleanup keeps access disabled and can be retried; a missing Auth identity after a completed cleanup is reconciled into the audit result. Admin/self deletion is blocked by the server. This operation removes the account and its personal operational records; it does not erase retained shared media or conversations and does not cancel Google Play/App Store billing. Deletion previews expire after five minutes.

TypeScript and the production web build passed. Auth/Firestore emulator tests covered 14 deletion checks including admin protection, preview/UID/reason validation, Auth and profile cleanup, nested document removal, other-user device preservation, decision cleanup, retained shared messages/report evidence, duplicate suppression and reconciliation.

The deployed browser smoke passed 21 flows including readable Thai activities/date cards with no profile JSON blocks, wrong-UID button protection, cancelled deletion, real Auth/profile deletion of a disposable fixture and removal from the refreshed directory. Existing gallery, announcements, settings validation and mobile overflow checks remained passing, with zero browser errors, zero production settings writes, zero external notifications and no real user data changed. Screenshots: `artifacts/admin-detailed-user-profile.png` and `artifacts/admin-account-deletion-confirmation.png`. Disposable deletion previews/jobs/audit entries were cleaned up.

Profile picker update: TypeScript and Vite build passed. The deployed browser test (`node functions/adminUserPickerWeb.smoke.mjs --live`) passed 10 flows including recognition of existing email-based tester selections, name search, multiple testers, preserved unknown legacy UIDs, removal/reselection, disabled notification recipient protection, real server recipient preview and mobile layout. Feature publication was simulated to inspect the payload without changing production Remote Config. No external notifications were sent and temporary accounts/previews were removed. Screenshots: `artifacts/admin-feature-profile-picker.png`, `artifacts/admin-notification-profile-picker.png`, `artifacts/admin-profile-picker-mobile.png`.

```powershell
firebase emulators:exec --config firebase.admin-qa.json --only 'firestore,auth' --project demo-campusmate 'node functions/adminAccountDeletion.emulator.mjs'
node functions/adminAccountDeletionWeb.smoke.mjs --live
```

The user page refreshes its selected account from Auth/Firestore. Verification status comes from Auth even without historic SMTP timestamps; missing send timestamps are described explicitly. Suspension validates a reason on click, protects administrator accounts, disables Auth, revokes refresh tokens, and writes a server-only restriction. Firestore checks this restriction for signed-in operations, including requests with an existing token. Owners retain get-only access to their own reason/warning.

Report details include reporter/reported account identities, profiles, conversation participants, and a scoped source-message match. A temporary or missing message ID does not enable speculative message deletion. Moderation supports warning, removal of one reported message, removal of the referenced encrypted R2 object, or both. It requires a reason and confirmation, checks revision and room membership, preserves restricted evidence/audit, and never deletes the whole room. Failed media removal is recorded as partial and leaves the report reviewing for retry.

The media Worker requires a distinct action-specific signed delete capability. It writes a durable R2 block before deleting the object and checks blocks before reads, including cached reads, and uploads. Removed objects cannot be recreated with an old upload ticket. Downloaded client copies cannot be recalled.

Warnings are persisted in accountRestrictions and sent through Expo Push when eligible registrations exist; acceptance is not delivery proof. AuthContext now listens for suspension and unread warnings. The new in-app alert/listener requires a mobile release; existing installed clients use the deployed Auth/Firestore restriction and their existing Push support. Native-device rendering of this new listener has not been tested. Existing E2EE reports still cannot reveal plaintext images without evidence supplied by a participant; no conversation keys are exposed to administrators.

Validation: 32 policy/mailer/media/Worker unit tests passed; emulator restriction, existing gallery, and chat-video regressions passed. Disposable live SDK fixtures covered stale-revision denial, warning persistence, scoped deletion, media failure/retry, suspension/restoration, and admin self-protection. Live browser QA exercised real deployed message and R2 deletion, cancellation, old URL 404, upload replay denial, unrelated-message preservation, required suspension reason, restoration, refresh, verification state, and detailed account data, with no browser errors. Existing avatar, report preview, SMTP health, email-menu simulation, settings, audit, anonymous denial and mobile-width flows also passed. No real user was suspended or moderated and no external test emails or Push notifications were sent; fixtures were removed.

```powershell
node functions/adminModeration.smoke.mjs --live
$env:CAMPUSMATE_PROBE_DOH='true'
node functions/adminModerationWeb.smoke.mjs --live
firebase emulators:exec --only firestore --project demo-campusmate 'node scripts/test-admin-restriction-rules.mjs'
```
