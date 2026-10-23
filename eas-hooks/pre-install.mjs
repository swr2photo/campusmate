// EAS runs this before installing dependencies. On iOS builders, xcodebuild
// cannot interactively approve Swift package build plugins, and AWS's liveness
// package (via smithy-swift) ships one, so trust them non-interactively.
// The packages themselves are pinned in modules/face-liveness/ios/FaceLiveness.podspec.
import { execFileSync } from 'node:child_process';

if (process.env.EAS_BUILD_PLATFORM === 'ios' && process.platform === 'darwin') {
  for (const key of ['IDESkipPackagePluginFingerprintValidatation', 'IDESkipMacroFingerprintValidation']) {
    execFileSync('defaults', ['write', 'com.apple.dt.Xcode', key, '-bool', 'YES'], { stdio: 'inherit' });
  }
  console.log('Xcode package plugin and macro validation skipped for this CI build');
}
