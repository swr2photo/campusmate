import { initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

initializeApp({
  storageBucket: 'campusmate-7f1ab.firebasestorage.app',
});

const bucket = getStorage().bucket();
const args = new Set(process.argv.slice(2));
const commit = args.has('--commit');

async function cleanupStorage() {
  console.log('Fetching files in bucket:', bucket.name);
  const [files] = await bucket.getFiles({ prefix: 'chat_media/' });

  console.log(`Found ${files.length} total objects in chat_media/`);

  let unencryptedCount = 0;
  let encryptedCount = 0;

  for (const file of files) {
    const isEncrypted = file.name.endsWith('.enc');
    if (isEncrypted) {
      encryptedCount += 1;
      console.log(`[ENCRYPTED] ${file.name} (safe)`);
    } else {
      unencryptedCount += 1;
      console.log(`[UNENCRYPTED] ${file.name} (${file.metadata.size} bytes)`);
      if (commit) {
        await file.delete();
        console.log(`  -> Deleted: ${file.name}`);
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Encrypted files (.enc): ${encryptedCount}`);
  console.log(`Unencrypted legacy files: ${unencryptedCount}`);
  if (!commit && unencryptedCount > 0) {
    console.log('\nDry run complete. To permanently delete unencrypted legacy files, run:');
    console.log('node scripts/cleanup-firebase-storage.mjs --commit');
  } else if (commit) {
    console.log('\nCleanup complete! All unencrypted files have been removed from Firebase Storage.');
  }
}

cleanupStorage().catch((err) => {
  console.error('Storage cleanup failed:', err);
  process.exit(1);
});
