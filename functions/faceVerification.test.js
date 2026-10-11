import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFaceVerificationSession,
  verifyFaceMatch,
  assessSelfieFaces,
  isAwsConfigured,
  getAwsSecretNames,
  getAwsRekognitionConfig,
  getRekognitionClient,
  MIN_FACE_SIMILARITY,
  MIN_LIVENESS_CONFIDENCE,
} from './faceVerification.js';

function createMockDb(initialData = {}) {
  const store = {
    users: new Map(Object.entries(initialData.users || {})),
    profiles: new Map(Object.entries(initialData.profiles || {})),
    faceVerificationSessions: new Map(Object.entries(initialData.sessions || initialData.faceVerificationSessions || {})),
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

test('createFaceVerificationSession requires valid uid and avatarUri', async () => {
  const db = createMockDb({
    users: {
      u_no_avatar: { name: 'Test User' },
      u_with_avatar: { name: 'Test User', avatarUri: 'https://cdn.example.com/photo.jpg' },
    },
  });

  await assert.rejects(
    async () => createFaceVerificationSession({ db, uid: '' }),
    /กรุณาระบุรหัสผู้ใช้งานให้ถูกต้อง/
  );

  await assert.rejects(
    async () => createFaceVerificationSession({ db, uid: 'u_not_found' }),
    /ไม่พบข้อมูลผู้ใช้งาน/
  );

  await assert.rejects(
    async () => createFaceVerificationSession({ db, uid: 'u_no_avatar' }),
    /ต้องตั้งรูปโปรไฟล์หลักก่อนทำการยืนยันใบหน้า/
  );

  const res = await createFaceVerificationSession({ db, uid: 'u_with_avatar' });
  assert.ok(res.sessionId);

  const sessionDoc = db._store.faceVerificationSessions.get(res.sessionId);
  assert.equal(sessionDoc.uid, 'u_with_avatar');
  assert.equal(sessionDoc.avatarUri, 'https://cdn.example.com/photo.jpg');
  assert.equal(sessionDoc.status, 'PENDING');
});

test('verifyFaceMatch rejects invalid, foreign or expired sessions', async () => {
  const now = 100000;
  const db = createMockDb({
    users: {
      u1: { name: 'User 1', avatarUri: 'https://cdn.example.com/u1.jpg' },
    },
    sessions: {
      s_other: { sessionId: 's_other', uid: 'u2', status: 'PENDING', expiresAt: now + 5000 },
      s_used: { sessionId: 's_used', uid: 'u1', status: 'COMPLETED', expiresAt: now + 5000 },
      s_expired: { sessionId: 's_expired', uid: 'u1', status: 'PENDING', expiresAt: now - 1000 },
    },
  });

  const resInvalid = await verifyFaceMatch({ db, uid: 'u1', sessionId: 's_nonexistent', now });
  assert.equal(resInvalid.success, false);
  assert.equal(resInvalid.reason, 'invalid_session');

  const resForeign = await verifyFaceMatch({ db, uid: 'u1', sessionId: 's_other', now });
  assert.equal(resForeign.success, false);
  assert.equal(resForeign.reason, 'session_forbidden');

  const resUsed = await verifyFaceMatch({ db, uid: 'u1', sessionId: 's_used', now });
  assert.equal(resUsed.success, false);
  assert.equal(resUsed.reason, 'session_already_used');

  const resExpired = await verifyFaceMatch({ db, uid: 'u1', sessionId: 's_expired', now });
  assert.equal(resExpired.success, false);
  assert.equal(resExpired.reason, 'session_expired');
});

test('verifyFaceMatch succeeds when live selfie matches primary profile avatar', async () => {
  const now = 100000;
  const db = createMockDb({
    users: {
      u1: { name: 'User 1', avatarUri: 'https://cdn.example.com/u1.jpg', isFaceVerified: false },
    },
    sessions: {
      s_pending: {
        sessionId: 's_pending',
        uid: 'u1',
        avatarUri: 'https://cdn.example.com/u1.jpg',
        status: 'PENDING',
        expiresAt: now + 60000,
      },
    },
  });

  const mockFetch = async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });

  const mockComparator = async () => ({
    matched: true,
    similarity: 94.75,
  });

  const dummyBase64 = Buffer.from('dummy_selfie_bytes').toString('base64');
  const res = await verifyFaceMatch({
    db,
    uid: 'u1',
    sessionId: 's_pending',
    liveSelfieBase64: dummyBase64,
    fetchImpl: mockFetch,
    comparator: mockComparator,
    now,
  });

  assert.equal(res.success, true);
  assert.equal(res.status, 'verified');
  assert.equal(res.similarity, 94.75);

  const updatedUser = db._store.users.get('u1');
  assert.equal(updatedUser.isFaceVerified, true);
  assert.equal(updatedUser.faceMatchScore, 94.75);
  assert.equal(updatedUser.faceVerificationStatus, 'verified');

  const updatedSession = db._store.faceVerificationSessions.get('s_pending');
  assert.equal(updatedSession.status, 'COMPLETED');
});

