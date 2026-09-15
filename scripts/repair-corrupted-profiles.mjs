import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT || 'campusmate-7f1ab';
initializeApp({ projectId });
const db = getFirestore();

function hasQuestionMarks(value) {
  if (typeof value === 'string') return value.includes('???');
  if (Array.isArray(value)) return value.some(hasQuestionMarks);
  if (value && typeof value === 'object') return Object.values(value).some(hasQuestionMarks);
  return false;
}

function toPublicMeetup(meetup, privacy = {}) {
  if (!meetup || typeof meetup !== 'object' || hasQuestionMarks(meetup.name)) return null;
  if (privacy.showLocation === false && privacy.showAvailability === false) return null;
  const publicMeetup = {};
  if (privacy.showLocation !== false) {
    ['id', 'name', 'category', 'categoryLabel', 'group', 'emoji', 'rating', 'busyTime', 'image'].forEach((field) => {
      if (meetup[field] !== undefined && !hasQuestionMarks(meetup[field])) {
        publicMeetup[field] = meetup[field];
      }
    });
  }
  if (privacy.showAvailability !== false && meetup.schedule && typeof meetup.schedule === 'object') {
    const schedule = {};
    ['date', 'startTime', 'endTime'].forEach((field) => {
      if (typeof meetup.schedule[field] === 'string' && !hasQuestionMarks(meetup.schedule[field])) {
        schedule[field] = meetup.schedule[field].slice(0, 32);
      }
    });
    if (Number.isInteger(meetup.schedule.maxPeople)) {
      schedule.maxPeople = Math.max(1, Math.min(50, meetup.schedule.maxPeople));
    }
    if (typeof meetup.schedule.message === 'string' && !hasQuestionMarks(meetup.schedule.message)) {
      schedule.message = meetup.schedule.message.slice(0, 500);
    }
    if (Object.keys(schedule).length) publicMeetup.schedule = schedule;
    if (typeof meetup.scheduledAt === 'string' && !hasQuestionMarks(meetup.scheduledAt)) {
      publicMeetup.scheduledAt = meetup.scheduledAt.slice(0, 100);
    }
  }
  return Object.keys(publicMeetup).length > 0 ? publicMeetup : null;
}

function toConversationProfile(userId, uData, existingP = {}) {
  const profile = { id: userId, isDiscoverable: uData.isDiscoverable !== false };
  const textLimits = {
    name: 100,
    nickname: 100,
    faculty: 100,
    year: 50,
    activity: 100,
    activityLabel: 100,
    availability: 100,
    location: 200,
    bio: 1000,
    avatar: 100,
    avatarColor: 50,
    avatarUri: 2000,
    gender: 100,
    skill: 100,
    pace: 100,
  };
  
  Object.entries(textLimits).forEach(([field, maxLen]) => {
    const val = uData[field] !== undefined ? uData[field] : existingP[field];
    if (typeof val === 'string' && !hasQuestionMarks(val)) {
      profile[field] = val.slice(0, maxLen);
    } else {
      profile[field] = '';
    }
  });
  
  if (typeof uData.age === 'number') profile.age = uData.age;
  else if (typeof existingP.age === 'number') profile.age = existingP.age;
  
  const m = toPublicMeetup(uData.meetup || existingP.meetup, uData.privacy || {});
  if (m) profile.meetup = m;
  
  return profile;
}

async function repair() {
  console.log('--- Starting Complete Firestore Profile & Conversation Repair ---');
  
  // 1. Repair profiles collection
  const profilesSnap = await db.collection('profiles').get();
  let repairedProfilesCount = 0;
  
  for (const pDoc of profilesSnap.docs) {
    const pData = pDoc.data();
    if (hasQuestionMarks(pData)) {
      const uDoc = await db.collection('users').doc(pDoc.id).get();
      const uData = uDoc.exists ? uDoc.data() : {};
      const updates = {};
      
      const fieldsToCheck = [
        'faculty',
        'year',
        'activity',
        'activities',
        'activityLabel',
        'availability',
        'name',
        'nickname',
        'bio',
        'skill',
        'pace',
      ];
      
      fieldsToCheck.forEach((f) => {
        if (hasQuestionMarks(pData[f])) {
          if (uData[f] !== undefined && !hasQuestionMarks(uData[f])) {
            updates[f] = uData[f];
          } else {
            updates[f] = '';
          }
        }
      });
      
      if (hasQuestionMarks(pData.meetup)) {
        const cleanM = toPublicMeetup(uData.meetup || pData.meetup, uData.privacy || {});
        if (cleanM) {
          updates.meetup = cleanM;
        } else {
          updates.meetup = FieldValue.delete();
        }
      }
      
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = FieldValue.serverTimestamp();
        await pDoc.ref.update(updates);
        repairedProfilesCount++;
        console.log(`[REPAIRED PROFILE] ${pDoc.id} (${uData.name || pData.name}):`, Object.keys(updates).join(', '));
      }
    }
  }
  console.log(`Repaired ${repairedProfilesCount} profile(s).`);

  // 2. Repair conversations collection
  const convSnap = await db.collection('conversations').get();
  let repairedConvsCount = 0;
  
  for (const cDoc of convSnap.docs) {
    const cData = cDoc.data();
    const participantProfiles = cData.participantProfiles || {};
    if (hasQuestionMarks(participantProfiles)) {
      const updatedParticipantProfiles = { ...participantProfiles };
      let convNeedsUpdate = false;
      
      for (const [userId, participant] of Object.entries(participantProfiles)) {
        if (hasQuestionMarks(participant)) {
          const uDoc = await db.collection('users').doc(userId).get();
          const uData = uDoc.exists ? uDoc.data() : {};
          updatedParticipantProfiles[userId] = toConversationProfile(userId, uData, participant);
          convNeedsUpdate = true;
          console.log(`  Repaired participant ${userId} (${uData.name || participant.name}) in ${cDoc.id}`);
        }
      }
      
      if (convNeedsUpdate) {
        await cDoc.ref.update({
          participantProfiles: updatedParticipantProfiles,
          updatedAt: FieldValue.serverTimestamp(),
        });
        repairedConvsCount++;
        console.log(`[REPAIRED CONVERSATION] ${cDoc.id}`);
      }
    }
  }
  console.log(`Repaired ${repairedConvsCount} conversation(s).`);
  console.log('--- Repair Complete ---');
}

repair().catch((err) => {
  console.error('Repair failed:', err);
  process.exit(1);
});
