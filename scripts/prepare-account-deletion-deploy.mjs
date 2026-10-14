import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/account-deletion-deploy');
mkdirSync(output, { recursive: true });
const files = ['accountDeletionFunctions.js', 'accountDeletionOtp.js', 'accountDeletionMedia.js',
  'campusEmailMailer.js', 'profileGallery.js', 'package.json', 'package-lock.json'];
const hashes = {};
for (const name of files) {
  copyFileSync(path.join(root, 'functions', name), path.join(output, name));
  hashes[name] = createHash('sha256').update(readFileSync(path.join(output, name))).digest('hex');
}
writeFileSync(path.join(output, 'index.js'), `import { initializeApp } from 'firebase-admin/app';
initializeApp();
export { sendAccountDeletionOtp, verifyAccountDeletionOtp, deleteUserData } from './accountDeletionFunctions.js';
`);
const modules = path.join(output, 'node_modules');
if (!existsSync(modules)) symlinkSync(path.join(root, 'functions/node_modules'), modules, process.platform === 'win32' ? 'junction' : 'dir');
writeFileSync(path.join(root, 'artifacts/deletion-deploy.firebase.json'), JSON.stringify({ functions: {
  source: 'account-deletion-deploy', runtime: 'nodejs22', codebase: 'default',
  ignore: ['node_modules', '.git', '.env', '.env.*', '*.test.js'],
} }, null, 2) + '\n');
writeFileSync(path.join(root, 'artifacts/deletion-deploy-manifest.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log('Prepared 3 deletion endpoints with source hashes; no dotenv files or unrelated handlers.');
