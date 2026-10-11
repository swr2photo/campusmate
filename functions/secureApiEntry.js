// A scoped deployment entry avoids loading unrelated billing secrets before
// RevenueCat is configured. The main entry continues exporting these APIs.
import { initializeApp } from 'firebase-admin/app';
initializeApp();
export { getVisibleProfiles, setProfileVisibility, getIncomingLikeSummary, getDiscoveryPage,
  getMyDecisionState, getPartyEncryptionProfiles, getConversationEncryptionProfiles } from './secureProfileFunctions.js';
export { recordDiscoveryAction, respondToIncomingLike, rewindDiscoveryAction,
  cancelPendingOutgoingLike, unmatchProfile } from './matchingActionFunctions.js';
