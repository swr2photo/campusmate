import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as firestore from 'firebase/firestore';
import { initializeApp as adminApp } from 'firebase-admin/app';
import { getFirestore as adminDb } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, deleteDoc, doc, getFirestore, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
const projectId = 'demo-campusmate';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
adminApp({ projectId });
const cid = `video-test-${Date.now()}`;
await adminDb().doc(`conversations/${cid}`).set({ participants: ['alice', 'bob'] });
function client(uid) {
  const db = getFirestore(initializeApp({ projectId, apiKey: 'demo-key' }, `${uid}-${Math.random()}`));
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port), { mockUserToken: { sub: uid } });
  return db;
}
const alice = client('alice'), bob = client('bob'), secondBob = client('bob'), eve = client('eve');
const ref = (db, id) => doc(db, 'conversations', cid, 'messages', id);
const record = (id, videoMode = 'once', videoDuration = 60000) => ({ id, senderId: 'alice', createdAt: serverTimestamp(), time: serverTimestamp(), encrypted: true, encryptionVersion: 1, nonce: 'a'.repeat(32), ciphertext: 'a'.repeat(100), videoMode, videoDuration });
const denied = async operation => assert.rejects(operation, e => e.code === 'permission-denied');
for (const mode of ['once', 'replay', 'chat']) await setDoc(ref(alice, mode), record(mode, mode));
await denied(setDoc(ref(alice, 'long'), record('long', 'once', 60001)));
await denied(setDoc(ref(alice, 'invalid'), record('invalid', 'bad')));
await denied(setDoc(ref(eve, 'eve'), record('eve')));
await denied(updateDoc(ref(bob, 'once'), { videoMode: 'chat' }));
const receipt = (db, mid = 'once', uid = 'bob') => doc(ref(db, mid), 'videoViews', uid);
await denied(setDoc(receipt(eve, 'once', 'eve'), { viewedAt: serverTimestamp() }));
await denied(setDoc(receipt(bob, 'once', 'alice'), { viewedAt: serverTimestamp() }));
await denied(setDoc(receipt(bob, 'replay'), { viewedAt: serverTimestamp() }));
const require = createRequire(import.meta.url);
const presetRequire = createRequire(require.resolve('babel-preset-expo'));
const code = require('@babel/core').transformSync(readFileSync('src/services/chatVideoService.js', 'utf8'), {
  babelrc: false, configFile: false, plugins: [presetRequire.resolve('@babel/plugin-transform-modules-commonjs')],
}).code;
function claim(db) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (id === 'firebase/firestore') return firestore;
    if (id === './dbService') return { requireFirebase: () => ({ db }) };
    return {};
  }, module, module.exports);
  return module.exports.claimOnceVideo(cid, 'once', 'bob');
}
const results = await Promise.allSettled([claim(bob), claim(secondBob)]);
assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
await assert.rejects(claim(bob), /ถูกเปิดดูแล้ว/);
await denied(updateDoc(receipt(bob), { viewedAt: serverTimestamp() }));
await denied(deleteDoc(receipt(bob)));
console.log('PASS: video metadata rules, participant access, immutable receipts, and simultaneous-device once-only claim');
process.exit(0);
