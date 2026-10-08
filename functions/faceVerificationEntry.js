// Isolated entry used to deploy face verification without unrelated service secrets.
import { initializeApp } from 'firebase-admin/app';
initializeApp();
export {
  startFaceVerificationSession,
  completeFaceVerification,
} from './faceVerificationFunctions.js';
