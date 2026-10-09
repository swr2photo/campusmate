import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
if (process.argv.slice(2).some(arg => arg !== '--deploy')) throw new Error('Use --deploy or no argument');
const stage = path.join(process.env.TEMP || root, 'campusmate-conversation-encryption');
mkdirSync(stage, { recursive: true });
const copied = new Set();
function copyModule(name) {
  if (copied.has(name)) return;
  if (!/^[A-Za-z0-9]+\.js$/.test(name)) throw new Error('Unexpected module path');
  const source = readFileSync(path.join(root, 'functions', name), 'utf8');
  copied.add(name); writeFileSync(path.join(stage, name), source);
  for (const match of source.matchAll(/from\s+['"]\.\/([A-Za-z0-9]+\.js)['"]/g)) copyModule(match[1]);
}
copyModule('secureProfileFunctions.js');
writeFileSync(path.join(stage, 'entry.js'), "import { initializeApp } from 'firebase-admin/app';\ninitializeApp();\nexport { getConversationEncryptionProfiles } from './secureProfileFunctions.js';\n");
const manifest = JSON.parse(readFileSync(path.join(root, 'functions/package.json'), 'utf8')); manifest.main = 'entry.js';
writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2));
cpSync(path.join(root, 'functions/package-lock.json'), path.join(stage, 'package-lock.json'));
if (!existsSync(path.join(stage, 'node_modules'))) symlinkSync(path.join(root, 'functions/node_modules'), path.join(stage, 'node_modules'), 'junction');
writeFileSync(path.join(stage, '.env'), 'CAMPUSMATE_SECURE_DISCOVERY_ENABLED=true\n');
writeFileSync(path.join(stage, 'firebase.json'), JSON.stringify({ functions: { source: '.', codebase: 'default', runtime: 'nodejs22',
  ignore: ['node_modules', '.git', 'firebase.json', '*-debug.log'] } }, null, 2));
console.log(`Staged ${copied.size} modules for the member-only conversation keys endpoint.`);
if (process.argv.includes('--deploy')) {
  const args = ['deploy', '--config', path.join(stage, 'firebase.json'), '--only', 'functions:getConversationEncryptionProfiles',
    '--project', 'campusmate-7f1ab', '--non-interactive'];
  const firebaseBin = process.env.CAMPUSMATE_FIREBASE_CLI;
  if (!firebaseBin) throw new Error('Set CAMPUSMATE_FIREBASE_CLI to the installed firebase-tools/lib/bin/firebase.js');
  const result = spawnSync(process.execPath, [firebaseBin, ...args], { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status === 0 ? 0 : 1;
}
