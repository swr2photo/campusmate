import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { createMatchingActionApi } from './matchingActions.js';
function endpoint(name) {
  return onCall({ region: 'asia-southeast1', maxInstances: 20 }, (request) => {
    if (process.env.CAMPUSMATE_SECURE_DISCOVERY_ENABLED !== 'true') throw new HttpsError('failed-precondition', 'ระบบนี้ยังไม่เปิดให้ใช้งาน');
    return createMatchingActionApi({ db: getFirestore(), serverTimestamp: FieldValue.serverTimestamp })[name](request);
  });
}
export const recordDiscoveryAction = endpoint('recordDiscoveryAction');
export const respondToIncomingLike = endpoint('respondToIncomingLike');
export const rewindDiscoveryAction = endpoint('rewindDiscoveryAction');
export const cancelPendingOutgoingLike = endpoint('cancelPendingOutgoingLike');
export const unmatchProfile = endpoint('unmatchProfile');
