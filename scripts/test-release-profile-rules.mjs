import { spawnSync } from 'node:child_process';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required');
for (const file of ['test-profile-read-privacy-rules.mjs', 'test-notification-inbox-rules.mjs', 'test-profile-gallery-rules.mjs']) {
  const result = spawnSync(process.execPath, ['scripts/' + file], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
