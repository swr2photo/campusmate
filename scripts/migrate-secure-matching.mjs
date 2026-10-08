import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { migrateLegacyUser } from '../functions/matchingMigration.js';

const args = new Set(process.argv.slice(2));
if ([...args].some((entry) => !['--dry-run', '--apply', '--legacy-writes-closed'].includes(entry))
  || args.has('--dry-run') === args.has('--apply')) throw new Error('Choose --dry-run or --apply; apply also requires --legacy-writes-closed.');
if (args.has('--apply') && !args.has('--legacy-writes-closed')) throw new Error('Close legacy decision writes before applying the migration.');
const app = initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'campusmate-7f1ab' });
const db = getFirestore(app), total = { users: 0, planned: 0, withoutOrdering: 0, written: 0 };
try {
  let cursor = null;
  do {
    let query = db.collection('users').orderBy('__name__').limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const owner of page.docs) {
      const result = await migrateLegacyUser(db, owner.id, { apply: args.has('--apply'), serverTimestamp: FieldValue.serverTimestamp });
      total.users += 1;
      for (const key of ['planned', 'withoutOrdering', 'written']) total[key] += result[key];
    }
    cursor = page.size === 100 ? page.docs.at(-1) : null;
  } while (cursor);
  console.log(JSON.stringify({ mode: args.has('--apply') ? 'apply' : 'dry-run', ...total }));
} finally { await db.terminate(); await deleteApp(app); }
