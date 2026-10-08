import { initializeApp } from 'firebase-admin/app';
initializeApp();
export { getMembershipState, syncMembership, revenueCatWebhook } from './plusFunctions.js';
