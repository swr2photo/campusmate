// Isolated entry used to deploy the console without unrelated service secrets.
import { initializeApp } from 'firebase-admin/app';
initializeApp();
export { adminConsole } from './adminFunctions.js';