test('verifyFaceMatch fails when face similarity is below threshold', async () => {
  const now = 100000;
  const db = createMockDb({
    users: {
      u1: { name: 'User 1', avatarUri: 'https://cdn.example.com/u1.jpg', isFaceVerified: false },
    },
    sessions: {
      s_pending: {
        sessionId: 's_pending',
        uid: 'u1',
        avatarUri: 'https://cdn.example.com/u1.jpg',
        status: 'PENDING',
        expiresAt: now + 60000,
      },
    },
  });

  const mockFetch = async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });

  const mockComparator = async () => ({
    matched: false,
    similarity: 62.4,
  });

  const dummyBase64 = Buffer.from('dummy_selfie_bytes').toString('base64');
  const res = await verifyFaceMatch({
    db,
    uid: 'u1',
    sessionId: 's_pending',
    liveSelfieBase64: dummyBase64,
    fetchImpl: mockFetch,
    comparator: mockComparator,
    now,
  });

  assert.equal(res.success, false);
  assert.equal(res.reason, 'face_mismatch');
  assert.equal(res.similarity, 62.4);

  const updatedUser = db._store.users.get('u1');
  assert.equal(updatedUser.isFaceVerified, false);

  const updatedSession = db._store.faceVerificationSessions.get('s_pending');
  assert.equal(updatedSession.status, 'FAILED');
  assert.equal(updatedSession.reason, 'face_mismatch');
});

test('isAwsConfigured verifies accessKeyId and secretAccessKey', () => {
  assert.equal(isAwsConfigured({}), false);
  assert.equal(isAwsConfigured({ AWS_ACCESS_KEY_ID: 'test_key' }), false);
  assert.equal(isAwsConfigured({ AWS_SECRET_ACCESS_KEY: 'test_secret' }), false);
  assert.equal(isAwsConfigured({ AWS_ACCESS_KEY_ID: 'test_key', AWS_SECRET_ACCESS_KEY: 'test_secret' }), true);
});

test('getAwsSecretNames returns secret names only when enabled', () => {
  assert.deepEqual(getAwsSecretNames({}), []);
  assert.deepEqual(getAwsSecretNames({ CAMPUSMATE_AWS_SECRETS_ENABLED: 'false' }), []);
  assert.deepEqual(getAwsSecretNames({ CAMPUSMATE_AWS_SECRETS_ENABLED: 'true' }), ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']);
});

test('getAwsRekognitionConfig provides sensible defaults and parses environment', () => {
  const emptyConfig = getAwsRekognitionConfig({});
  assert.equal(emptyConfig.region, 'ap-southeast-2');
  assert.equal(emptyConfig.isConfigured, false);

  const customConfig = getAwsRekognitionConfig({
    AWS_REGION: 'ap-southeast-2',
    AWS_ACCESS_KEY_ID: 'AKIA_TEST',
    AWS_SECRET_ACCESS_KEY: 'SECRET_TEST',
    AWS_LIVENESS_TEMP_BUCKET: 'my-liveness-bucket',
  });
  assert.equal(customConfig.region, 'ap-southeast-2');
  assert.equal(customConfig.accessKeyId, 'AKIA_TEST');
  assert.equal(customConfig.secretAccessKey, 'SECRET_TEST');
  assert.equal(customConfig.bucketName, 'my-liveness-bucket');
  assert.equal(customConfig.isConfigured, true);
});

test('getRekognitionClient returns null without credentials and client with credentials', () => {
  assert.equal(getRekognitionClient({ env: {} }), null);
  const client = getRekognitionClient({
    env: {
      AWS_ACCESS_KEY_ID: 'AKIA_TEST',
      AWS_SECRET_ACCESS_KEY: 'SECRET_TEST',
      AWS_REGION: 'ap-southeast-1',
    },
  });
  assert.ok(client);
});

test('verifyFaceMatch handles Rekognition no faces detected in avatar gracefully', async () => {
  const now = 100000;
  const db = createMockDb({
    users: {
      u1: { name: 'User 1', avatarUri: 'https://cdn.example.com/u1.jpg', isFaceVerified: false },
    },
    sessions: {
      s_pending: {
        sessionId: 's_pending',
        uid: 'u1',
        avatarUri: 'https://cdn.example.com/u1.jpg',
        status: 'PENDING',
        expiresAt: now + 60000,
      },
    },
  });

  const mockFetch = async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });

  // Mock rekognition client that throws InvalidParameterException
  const mockRekognitionClient = {
    send: async (cmd) => {
      // If DetectFacesCommand, return 1 face
      if (cmd.constructor.name === 'DetectFacesCommand') {
        return { FaceDetails: [{ Confidence: 99 }] };
      }
      // If CompareFacesCommand, throw InvalidParameterException
      const err = new Error('There are no faces in the image.');
      err.name = 'InvalidParameterException';
      throw err;
    },
  };

  const dummyBase64 = Buffer.from('dummy_selfie_bytes').toString('base64');
  const res = await verifyFaceMatch({
    db,
    uid: 'u1',
    sessionId: 's_pending',
    liveSelfieBase64: dummyBase64,
    rekognitionClient: mockRekognitionClient,
    fetchImpl: mockFetch,
    now,
  });

  assert.equal(res.success, false);
  assert.equal(res.reason, 'avatar_no_face_detected');
  assert.match(res.message, /ไม่พบใบหน้าที่ชัดเจนในรูปโปรไฟล์หลัก/);
});

