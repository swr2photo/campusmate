import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { createProfileAccessApi } from './secureProfileAccess.js';
import { createDiscoveryApi } from './secureDiscovery.js';
function endpoint(name) {
  return onCall({ region: 'asia-southeast1', maxInstances: 20 }, (request) => {
    if (process.env.CAMPUSMATE_SECURE_DISCOVERY_ENABLED !== 'true') {
      throw new HttpsError('failed-precondition', 'ระบบนี้ยังไม่เปิดให้ใช้งาน');
    }
    if (name === 'getDiscoveryPage') return createDiscoveryApi({ db: getFirestore() })(request);
    return createProfileAccessApi({ db: getFirestore(), serverTimestamp: FieldValue.serverTimestamp })[name](request);
  });
}
export const getVisibleProfiles = endpoint('getVisibleProfiles');
export const setProfileVisibility = endpoint('setProfileVisibility');
export const getIncomingLikeSummary = endpoint('getIncomingLikeSummary');
export const getDiscoveryPage = endpoint('getDiscoveryPage');
export const getMyDecisionState = endpoint('getMyDecisionState');
export const getPartyEncryptionProfiles = endpoint('getPartyEncryptionProfiles');
