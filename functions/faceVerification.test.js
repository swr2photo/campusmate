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
  isAllowedAvatarUrl,
  isAutoVerifiedEmail,
  shouldRevokeFaceVerification,
  FaceVerificationError,
  COOLDOWN_MS,
  MAX_FAILURES_PER_WINDOW,
  MAX_SESSIONS_PER_WINDOW,
} from './faceVerification.js';

const HOSTS = ['cdn.example.com'];
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const SELFIE = JPEG.toString('base64');

function createMockDb(initialData = {}) {
  const store = {
    users: new Map(Object.entries(initialData.users || {})),
    profiles: new Map(Object.entries(initialData.profiles || {})),
    faceVerificationSessions: new Map(Object.entries(initialData.sessions || {})),
  };
  const ref = (colName, docId) => ({
    get: async () => ({
      exists: store[colName]?.has(docId) ?? false,
      data: () => store[colName]?.get(docId),
    }),
    set: async (data) => {
      if (!store[colName]) store[colName] = new Map();
      store[colName].set(docId, data);
    },
    update: async (data) => {
      if (!store[colName]?.has(docId)) throw new Error(`Doc ${docId} does not exist in ${colName}`);
      store[colName].set(docId, { ...store[colName].get(docId), ...data });
    },
  });
  // Firestore transactions are serializable; model that with a queue.
  let queue = Promise.resolve();
  return {
    collection: (colName) => ({ doc: (docId) => ref(colName, docId) }),
    runTransaction: (body) => {
      const run = queue.then(() => body({ get: (r) => r.get(), update: (r, data) => r.update(data) }));
      queue = run.catch(() => {});
      return run;
    },
    _store: store,
  };
}

const okAvatar = async () => ({ ok: true, headers: { get: () => null }, arrayBuffer: async () => JPEG });

function pendingSession(now, extra = {}) {
  return { sessionId: 's1', uid: 'u1', avatarUri: 'https://cdn.example.com/u1.jpg', status: 'PENDING', expiresAt: now + 60_000, ...extra };
}

function dbWithSession(now, extra = {}, users = {}) {
  return createMockDb({
    users: { u1: { avatarUri: 'https://cdn.example.com/u1.jpg', isFaceVerified: false }, ...users },
    sessions: { s1: pendingSession(now, extra) },
  });
}

test('createFaceVerificationSession requires valid uid and avatarUri', async () => {
  const db = createMockDb({
    users: {
      u_no_avatar: { name: 'Test User' },
      u_with_avatar: { name: 'Test User', avatarUri: 'https://cdn.example.com/photo.jpg' },
    },
  });
  await assert.rejects(() => createFaceVerificationSession({ db, uid: '' }), /กรุณาระบุรหัสผู้ใช้งานให้ถูกต้อง/);
  await assert.rejects(() => createFaceVerificationSession({ db, uid: 'u_not_found' }), /ไม่พบข้อมูลผู้ใช้งาน/);
  await assert.rejects(() => createFaceVerificationSession({ db, uid: 'u_no_avatar' }), /ต้องตั้งรูปโปรไฟล์หลักก่อนทำการยืนยันใบหน้า/);

  const res = await createFaceVerificationSession({ db, uid: 'u_with_avatar' });
  assert.match(res.sessionId, /^session_[0-9a-f]{32}$/);
  const session = db._store.faceVerificationSessions.get(res.sessionId);
  assert.equal(session.uid, 'u_with_avatar');
  assert.equal(session.avatarUri, 'https://cdn.example.com/photo.jpg');
  assert.equal(session.status, 'PENDING');
  assert.ok(session.policyVersion);
});

