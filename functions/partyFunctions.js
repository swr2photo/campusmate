import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

const REGION = 'asia-southeast1';
const CAMPUS = { latitude: 7.008453, longitude: 100.497914 };
const RADIUS_METERS = 3000;
const placesKey = defineSecret('GOOGLE_PLACES_API_KEY');
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function uidOf(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบ');
  return uid;
}

function cleanId(value, label = 'ID') {
  if (typeof value !== 'string' || !idPattern.test(value)) {
    throw new HttpsError('invalid-argument', `${label} ไม่ถูกต้อง`);
  }
  return value;
}

function pointDistanceMeters(a, b = CAMPUS) {
  const rad = Math.PI / 180;
  const dLat = (a.latitude - b.latitude) * rad;
  const dLng = (a.longitude - b.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validPoint(point) {
  return point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
    && pointDistanceMeters(point) <= RADIUS_METERS;
}

function scheduleFrom(data) {
  const date = String(data?.date || '');
  const startTime = String(data?.startTime || '');
  const endTime = String(data?.endTime || '');
  if (!datePattern.test(date) || !timePattern.test(startTime) || !timePattern.test(endTime)) {
    throw new HttpsError('invalid-argument', 'วันและเวลานัดหมายไม่ถูกต้อง');
  }
  const start = Date.parse(`${date}T${startTime}:00+07:00`);
  const end = Date.parse(`${date}T${endTime}:00+07:00`);
  const parsedDate = Number.isFinite(start)
    ? new Date(start + 7 * 60 * 60 * 1000).toISOString().slice(0, 10) : '';
  if (parsedDate !== date) {
    throw new HttpsError('invalid-argument', 'วันที่นัดหมายไม่มีอยู่จริง');
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start <= Date.now()) {
    throw new HttpsError('failed-precondition', 'เวลานัดหมายต้องอยู่ในอนาคตและเวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
  }
  return {
    date, startTime, endTime,
    startsAt: Timestamp.fromMillis(start),
    endsAt: Timestamp.fromMillis(end),
    message: String(data?.message || '').trim().slice(0, 500),
  };
}

async function placesRequest(path, body) {
  const key = placesKey.value()?.trim();
  if (!key) throw new HttpsError('unavailable', 'บริการค้นหาสถานที่ยังไม่พร้อม');
  let response;
  try {
    response = await fetch(`https://places.googleapis.com/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': body
          ? 'suggestions.placePrediction.placeId,suggestions.placePrediction.text'
          : 'id,displayName,location',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    throw new HttpsError('unavailable', 'เชื่อมต่อบริการค้นหาสถานที่ไม่ได้');
  }
  if (!response.ok) {
    logger.warn('places_api_failed', { status: response.status });
    throw new HttpsError('unavailable', 'บริการค้นหาสถานที่ขัดข้อง');
  }
  return response.json();
}

async function resolvePlace(placeId) {
  const id = cleanId(placeId, 'Place ID');
  const place = await placesRequest(`places/${encodeURIComponent(id)}`);
  const point = { latitude: place.location?.latitude, longitude: place.location?.longitude };
  if (!validPoint(point)) throw new HttpsError('out-of-range', 'สถานที่อยู่นอกรัศมี 3 กม. จาก ม.อ. หาดใหญ่');
  return { id: place.id, name: place.displayName?.text || 'สถานที่บนแผนที่', ...point };
}

export const searchCampusPlaces = onCall({ region: REGION, secrets: [placesKey], maxInstances: 20 }, async (request) => {
  uidOf(request);
  const input = String(request.data?.query || '').trim().slice(0, 100);
  if (input.length < 2) return { places: [] };
  const result = await placesRequest('places:autocomplete', {
    input,
    locationRestriction: { circle: { center: CAMPUS, radius: RADIUS_METERS } },
    includedRegionCodes: ['th'],
    languageCode: 'th',
  });
  return {
    places: (result.suggestions || []).slice(0, 8).map((entry) => ({
      placeId: entry.placePrediction?.placeId,
      name: entry.placePrediction?.text?.text,
    })).filter((entry) => entry.placeId && entry.name),
  };
});

export const resolveCampusPlace = onCall({ region: REGION, secrets: [placesKey], maxInstances: 20 }, async (request) => {
  uidOf(request);
  const place = await resolvePlace(request.data?.placeId);
  return { place };
});

async function normalizedLocation(raw) {
  const kind = String(raw?.kind || '');
  if (kind === 'google') {
    const resolved = await resolvePlace(raw.placeId);
    return { kind, placeId: resolved.id }; // Places content is resolved again when displayed.
  }
  if (kind === 'campus') {
    const spotId = cleanId(raw.spotId, 'สถานที่');
    const spot = await getFirestore().doc(`spots/${spotId}`).get();
    if (!spot.exists) throw new HttpsError('not-found', 'ไม่พบสถานที่ใน ม.อ.');
    const point = { latitude: Number(spot.get('latitude')), longitude: Number(spot.get('longitude')) };
    if (!validPoint(point)) throw new HttpsError('out-of-range', 'สถานที่อยู่นอกรัศมี 3 กม.');
    return { kind, spotId, latitude: point.latitude, longitude: point.longitude, name: String(spot.get('name') || '').slice(0, 200) };
  }
  if (kind === 'pin') {
    const point = { latitude: Number(raw.latitude), longitude: Number(raw.longitude) };
    if (!validPoint(point)) throw new HttpsError('out-of-range', 'จุดนัดหมายอยู่นอกรัศมี 3 กม.');
    return { kind, ...point, name: String(raw.name || 'จุดที่ปักหมุด').trim().slice(0, 200) };
  }
  throw new HttpsError('invalid-argument', 'กรุณาเลือกสถานที่');
}

export const createParty = onCall({ region: REGION, secrets: [placesKey] }, async (request) => {
  const hostId = uidOf(request);
  const schedule = scheduleFrom(request.data?.schedule);
  const maxPeople = Number(request.data?.maxPeople);
  if (!Number.isInteger(maxPeople) || maxPeople < 2 || maxPeople > 50) {
    throw new HttpsError('invalid-argument', 'จำนวนสมาชิกต้องอยู่ระหว่าง 2–50 คน');
  }
  const location = await normalizedLocation(request.data?.location);
  const db = getFirestore();
  const profile = await db.doc(`profiles/${hostId}`).get();
  const host = profile.data() || {};
  const hostAvatar = String(host.avatarUri || host.photoURL || (Array.isArray(host.photos) ? host.photos[0] : '') || '').slice(0, 5000);
  const hostName = String(host.nickname || host.name || 'เพื่อนใน ม.อ.').slice(0, 100);
  const partyRef = db.collection('parties').doc();
  await partyRef.create({
    hostId,
    host: {
      name: hostName,
      avatarUri: hostAvatar,
      faculty: String(host.faculty || '').slice(0, 100),
      year: String(host.year || '').slice(0, 50),
    },
    location,
    schedule,
    maxPeople,
    memberIds: [hostId],
    members: [{
      id: hostId,
      name: hostName,
      avatarUri: hostAvatar,
    }],
    memberCount: 1,
    status: 'open',
    legacy: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { partyId: partyRef.id };
});

function assertOpen(party) {
  if (!party || party.status !== 'open') throw new HttpsError('failed-precondition', 'ตี้นี้ไม่ได้เปิดรับแล้ว');
  const startsAt = party.schedule?.startsAt?.toMillis?.();
  if (!Number.isFinite(startsAt) || startsAt <= Date.now()) {
    throw new HttpsError('failed-precondition', 'เวลานัดหมายผ่านไปแล้ว');
  }
}

function partyChatTitle(party) {
  const date = String(party.schedule?.date || '').slice(0, 10);
  const time = String(party.schedule?.startTime || '').slice(0, 5);
  const place = party.location?.kind === 'google' ? '' : String(party.location?.name || '').slice(0, 80);
  return [place || `ตี้ ${date} ${time}`, `โดย ${String(party.host?.name || 'เพื่อนใน ม.อ.').slice(0, 60)}`].join(' · ');
}

export const requestJoinParty = onCall({ region: REGION }, async (request) => {
  const userId = uidOf(request);
  const partyId = cleanId(request.data?.partyId, 'ตี้');
  const db = getFirestore();
  const partyRef = db.doc(`parties/${partyId}`);
  const requestRef = db.doc(`parties/${partyId}/requests/${userId}`);
  const requesterProfile = await db.doc(`profiles/${userId}`).get();
  const reqData = requesterProfile.data() || {};
  const requesterName = String(reqData.nickname || reqData.name || 'ผู้ใช้ ม.อ.').slice(0, 100);
  const requesterAvatarUri = String(reqData.avatarUri || reqData.photoURL || (Array.isArray(reqData.photos) ? reqData.photos[0] : '') || '').slice(0, 5000);
  return db.runTransaction(async (tx) => {
    const [partySnap, joinSnap] = await Promise.all([tx.get(partyRef), tx.get(requestRef)]);
    const party = partySnap.data();
    assertOpen(party);
    if (party.hostId === userId || party.memberIds?.includes(userId)) {
      throw new HttpsError('already-exists', 'คุณอยู่ในตี้นี้แล้ว');
    }
    if (party.memberCount >= party.maxPeople) throw new HttpsError('resource-exhausted', 'ตี้เต็มแล้ว');
    if (joinSnap.get('status') === 'pending') return { status: 'pending' };
    tx.set(requestRef, {
      partyId, hostId: party.hostId, requesterId: userId,
      requesterName,
      avatarUri: requesterAvatarUri,
      requesterAvatarUri,
      status: 'pending', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    return { status: 'pending' };
  });
});

export const withdrawPartyRequest = onCall({ region: REGION }, async (request) => {
  const userId = uidOf(request);
  const partyId = cleanId(request.data?.partyId, 'ตี้');
  const ref = getFirestore().doc(`parties/${partyId}/requests/${userId}`);
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get('status') !== 'pending') throw new HttpsError('failed-precondition', 'ไม่พบคำขอที่รออนุมัติ');
    tx.update(ref, { status: 'withdrawn', updatedAt: FieldValue.serverTimestamp() });
  });
  return { status: 'withdrawn' };
});

export const rejectPartyRequest = onCall({ region: REGION }, async (request) => {
  const hostId = uidOf(request);
  const partyId = cleanId(request.data?.partyId, 'ตี้');
  const requesterId = cleanId(request.data?.requesterId, 'ผู้ขอเข้าร่วม');
  const db = getFirestore();
  const partyRef = db.doc(`parties/${partyId}`);
  const requestRef = db.doc(`parties/${partyId}/requests/${requesterId}`);
  await db.runTransaction(async (tx) => {
    const [party, join] = await Promise.all([tx.get(partyRef), tx.get(requestRef)]);
    if (party.get('hostId') !== hostId) throw new HttpsError('permission-denied', 'เจ้าของตี้เท่านั้นที่จัดการคำขอได้');
    if (join.get('status') !== 'pending') throw new HttpsError('failed-precondition', 'คำขอนี้ไม่รออนุมัติแล้ว');
    tx.update(requestRef, { status: 'rejected', updatedAt: FieldValue.serverTimestamp() });
  });
  return { status: 'rejected' };
});

export const cancelParty = onCall({ region: REGION }, async (request) => {
  const hostId = uidOf(request);
  const partyId = cleanId(request.data?.partyId, 'ตี้');
  const ref = getFirestore().doc(`parties/${partyId}`);
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get('hostId') !== hostId) throw new HttpsError('permission-denied', 'เจ้าของตี้เท่านั้นที่ยกเลิกได้');
    if (snap.get('status') !== 'open') throw new HttpsError('failed-precondition', 'ตี้นี้ไม่ได้เปิดรับแล้ว');
    tx.update(ref, { status: 'cancelled', cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return { status: 'cancelled' };
});

function validEnvelope(envelope) {
  return envelope && typeof envelope === 'object' && !Array.isArray(envelope)
    && Object.keys(envelope).sort().join('|') === 'ciphertext|nonce|senderDeviceId|senderPublicKey'
    && typeof envelope.senderDeviceId === 'string'
    && /^[A-Za-z0-9._:-]{1,128}$/.test(envelope.senderDeviceId)
    && validBase64Bytes(envelope.senderPublicKey, 32)
    && validBase64Bytes(envelope.nonce, 24)
    && validBase64Bytes(envelope.ciphertext, 48);
}

function validBase64Bytes(value, size) {
  return typeof value === 'string'
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
    && Buffer.from(value, 'base64').length === size;
}

function validDevices(profile) {
  const raw = profile?.encryptionDevices;
  const devices = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    Object.entries(raw).forEach(([deviceId, entry]) => {
      if (Object.keys(devices).length >= 5 || !/^[A-Za-z0-9._:-]{1,128}$/.test(deviceId)) return;
      const publicKey = typeof entry === 'string' ? entry : entry?.publicKey;
      if (validBase64Bytes(publicKey, 32)) devices[deviceId] = publicKey;
    });
  }
  if (!Object.keys(devices).length && validBase64Bytes(profile?.encryptionPublicKey, 32)) {
    devices.legacy = profile.encryptionPublicKey;
  }
  return devices;
}

function validateGrants(grants, userIds, profiles) {
  if (!grants || typeof grants !== 'object' || Object.keys(grants).sort().join('|') !== [...userIds].sort().join('|')) {
    throw new HttpsError('failed-precondition', 'ข้อมูลกุญแจกลุ่มของสมาชิกไม่ครบ');
  }
  for (const userId of userIds) {
    const devices = validDevices(profiles[userId]);
    const envelopes = grants[userId];
    const deviceIds = Object.keys(devices);
    if (!envelopes || typeof envelopes !== 'object' || !deviceIds.length
      || Object.keys(envelopes).sort().join('|') !== deviceIds.sort().join('|')) {
      throw new HttpsError('failed-precondition', `สมาชิก ${userId} ยังไม่มีกุญแจอุปกรณ์`);
    }
    for (const deviceId of deviceIds) {
      if (!validEnvelope(envelopes[deviceId])) {
        throw new HttpsError('failed-precondition', `กุญแจของสมาชิก ${userId} ไม่ครบ`);
      }
    }
  }
}

export const approvePartyRequest = onCall({ region: REGION }, async (request) => {
  const hostId = uidOf(request);
  const partyId = cleanId(request.data?.partyId, 'ตี้');
  const requesterId = cleanId(request.data?.requesterId, 'ผู้ขอเข้าร่วม');
  const db = getFirestore();
  const partyRef = db.doc(`parties/${partyId}`);
  const requestRef = db.doc(`parties/${partyId}/requests/${requesterId}`);
  const chatRef = db.doc(`groupChats/${partyId}`);
  try {
    return await db.runTransaction(async (tx) => {
    const [partySnap, joinSnap, chatSnap] = await Promise.all([
      tx.get(partyRef), tx.get(requestRef), tx.get(chatRef),
    ]);
    const party = partySnap.data();
    assertOpen(party);
    if (party.hostId !== hostId) throw new HttpsError('permission-denied', 'เจ้าของตี้เท่านั้นที่อนุมัติได้');
    if (joinSnap.get('status') !== 'pending') throw new HttpsError('failed-precondition', 'คำขอนี้ไม่รออนุมัติแล้ว');
    if (party.memberIds?.includes(requesterId)) throw new HttpsError('already-exists', 'สมาชิกอยู่ในตี้แล้ว');
    if (party.memberCount >= party.maxPeople) throw new HttpsError('resource-exhausted', 'ตี้เต็มแล้ว');
    const chat = chatSnap.data();
    if (chat?.rekeyRequired) throw new HttpsError('failed-precondition', 'กำลังเปลี่ยนกุญแจกลุ่ม กรุณาลองใหม่');
    const nextMembers = [...party.memberIds, requesterId];
    const profiles = {};
    const profileSnaps = await Promise.all(nextMembers.map((uid) => tx.get(db.doc(`profiles/${uid}`))));
    nextMembers.forEach((uid, i) => { profiles[uid] = profileSnaps[i].data() || {}; });

    if (!chatSnap.exists) {
      const grants = request.data?.initialGrants;
      validateGrants(grants, nextMembers, profiles);
      tx.create(chatRef, {
        partyId, hostId, title: partyChatTitle(party), memberIds: nextMembers, memberCount: nextMembers.length,
        currentEpoch: 0, epochCount: 1, rekeyRequired: false,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      tx.create(chatRef.collection('epochs').doc('0'), {
        epoch: 0, keyEnvelopes: grants, createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      const epochCount = Number(chat.epochCount);
      if (!Number.isInteger(epochCount) || epochCount < 1 || epochCount > 100) {
        throw new HttpsError('failed-precondition', 'ประวัติกุญแจกลุ่มไม่ถูกต้อง');
      }
      const supplied = request.data?.epochGrants || {};
      if (Object.keys(supplied).length !== epochCount) {
        throw new HttpsError('failed-precondition', 'กุญแจประวัติแชตทุกช่วงไม่ครบ');
      }
      const epochs = await Promise.all(Array.from({ length: epochCount }, (_, i) => tx.get(chatRef.collection('epochs').doc(String(i)))));
      epochs.forEach((epochSnap, i) => {
        if (!epochSnap.exists) throw new HttpsError('failed-precondition', 'ไม่พบกุญแจประวัติแชตบางช่วง');
        const grant = supplied[String(i)];
        validateGrants({ [requesterId]: grant }, [requesterId], profiles);
        // The host must still have a readable key for every history epoch.
        if (!epochSnap.get(`keyEnvelopes.${hostId}`)) {
          throw new HttpsError('failed-precondition', 'เจ้าของตี้ไม่มีกุญแจประวัติแชตครบ');
        }
        tx.update(epochSnap.ref, { [`keyEnvelopes.${requesterId}`]: grant });
      });
      tx.update(chatRef, { memberIds: nextMembers, memberCount: nextMembers.length, updatedAt: FieldValue.serverTimestamp() });
    }
    tx.update(partyRef, { memberIds: nextMembers, memberCount: nextMembers.length, updatedAt: FieldValue.serverTimestamp() });
    tx.update(requestRef, { status: 'approved', updatedAt: FieldValue.serverTimestamp() });
    return { status: 'approved', groupChatId: partyId };
    });
  } catch (error) {
    logger.warn('party_approval_failed', { partyId, code: error?.code || 'unknown' });
    throw error;
  }
});

export const activateLegacyPartyChat = onCall({ region: REGION }, async (request) => {
  const hostId = uidOf(request);
  const partyId = cleanId(request.data?.partyId, 'ตี้');
  const db = getFirestore();
  const partyRef = db.doc(`parties/${partyId}`);
  const chatRef = db.doc(`groupChats/${partyId}`);
  return db.runTransaction(async (tx) => {
    const [partySnap, chatSnap] = await Promise.all([tx.get(partyRef), tx.get(chatRef)]);
    const party = partySnap.data();
    if (!party || party.hostId !== hostId || party.legacy !== true || party.memberIds?.length < 2) {
      throw new HttpsError('permission-denied', 'เปิดแชตสำหรับตี้นี้ไม่ได้');
    }
    if (chatSnap.exists) return { groupChatId: partyId, activated: false };
    const profiles = {};
    const profileSnaps = await Promise.all(party.memberIds.map((uid) => tx.get(db.doc(`profiles/${uid}`))));
    party.memberIds.forEach((uid, i) => { profiles[uid] = profileSnaps[i].data() || {}; });
    validateGrants(request.data?.initialGrants, party.memberIds, profiles);
    tx.create(chatRef, {
      partyId, hostId, title: partyChatTitle(party), memberIds: party.memberIds, memberCount: party.memberIds.length,
      currentEpoch: 0, epochCount: 1, rekeyRequired: false,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    tx.create(chatRef.collection('epochs').doc('0'), {
      epoch: 0, keyEnvelopes: request.data.initialGrants,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(partyRef, { chatActivationRequired: false, updatedAt: FieldValue.serverTimestamp() });
    return { groupChatId: partyId, activated: true };
  });
});

export const leaveParty = onCall({ region: REGION }, async (request) => {
  const userId = uidOf(request);
  const partyId = cleanId(request.data?.partyId, 'ตี้');
  const db = getFirestore();
  const partyRef = db.doc(`parties/${partyId}`);
  const chatRef = db.doc(`groupChats/${partyId}`);
  await db.runTransaction(async (tx) => {
    const [partySnap, chatSnap] = await Promise.all([tx.get(partyRef), tx.get(chatRef)]);
    const party = partySnap.data();
    if (!party?.memberIds?.includes(userId)) throw new HttpsError('failed-precondition', 'คุณไม่ได้อยู่ในตี้นี้');
    if (party.hostId === userId) throw new HttpsError('failed-precondition', 'เจ้าของตี้ต้องยกเลิกตี้แทนการออก');
    const memberIds = party.memberIds.filter((id) => id !== userId);
    tx.update(partyRef, { memberIds, memberCount: memberIds.length, updatedAt: FieldValue.serverTimestamp() });
    if (chatSnap.exists) {
      tx.update(chatRef, {
        memberIds, memberCount: memberIds.length, rekeyRequired: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return { status: 'left' };
});

export const rotatePartyKey = onCall({ region: REGION }, async (request) => {
  const userId = uidOf(request);
  const partyId = cleanId(request.data?.partyId, 'ตี้');
  const db = getFirestore();
  const chatRef = db.doc(`groupChats/${partyId}`);
  return db.runTransaction(async (tx) => {
    const chatSnap = await tx.get(chatRef);
    const chat = chatSnap.data();
    if (!chat?.memberIds?.includes(userId)) throw new HttpsError('permission-denied', 'คุณไม่ได้อยู่ในแชตกลุ่ม');
    if (!chat.rekeyRequired) return { epoch: chat.currentEpoch };
    const profiles = {};
    const profileSnaps = await Promise.all(chat.memberIds.map((uid) => tx.get(db.doc(`profiles/${uid}`))));
    chat.memberIds.forEach((uid, i) => { profiles[uid] = profileSnaps[i].data() || {}; });
    const grants = request.data?.grants;
    validateGrants(grants, chat.memberIds, profiles);
    const epoch = Number(chat.epochCount);
    tx.create(chatRef.collection('epochs').doc(String(epoch)), {
      epoch, keyEnvelopes: grants, createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(chatRef, {
      currentEpoch: epoch, epochCount: epoch + 1, rekeyRequired: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { epoch };
  });
});

export { pointDistanceMeters, validPoint, scheduleFrom };
