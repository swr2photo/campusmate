# Profile photo grid and shared image editor — 2026-10-15

Android 3.1.4 / 93 in Nox reproduced the reported two-column photo grid: the third image wrapped and left unused space on the right. The fix renders three explicit rows of three equal-flex slots, retaining the 2:3 card ratio and the nine-photo limit.

The photo action menu now includes **แก้ไขรูปภาพ**. Existing images and newly selected replacements use `ChatImageEditorModal`, the same platform-resolved component as `ChatMediaComposer`. Profile editing hides the chat caption and labels confirmation **ใช้รูปนี้**. Both editor variants include a 2:3 profile crop preset.

Gallery edits remain drafts until the screen's save button is used. Cancel leaves the previous photo intact. Changing the main photo follows the existing save-then-face-verification flow; verification fields remain server-owned. Downloads, compression failures, duplicate confirmations, and late results after an owner change have regression coverage. Shared chat editing retains multi-image edits and no longer replaces the current edit with an older cached edit.

## Validation

- 61 focused tests passed across profile editing, own-profile synchronization, photo verification, verification persistence, music/filter regressions, and audited UI flows. Log: `artifacts/photo-grid94-tests.log`.
- Android and iOS production Hermes bundles succeeded: `artifacts/photo-grid94-android-bundle.log` and `artifacts/photo-grid94-ios-bundle.log`. These checks do not establish native device behavior.
- Android native configuration and animation runtime checks passed; `git diff --check` passed.
- Source hashes at build dispatch: `artifacts/photo-grid94-source.json`.
- Android internal build **FINISHED**: `f8fc0ee6-4abc-42ad-ae87-90a3366ce756`, version 3.1.4 / 94, preview profile.
- APK: https://expo.dev/artifacts/eas/isBIHhJxUpctgtwSjH1TkmGIZpS_ITuXbMjZqrWgW6k.apk . Local copy: `C:/Temp/CampusMate-QA-94/CampusMate-3.1.4-94-photo-editor.apk` (232815746 bytes). SHA-256: `2432ef6283c3dd518b921e904a8ffacf31472044d75aadabd3952949f57209a4`.
- APK manifest confirms package `com.campusmate.app`, version 3.1.4 / 94, min SDK 24 and target SDK 36. APK signature verification passed with certificate SHA-256 `1e4e5d22936e5723a6c0a581411701a357fed9e1c9854ea11a9f8735b9c98e62`.
- Nox currently has 3.1.4 / 93 installed as a split package, signed with a different certificate. `adb install -r` rejected build 94 with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. The existing app and its signed-in data were retained. Native validation is pending a user choice of another test device or uninstall/reinstall in Nox.
- Baseline screenshot: `D:/Temp/Nox-HyperV-repair-2026-10-14/photo94-before-grid.png`.

Native QA must confirm the three-column grid, photo menu, shared editor, cancellation, and edited gallery draft without saving changes to the signed-in person's real profile. Physical Android/iPhone, actual chat sending, live photo saving, and Face Liveness are outside the evidence collected so far. No store release or production migration was performed for this change.
