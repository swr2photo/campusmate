import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length && args[0] !== '--deploy')) throw new Error('Use no argument to stage, or --deploy.');
const root = path.resolve(import.meta.dirname, '..');
const stage = path.join(root, 'artifacts/server-staging/secure-access');
mkdirSync(stage, { recursive: true });
const copied = new Set();
function copyModule(name) {
  if (copied.has(name)) return;
  if (!/^[A-Za-z0-9]+\.js$/.test(name)) throw new Error('Unexpected dependency path.');
  const source = readFileSync(path.join(root, 'functions', name), 'utf8');
  copied.add(name); writeFileSync(path.join(stage, name), source);
  for (const match of source.matchAll(/from\s+['"]\.\/([A-Za-z0-9]+\.js)['"]/g)) copyModule(match[1]);
}
copyModule('secureApiEntry.js');
const manifest = JSON.parse(readFileSync(path.join(root, 'functions/package.json'), 'utf8'));
manifest.main = 'secureApiEntry.js';
writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2));
cpSync(path.join(root, 'functions/package-lock.json'), path.join(stage, 'package-lock.json'));
// Local discovery uses the already installed dependencies. Firebase excludes
// this link from the source archive and Cloud Build installs from the lockfile.
if (!existsSync(path.join(stage, 'node_modules'))) symlinkSync(path.join(root, 'functions/node_modules'), path.join(stage, 'node_modules'), 'junction');
// Explicitly disabled. No secrets, paid membership configuration or existing
// endpoint definitions are included in this deployment.
writeFileSync(path.join(stage, '.env'), 'CAMPUSMATE_SECURE_DISCOVERY_ENABLED=false\n');
const config = path.join(root, 'artifacts/server-staging/firebase.json');
writeFileSync(config, JSON.stringify({ functions: { source: 'secure-access', codebase: 'default', runtime: 'nodejs22',
  ignore: ['node_modules', '.env', '.env.*', '.git', '*-debug.log'] } }, null, 2));
console.log(`Staged ${copied.size} modules with secure access disabled.`);
if (args[0] === '--deploy') {
  const names = ['getVisibleProfiles', 'setProfileVisibility', 'getIncomingLikeSummary', 'getDiscoveryPage',
    'getMyDecisionState', 'getPartyEncryptionProfiles', 'recordDiscoveryAction', 'respondToIncomingLike',
    'rewindDiscoveryAction', 'cancelPendingOutgoingLike', 'unmatchProfile'];
  const deployArgs = ['deploy', '--config', 'artifacts/server-staging/firebase.json', '--only', names.map((name) => `functions:${name}`).join(','),
    '--project', 'campusmate-7f1ab', '--non-interactive'];
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', `firebase ${deployArgs.join(' ')}`], { cwd: root, stdio: 'inherit' })
    : spawnSync('firebase', deployArgs, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status === 0 ? 0 : 1;
}
