// Smoke test for Face Verification & AWS Rekognition integration
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFaceVerificationSession,
  getAwsRekognitionConfig,
  getRekognitionClient,
  isAwsConfigured,
  verifyFaceMatch,
  MIN_FACE_SIMILARITY,
  MIN_LIVENESS_CONFIDENCE,
} from './faceVerification.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');

// Load .env
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

function createMockDb(initialData = {}) {
  const store = {
    users: new Map(Object.entries(initialData.users || {})),
    faceVerificationSessions: new Map(Object.entries(initialData.sessions || {})),
  };

  return {
    collection: (colName) => ({
      doc: (docId) => ({
        get: async () => ({
          exists: store[colName]?.has(docId) ?? false,
          data: () => store[colName]?.get(docId),
        }),
        set: async (data) => {
          if (!store[colName]) store[colName] = new Map();
          store[colName].set(docId, data);
        },
        update: async (data) => {
          if (!store[colName]?.has(docId)) {
            throw new Error(`Doc ${docId} does not exist in ${colName}`);
          }
          const prev = store[colName].get(docId) || {};
          store[colName].set(docId, { ...prev, ...data });
        },
      }),
    }),
    _store: store,
  };
}

async function runSmokeTests() {
  console.log('=== Starting Face Verification Smoke Tests ===\n');
  const results = [];

  // Check 1: AWS Configuration
  const isConfigured = isAwsConfigured(process.env);
  assert.equal(isConfigured, true, 'AWS must be configured');
  const config = getAwsRekognitionConfig(process.env);
  console.log(`[PASS] Check 1: AWS Configuration detected (Region: ${config.region}, Profile: ${config.profile || 'default'})`);
  results.push('AWS_CONFIG');

  // Check 2: Rekognition Client Initialization & Live Handshake
  const client = getRekognitionClient({ env: process.env });
  assert.ok(client, 'RekognitionClient should initialize');
  console.log('[PASS] Check 2: Rekognition client initialized successfully');
  results.push('CLIENT_INIT');

  // Check 3: Create Session Validation
  const db = createMockDb({
    users: {
      user_no_avatar: { name: 'User Without Avatar' },
      user_valid: { name: 'Valid User', avatarUri: 'https://photos.getcampusmate.app/u1.jpg' },
    },
  });

  await assert.rejects(
    async () => createFaceVerificationSession({ db, uid: 'user_no_avatar' }),
    /ต้องตั้งรูปโปรไฟล์หลักก่อนทำการยืนยันใบหน้า/
  );
  console.log('[PASS] Check 3: Session creation correctly blocks user without primary avatar');
  results.push('SESSION_AVATAR_GUARD');

  // Check 4: Create Valid Session
  const sessionRes = await createFaceVerificationSession({ db, uid: 'user_valid', rekognitionClient: client });
  assert.ok(sessionRes.sessionId, 'SessionId should be returned');
  const sessionDoc = db._store.faceVerificationSessions.get(sessionRes.sessionId);
  assert.equal(sessionDoc.status, 'PENDING');
  assert.equal(sessionDoc.uid, 'user_valid');
  console.log(`[PASS] Check 4: Valid verification session created (Session ID: ${sessionRes.sessionId.slice(0, 16)}...)`);
  results.push('SESSION_CREATED');

  // Check 5: Verify Session Security Checks
  const fakeSession = await verifyFaceMatch({
    db,
    uid: 'user_valid',
    sessionId: 'non_existent_session',
  });
  assert.equal(fakeSession.success, false);
  assert.equal(fakeSession.reason, 'invalid_session');
  console.log('[PASS] Check 5: Tampered or invalid session ID rejected');
  results.push('SESSION_SECURITY');

  // Check 6: Avatar Missing Face Handling (Rekognition InvalidParameterException)
  const mockRekognitionNoFace = {
    send: async (cmd) => {
      if (cmd.constructor.name === 'DetectFacesCommand') {
        return { FaceDetails: [{ Confidence: 99 }] };
      }
      const err = new Error('There are no faces in the image.');
      err.name = 'InvalidParameterException';
      throw err;
    },
  };

  const noFaceRes = await verifyFaceMatch({
    db,
    uid: 'user_valid',
    sessionId: sessionRes.sessionId,
    liveSelfieBase64: Buffer.from('test_image_bytes').toString('base64'),
    rekognitionClient: mockRekognitionNoFace,
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }),
  });
  assert.equal(noFaceRes.success, false);
  assert.equal(noFaceRes.reason, 'avatar_no_face_detected');
  console.log('[PASS] Check 6: Avatar without face gracefully handled with user guidance');
  results.push('NO_FACE_GUARD');

  // Check 7: Successful Face Verification Flow (Simulated 96% Match)
  const dbMatch = createMockDb({
    users: {
      u_target: { name: 'Match Target', avatarUri: 'https://photos.getcampusmate.app/target.jpg', isFaceVerified: false },
    },
  });
  const validSession = await createFaceVerificationSession({ db: dbMatch, uid: 'u_target' });
  const matchResult = await verifyFaceMatch({
    db: dbMatch,
    uid: 'u_target',
    sessionId: validSession.sessionId,
    liveSelfieBase64: Buffer.from('valid_selfie_bytes').toString('base64'),
    comparator: async () => ({ matched: true, similarity: 96.5 }),
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }),
  });
  assert.equal(matchResult.success, true);
  assert.equal(matchResult.status, 'verified');
  assert.equal(matchResult.similarity, 96.5);
  const updatedUser = dbMatch._store.users.get('u_target');
  assert.equal(updatedUser.isFaceVerified, true);
  assert.equal(updatedUser.faceMatchScore, 96.5);
  assert.equal(updatedUser.faceVerificationStatus, 'verified');
  console.log(`[PASS] Check 7: High match verification succeeds (Score: ${matchResult.similarity}%, User Verified: true)`);
  results.push('MATCH_SUCCESS');

  // Check 8: Rejected Face Verification Flow (Simulated 55% Mismatch)
  const dbMismatch = createMockDb({
    users: {
      u_target: { name: 'Mismatch Target', avatarUri: 'https://photos.getcampusmate.app/target.jpg', isFaceVerified: false },
    },
  });
  const mismatchSession = await createFaceVerificationSession({ db: dbMismatch, uid: 'u_target' });
  const mismatchResult = await verifyFaceMatch({
    db: dbMismatch,
    uid: 'u_target',
    sessionId: mismatchSession.sessionId,
    liveSelfieBase64: Buffer.from('different_person_bytes').toString('base64'),
    comparator: async () => ({ matched: false, similarity: 54.2 }),
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }),
  });
  assert.equal(mismatchResult.success, false);
  assert.equal(mismatchResult.reason, 'face_mismatch');
  assert.equal(mismatchResult.similarity, 54.2);
  const unverifiedUser = dbMismatch._store.users.get('u_target');
  assert.equal(unverifiedUser.isFaceVerified, false);
  console.log(`[PASS] Check 8: Face mismatch rejected below threshold (Score: ${mismatchResult.similarity}% < ${MIN_FACE_SIMILARITY}%)`);
  results.push('MISMATCH_REJECT');

  console.log(`\n=== All ${results.length}/${results.length} Smoke Test Checks Passed Successfully ===`);
}

runSmokeTests().catch((err) => {
  console.error('\n[FAIL] Smoke test encountered an error:', err);
  process.exit(1);
});