test('verifyFaceMatch rejects invalid, foreign, used or expired sessions', async () => {
  const now = 100_000;
  const db = createMockDb({
    users: { u1: { avatarUri: 'https://cdn.example.com/u1.jpg' } },
    sessions: {
      s_other: pendingSession(now, { uid: 'u2' }),
      s_used: pendingSession(now, { status: 'COMPLETED' }),
      s_expired: pendingSession(now, { expiresAt: now - 1 }),
    },
  });
  const run = (sessionId) => verifyFaceMatch({ db, uid: 'u1', sessionId, now, avatarHosts: HOSTS });
  assert.equal((await run('s_missing')).reason, 'invalid_session');
  assert.equal((await run('s_other')).reason, 'session_forbidden');
  assert.equal((await run('s_used')).reason, 'session_already_used');
  assert.equal((await run('s_expired')).reason, 'session_expired');
  // A foreign session is never consumed by the attacker.
  assert.equal(db._store.faceVerificationSessions.get('s_other').status, 'PENDING');
});

test('a match verifies on the server, pins the photo and returns no score', async () => {
  const now = 100_000;
  const db = dbWithSession(now);
  const res = await verifyFaceMatch({
    db, uid: 'u1', sessionId: 's1', liveSelfieBase64: SELFIE, now,
    fetchImpl: okAvatar, comparator: async () => ({ matched: true, similarity: 94.75 }), avatarHosts: HOSTS,
  });
  assert.deepEqual(Object.keys(res).sort(), ['message', 'status', 'success']);
  assert.equal(res.success, true);
  assert.doesNotMatch(res.message, /\d/);
  const user = db._store.users.get('u1');
  assert.equal(user.isFaceVerified, true);
  assert.equal(user.faceMatchScore, null);
  assert.equal(user.faceVerificationStatus, 'verified');
  assert.equal(db._store.faceVerifications.get('u1').avatarUri, 'https://cdn.example.com/u1.jpg');
  assert.equal(db._store.faceVerificationSessions.get('s1').status, 'COMPLETED');
});

test('a mismatch stays unverified without revealing the score', async () => {
  const now = 100_000;
  const db = dbWithSession(now);
  const res = await verifyFaceMatch({
    db, uid: 'u1', sessionId: 's1', liveSelfieBase64: SELFIE, now,
    fetchImpl: okAvatar, comparator: async () => ({ matched: true, similarity: 62.4 }), avatarHosts: HOSTS,
  });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'face_mismatch');
  assert.equal(res.similarity, undefined);
  assert.doesNotMatch(res.message, /\d/);
  assert.equal(db._store.users.get('u1').isFaceVerified, false);
  assert.equal(db._store.faceVerificationSessions.get('s1').status, 'FAILED');
});

test('a session is single-use: replaying it never compares again', async () => {
  const now = 100_000;
  const db = dbWithSession(now);
  let compares = 0;
  const comparator = async () => { compares += 1; return { matched: false, similarity: 10 }; };
  const args = { db, uid: 'u1', sessionId: 's1', liveSelfieBase64: SELFIE, now, fetchImpl: okAvatar, comparator, avatarHosts: HOSTS };
  assert.equal((await verifyFaceMatch(args)).reason, 'face_mismatch');
  assert.equal((await verifyFaceMatch({ ...args, comparator: async () => { compares += 1; return { matched: true, similarity: 99 }; } })).reason, 'session_already_used');
  assert.equal(compares, 1);
  assert.equal(db._store.users.get('u1').isFaceVerified, false);
});

test('two concurrent completions produce exactly one evaluation', async () => {
  const now = 100_000;
  const db = dbWithSession(now);
  let compares = 0;
  const comparator = async () => { compares += 1; await new Promise((r) => setTimeout(r, 5)); return { matched: true, similarity: 99 }; };
  const args = { db, uid: 'u1', sessionId: 's1', liveSelfieBase64: SELFIE, now, fetchImpl: okAvatar, comparator, avatarHosts: HOSTS };
  const results = await Promise.all([verifyFaceMatch(args), verifyFaceMatch(args)]);
  assert.equal(compares, 1);
  assert.equal(results.filter((r) => r.success).length, 1);
  assert.equal(results.filter((r) => r.reason === 'session_already_used').length, 1);
});

