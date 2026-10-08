const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const stage = path.resolve('artifacts/profile-plus-staging');
fs.mkdirSync(stage, { recursive: true });
const files = ['profileGalleryEntry.js', 'profileGalleryFunctions.js', 'profileGallery.js', 'imageModeration.js', 'imageModerationPolicy.js', 'plusEntry.js', 'plusFunctions.js', 'plusEntitlements.js'];
for (const file of files) fs.copyFileSync(path.join('functions', file), path.join(stage, file));
fs.writeFileSync(path.join(stage, 'entry.js'), "import { initializeApp } from 'firebase-admin/app';\ninitializeApp();\nexport { uploadProfileGalleryImage } from './profileGalleryFunctions.js';\nexport { getMembershipState, syncMembership, revenueCatWebhook } from './plusFunctions.js';\n");
const manifest = JSON.parse(fs.readFileSync('functions/package.json', 'utf8'));
manifest.main = 'entry.js';
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest));
fs.copyFileSync('functions/package-lock.json', path.join(stage, 'package-lock.json'));
fs.writeFileSync(path.join(stage, '.env'), 'CAMPUSMATE_PLUS_ENABLED=true\nCAMPUSMATE_PLUS_ALLOW_SANDBOX=true\nREVENUECAT_PROJECT_ID=proj66fb23d5\n');
if (!fs.existsSync(path.join(stage, 'node_modules'))) fs.symlinkSync(path.resolve('functions/node_modules'), path.join(stage, 'node_modules'), 'junction');
fs.writeFileSync(path.join(stage, 'firebase.json'), JSON.stringify({ functions: { source: '.', runtime: 'nodejs22', codebase: 'default', ignore: ['node_modules', '.git', '*-debug.log'] } }));
if (process.argv.includes('--deploy')) {
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', 'firebase deploy --config artifacts/profile-plus-staging/firebase.json --only functions:uploadProfileGalleryImage,functions:syncMembership,functions:revenueCatWebhook --project campusmate-7f1ab --non-interactive'], { stdio: 'inherit' });
  process.exitCode = result.status || 0;
}
