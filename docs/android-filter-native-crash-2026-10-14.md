# Android filter confirmation: native Fabric crash

Confirming matching filters in Android `3.1.3 / 90` leaves a persistent white screen. This was reproduced on the user's connected Nox Android 12 / API 32 instance after resolving its Hyper-V and graphics startup problems. It is a native rendering failure, not a confirmed JavaScript error or an empty discovery result.

## Runtime evidence

At 19:54:16 Bangkok time, `BUILD90_CONFIRM` was marked in device logcat, then the existing filter values were confirmed without additional selection changes. At 19:54:18 Fabric threw:

```text
addViewAt: failed to insert view [2106] into parent [2110] at index 4
The specified child already has a parent. You must call removeView() on the child's parent first.
ReactHost{0}.handleHostException(...)
```

The earlier instance captured at 19:37:52 identifies the offending view and both parents:

```text
RCTScrollView id=4344 parentTag=4346
RCTView id=4346 parentTag=4348
RCTView id=4348 parentTag=4350
addViewAt: failed to insert view [4344] into parent [4348] at index 4
```

The ScrollView was being re-parented out of the filter body wrapper as that wrapper became flattenable. The successful save starts native-stack dismissal, then `finally` clears `saving`, changing the body's `pointerEvents` from `none` to `auto` in the same commit. The outgoing subtree is retained by the native transition, so Android still considers the ScrollView attached to its old parent. ReactHost then destroys its rendering instance; later `reactInstance is null` messages are consequences of that native failure. JavaScript error boundaries cannot recover this native host destruction.

The installed native screens dependency is `react-native-screens 4.28.0`. The same flattening/removal-transition mechanism and `collapsable={false}` workaround are described in the [upstream issue](https://github.com/software-mansion/react-native-screens/issues/4677). The matching view tree and the reproducible local failure are the basis for this app-specific fix.

## Build 91 change

- Keep the body wrapper materialized with `collapsable={false}`, so its ScrollView stays under the same native parent when busy changes.
- Hold the submit lock and busy state after successful navigation until the departing screen unmounts. Failure still clears busy and allows retry; navigation errors also release the lock.
- Do not hydrate form fields from profile refreshes during a pending save or dismissal.
- Keep the existing filter navigation and modal presentation. No unrelated navigation redesign, native-library patch, or production backend switch is included.

The regression test executes the actual save handler while its screen remains mounted during dismissal. It failed on build 90's source because `busy=false` was emitted after navigation. It passes after the fix and verifies that a second tap cannot save or dismiss again. App/music/filter/discovery/UI regression tests pass 45/45; Android and iOS Hermes exports pass. These checks do not replace the native repeat of the failing flow.

Build 91: `d2102637-fd59-4143-9e14-69987dc4ca04`, profile `preview`, version `3.1.3 / 91`; EAS reports FINISHED. Source hashes are frozen in ignored `artifacts/filter-native91-source.json`; all nine still match the uploaded snapshot. Sanitized native baseline evidence is in `artifacts/filter-native90-crash-evidence.txt`.

## Verified final APK and native repeat

- [Download internal Firebase APK 3.1.3 / 91](https://expo.dev/artifacts/eas/z9OOPOvatKJvzllPJcICyCKOBcrg8It-slzWIW8Y7HA.apk).
- Local artifact: `artifacts/CampusMate-3.1.3-91-filter-native.apk`, 232,817,298 bytes; SHA-256 `a8b23bfb4050abdcfe887935d47127c6c83bb391ab422c63d88057f10923cba4`.
- `aapt2 dump badging` confirms `com.campusmate.app`, versionName `3.1.3`, versionCode `91`, minSdk 24 and targetSdk 36. `apksigner verify` exits 0 with APK v2 verified; certificate SHA-256 `1e4e5d22936e5723a6c0a581411701a357fed9e1c9854ea11a9f8735b9c98e62` matches build 90.
- ADB replacement installation succeeded without clearing the signed-in session. `dumpsys package` confirms installed `3.1.3 / 91`.

Native QA ran on the same Nox guest at approximately 20:27–20:29 Bangkok time on 2026-10-14. Five save/dismiss cycles returned to the visible discovery screen: two unchanged saves, switching distance from 25 km to unlimited, restoring 25 km, and a final save with two rapid confirmation taps. Reopening verified the saved unlimited value and then the restored 25 km value. A further unsaved unlimited draft was cancelled with X; reopening showed 25 km, and Android system Back also returned to discovery.

The app process stayed at PID 6240 through these cycles. Screenshots show the discovery empty state with its header, actions and tab bar after every save, X and Back. There was no persistent white screen and no `addViewAt`, parent conflict, `handleHostException`, fatal exception or ReactHost destruction in the marked build 91 QA log window. This verifies the reported failure on the connected Nox instance; physical Android/iOS behavior and slow/offline save flows remain unverified.

Screenshots and marked logs are under `D:\Temp\Nox-HyperV-repair-2026-10-14`: `build91-confirm1.png` through `build91-confirm5.png`, `build91-persistence-open.png`, `build91-cancel-persistence.png`, `build91-cancel-return.png`, `build91-back-return.png` and `build91-full-qa-window.log`. The original 25 km preference was restored before ending QA.

## Connected test environment

Nox Hyper-V beta `7.0.6.0` was installed from the vendor's [Hyper-V support page](https://support.bignox.com/ja/else/hypervonbeta). The installer signature verifies as Nox Limited. Although a separate destination was requested, the installer updated `D:\Program Files\Nox`; the original program and guest disk were backed up beforehand, with all 558 source files hash-verified. Backups and repair evidence are under `D:\Temp\Nox-HyperV-repair-2026-10-14`.

The VM now reports `NEMR3Init: Active`, Android `sys.boot_completed=1`, API 32 and x86_64 support. Its initial black graphics output was resolved after setting the package-supported `persist.nox.gles=2` and cold-starting the emulator. The effective host renderer log still says OpenGL+, so this is recorded as the GLES 2 adjustment, not a verified DirectX switch. Windows HypervisorPresent remains true and its DeviceGuard state is unchanged.

CampusMate APK 90 installed successfully, its installed version was verified, and the onboarding and signed-in discovery screen were observed. Agent-device's snapshot path did not work reliably with Nox's old ADB server; native evidence was collected directly through the Android SDK's separate ADB server on port 5039 and the forwarded guest on `127.0.0.1:62001`. No real account was deleted and no production cutover was performed.

## Remaining verification

Repeat the final APK on a physical Android device, including slow/offline saves. Physical-device music, deletion/email and Face Liveness validation remain separate release gates. No Store release or production backend cutover is established by this internal Firebase APK.