test('a client-written profile email can never unlock the admin shortcut', async () => {
  const now = 100_000;
  // The attacker wrote the super-admin address into their own profile doc.
  const db = dbWithSession(now, {}, { u1: { avatarUri: 'https://cdn.example.com/u1.jpg', email: '6710210317@psu.ac.th', campusEmail: '6710210317@psu.ac.th' } });
  const res = await verifyFaceMatch({
    db, uid: 'u1', sessionId: 's1', now, avatarHosts: HOSTS,
    authEmail: 'attacker@psu.ac.th', authEmailVerified: true,
    comparator: async () => { throw new Error('no selfie, no compare'); },
  });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'invalid_selfie');
  assert.equal(db._store.users.get('u1').isFaceVerified, undefined);
});

test('the admin shortcut needs a verified auth email and stores no fake score', async () => {
  assert.equal(isAutoVerifiedEmail('6710210317@psu.ac.th', false), false);
  assert.equal(isAutoVerifiedEmail('6710210317@psu.ac.th', true), true);
  assert.equal(isAutoVerifiedEmail(' 6710210317@PSU.ac.th ', true), true);

  const now = 100_000;
  const unverifiedEmail = dbWithSession(now);
  const denied = await verifyFaceMatch({
    db: unverifiedEmail, uid: 'u1', sessionId: 's1', now, avatarHosts: HOSTS,
    authEmail: '6710210317@psu.ac.th', authEmailVerified: false,
  });
  assert.equal(denied.success, false);

  const db = dbWithSession(now);
  const res = await verifyFaceMatch({
    db, uid: 'u1', sessionId: 's1', now, avatarHosts: HOSTS,
    authEmail: '6710210317@psu.ac.th', authEmailVerified: true,
  });
  assert.equal(res.success, true);
  assert.equal(db._store.users.get('u1').faceMatchScore, null);
  assert.equal(db._store.faceVerifications.get('u1').method, 'admin');
});

test('untrusted photo hosts are refused before any network request', async () => {
  const hostile = [
    'http://cdn.example.com/u1.jpg',
    'https://169.254.169.254/latest/meta-data/',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://cdn.example.com.evil.test/u1.jpg',
    'https://user:pass@cdn.example.com/u1.jpg',
    'https://cdn.example.com:8443/u1.jpg',
    'file:///etc/passwd',
    'not a url',
  ];
  for (const url of hostile) assert.equal(isAllowedAvatarUrl(url, HOSTS), false, url);
  assert.equal(isAllowedAvatarUrl('https://cdn.example.com/u1.jpg', HOSTS), true);

  const now = 100_000;
  const db = dbWithSession(now, { avatarUri: 'https://169.254.169.254/latest/meta-data/' });
  let fetched = false;
  const res = await verifyFaceMatch({
    db, uid: 'u1', sessionId: 's1', liveSelfieBase64: SELFIE, now, avatarHosts: HOSTS,
    fetchImpl: async () => { fetched = true; return okAvatar(); },
    comparator: async () => ({ matched: true, similarity: 99 }),
  });
  assert.equal(res.reason, 'avatar_untrusted_host');
  assert.equal(fetched, false);
});

