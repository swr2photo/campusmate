import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function pure(file, names) {
  const source = readFileSync(file, 'utf8').replace(/^export /gm, '');
  return vm.runInNewContext(`${source}\n({${names}})`, { setTimeout, clearTimeout, console });
}
const { createImageOutbox } = pure('src/services/imageOutbox.js', 'createImageOutbox');
const prefs = pure('src/utils/appPreferences.js', 'normalizePreferences,validatePreferencePatch,canAutoplay');
const { presencePresentation } = pure('src/utils/chatPresence.js', 'presencePresentation');
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } assert.fail('queue did not settle'); }
const item = id => ({ id, uri: `file:///${id}.jpg`, conversationId: 'room', createdAt: 123, viewMode: 'once' });
function fixture(extra = {}) {
  const writes = [], uploads = [], sends = [];
  const engine = createImageOutbox({ isCurrent: () => true,
    persist: async tasks => { writes.push(JSON.parse(JSON.stringify(tasks))); },
    prepare: async task => ({ uri: `file:///durable/${task.id}.jpg`, prepared: true }),
    upload: async (task, progress) => { uploads.push(task); progress({ stage: 'uploading', progress: 0.5 }); return `https://media/${task.id}`; },
    send: async task => { sends.push(task); return true; }, ...extra });
  return { engine, writes, uploads, sends };
}

test('canonical settings retain online/audio values; typo/legacy keys fail visibly', () => {
  const value = prefs.normalizePreferences({ showOnlineStatus: false, muteAutoplayVideo: false, notifications: { push: false, team: false } });
  assert.equal(value.showOnlineStatus, false); assert.equal(value.muteAutoplayVideo, false);
  assert.equal(value.notifications.push, false); assert.equal(value.notifications.sms, false);
  assert.throws(() => prefs.validatePreferencePatch({ autoplayWifiOnly: true }));
  assert.throws(() => prefs.validatePreferencePatch({ showOnlineStatus: 'false' }));
  assert.throws(() => prefs.validatePreferencePatch({ notifications: { unknown: true } }));
  assert.throws(() => prefs.validatePreferencePatch({ publicUsername: 'invalid user' }));
  prefs.validatePreferencePatch({ publicUsername: 'alice_1', notifications: { team: true }, autoplay: 'wifi' });
  assert.equal(prefs.canAutoplay('wifi', { type: 'cellular', isConnected: true }), false);
  assert.equal(prefs.canAutoplay('wifi', { type: 'wifi', isConnected: true }), true);
  assert.equal(prefs.canAutoplay('never', { type: 'wifi', isConnected: true }), false);
});

test('presence never invents activity; hidden and expired leases cannot show online', () => {
  const now = 1800000000000;
  assert.equal(presencePresentation(null, now).label, '');
  assert.equal(presencePresentation({ visible: false, isOnline: true, expiresAt: now + 90000 }, now).label, '');
  assert.equal(presencePresentation({ visible: true, isOnline: true, expiresAt: now + 1 }, now).isOnline, true);
  const expired = presencePresentation({ visible: true, isOnline: true, expiresAt: now - 1, lastActiveAt: now - 120000 }, now);
  assert.equal(expired.isOnline, false); assert.equal(expired.label, 'ใช้งานเมื่อ 2 นาทีที่แล้ว');
});

test('enqueue publishes local image synchronously, then native progress, then acknowledgement', async () => {
  let release; const stages = [];
  const f = fixture({ send: () => new Promise(resolve => { release = resolve; }) });
  f.engine.subscribe(tasks => stages.push(tasks)); f.engine.enqueue([item('a')]);
  assert.equal(f.engine.snapshot()[0].uri, 'file:///a.jpg'); assert.equal(f.uploads.length, 0);
  await until(() => !!release);
  assert.ok(stages.some(tasks => tasks[0]?.progress === 0.5));
  assert.equal(f.engine.snapshot().length, 1, 'not delivered before message acknowledgement');
  release(true); await until(() => f.engine.snapshot().length === 0); f.engine.dispose();
});

test('offline images are persisted/prepared and resume without leaving the room open', async () => {
  const f = fixture(); f.engine.setOnline(false); f.engine.enqueue([item('offline')]);
  await until(() => f.engine.snapshot()[0]?.prepared && f.engine.snapshot()[0]?.stage === 'waiting');
  assert.equal(f.uploads.length, 0); assert.ok(f.writes.some(tasks => tasks[0]?.prepared));
  f.engine.setOnline(true); await until(() => f.sends.length === 1 && f.engine.snapshot().length === 0); f.engine.dispose();
});

test('message commit retry keeps the stable ID and reuses the completed upload', async () => {
  let attempts = 0;
  const f = fixture({ send: async () => { if (++attempts === 1) throw Error('network'); return true; } });
  f.engine.enqueue([item('retry')]); await until(() => f.engine.snapshot()[0]?.status === 'failed');
  assert.equal(f.engine.snapshot()[0].downloadUrl, 'https://media/retry');
  f.engine.retry('retry'); await until(() => f.engine.snapshot().length === 0);
  assert.equal(f.uploads.length, 1); assert.equal(attempts, 2); f.engine.dispose();
});

