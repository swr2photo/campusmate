import crypto from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();
const commit = process.argv.includes('--commit');
const PAGE_SIZE = 300;
const CAMPUS = { latitude: 7.008453, longitude: 100.497914 };

function withinCampus(point) {
  const rad = Math.PI / 180;
  const dLat = (point.latitude - CAMPUS.latitude) * rad;
  const dLng = (point.longitude - CAMPUS.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(point.latitude * rad) * Math.cos(CAMPUS.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h))) <= 3000;
}

function scheduleFor(meetup) {
  const raw = meetup?.schedule || {};
  const start = Date.parse(`${raw.date || ''}T${raw.startTime || ''}:00+07:00`);
  const end = Date.parse(`${raw.date || ''}T${raw.endTime || ''}:00+07:00`);
  const parsedDate = Number.isFinite(start)
    ? new Date(start + 7 * 60 * 60 * 1000).toISOString().slice(0, 10) : '';
  if (!Number.isFinite(start) || !Number.isFinite(end) || parsedDate !== raw.date
    || end <= start || start <= Date.now()) return null;
  return {
    date: raw.date, startTime: raw.startTime, endTime: raw.endTime,
    startsAt: Timestamp.fromMillis(start), endsAt: Timestamp.fromMillis(end),
    message: String(raw.message || '').slice(0, 500),
  };
}

function matchesAppointment(appointment, meetup, schedule) {
  const other = appointment.meetup;
  return appointment.status === 'active'
    && appointment.guestId
    && other?.id === meetup.id
    && other?.schedule?.date === schedule.date
    && other?.schedule?.startTime === schedule.startTime;
}

async function run() {
  let cursor;
  let scanned = 0;
  let eligible = 0;
  let written = 0;
  while (true) {
    let query = db.collection('profiles').orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const profileSnap of page.docs) {
      scanned += 1;
      const profile = profileSnap.data();
      if (profile.isDiscoverable === false || profile.privacy?.showLocation === false
        || profile.privacy?.showAvailability === false) continue;
      const meetup = profile.meetup;
      if (!meetup?.id) continue;
      const schedule = scheduleFor(meetup);
      if (!schedule || !Number.isFinite(Number(meetup.latitude)) || !Number.isFinite(Number(meetup.longitude))) continue;
      if (!withinCampus({ latitude: Number(meetup.latitude), longitude: Number(meetup.longitude) })) continue;
      const hostId = profileSnap.id;
      const digest = crypto.createHash('sha256').update(`${hostId}|${meetup.id}|${schedule.date}|${schedule.startTime}`).digest('hex').slice(0, 20);
      const partyId = `legacy-${digest}`;
      const partyRef = db.doc(`parties/${partyId}`);
      const appointments = await db.collection('appointments').where('hostId', '==', hostId).get();
      const accepted = [...new Set(appointments.docs
        .map((entry) => entry.data())
        .filter((item) => matchesAppointment(item, meetup, schedule))
        .map((item) => item.guestId))];
      const memberIds = [hostId, ...accepted].slice(0, 50);
      const maxPeople = Math.min(50, Math.max(memberIds.length, 2, Number(meetup.schedule?.maxPeople) || 2));
      eligible += 1;
      if (!commit) {
        console.log(`[dry-run] ${partyId}: ${memberIds.length}/${maxPeople} members`);
        continue;
      }
      try {
        await partyRef.create({
          hostId,
          host: { name: String(profile.nickname || profile.name || 'ผู้ใช้ ม.อ.').slice(0, 100) },
          location: {
            kind: 'pin', name: String(meetup.name || 'จุดนัดหมาย').slice(0, 200),
            latitude: Number(meetup.latitude), longitude: Number(meetup.longitude),
          },
          schedule, maxPeople, memberIds, memberCount: memberIds.length,
          status: 'open', legacy: true, chatActivationRequired: memberIds.length > 1,
          legacySource: `${hostId}:${meetup.id}`,
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        });
        written += 1;
      } catch (error) {
        if (error?.code !== 6 && error?.code !== 'already-exists') throw error;
      }
    }
    cursor = page.docs[page.docs.length - 1];
    console.log(`[party backfill] scanned ${scanned}, eligible ${eligible}, created ${written}`);
  }
  console.log(JSON.stringify({ commit, scanned, eligible, written }));
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