test('forged or oversized images are rejected before comparison', async () => {
  const now = 100_000;
  const compareNever = async () => { throw new Error('must not compare'); };

  const notImage = dbWithSession(now);
  const res1 = await verifyFaceMatch({
    db: notImage, uid: 'u1', sessionId: 's1', liveSelfieBase64: SELFIE, now, avatarHosts: HOSTS, comparator: compareNever,
    fetchImpl: async () => ({ ok: true, headers: { get: () => null }, arrayBuffer: async () => Buffer.from('<html>not an image</html>') }),
  });
  assert.equal(res1.reason, 'avatar_unusable');

  const forgedSelfie = dbWithSession(now);
  const res2 = await verifyFaceMatch({
    db: forgedSelfie, uid: 'u1', sessionId: 's1', now, avatarHosts: HOSTS, comparator: compareNever, fetchImpl: okAvatar,
    liveSelfieBase64: Buffer.from('GIF89a-not-allowed').toString('base64'),
  });
  assert.equal(res2.reason, 'invalid_selfie');

  const huge = dbWithSession(now);
  const res3 = await verifyFaceMatch({
    db: huge, uid: 'u1', sessionId: 's1', now, avatarHosts: HOSTS, comparator: compareNever, fetchImpl: okAvatar,
    liveSelfieBase64: Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)]).toString('base64'),
  });
  assert.equal(res3.reason, 'invalid_selfie');

  const declaredHuge = dbWithSession(now);
  const res4 = await verifyFaceMatch({
    db: declaredHuge, uid: 'u1', sessionId: 's1', liveSelfieBase64: SELFIE, now, avatarHosts: HOSTS, comparator: compareNever,
    fetchImpl: async () => ({ ok: true, headers: { get: () => String(50 * 1024 * 1024) }, arrayBuffer: async () => JPEG }),
  });
  assert.equal(res4.reason, 'avatar_unusable');
});

test('repeated mismatches trigger a cooldown, and session creation is capped', async () => {
  let now = 1_000_000;
  const db = createMockDb({ users: { u1: { avatarUri: 'https://cdn.example.com/u1.jpg' } } });
  for (let i = 0; i < MAX_FAILURES_PER_WINDOW; i += 1) {
    const { sessionId } = await createFaceVerificationSession({ db, uid: 'u1', now });
    const res = await verifyFaceMatch({
      db, uid: 'u1', sessionId, liveSelfieBase64: SELFIE, now, avatarHosts: HOSTS,
      fetchImpl: okAvatar, comparator: async () => ({ matched: false, similarity: 1 }),
    });
    assert.equal(res.reason, 'face_mismatch');
    now += 1000;
  }
  await assert.rejects(() => createFaceVerificationSession({ db, uid: 'u1', now }), (error) => error instanceof FaceVerificationError && error.code === 'rate_limited');
  now += COOLDOWN_MS;
  assert.ok((await createFaceVerificationSession({ db, uid: 'u1', now })).sessionId);

  const capped = createMockDb({ users: { u2: { avatarUri: 'https://cdn.example.com/u2.jpg' } } });
  for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i += 1) await createFaceVerificationSession({ db: capped, uid: 'u2', now: now + i });
  await assert.rejects(() => createFaceVerificationSession({ db: capped, uid: 'u2', now: now + MAX_SESSIONS_PER_WINDOW }), /บ่อยเกินไป/);
});

test('changing the main photo revokes the badge; admin-managed accounts are exempt', () => {
  const verified = { avatarUri: 'https://cdn.example.com/a.jpg', avatarRevision: 1, isFaceVerified: true };
  assert.equal(shouldRevokeFaceVerification(verified, { ...verified, avatarUri: 'https://cdn.example.com/b.jpg' }), true);
  assert.equal(shouldRevokeFaceVerification(verified, { ...verified, avatarRevision: 2 }), true);
  assert.equal(shouldRevokeFaceVerification(verified, { ...verified, bio: 'new bio' }), false);
  assert.equal(shouldRevokeFaceVerification(verified, { ...verified, avatarUri: 'x', isFaceVerified: false }), false);
  assert.equal(shouldRevokeFaceVerification(verified, { ...verified, avatarUri: 'x', autoVerifyFace: true }), false);
  assert.equal(shouldRevokeFaceVerification(null, verified), false);
  // Photo-only accounts (Google photoURL) are covered too.
  const google = { photoURL: 'https://lh3.googleusercontent.com/a', isFaceVerified: true };
  assert.equal(shouldRevokeFaceVerification(google, { ...google, photoURL: 'https://lh3.googleusercontent.com/b' }), true);
});

