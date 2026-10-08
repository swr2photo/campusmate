import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { createEntitlementSynchronizer, createRevenueCatWebhook, fetchRevenueCatSubscriber, membershipState } from './plusEntitlements.js';

const REGION = 'asia-southeast1';
const apiKey = defineSecret('REVENUECAT_SECRET_API_KEY');
const webhookAuth = defineSecret('REVENUECAT_WEBHOOK_AUTHORIZATION');
const synchronizer = () => createEntitlementSynchronizer({ db: getFirestore(),
  getSubscriber: (uid) => fetchRevenueCatSubscriber(uid, apiKey.value()),
  allowSandbox: process.env.CAMPUSMATE_PLUS_ALLOW_SANDBOX === 'true' });
function signedIn(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบ');
  return request.auth.uid;
}

export const getMembershipState = onCall({ region: REGION, maxInstances: 20 }, async (request) => {
  const uid = signedIn(request);
  return membershipState((await getFirestore().collection('entitlements').doc(uid).get()).data());
});
export const syncMembership = onCall({ region: REGION, maxInstances: 10, secrets: [apiKey] }, async (request) => {
  const uid = signedIn(request);
  if (process.env.CAMPUSMATE_PLUS_ENABLED !== 'true') throw new HttpsError('failed-precondition', 'ระบบสมาชิกยังไม่เปิดให้ใช้งาน');
  // The client supplies no receipt, product, expiration or user ID to trust.
  return synchronizer()(uid);
});
export const revenueCatWebhook = onRequest({ region: REGION, maxInstances: 10, secrets: [apiKey, webhookAuth], timeoutSeconds: 180 }, (request, response) => {
  if (process.env.CAMPUSMATE_PLUS_ENABLED !== 'true') return response.status(503).send('Membership not configured');
  return createRevenueCatWebhook({ db: getFirestore(), sync: synchronizer(), getAuthorization: () => webhookAuth.value(),
    userExists: async (uid) => {
      try { await getAuth().getUser(uid); return true; }
      catch (error) { if (error.code === 'auth/user-not-found') return false; throw error; }
    },
  })(request, response);
});
