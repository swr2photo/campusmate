console.log("Waiting for admin...");
const admin = require('firebase-admin');

// We are inside functions:shell. admin is already initialized by index.js!
async function cleanup() {
  const db = admin.firestore();
  const auth = admin.auth();
  const profiles = await db.collection('profiles').get();
  
  let count = 0;
  for (const doc of profiles.docs) {
    const data = doc.data();
    const email = data.email || data.campusEmail || '';
    if (!/@psu\.ac\.th$/i.test(email)) {
      console.log(`Deleting ${doc.id} (email: ${email})`);
      await db.collection('profiles').doc(doc.id).delete().catch(()=>null);
      await db.collection('users').doc(doc.id).delete().catch(()=>null);
      await db.collection('discoveryProfiles').doc(doc.id).delete().catch(()=>null);
      await auth.deleteUser(doc.id).catch(()=>null);
      count++;
    }
  }
  console.log(`Deleted ${count} non-PSU users.`);
}
cleanup().then(() => console.log('DONE'));