test('without Rekognition or a comparator the service fails closed', async () => {
  const now = 100_000;
  const db = dbWithSession(now);
  const res = await verifyFaceMatch({ db, uid: 'u1', sessionId: 's1', liveSelfieBase64: SELFIE, now, avatarHosts: HOSTS, fetchImpl: okAvatar });
  assert.equal(res.reason, 'service_unavailable');
  assert.notEqual(db._store.users.get('u1').isFaceVerified, true);
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
  assert.ok(getRekognitionClient({ env: { AWS_ACCESS_KEY_ID: 'AKIA_TEST', AWS_SECRET_ACCESS_KEY: 'SECRET_TEST', AWS_REGION: 'ap-southeast-1' } }));
});

test('verifyFaceMatch handles Rekognition no faces detected in avatar gracefully', async () => {
  const now = 100_000;
  const db = dbWithSession(now);
  const rekognitionClient = {
    send: async (cmd) => {
      if (cmd.constructor.name === 'DetectFacesCommand') return { FaceDetails: [{ Confidence: 99 }] };
      const err = new Error('There are no faces in the image.');
      err.name = 'InvalidParameterException';
      throw err;
    },
  };
  const res = await verifyFaceMatch({ db, uid: 'u1', sessionId: 's1', liveSelfieBase64: SELFIE, rekognitionClient, fetchImpl: okAvatar, now, avatarHosts: HOSTS });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'avatar_no_face_detected');
  assert.match(res.message, /ไม่พบใบหน้าที่ชัดเจนในรูปโปรไฟล์หลัก/);
});

test('CompareFaces uses the policy threshold and the best returned match', async () => {
  const now = 100_000;
  const sent = [];
  const rekognitionClient = {
    send: async (cmd) => {
      sent.push(cmd);
      if (cmd.constructor.name === 'DetectFacesCommand') return { FaceDetails: [{ Confidence: 99 }] };
      return { FaceMatches: [{ Similarity: 70 }, { Similarity: 96 }] };
    },
  };
  const db = dbWithSession(now);
  const res = await verifyFaceMatch({ db, uid: 'u1', sessionId: 's1', liveSelfieBase64: SELFIE, rekognitionClient, fetchImpl: okAvatar, now, avatarHosts: HOSTS });
  assert.equal(res.success, true);
  const compare = sent.find((cmd) => cmd.constructor.name === 'CompareFacesCommand');
  assert.equal(compare.input.SimilarityThreshold, 85);
  assert.ok(Buffer.isBuffer(compare.input.TargetImage.Bytes), 'reference photo is sent as bytes');
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

test('an obstructed selfie is rejected before loading the profile photo and consumes the session', async () => {
  const now = 100_000;
  const db = dbWithSession(now);
  const res = await verifyFaceMatch({
    db, uid: 'u1', sessionId: 's1', liveSelfieBase64: SELFIE, now, avatarHosts: HOSTS,
    rekognitionClient: { send: async () => ({ FaceDetails: [clearSelfie({ Sunglasses: { Value: true, Confidence: 97 } })] }) },
    fetchImpl: async () => { throw new Error('avatar should stay unused'); },
  });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'sunglasses');
  assert.equal(db._store.faceVerificationSessions.get('s1').status, 'FAILED');
});

test('the app own photo hosts are trusted by default, look-alikes are not', async () => {
  const { allowedAvatarHosts } = await import('./faceVerification.js');
  const hosts = allowedAvatarHosts({});
  for (const url of ['https://images.getcampusmate.app/users/u1/avatar.jpg', 'https://pub-73287d4af57d4e788f89d95e71d2ea70.r2.dev/users/u1/avatar.jpg']) {
    assert.equal(isAllowedAvatarUrl(url, hosts), true, url);
  }
  for (const url of ['https://images.getcampusmate.app.evil.test/users/u1/avatar.jpg', 'https://pub-00000000000000000000000000000000.r2.dev/users/u1/avatar.jpg', 'http://images.getcampusmate.app/users/u1/avatar.jpg']) {
    assert.equal(isAllowedAvatarUrl(url, hosts), false, url);
  }
});
