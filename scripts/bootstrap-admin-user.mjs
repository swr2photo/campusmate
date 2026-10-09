import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const TARGET_EMAIL = '6710210317@psu.ac.th';
const projectId = process.env.GCLOUD_PROJECT || 'campusmate-7f1ab';

try {
  initializeApp({ projectId });
} catch {
  // Already initialized
}

const auth = getAuth();
const db = getFirestore();

async function bootstrap() {
  console.log(`[BootstrapAdmin] Configuring super admin user: ${TARGET_EMAIL}...`);
  let user;
  try {
    user = await auth.getUserByEmail(TARGET_EMAIL);
    console.log(`[BootstrapAdmin] Found existing Auth user: UID = ${user.uid}`);
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.log(`[BootstrapAdmin] User not found in Firebase Auth. Creating user...`);
      user = await auth.createUser({
        email: TARGET_EMAIL,
        emailVerified: true,
        displayName: 'Game',
      });
      console.log(`[BootstrapAdmin] Created new Auth user: UID = ${user.uid}`);
    } else {
      throw error;
    }
  }

  // 1. Ensure emailVerified = true
  if (!user.emailVerified) {
    await auth.updateUser(user.uid, { emailVerified: true });
    console.log(`[BootstrapAdmin] Updated Auth emailVerified = true`);
  }

  // 2. Set custom claims { admin: true }
  await auth.setCustomUserClaims(user.uid, {
    ...(user.customClaims || {}),
    admin: true,
  });
  console.log(`[BootstrapAdmin] Set Auth custom claims { admin: true }`);

  // 3. Update Firestore users/{uid}
  const userRef = db.collection('users').doc(user.uid);
  const userSnap = await userRef.get();
  const existingUser = userSnap.data() || {};

  const userPatch = {
    email: TARGET_EMAIL,
    campusEmail: TARGET_EMAIL,
    emailVerified: true,
    campusEmailVerified: true,
    isAdmin: true,
    role: 'admin',
    isFaceVerified: true,
    faceMatchScore: 100,
    faceVerificationStatus: 'verified',
    autoVerifyFace: true,
    faceVerifiedAt: existingUser.faceVerifiedAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await userRef.set(userPatch, { merge: true });
  console.log(`[BootstrapAdmin] Updated Firestore users/${user.uid} with admin & verified face (100%)`);

  // 4. Update Firestore profiles/{uid}
  const profileRef = db.collection('profiles').doc(user.uid);
  await profileRef.set({
    isAdmin: true,
    role: 'admin',
    isFaceVerified: true,
    faceMatchScore: 100,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log(`[BootstrapAdmin] Updated Firestore profiles/${user.uid}`);

  // 5. Update discoveryProfiles if exists
  const discRef = db.collection('discoveryProfiles').doc(user.uid);
  const discSnap = await discRef.get();
  if (discSnap.exists) {
    await discRef.set({ isFaceVerified: true }, { merge: true });
    console.log(`[BootstrapAdmin] Updated Firestore discoveryProfiles/${user.uid}`);
  }

  console.log(`\n✅ Successfully verified ${TARGET_EMAIL} as Admin and Auto-Face-Verified!`);
  console.log(`Summary:`);
  console.log(`- Email: ${TARGET_EMAIL}`);
  console.log(`- UID: ${user.uid}`);
  console.log(`- Admin Claim: true`);
  console.log(`- Email Verified: true`);
  console.log(`- Face Verified: true (100%)`);
  console.log(`- Role: admin`);
}

bootstrap().catch((err) => {
  console.error('[BootstrapAdmin] Failed:', err);
  process.exit(1);
});