test('failed moderation retains the preview but disables retry and never commits a message', async () => {
  const f = fixture({ upload: async () => { throw Object.assign(Error('unsafe'), { isModerationViolation: true }); } });
  f.engine.enqueue([item('blocked')]); await until(() => f.engine.snapshot()[0]?.status === 'failed');
  assert.equal(f.engine.snapshot()[0].retryable, false); f.engine.retry('blocked'); await pause();
  assert.equal(f.sends.length, 0); assert.equal(f.engine.snapshot()[0].status, 'failed');
  await f.engine.remove('blocked'); assert.equal(f.engine.snapshot().length, 0); f.engine.dispose();
});

test('queue limits simultaneous uploads to two and never sends after an account switch', async () => {
  const releases = []; let current = true, inFlight = 0, peak = 0;
  const f = fixture({ isCurrent: () => current, upload: () => new Promise(resolve => {
    inFlight++; peak = Math.max(peak, inFlight); releases.push(() => { inFlight--; resolve('https://media/result'); });
  }) });
  f.engine.enqueue([item('one'), item('two'), item('three')]); await until(() => releases.length === 2);
  assert.equal(peak, 2); current = false; releases.splice(0).forEach(fn => fn()); await pause(); await pause();
  assert.equal(f.sends.length, 0); assert.equal(releases.length, 0); assert.equal(f.engine.snapshot().length, 3); f.engine.dispose();
});

test('disk failure prevents upload and retains an actionable failed preview', async () => {
  const f = fixture({ persist: async () => { throw Error('disk full'); } });
  f.engine.enqueue([item('disk')]); await until(() => f.engine.snapshot()[0]?.status === 'failed');
  assert.equal(f.uploads.length, 0); assert.equal(f.engine.snapshot()[0].retryable, true); f.engine.dispose();
});

test('restored interrupted uploads resume, completed upload commits without a duplicate upload', async () => {
  const f = fixture({ initial: [{ ...item('restored'), prepared: true, status: 'uploading', downloadUrl: 'https://media/restored' }] });
  f.engine.setOnline(true); await until(() => f.engine.snapshot().length === 0);
  assert.equal(f.uploads.length, 0); assert.equal(f.sends[0].id, 'restored'); assert.equal(f.sends[0].viewMode, 'once'); f.engine.dispose();
});

test('a group key rotation invalidates the prior upload before retrying under the new epoch', async () => {
  let uploads = 0, attempts = 0;
  const f = fixture({ upload: async () => ({ downloadUrl: `https://media/${++uploads}`, mediaEpoch: uploads }),
    send: async task => { if (++attempts === 1) throw Object.assign(Error('key rotated'), { resetUpload: true }); return task.mediaEpoch === 2; } });
  f.engine.enqueue([{ ...item('group'), roomKind: 'group' }]); await until(() => f.engine.snapshot()[0]?.status === 'failed');
  assert.equal(f.engine.snapshot()[0].downloadUrl, undefined);
  f.engine.retry('group'); await until(() => f.engine.snapshot().length === 0);
  assert.equal(uploads, 2); f.engine.dispose();
});

test('parallel uploads preserve selection order when committing multiple photos in one room', async () => {
  const releases = {}, sent = [];
  const f = fixture({ upload: task => new Promise(resolve => { releases[task.id] = () => resolve(`https://media/${task.id}`); }),
    send: async task => { sent.push(task.id); return true; } });
  f.engine.enqueue([item('first'), item('second')]); await until(() => !!releases.second);
  releases.second(); await pause(); assert.equal(sent.length, 0);
  releases.first(); await until(() => f.engine.snapshot().length === 0);
  assert.deepEqual(sent, ['first', 'second']); f.engine.dispose();
});

test('group retry persists and reuses the exact encrypted commit record', async () => {
  let nonces = 0, attempts = 0; const committed = [];
  const f = fixture({
    prepareSend: async task => ({ groupEncrypted: task.groupEncrypted || { nonce: String(++nonces), ciphertext: 'encrypted' } }),
    send: async task => { committed.push(task.groupEncrypted.nonce); if (++attempts === 1) throw Error('unknown acknowledgement'); return true; },
  });
  f.engine.enqueue([{ ...item('stable-group'), roomKind: 'group' }]); await until(() => f.engine.snapshot()[0]?.status === 'failed');
  assert.ok(f.writes.some(tasks => tasks[0]?.groupEncrypted?.nonce === '1'));
  f.engine.retry('stable-group'); await until(() => f.engine.snapshot().length === 0);
  assert.deepEqual(committed, ['1', '1']); assert.equal(nonces, 1); f.engine.dispose();
});