function clearSelfie(overrides = {}) {
  return {
    Confidence: 99,
    BoundingBox: { Width: 0.46, Height: 0.58 },
    Quality: { Brightness: 58, Sharpness: 74 },
    Pose: { Yaw: 3, Pitch: 2, Roll: 1 },
    Sunglasses: { Value: false, Confidence: 99 },
    FaceOccluded: { Value: false, Confidence: 99 },
    ...overrides,
  };
}

test('assessSelfieFaces accepts a clear front-facing selfie and rejects unusable ones', () => {
  assert.equal(assessSelfieFaces([clearSelfie()]).ok, true);
  assert.equal(assessSelfieFaces([]).reason, 'no_face_detected');
  assert.equal(assessSelfieFaces([clearSelfie(), clearSelfie()]).reason, 'multiple_faces_detected');
  assert.equal(assessSelfieFaces([clearSelfie({ Confidence: 40 })]).reason, 'low_face_confidence');
  assert.equal(assessSelfieFaces([clearSelfie({ BoundingBox: { Width: 0.08, Height: 0.1 } })]).reason, 'face_too_small');
  assert.equal(assessSelfieFaces([clearSelfie({ Quality: { Brightness: 58, Sharpness: 4 } })]).reason, 'face_blurry');
  assert.equal(assessSelfieFaces([clearSelfie({ Quality: { Brightness: 4, Sharpness: 74 } })]).reason, 'face_lighting');
  assert.equal(assessSelfieFaces([clearSelfie({ Pose: { Yaw: 50, Pitch: 0, Roll: 0 } })]).reason, 'face_pose');
  assert.equal(assessSelfieFaces([clearSelfie({ Sunglasses: { Value: true, Confidence: 96 } })]).reason, 'sunglasses');
  assert.equal(assessSelfieFaces([clearSelfie({ FaceOccluded: { Value: true, Confidence: 91 } })]).reason, 'face_occluded');
  assert.equal(assessSelfieFaces([{ Confidence: 99 }]).ok, true);
});

test('verifyFaceMatch rejects an obstructed selfie before loading the profile photo', async () => {
  const now = 100000;
  const db = createMockDb({
    users: { u1: { avatarUri: 'https://cdn.example.com/u1.jpg' } },
    sessions: {
      s_pending: {
        sessionId: 's_pending',
        uid: 'u1',
        avatarUri: 'https://cdn.example.com/u1.jpg',
        status: 'PENDING',
        expiresAt: now + 60000,
      },
    },
  });

  const res = await verifyFaceMatch({
    db,
    uid: 'u1',
    sessionId: 's_pending',
    liveSelfieBase64: Buffer.from('clear-enough-selfie-bytes').toString('base64'),
    rekognitionClient: {
      send: async () => ({ FaceDetails: [clearSelfie({ Sunglasses: { Value: true, Confidence: 97 } })] }),
    },
    fetchImpl: async () => { throw new Error('avatar should stay unused'); },
    comparator: async () => { throw new Error('compare should stay unused'); },
    now,
  });

  assert.equal(res.success, false);
  assert.equal(res.reason, 'sunglasses');
  assert.equal(db._store.faceVerificationSessions.get('s_pending').status, 'PENDING');
});

test('verifyFaceMatch automatically verifies designated emails (6710210317@psu.ac.th)', async () => {
  const now = 1_700_000_000_000;
  const db = createMockDb({
    users: {
      u_super: {
        email: '6710210317@psu.ac.th',
        name: 'Game',
        avatarUri: 'https://example.test/game.jpg',
      },
    },
    profiles: {
      u_super: {
        name: 'Game',
      },
    },
    faceVerificationSessions: {
      s_super: {
        uid: 'u_super',
        status: 'PENDING',
        expiresAt: now + 60_000,
      },
    },
  });

  const res = await verifyFaceMatch({
    db,
    uid: 'u_super',
    sessionId: 's_super',
    now,
  });

  assert.equal(res.success, true);
  assert.equal(res.similarity, 100);
  assert.equal(db._store.users.get('u_super').isFaceVerified, true);
  assert.equal(db._store.users.get('u_super').faceMatchScore, 100);
  assert.equal(db._store.profiles.get('u_super').isFaceVerified, true);
  assert.equal(db._store.faceVerificationSessions.get('s_super').status, 'COMPLETED');
});

