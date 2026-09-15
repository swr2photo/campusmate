import { compareConversationsByActivity } from '../utils/conversationOrder';
import { createReplySnapshot } from '../utils/messageReply';
import {
  Timestamp,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getCurrentUserIdToken } from './authService';
import { requireFirebase } from './dbService';
import { verifyImageSafety } from './imageModerationService';
import * as FileSystem from 'expo-file-system/legacy';
import { ACTIVITY_LABELS } from '../utils/formatters';
import { matchesAvailabilityPeriods } from '../data/matchingFilters';
import {
  createConversationEncryption,
  decryptMessageRecord,
  encryptMessageRecord,
  ensureConversationEncryption,
  ensureEncryptionIdentity,
  getOrCreateEncryptionIdentity,
  getConversationKey,
  getEncryptionDevices,
  hasCurrentDeviceEnvelope,
  isE2EEUnavailableError,
  isValidConversationEncryption,
  withIdentityDevice,
  ENCRYPTED_PREVIEW,
} from './chatEncryptionService';

const publicProfileFields = [
  'name',
  'nickname',
  'age',
  'faculty',
  'year',
  'activity',
  'activities',
  'activityLabel',
  'skill',
  'pace',
  'availability',
  'availabilitySlots',
  'bio',
  'avatar',
  'avatarColor',
  'avatarUri',
  'compatibility',
  // GPS coordinates are intentionally excluded from public profiles.
  // They are stored only in the private `users/{uid}` collection
  // to comply with PDPA data protection requirements.
  'tags',
  'interests',
  'gender',
  'meetup',
  'encryptionDevices',
];

const privateProfileFields = [
  ...publicProfileFields,
  'latitude',
  'longitude',
  'privacy',
  'matchingPreferences',
  'notificationsEnabled',
  'consentAcceptedAt',
];

const matchingPreferenceFields = [
  'ageMin',
  'ageMax',
  'genders',
  'years',
  'activities',
  'paces',
  'availabilityPeriods',
  'faculty',
  'sameFacultyOnly',
  'maxDistance',
];

const DISCOVERY_COLLECTION = 'discoveryProfiles';
const DISCOVERY_META_ID = '_meta';
const DISCOVERY_PAGE_SIZE = 40;
const PROFILE_ID_QUERY_LIMIT = 30;

const legacyPrivateProfileFields = [
  'createdAt',
  'photoURL',
  'photos',
  'displayName',
  'lastSeen',
];

const profileTextLimits = {
  name: 100,
  nickname: 100,
  faculty: 100,
  year: 50,
  activity: 100,
  activityLabel: 100,
  skill: 100,
  pace: 100,
  availability: 100,
  bio: 1000,
  avatar: 100,
  avatarColor: 50,
  avatarUri: 5000,
  gender: 100,
};

function withoutUndefined(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj
      .filter((item) => item !== undefined)
      .map((item) => withoutUndefined(item));
  }
  if (
    typeof obj.toDate === 'function'
    || obj instanceof Date
    || obj.constructor?.name === 'FieldValue'
    || obj.constructor?.name === 'ServerTimestampTransform'
    || obj._methodName
  ) {
    return obj;
  }
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = withoutUndefined(value);
    }
  }
  return result;
}

// Older profile records may contain ISO strings, JavaScript dates, or epoch
// milliseconds for audit fields. The current Firestore rules accept a
// Timestamp (and legacy milliseconds), but a raw ISO string can make a
// profile projection fail with permission-denied. Normalize only these
// legacy fields before writing the private projection.
function normalizeLegacyTimestamp(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value?.toMillis === 'function') return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : Timestamp.fromDate(value);
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Timestamp.fromMillis(value);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Timestamp.fromMillis(parsed);
  }
  return undefined;
}

function sanitizeMatchingPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result = {};
  matchingPreferenceFields.forEach((field) => {
    const currentValue = value[field];
    if (currentValue === undefined) return;
    if (['genders', 'years', 'activities', 'paces', 'availabilityPeriods'].includes(field)) {
      if (!Array.isArray(currentValue)) return;
      result[field] = currentValue
        .filter((item) => typeof item === 'string')
        .map((item) => item.slice(0, 100))
        .slice(0, 30);
      return;
    }
    if (['ageMin', 'ageMax', 'maxDistance'].includes(field)) {
      if (typeof currentValue === 'number' && Number.isFinite(currentValue)) {
        result[field] = currentValue;
      }
      return;
    }
    if (field === 'faculty') {
      if (typeof currentValue === 'string') result[field] = currentValue.slice(0, 100);
      return;
    }
    if (field === 'sameFacultyOnly' && typeof currentValue === 'boolean') {
      result[field] = currentValue;
    }
  });
  return result;
}

function isConversationWritable(data) {
  return Array.isArray(data?.participants)
    && data.participants.length === 2
    && data.participants.every((participantId) => typeof participantId === 'string')
    && data.participants[0] !== data.participants[1]
    && Array.isArray(data.messages)
    && data.messages.length <= 500
    && data.lastMessage === ENCRYPTED_PREVIEW
    && data.unreadCounts && typeof data.unreadCounts === 'object'
    && data.participantProfiles && typeof data.participantProfiles === 'object'
    && isValidConversationEncryption(data.encryption);
}

function hasMeaningfulValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function getR2AvatarOwnerId(uri) {
  if (typeof uri !== 'string' || !/^https?:\/\//i.test(uri)) return null;
  try {
    const match = uri.match(/^https?:\/\/([^/]+)(\/users\/([^/?#]+)\/avatar\.(?:jpe?g|png|webp))(?:[?#].*)?$/i);
    if (!match) return null;
    const hostname = match[1].toLowerCase().split(':')[0];
    const isCloudflareStorageHost = hostname.endsWith('.r2.dev')
      || hostname.endsWith('.workers.dev')
      || hostname.endsWith('.r2.cloudflarestorage.com');
    if (!isCloudflareStorageHost) return null;
    return decodeURIComponent(match[3]);
  } catch {
    return null;
  }
}

/**
 * R2 avatar URLs contain the Firebase UID in their object path. Keep a
 * corrupted/stale URL from one account from being rendered for another.
 * URLs from other providers are intentionally allowed because legacy Google
 * profile photos do not carry this R2 path convention.
 */
export function isAvatarOwnedByProfile(uri, userId) {
  const ownerId = getR2AvatarOwnerId(uri);
  return !ownerId || !userId || ownerId === userId;
}

function removeForeignR2AvatarValues(profile, userId) {
  ['avatarUri', 'photoURL', 'photoUrl', 'avatarUrl'].forEach((field) => {
    if (profile[field] && !isAvatarOwnedByProfile(profile[field], userId)) profile[field] = null;
  });
  if (Array.isArray(profile.photos)) {
    profile.photos = profile.photos.filter((photo) => isAvatarOwnedByProfile(photo, userId));
  }
}

function sanitizeProfileText(value, maxLength) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, maxLength);
}

function sanitizeProfileList(value, maxSize, itemMaxLength = 100) {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item) => item !== undefined)
    .slice(0, maxSize)
    .map((item) => (
      typeof item === 'string'
        ? item.trim().slice(0, itemMaxLength)
        : withoutUndefined(item)
    ));
}

function sanitizeProfilePrivacy(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, currentValue]) => typeof currentValue === 'boolean')
      .slice(0, 10)
  );
}

function sanitizeProfileForFirestore(userId, source = {}) {
  const profile = { id: userId };

  Object.entries(profileTextLimits).forEach(([field, maxLength]) => {
    if (!Object.prototype.hasOwnProperty.call(source, field)) return;
    const value = sanitizeProfileText(source[field], maxLength);
    if (value !== undefined) profile[field] = value;
  });

  [
    ['activities', 30],
    ['tags', 50],
    ['interests', 50],
  ].forEach(([field, maxSize]) => {
    if (!Object.prototype.hasOwnProperty.call(source, field)) return;
    const value = sanitizeProfileList(source[field], maxSize);
    if (value !== undefined) profile[field] = value;
  });
  if (Object.prototype.hasOwnProperty.call(source, 'availabilitySlots')) {
    const value = sanitizeProfileList(source.availabilitySlots, 50, 200);
    if (value !== undefined) profile.availabilitySlots = value;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'age')) {
    if (source.age === null) profile.age = null;
    else if (typeof source.age === 'number' && Number.isFinite(source.age)
      && source.age >= 18 && source.age <= 100) profile.age = source.age;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'compatibility')) {
    if (source.compatibility === null) profile.compatibility = null;
    else if (typeof source.compatibility === 'number' && Number.isFinite(source.compatibility)
      && source.compatibility >= 0 && source.compatibility <= 100) profile.compatibility = source.compatibility;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'meetup')) {
    profile.meetup = source.meetup === null ? null : sanitizeMeetup(source.meetup);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'encryptionDevices')) {
    profile.encryptionDevices = getEncryptionDevices(source);
  }

  ['isNewUser', 'isDiscoverable', 'notificationsEnabled'].forEach((field) => {
    if (typeof source[field] === 'boolean') profile[field] = source[field];
  });

  if (Object.prototype.hasOwnProperty.call(source, 'email')) {
    const email = sanitizeProfileText(source.email, 320);
    if (email !== undefined) profile.email = email;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'privacy')) {
    profile.privacy = sanitizeProfilePrivacy(source.privacy);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'matchingPreferences')) {
    profile.matchingPreferences = sanitizeMatchingPreferences(source.matchingPreferences);
  }
  ['latitude', 'longitude'].forEach((field) => {
    const value = source[field];
    const minimum = field === 'latitude' ? -90 : -180;
    const maximum = field === 'latitude' ? 90 : 180;
    if (typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum) {
      profile[field] = value;
    }
  });

  ['createdAt', 'lastSeen', 'consentAcceptedAt'].forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(source, field)) return;
    const timestamp = normalizeLegacyTimestamp(source[field]);
    if (timestamp) profile[field] = timestamp;
  });
  const displayName = sanitizeProfileText(source.displayName, 100);
  if (displayName !== undefined) profile.displayName = displayName;
  const photoURL = sanitizeProfileText(source.photoURL, 5000);
  if (photoURL !== undefined) profile.photoURL = photoURL;
  if (Object.prototype.hasOwnProperty.call(source, 'photos')) {
    const photos = sanitizeProfileList(source.photos, 10, 5000);
    if (photos !== undefined) profile.photos = photos;
  }

  return profile;
}

function mergeProfileInput(existing = {}, incoming = {}) {
  const merged = { ...existing };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (value !== undefined) merged[key] = value;
  });
  if (existing.privacy || incoming.privacy) {
    merged.privacy = { ...(existing.privacy || {}), ...(incoming.privacy || {}) };
  }
  if (existing.matchingPreferences || incoming.matchingPreferences) {
    merged.matchingPreferences = {
      ...(existing.matchingPreferences || {}),
      ...(incoming.matchingPreferences || {}),
    };
  }
  return merged;
}

export function sanitizeMeetup(meetup, privacy = {}) {
  if (!meetup || typeof meetup !== 'object' || Array.isArray(meetup) || privacy.showLocation === false) {
    return null;
  }

  const clean = {};
  const textLimits = {
    id: 128,
    name: 200,
    description: 500,
    category: 50,
    categoryLabel: 100,
    group: 150,
    emoji: 16,
    rating: 20,
    busyTime: 100,
    image: 500,
  };
  Object.entries(textLimits).forEach(([field, maxLength]) => {
    if (typeof meetup[field] === 'string' && meetup[field].trim().length > 0) {
      clean[field] = meetup[field].trim().slice(0, maxLength);
    }
  });

  if (typeof meetup.latitude === 'number' && Number.isFinite(meetup.latitude)) {
    clean.latitude = meetup.latitude;
  }
  if (typeof meetup.longitude === 'number' && Number.isFinite(meetup.longitude)) {
    clean.longitude = meetup.longitude;
  }

  if (privacy.showAvailability !== false) {
    if (meetup.schedule && typeof meetup.schedule === 'object') {
      const schedule = {};
      ['date', 'startTime', 'endTime'].forEach((field) => {
        if (typeof meetup.schedule[field] === 'string' && meetup.schedule[field].trim().length > 0) {
          schedule[field] = meetup.schedule[field].trim().slice(0, 32);
        }
      });
      const scheduledFor = meetup.schedule.scheduledFor;
      if (
        scheduledFor instanceof Date
        && !Number.isNaN(scheduledFor.getTime())
      ) {
        schedule.scheduledFor = scheduledFor;
      } else if (scheduledFor && typeof scheduledFor.toMillis === 'function') {
        schedule.scheduledFor = scheduledFor;
      }
      if (Number.isInteger(meetup.schedule.maxPeople)) {
        schedule.maxPeople = Math.max(1, Math.min(50, meetup.schedule.maxPeople));
      }
      if (typeof meetup.schedule.message === 'string' && meetup.schedule.message.trim().length > 0) {
        schedule.message = meetup.schedule.message.trim().slice(0, 500);
      }
      if (Object.keys(schedule).length) clean.schedule = schedule;
    }
    if (typeof meetup.scheduledAt === 'string' && meetup.scheduledAt.trim().length > 0) {
      clean.scheduledAt = meetup.scheduledAt.trim().slice(0, 100);
    }
  }

  return Object.keys(clean).length ? clean : null;
}

function toPublicMeetup(meetup, privacy = {}) {
  return sanitizeMeetup(meetup, privacy);
}

function toPublicProfile(userId, data) {
  const privacy = data.privacy || {};
  const profile = { id: userId };
  const publicMeetup = toPublicMeetup(data.meetup, privacy);
  const alwaysVisibleFields = [
    'name',
    'nickname',
    'bio',
    'avatar',
    'avatarColor',
    'avatarUri',
    'compatibility',
    'tags',
    'interests',
    'encryptionDevices',
  ];
  const visibilityByField = {
    age: privacy.showAge !== false,
    gender: privacy.showGender !== false,
    faculty: privacy.showFaculty !== false,
    year: privacy.showFaculty !== false,
    activity: privacy.showActivity !== false,
    activities: privacy.showActivity !== false,
    activityLabel: privacy.showActivity !== false,
    skill: privacy.showActivity !== false,
    pace: privacy.showActivity !== false,
    availability: privacy.showAvailability !== false,
    availabilitySlots: privacy.showAvailability !== false,
  };

  publicProfileFields.forEach((field) => {
    if (
      data[field] !== undefined
      && (field !== 'meetup' || publicMeetup)
      && (alwaysVisibleFields.includes(field) || visibilityByField[field] !== false)
    ) {
      profile[field] = field === 'encryptionDevices'
        ? getEncryptionDevices(data)
        : field === 'meetup'
          ? publicMeetup
          : data[field];
    }
  });
  // Missing flags are legacy records. Preserve the historical opt-in default
  // while still honoring an explicit user opt-out.
  profile.isDiscoverable = data.isDiscoverable !== false;
  return withoutUndefined(profile);
}

function toConversationProfile(userId, data) {
  const publicProfile = toPublicProfile(userId, data);
  const profile = { id: userId, isDiscoverable: publicProfile.isDiscoverable === true };
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
  };

  Object.entries(textLimits).forEach(([field, maxLength]) => {
    if (typeof publicProfile[field] === 'string') {
      profile[field] = publicProfile[field].slice(0, maxLength);
    }
  });
  if (typeof publicProfile.age === 'number' && publicProfile.age >= 18 && publicProfile.age <= 100) {
    profile.age = publicProfile.age;
  }
  // Never fall back to the private input object here. A profile may hide its
  // meetup location/availability, and copying `data.meetup` would bypass that
  // privacy decision when the participant snapshot is written.
  if (publicProfile.meetup) profile.meetup = publicProfile.meetup;
  const encryptionDevices = getEncryptionDevices(publicProfile);
  if (Object.keys(encryptionDevices).length) profile.encryptionDevices = encryptionDevices;
  if (data.updatedAt !== undefined && data.updatedAt !== null) {
    if (typeof data.updatedAt === 'number') {
      profile.updatedAt = data.updatedAt;
    } else if (typeof data.updatedAt?.toMillis === 'function') {
      profile.updatedAt = data.updatedAt;
    } else if (typeof data.updatedAt === 'string') {
      const parsed = new Date(data.updatedAt).getTime();
      if (!Number.isNaN(parsed)) profile.updatedAt = parsed;
    }
  }
  return profile;
}

export function normalizeProfileRecord(userId, data = {}) {
  const nestedProfile = data?.profile && typeof data.profile === 'object' ? data.profile : {};
  const resolvedUserId = userId || data?.id;
  // The Firestore document ID is authoritative. A legacy `id` field inside
  // the document must never make two different profile documents collapse
  // into one client-side profile.
  const profile = {
    ...nestedProfile,
    ...data,
    ...(resolvedUserId ? { id: resolvedUserId } : {}),
  };
  removeForeignR2AvatarValues(profile, resolvedUserId);
  const nameAlias = profile.displayName || profile.fullName || profile.userName || profile.username;
  if (!hasMeaningfulValue(profile.name) && nameAlias) profile.name = nameAlias;
  if (!hasMeaningfulValue(profile.name) && profile.nickname) profile.name = profile.nickname;
  if (!hasMeaningfulValue(profile.name)) profile.name = 'เพื่อนใหม่';
  if (!profile.avatarUri) {
    const fallbackAvatar = profile.photoURL
      || profile.photoUrl
      || profile.avatarUrl
      || (Array.isArray(profile.photos) ? profile.photos[0] : null)
      || (typeof profile.avatar === 'string' && /^(https?:|file:|data:image\/)/.test(profile.avatar) ? profile.avatar : null);
    if (fallbackAvatar) profile.avatarUri = fallbackAvatar;
  }
  if (profile.age !== undefined && profile.age !== null) {
    const parsedAge = typeof profile.age === 'number' ? profile.age : parseInt(profile.age, 10);
    profile.age = Number.isFinite(parsedAge) && parsedAge >= 10 && parsedAge <= 120 ? parsedAge : null;
  }
  const cleanQ = (val) => (typeof val === 'string' && val.includes('???') ? '' : val);
  ['faculty', 'year', 'activityLabel', 'availability', 'name', 'bio', 'nickname'].forEach((f) => {
    if (profile[f]) profile[f] = cleanQ(profile[f]);
  });
  if (profile.meetup && typeof profile.meetup === 'object') {
    ['name', 'categoryLabel', 'busyTime', 'description'].forEach((f) => {
      if (profile.meetup[f]) profile.meetup[f] = cleanQ(profile.meetup[f]);
    });
  }
  if (!profile.bio) profile.bio = profile.introduction || profile.about || profile.description || profile.bio;
  if (!profile.faculty) profile.faculty = profile.major || profile.department || profile.course || profile.faculty;
  if (!profile.year) profile.year = profile.classYear || profile.studyYear || profile.year;
  if (!profile.gender) profile.gender = profile.sex || profile.gender;
  if (!Array.isArray(profile.activities)) {
    const legacyActivities = profile.activity || profile.interests;
    if (Array.isArray(legacyActivities)) profile.activities = legacyActivities;
    else if (legacyActivities) profile.activities = [legacyActivities];
  }
  if (!profile.activity && Array.isArray(profile.activities) && profile.activities.length) {
    profile.activity = profile.activities[0];
  }
  if (!profile.activityLabel && Array.isArray(profile.activities) && profile.activities.length) {
    profile.activityLabel = profile.activities.map((a) => ACTIVITY_LABELS[a] || a).join(', ');
  }
  return profile;
}

export function toSafePublicProfile(userId, data = {}) {
  const profile = normalizeProfileRecord(userId, data);
  const safeProfile = {
    id: userId,
    isDiscoverable: profile.isDiscoverable !== false,
  };
  // Do not trust older public documents to obey the current projection
  // schema. Strip private fields at the read boundary as well as at write
  // time, so a stale document cannot leak email or precise location.
  publicProfileFields.forEach((field) => {
    if (field === 'meetup') {
      const publicMeetup = toPublicMeetup(profile.meetup, profile.privacy || {});
      if (publicMeetup) safeProfile.meetup = publicMeetup;
      return;
    }
    if (field === 'encryptionDevices') {
      const encryptionDevices = getEncryptionDevices(profile);
      if (Object.keys(encryptionDevices).length) safeProfile.encryptionDevices = encryptionDevices;
      return;
    }
    if (profile[field] !== undefined) safeProfile[field] = profile[field];
  });
  // Keep the projection revision available to the image cache and to paged
  // discovery listeners. It is an audit value, not private profile data.
  if (profile.updatedAt !== undefined && profile.updatedAt !== null) {
    safeProfile.updatedAt = profile.updatedAt;
  }
  return withoutUndefined(safeProfile);
}

/**
 * Merge a profile from multiple caches/snapshots without allowing an empty
 * legacy field to erase a newer value. The last meaningful value wins.
 */
export function mergeProfileRecords(...records) {
  const merged = {};
  records.flat().forEach((record) => {
    if (!record || typeof record !== 'object') return;
    const normalized = normalizeProfileRecord(record.id || merged.id, record);
    Object.entries(normalized).forEach(([key, value]) => {
      if (hasMeaningfulValue(value) || !Object.prototype.hasOwnProperty.call(merged, key)) {
        merged[key] = value;
      }
    });
  });
  return merged.id ? normalizeProfileRecord(merged.id, merged) : null;
}

export function isProfileReadyForDiscovery(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const normalized = normalizeProfileRecord(profile?.id, profile);
  return isNormalizedProfileReady(normalized);
}

function isNormalizedProfileReady(normalized) {
  if (!normalized?.id) return false;

  // 1. ผู้ใช้ใหม่ที่ยังตั้งค่าโปรไฟล์ไม่เสร็จ (isNewUser: true)
  if (normalized.isNewUser === true) return false;

  // 2. ต้องตั้งชื่ออย่างน้อย 2 ตัวอักษร
  const name = String(normalized.nickname || normalized.name || '').trim();
  if (name.length < 2) return false;

  // 3. ต้องมีรูปโปรไฟล์
  const avatar = normalized.avatarUri || normalized.avatar;
  if (!avatar || typeof avatar !== 'string' || !avatar.trim()) return false;

  // 4. ต้องเลือกคณะ (ไม่เป็นค่าว่าง หรือ 'all')
  if (!normalized.faculty || normalized.faculty === 'all' || !String(normalized.faculty).trim()) return false;

  // 5. ต้องเลือกชั้นปี
  if (!normalized.year || !String(normalized.year).trim()) return false;

  // 6. ต้องเลือกเพศ
  if (!normalized.gender || !String(normalized.gender).trim()) return false;

  // 7. ต้องระบุอายุระหว่าง 18 - 100 ปี
  const age = Number(normalized.age);
  if (!Number.isFinite(age) || age < 18 || age > 100) return false;

  // 8. ต้องเลือกกิจกรรมหรือความสนใจอย่างน้อย 1 รายการ
  const hasActivity = (Array.isArray(normalized.activities) && normalized.activities.length > 0)
    || (typeof normalized.activity === 'string' && normalized.activity.trim().length > 0)
    || (Array.isArray(normalized.interests) && normalized.interests.length > 0);
  if (!hasActivity) return false;

  return true;
}

async function getProfileDocFresh(reference) {
  try {
    const serverPromise = getDocFromServer(reference);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 2000)
    );
    return await Promise.race([serverPromise, timeoutPromise]);
  } catch {
    // Offline mode or slow network uses the local Firestore cache.
    return getDoc(reference);
  }
}

export async function getPublicProfile(userId) {
  if (!userId) return null;
  const { db } = requireFirebase();
  const snapshot = await getProfileDocFresh(doc(db, 'profiles', userId));
  return snapshot.exists() ? toSafePublicProfile(snapshot.id, snapshot.data()) : null;
}

/**
 * Hydrate only the profiles referenced by a decision. Discovery pages are
 * intentionally bounded, so likes from users outside the currently loaded
 * page must not disappear from the likes screen.
 */
export async function getPublicProfilesByIds(userIds) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [])
    .filter((value) => typeof value === 'string' && value.trim()))];
  if (!ids.length) return [];

  const { db } = requireFirebase();
  const resultById = new Map();
  const collections = [DISCOVERY_COLLECTION, 'profiles'];

  for (const collectionName of collections) {
    const missingIds = ids.filter((id) => !resultById.has(id));
    if (!missingIds.length) break;
    for (let index = 0; index < missingIds.length; index += PROFILE_ID_QUERY_LIMIT) {
      const chunk = missingIds.slice(index, index + PROFILE_ID_QUERY_LIMIT);
      try {
        const snapshot = await getDocs(query(
          collection(db, collectionName),
          where(documentId(), 'in', chunk)
        ));
        snapshot.docs.forEach((profileDocument) => {
          const safeProfile = toSafePublicProfile(profileDocument.id, profileDocument.data());
          if (isNormalizedProfileReady(safeProfile)) resultById.set(profileDocument.id, safeProfile);
        });
      } catch (error) {
        // A migration can briefly have the new collection/rules unavailable.
        // Continue with the legacy collection instead of breaking likes.
        if (collectionName === 'profiles') throw error;
      }
    }
  }

  return ids.map((id) => resultById.get(id)).filter(Boolean);
}

function getRealDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0;
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
}

function getDistanceBetweenProfiles(p1, p2) {
  if (!p1 || !p2 || p1.latitude == null || p2.latitude == null) {
    return null;
  }
  return getRealDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
}

/**
 * คำนวณระยะห่างจริง (กม.) ระหว่างตำแหน่ง GPS ผู้ใช้กับสถานที่
 * คืนค่า null ถ้าไม่มีพิกัดฝั่งใดฝั่งหนึ่ง
 */
export function getSpotDistanceFromUser(userProfile, spot) {
  const coordinates = [
    userProfile?.latitude,
    userProfile?.longitude,
    spot?.latitude,
    spot?.longitude,
  ];
  if (coordinates.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    return null;
  }
  return getRealDistance(...coordinates);
}

/**
 * แปลงระยะทาง (กม.) เป็นข้อความภาษาไทย เช่น "ห่าง 350 ม." หรือ "ห่าง 1.2 กม."
 */
export function formatDistance(km) {
  if (typeof km !== 'number' || !Number.isFinite(km)) return 'เปิด GPS เพื่อดูระยะทาง';
  if (km < 1) {
    const meters = Math.round(km * 1000);
    return `ห่าง ${meters} ม.`;
  }
  return `ห่าง ${km.toFixed(1)} กม.`;
}

function matchesPreferences(profile, preferences = {}, currentUserProfile = null) {
  if (currentUserProfile && preferences.maxDistance) {
    const dist = getDistanceBetweenProfiles(currentUserProfile, profile);
    if (dist > preferences.maxDistance) return false;
  }

  // "Same faculty" and a specifically selected faculty are mutually exclusive.
  // Prefer the user's own faculty when sameFacultyOnly is enabled so stale
  // persisted values cannot combine into an impossible filter.
  const facultyFilter = preferences.sameFacultyOnly
    ? preferences.currentFaculty
    : (preferences.faculty && preferences.faculty !== 'all' ? preferences.faculty : null);
  if (facultyFilter && profile.faculty !== facultyFilter) {
    return false;
  }
  if (profile.age != null) {
    if (preferences.ageMin != null && profile.age < preferences.ageMin) return false;
    if (preferences.ageMax != null && profile.age > preferences.ageMax) return false;
  }
  const genders = preferences.genders instanceof Set ? preferences.genders : new Set(preferences.genders || []);
  const years = preferences.years instanceof Set ? preferences.years : new Set(preferences.years || []);
  const activities = preferences.activities instanceof Set ? preferences.activities : new Set(preferences.activities || []);
  const paces = preferences.paces instanceof Set ? preferences.paces : new Set(preferences.paces || []);

  if (genders.size && !genders.has(profile.gender)) return false;
  if (years.size && !years.has(profile.year)) return false;

  if (activities.size) {
    const profileActivities = Array.isArray(profile.activities) && profile.activities.length
      ? profile.activities
      : [profile.activity].filter(Boolean);
    if (!profileActivities.some((activity) => activities.has(activity))) return false;
  }
  if (paces.size && !paces.has(profile.pace)) return false;
  if (preferences.availabilityPeriods?.length && !matchesAvailabilityPeriods(profile, preferences.availabilityPeriods)) {
    return false;
  }
  return true;
}

function toMillis(value) {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (value?.toMillis) return value.toMillis();
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  if (typeof value?._seconds === 'number') {
    return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1e6);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function formatLikeTime(value) {
  const millis = toMillis(value);
  if (!millis) return 'เมื่อสักครู่';
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(millis));
}



const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

async function assertAvatarSize(uri) {
  if (typeof uri !== 'string') throw new Error('ไฟล์รูปภาพไม่ถูกต้อง');
  if (uri.startsWith('file://')) {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      throw new Error('ไม่พบไฟล์รูปภาพในอุปกรณ์');
    }
    if (Number.isFinite(info.size) && info.size > MAX_AVATAR_BYTES) {
      throw new Error('รูปภาพมีขนาดใหญ่เกินไป (ต้องไม่เกิน 5 MB หลังการประมวลผล)');
    }
    return;
  }
  if (uri.startsWith('data:')) {
    const match = uri.match(/^data:image\/(?:jpe?g|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) throw new Error('รองรับเฉพาะไฟล์รูปภาพประเภท JPEG, PNG หรือ WebP เท่านั้น');
    const encodedLength = match[1].replace(/\s/g, '').length;
    const byteLength = Math.floor((encodedLength * 3) / 4) - (match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0);
    if (byteLength > MAX_AVATAR_BYTES) throw new Error('รูปภาพมีขนาดใหญ่เกินไป (ต้องไม่เกิน 5 MB)');
  }
}

export async function uploadImage(uri, userId) {
  if (!uri || !userId) return null;
  if (!isAvatarOwnedByProfile(uri, userId)) {
    throw new Error('รูปโปรไฟล์นี้ไม่ตรงกับบัญชีปัจจุบัน กรุณาเลือกรูปใหม่');
  }
  const workerUrl = (process.env.EXPO_PUBLIC_WORKER_URL || 'https://campusmate-upload.comcamp.workers.dev').replace(/\/$/, '');
  if (!/^https:\/\//i.test(workerUrl)) {
    throw new Error('Avatar upload endpoint must use HTTPS');
  }

  const idToken = await getCurrentUserIdToken();
  if (!idToken) throw new Error('Missing Firebase authentication token');
  await assertAvatarSize(uri);

  // Safety check: detect nudity/adult content before uploading avatar
  await verifyImageSafety(uri);

  // If local file, use FileSystem.uploadAsync for reliable native upload
  if (uri.startsWith('file://')) {
    const uploadResult = await FileSystem.uploadAsync(
      `${workerUrl}/avatar/${encodeURIComponent(userId)}`,
      uri,
      {
        httpMethod: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'image/jpeg',
        },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      }
    );

    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      let errorMsg = 'อัปโหลดรูปภาพไม่สำเร็จ';
      try {
        const body = JSON.parse(uploadResult.body);
        if (body.error) errorMsg = body.error;
      } catch {}
      throw new Error(errorMsg);
    }

    const result = JSON.parse(uploadResult.body);
    if (!result.url || !isAvatarOwnedByProfile(result.url, userId)) {
      throw new Error('เซิร์ฟเวอร์ส่ง URL รูปโปรไฟล์ที่ไม่ตรงกับบัญชีปัจจุบัน');
    }
    return result.url;
  }

  // If data: URI or base64, convert to temporary local file first, then upload
  if (uri.startsWith('data:')) {
    const base64Data = uri.split(',')[1] || uri;
    const tempFileUri = `${FileSystem.cacheDirectory}upload_temp_${Date.now()}.jpg`;
    await FileSystem.writeAsStringAsync(tempFileUri, base64Data, {
      encoding: FileSystem.EncodingType.Base64,
    });
    try {
      const uploadResult = await FileSystem.uploadAsync(
        `${workerUrl}/avatar/${encodeURIComponent(userId)}`,
        tempFileUri,
        {
          httpMethod: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'image/jpeg',
          },
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        }
      );

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        let errorMsg = 'อัปโหลดรูปภาพไม่สำเร็จ';
        try {
          const body = JSON.parse(uploadResult.body);
          if (body.error) errorMsg = body.error;
        } catch {}
        throw new Error(errorMsg);
      }
      const result = JSON.parse(uploadResult.body);
      if (!result.url || !isAvatarOwnedByProfile(result.url, userId)) {
        throw new Error('เซิร์ฟเวอร์ส่ง URL รูปโปรไฟล์ที่ไม่ตรงกับบัญชีปัจจุบัน');
      }
      return result.url;
    } finally {
      await FileSystem.deleteAsync(tempFileUri, { idempotent: true }).catch(() => {});
    }
  }

  return uri;
}

export async function getUserProfile(userId) {
  if (!userId) return null;
  const { db } = requireFirebase();
  try {
    const privateSnapshot = await getProfileDocFresh(doc(db, 'users', userId));
    if (privateSnapshot.exists()) {
      return normalizeProfileRecord(userId, privateSnapshot.data());
    }
  } catch (err) {
    console.warn('[getUserProfile] Failed to fetch private profile:', err?.message || err);
  }

  try {
    const publicSnapshot = await getProfileDocFresh(doc(db, 'profiles', userId));
    if (publicSnapshot.exists()) {
      return normalizeProfileRecord(userId, publicSnapshot.data());
    }
  } catch (err) {
    console.warn('[getUserProfile] Failed to fetch public profile:', err?.message || err);
  }

  return null;
}

export async function createUserProfile(userId, data) {
  const { db } = requireFirebase();
  let existingPrivateData = {};
  try {
    const existingPrivateSnapshot = await getProfileDocFresh(doc(db, 'users', userId));
    if (existingPrivateSnapshot.exists()) existingPrivateData = existingPrivateSnapshot.data();
  } catch (error) {
    // A complete optimistic profile can still be written if the read is
    // temporarily unavailable. Offline callers are already queued by the
    // AppContext layer.
    console.warn('[createUserProfile] Existing profile read failed:', error?.message || error);
  }
  let profileData = normalizeProfileRecord(
    userId,
    mergeProfileInput(existingPrivateData, data || {})
  );
  // Profile saves can run at the same time as the first E2EE publication.
  // Always carry this device's public key in the complete profile projection
  // so a full `profiles/{uid}` write cannot accidentally erase it.
  try {
    const identity = await getOrCreateEncryptionIdentity(userId);
    profileData = withIdentityDevice(profileData, identity);
  } catch (error) {
    // Keep normal profile setup usable when secure storage is unavailable;
    // the E2EE publisher will surface the problem and retry separately.
    console.warn('[createUserProfile] E2EE identity unavailable:', error?.message || error);
  }
  // Keep the client-side projection within the same bounds as the rules.
  // This prevents one oversized legacy/text field from rejecting a profile
  // projection with a generic permission-denied error.
  profileData = sanitizeProfileForFirestore(userId, profileData);
  const privateData = {
    id: userId,
    email: profileData.email || '',
    isNewUser: profileData.isNewUser !== false,
    isDiscoverable: profileData.isDiscoverable !== false,
    updatedAt: serverTimestamp(),
  };
  const sanitizedPrivateMeetup = profileData.meetup === null
    ? null
    : sanitizeMeetup(profileData.meetup);
  privateProfileFields.forEach((field) => {
    if (field === 'meetup') {
      if (profileData.meetup !== undefined) privateData.meetup = sanitizedPrivateMeetup;
    } else if (profileData[field] !== undefined) {
      if (field === 'consentAcceptedAt') {
        const timestamp = normalizeLegacyTimestamp(profileData[field]);
        if (timestamp) privateData[field] = timestamp;
      } else {
        privateData[field] = field === 'matchingPreferences'
          ? sanitizeMatchingPreferences(profileData[field])
          : profileData[field];
      }
    }
  });
  legacyPrivateProfileFields.forEach((field) => {
    if (profileData[field] === undefined) return;
    if (field === 'createdAt' || field === 'lastSeen') {
      const timestamp = normalizeLegacyTimestamp(profileData[field]);
      if (timestamp) privateData[field] = timestamp;
      return;
    }
    privateData[field] = profileData[field];
  });
  const publicData = {
    ...toPublicProfile(userId, profileData),
    updatedAt: serverTimestamp(),
  };

  // Replace both projections with their canonical shapes. Keep these as two
  // requests: Firestore evaluates security-rule expressions across every
  // write in a batch, and a complete private + public profile can exceed the
  // 1,000-expression request budget even though each document is valid alone.
  // The private write comes first so the owner record remains authoritative if
  // a transient failure interrupts the public projection write.
  await setDoc(doc(db, 'users', userId), withoutUndefined(privateData));
  await setDoc(doc(db, 'profiles', userId), withoutUndefined(publicData));

  // อัพเดท participantProfiles ใน conversations ที่ user นี้เป็นสมาชิก
  // เพื่อให้อีกเครื่องเห็นชื่อ/รูปที่เปลี่ยนแปลงทันที
  try {
    const { auth } = requireFirebase();
    if (auth?.currentUser?.uid === userId) {
      const convQuery = query(
        collection(db, 'conversations'),
        where('participants', 'array-contains', userId)
      );
      const convSnapshot = await getDocs(convQuery);
      const writableConversations = convSnapshot.docs.filter((convDoc) => (
        isConversationWritable(convDoc.data())
      ));
      if (writableConversations.length > 0) {
        const updatedProfile = toConversationProfile(userId, profileData);
        const cleanProfile = withoutUndefined(updatedProfile);
        for (const convDoc of writableConversations) {
          try {
            await updateDoc(convDoc.ref, {
              [`participantProfiles.${userId}`]: cleanProfile,
              updatedAt: serverTimestamp(),
            });
          } catch (convErr) {
            console.warn(`[createUserProfile] Skipping conv sync ${convDoc.id}:`, convErr?.message || convErr);
          }
        }
      }
    }
  } catch (error) {
    console.warn('[createUserProfile] Conversation sync warning:', error?.message || error);
  }
}

export async function updateUserMatchingPreferences(userId, matchingPreferences) {
  if (!userId) throw new Error('ไม่พบข้อมูลผู้ใช้สำหรับบันทึกตัวกรอง');
  const { db } = requireFirebase();
  const userRef = doc(db, 'users', userId);
  await setDoc(userRef, {
    id: userId,
    matchingPreferences: sanitizeMatchingPreferences(matchingPreferences),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

function valuesMatch(left, right) {
  if (left === right) return true;
  if (left === undefined || left === null || right === undefined || right === null) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/**
 * Repair only the owner-selected public fields when a legacy profile was
 * saved to `users` but its `profiles` projection was incomplete/stale.
 */
export async function ensurePublicProfileProjection(userId, profileData) {
  if (!userId || !profileData) return false;
  const { db } = requireFirebase();
  try {
    const publicSnapshot = await getProfileDocFresh(doc(db, 'profiles', userId));
    const currentPublic = publicSnapshot.exists() ? publicSnapshot.data() : {};
    const expectedPublic = toPublicProfile(
      userId,
      normalizeProfileRecord(userId, profileData)
    );
    // Compare the complete public projection, including fields that should be
    // absent. This repairs stale documents that still contain email, GPS, or
    // privacy-controlled fields from an older release.
    const projectionKeys = new Set([
      ...Object.keys(expectedPublic),
      ...Object.keys(currentPublic).filter((field) => field !== 'updatedAt'),
    ]);
    const needsRepair = !publicSnapshot.exists() || [...projectionKeys].some((field) => (
      !valuesMatch(currentPublic[field], expectedPublic[field])
    ));
    if (!needsRepair) return false;
    await createUserProfile(userId, profileData);
    return true;
  } catch (error) {
    console.warn('[ensurePublicProfileProjection] Repair skipped:', error?.message || error);
    return false;
  }
}

export async function updateUserLocation(userId, latitude, longitude) {
  if (!userId) return;
  const { db } = requireFirebase();
  await setDoc(doc(db, 'users', userId), {
    id: userId,
    latitude,
    longitude,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/**
 * Save the selected meetup without rewriting the complete profile projection.
 * This keeps meetup scheduling working for accounts whose profile document
 * still contains fields written by an older app version.
 */
export async function updateUserMeetup(userId, meetup, privacy = {}) {
  if (!userId) return;
  const { db } = requireFirebase();
  const privateMeetup = meetup == null ? null : sanitizeMeetup(meetup);
  const publicMeetup = meetup == null ? null : toPublicMeetup(meetup, privacy || {});
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', userId), {
    id: userId,
    meetup: privateMeetup,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(db, 'profiles', userId), {
    id: userId,
    meetup: publicMeetup,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return true;
}

export function subscribeToSpots(callback, onError) {
  const { db } = requireFirebase();
  return onSnapshot(
    collection(db, 'spots'),
    (snapshot) => callback(snapshot.docs.map((spotDoc) => ({ id: spotDoc.id, ...spotDoc.data() }))),
    onError
  );
}

function appointmentDocumentId(conversationId, hostUserId) {
  return `a-${conversationId}-${hostUserId}`;
}

function isFirestoreTimestamp(value) {
  return value instanceof Date
    ? !Number.isNaN(value.getTime())
    : Boolean(value && typeof value.toMillis === 'function');
}

function deriveScheduledFor(meetup) {
  const schedule = meetup?.schedule;
  if (!schedule) return null;
  if (isFirestoreTimestamp(schedule.scheduledFor)) {
    return schedule.scheduledFor instanceof Date
      ? Timestamp.fromDate(schedule.scheduledFor)
      : schedule.scheduledFor;
  }
  const dateParts = String(schedule.date || '').split('-').map(Number);
  const timeParts = String(schedule.startTime || '00:00').split(':').map(Number);
  if (dateParts.length !== 3 || dateParts.some((value) => !Number.isFinite(value))) return null;
  const [year, month, day] = dateParts;
  const hour = Number.isFinite(timeParts[0]) ? timeParts[0] : 0;
  const minute = Number.isFinite(timeParts[1]) ? timeParts[1] : 0;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
}

function appointmentMeetupSnapshot(meetup) {
  const safeMeetup = sanitizeMeetup(meetup);
  if (!safeMeetup?.schedule?.date) return null;
  const scheduledFor = deriveScheduledFor(safeMeetup);
  if (!scheduledFor) return null;
  return {
    ...safeMeetup,
    id: safeMeetup.id || 'meetup-spot',
    schedule: {
      ...safeMeetup.schedule,
      scheduledFor,
    },
  };
}

export function subscribeToAppointments(currentUserId, callback, onError) {
  const { db } = requireFirebase();
  // Query the two participant fields separately. A rules expression that
  // checks membership in `participants` cannot reliably prove an
  // array-contains query for every stored appointment shape, which caused
  // the history listener to fail with permission-denied. These equality
  // queries line up with the appointment list rule and still return only
  // appointments involving the signed-in user.
  const byHost = new Map();
  const byGuest = new Map();

  const emit = () => {
    const merged = new Map([...byHost, ...byGuest]);
    callback([...merged.values()]);
  };

  const subscribeFor = (field, target) => onSnapshot(
    query(collection(db, 'appointments'), where(field, '==', currentUserId)),
    (snapshot) => {
      target.clear();
      snapshot.docs.forEach((appointmentDoc) => {
        target.set(appointmentDoc.id, { id: appointmentDoc.id, ...appointmentDoc.data() });
      });
      emit();
    },
    onError,
  );

  const unsubscribeHost = subscribeFor('hostId', byHost);
  const unsubscribeGuest = subscribeFor('guestId', byGuest);
  return () => {
    unsubscribeHost();
    unsubscribeGuest();
  };
}

/**
 * Repair an accepted meetup that predates appointment-history persistence.
 * Only the guest can create the appointment document, matching the normal
 * appointmentCreateAllowed rule. The host profile remains the source of truth
 * for the meetup snapshot so the repair cannot invent a different schedule.
 */
export async function ensureAppointmentHistory(conversationId, currentUserId, hostUserId) {
  if (!conversationId || !currentUserId) return false;
  const { db } = requireFirebase();
  const conversationRef = doc(db, 'conversations', conversationId);
  let created = false;

  try {
    await runTransaction(db, async (transaction) => {
      const conversationSnapshot = await transaction.get(conversationRef);
      if (!conversationSnapshot.exists()) return;
      const conversation = conversationSnapshot.data() || {};
      const participants = Array.isArray(conversation.participants) ? conversation.participants : [];
      if (participants.length !== 2 || !participants.includes(currentUserId)) return;

      const hostId = participants.includes(hostUserId) && hostUserId !== currentUserId
        ? hostUserId
        : participants.find((participantId) => participantId !== currentUserId);
      const guestId = participants.find((participantId) => participantId !== hostId);
      if (!hostId || guestId !== currentUserId) return;

      const acceptedUsers = Array.isArray(conversation.meetupAcceptedUsers)
        ? conversation.meetupAcceptedUsers
        : [];
      if (!acceptedUsers.includes(currentUserId)) return;

      const appointmentId = appointmentDocumentId(conversationId, hostId);
      const appointmentRef = doc(db, 'appointments', appointmentId);
      let appointmentSnapshot = null;
      try {
        appointmentSnapshot = await transaction.get(appointmentRef);
      } catch (e) {
        if (e?.code === 'permission-denied') return;
        throw e;
      }
      if (appointmentSnapshot?.exists()) return;

      let hostProfileSnapshot = null;
      try {
        hostProfileSnapshot = await transaction.get(doc(db, 'profiles', hostId));
      } catch (e) {
        if (e?.code === 'permission-denied') return;
        throw e;
      }
      const hostMeetup = appointmentMeetupSnapshot(
        hostProfileSnapshot?.exists() ? hostProfileSnapshot.data()?.meetup : null
      );
      if (!hostMeetup) return;

      // Keep getAfter(conversationRef) available for the appointment create rule
      // even though the acceptance itself was written by an older operation.
      transaction.update(conversationRef, { updatedAt: serverTimestamp() });
      transaction.set(appointmentRef, {
        id: appointmentId,
        conversationId,
        participants: [hostId, currentUserId].sort(),
        hostId,
        guestId,
        meetup: hostMeetup,
        scheduledFor: hostMeetup.schedule.scheduledFor,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      created = true;
    });
  } catch (err) {
    if (err?.code === 'permission-denied') {
      return false;
    }
    console.warn('[Firestore] ensureAppointmentHistory warning:', err?.message || err);
    return false;
  }

  return created;
}

/**
 * Subscribe to the server-owned discovery projection in stable, bounded
 * pages. The `_meta` marker is written only after the one-time backfill has
 * completed; until then, keep using the legacy public profile query so a
 * partial migration can never hide users from the app.
 */
export function createSharedProfilesSubscription(onProfiles, onError, options = {}) {
  const { db } = requireFirebase();
  const pageSize = Math.max(10, Math.min(100, Number(options.pageSize) || DISCOVERY_PAGE_SIZE));
  const onPageInfo = typeof options.onPageInfo === 'function' ? options.onPageInfo : () => {};
  const profileCache = new Map();
  const pageStates = [];
  let disposed = false;
  let source = null;
  let legacyUnsubscribe = null;
  let hasMore = false;
  let discoveryFallbackStarted = false;
  let legacyStarted = false;

  const emitPageInfo = (loading = false) => {
    onPageInfo({
      source,
      hasMore,
      loading,
      loadedPages: pageStates.filter((page) => page?.loaded).length,
    });
  };

  const clearDiscoveryState = () => {
    pageStates.forEach((page) => page?.unsubscribe?.());
    pageStates.length = 0;
    profileCache.clear();
    hasMore = false;
  };

  const emitDiscoveryProfiles = () => {
    const seenIds = new Set();
    const profiles = [];
    pageStates.forEach((page) => {
      page?.ids?.forEach((id) => {
        if (seenIds.has(id)) return;
        seenIds.add(id);
        const profile = profileCache.get(id);
        if (profile) profiles.push(profile);
      });
    });
    onProfiles?.(profiles);
  };

  const startLegacy = () => {
    if (disposed || legacyStarted) return;
    legacyStarted = true;
    discoveryFallbackStarted = true;
    source = 'profiles';
    clearDiscoveryState();
    startDiscoveryPage(0, null, null, 'profiles', false);
  };

  const startUnboundedLegacy = () => {
    if (disposed || legacyUnsubscribe) return;
    source = 'profiles';
    clearDiscoveryState();
    emitPageInfo(false);
    legacyUnsubscribe = onSnapshot(
      query(collection(db, 'profiles'), where('isDiscoverable', '==', true)),
      (snapshot) => {
        if (snapshot.empty) {
          profileCache.clear();
          onProfiles?.([]);
          return;
        }
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'removed') {
            profileCache.delete(change.doc.id);
            return;
          }
          const safeProfile = toSafePublicProfile(change.doc.id, change.doc.data());
          if (isNormalizedProfileReady(safeProfile)) profileCache.set(change.doc.id, safeProfile);
          else profileCache.delete(change.doc.id);
        });
        onProfiles?.(snapshot.docs.map((document) => profileCache.get(document.id)).filter(Boolean));
      },
      onError
    );
  };

  const startDiscoveryPage = (pageIndex, cursor, resolveInitial, collectionName = 'profiles', allowLegacyFallback = true) => {
    if (disposed) return;
    const page = {
      index: pageIndex,
      collectionName,
      ids: [],
      lastDocument: cursor || null,
      loaded: false,
      resolveInitial,
      unsubscribe: null,
    };
    pageStates[pageIndex] = page;

    const constraints = [
      where('isDiscoverable', '==', true),
      orderBy(documentId()),
    ];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(pageSize));

    emitPageInfo(true);
    page.unsubscribe = onSnapshot(
      query(collection(db, collectionName), ...constraints),
      (snapshot) => {
        if (disposed || (collectionName === DISCOVERY_COLLECTION && discoveryFallbackStarted)) return;
        const isFirstSnapshot = !page.loaded;
        page.loaded = true;
        page.ids = snapshot.docs.map((document) => document.id);
        if (snapshot.docs.length > 0) {
          page.lastDocument = snapshot.docs[snapshot.docs.length - 1];
        }
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'removed') {
            profileCache.delete(change.doc.id);
            return;
          }
          const safeProfile = toSafePublicProfile(change.doc.id, change.doc.data());
          if (isNormalizedProfileReady(safeProfile)) profileCache.set(change.doc.id, safeProfile);
          else profileCache.delete(change.doc.id);
        });

        if (pageIndex === pageStates.length - 1) {
          hasMore = snapshot.docs.length === pageSize;
        }
        emitPageInfo(false);
        emitDiscoveryProfiles();
        if (isFirstSnapshot) page.resolveInitial?.(snapshot.docs.length > 0);
        page.resolveInitial = null;
      },
      (error) => {
        if (disposed) return;
        page.resolveInitial?.(false);
        page.resolveInitial = null;
        // Missing indexes/rules during rollout should not take discovery down.
        // First try the paged legacy projection, then retain the old unbounded
        // listener as a final compatibility fallback for older deployments.
        if (pageIndex === 0 && allowLegacyFallback && !discoveryFallbackStarted) {
          page.unsubscribe?.();
          startLegacy();
          return;
        }
        if (pageIndex === 0 && collectionName === 'profiles' && !legacyUnsubscribe) {
          page.unsubscribe?.();
          startUnboundedLegacy();
          return;
        }
        onError?.(error);
      }
    );
  };

  const loadMore = () => {
    if (disposed || !['discovery', 'profiles'].includes(source) || !hasMore) return Promise.resolve(false);
    const lastPage = pageStates[pageStates.length - 1];
    if (!lastPage?.loaded || !lastPage.lastDocument || lastPage.loading) return Promise.resolve(false);
    lastPage.loading = true;
    emitPageInfo(true);
    return new Promise((resolve) => {
      startDiscoveryPage(pageStates.length, lastPage.lastDocument, resolve, source, false);
    });
  };

  const unsubscribe = () => {
    if (disposed) return;
    disposed = true;
    legacyUnsubscribe?.();
    legacyUnsubscribe = null;
    clearDiscoveryState();
    onPageInfo({ source: null, hasMore: false, loading: false, loadedPages: 0 });
  };

  const controller = {
    unsubscribe,
    loadMore,
    get hasMore() {
      return hasMore;
    },
    get source() {
      return source;
    },
  };

  const start = async () => {
    // อ่านตรงจาก collection 'profiles' เสมอ เพื่อให้ค้นหาเพื่อนได้ทันที
    // โดยไม่ต้องพึ่งพา Cloud Functions หรือ collection discoveryProfiles
    startLegacy();
  };

  void start();
  return controller;
}

function decisionProfileId(decision, direction) {
  return direction === 'incoming' ? decision?.fromUserId : decision?.toUserId;
}

export function filterAvailableProfiles(
  currentUserId,
  preferences,
  allProfiles,
  outgoingDecisions = [],
  currentUserProfileOverride = null,
) {
  const removedUserIds = new Set();
  const hiddenIds = new Set();
  const matchedIds = new Set();
  const compiledPreferences = {
    ...preferences,
    genders: new Set(preferences?.genders || []),
    years: new Set(preferences?.years || []),
    activities: new Set(preferences?.activities || []),
    paces: new Set(preferences?.paces || []),
  };

  outgoingDecisions.forEach((decision) => {
    const targetId = decision?.toUserId;
    if (!targetId) return;
    if (decision.status === 'removed') {
      removedUserIds.add(targetId);
      hiddenIds.add(targetId);
      return;
    }
    if (
      decision.type === 'skip'
      || (decision.type === 'like' && decision.status !== 'rejected')
      || decision.status === 'accepted'
    ) {
      hiddenIds.add(targetId);
    }
    if (decision.status === 'accepted') matchedIds.add(targetId);
  });

  const currentUserProfile = currentUserProfileOverride
    || allProfiles.find((profile) => profile.id === currentUserId);
  const filteredProfiles = [];
  allProfiles.forEach((profile) => {
    if (
      profile.id === currentUserId
      || profile.isDiscoverable === false
      || !isProfileReadyForDiscovery(profile)
      || hiddenIds.has(profile.id)
      || !matchesPreferences(profile, compiledPreferences, currentUserProfile)
    ) return;

    filteredProfiles.push({
      ...profile,
      isMatched: matchedIds.has(profile.id),
      distance: getDistanceBetweenProfiles(currentUserProfile, profile),
    });
  });

  return { profiles: filteredProfiles, removedUserIds };
}

export function hydrateDecisionLikes(decisions, allProfiles, direction) {
  const profilesById = new Map(allProfiles.map((profile) => [profile.id, profile]));
  return decisions
    .filter((decision) => (
      decision.type === 'like'
      && decision.status !== 'removed'
      && decision.status !== 'rejected'
    ))
    .map((decision) => {
      const profileId = decisionProfileId(decision, direction);
      const profileData = profilesById.get(profileId);
      if (!profileData) return null;
      return {
        id: profileId,
        ...profileData,
        decisionId: decision.decisionId || decision.id,
        status: decision.status || 'pending',
        likeMessage: decision.likeMessage || '',
        likedAt: formatLikeTime(decision.createdAt),
        createdAt: decision.createdAt,
      };
    })
    .filter(Boolean)
    .sort((first, second) => toMillis(second.createdAt) - toMillis(first.createdAt));
}

/**
 * Subscribe to both decision directions once. The previous implementation
 * opened a third outgoing listener just to derive available profiles and
 * recreated all decision listeners whenever the profile list changed.
 */
export function subscribeToUserDecisions(currentUserId, callback, onError) {
  const { db } = requireFirebase();
  const decisionCaches = {
    incoming: new Map(),
    outgoing: new Map(),
  };
  let incomingDecisions = null;
  let outgoingDecisions = null;

  const emit = () => {
    if (!incomingDecisions || !outgoingDecisions) return;
    callback({ incomingDecisions, outgoingDecisions });
  };

  const subscribeFor = (field, target) => onSnapshot(
    query(collection(db, 'decisions'), where(field, '==', currentUserId)),
    (snapshot) => {
      const cache = decisionCaches[target];
      const changes = snapshot.docChanges();
      if (changes.length === 0) return;
      changes.forEach((change) => {
        if (change.type === 'removed') {
          cache.delete(change.doc.id);
          return;
        }
        cache.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
      });
      const decisions = [...cache.values()];
      if (target === 'incoming') incomingDecisions = decisions;
      else outgoingDecisions = decisions;
      emit();
    },
    onError,
  );

  const unsubscribeIncoming = subscribeFor('toUserId', 'incoming');
  const unsubscribeOutgoing = subscribeFor('fromUserId', 'outgoing');
  return () => {
    unsubscribeIncoming?.();
    unsubscribeOutgoing?.();
  };
}

function isMessageHiddenForUser(message, userId) {
  if (Array.isArray(message?.hiddenFor)) return message.hiddenFor.includes(userId);
  return message?.hiddenFor?.[userId] === true;
}

function isMessageAfterHistoryCutoff(message, historyClearedAt) {
  const cutoffMillis = toMillis(historyClearedAt);
  if (!cutoffMillis) return true;
  const messageMillis = toMillis(message?.createdAt || message?.time);
  return messageMillis > cutoffMillis - 60000;
}

export function decryptConversationMessageList(
  conversationId,
  rawMessages,
  conversationKey,
  currentUserId,
  historyClearedAt = null
) {
  return (Array.isArray(rawMessages) ? rawMessages : [])
    .filter((message) => isMessageAfterHistoryCutoff(message, historyClearedAt))
    .map((message, index) => {
      const withId = {
        ...message,
        id: message.id || `${conversationId}-m-${toMillis(message.createdAt || message.time)}-${message.senderId || message.sender || 'unknown'}-${index}`,
      };
      const decrypted = decryptMessageRecord(withId, conversationKey);
      return {
        ...decrypted,
        sender: decrypted.senderId
          ? (decrypted.senderId === currentUserId ? 'me' : 'other')
          : decrypted.sender,
      };
    })
    .filter((message) => !isMessageHiddenForUser(message, currentUserId))
    .sort((first, second) => toMillis(first.createdAt || first.time) - toMillis(second.createdAt || second.time));
}

/**
 * Subscribe to conversation metadata and the protected per-message
 * subcollection. The root `messages` array is legacy/read-only data; new
 * writes never use it because Firestore rules cannot validate an array item
 * independently.
 */
export function subscribeToConversations(currentUserId, callback, onError) {
  const { db } = requireFirebase();
  let previousEntries = new Map();
  let previousConversations = null;
  let previousRootSnapshotInfo = null;
  let emitVersion = 0;
  let disposed = false;
  let emitTimer = null;
  let emitInFlight = false;
  let emitRequested = false;
  const rawConversations = new Map();
  const hydratedConversations = new Map();
  const secureMessagesByConversation = new Map();
  const secureMessageSnapshotsReady = new Set();
  const messageUnsubscribers = new Map();
  let latestRootSnapshotInfo = { fromCache: true, hasPendingWrites: false };
  // Reading the local identity must not wait for the optional Firestore
  // publication transaction. A legacy profile can reject that transaction
  // while the current device can still decrypt existing conversations.
  const identityPromise = getOrCreateEncryptionIdentity(currentUserId);
  const conversationsQuery = query(
    collection(db, 'conversations'),
    where('participants', 'array-contains', currentUserId)
  );

  const emit = async () => {
    const currentEmitVersion = ++emitVersion;
    let identity;
    try {
      identity = await identityPromise;
    } catch (error) {
      onError?.(error);
      return;
    }

    try {
      const hydrateConversation = async ([conversationId, entry]) => {
        subscribeToMessageSubcollection(conversationId);
        const secureMessageSnapshot = secureMessagesByConversation.get(conversationId) || [];
        const secureSnapshotReady = secureMessageSnapshotsReady.has(conversationId);
        const cachedHydration = hydratedConversations.get(conversationId);
        if (
          cachedHydration
          && cachedHydration.rawEntry === entry
          && cachedHydration.secureMessages === secureMessageSnapshot
          && cachedHydration.secureSnapshotReady === secureSnapshotReady
        ) return cachedHydration.conversation;

        const data = entry.data || {};
        const mySettings = data.participantSettings?.[currentUserId] || {};
        const isHidden = mySettings.isHidden === true;
        // `hiddenAt` was written by the previous unmatch implementation. Use
        // it as a migration fallback so rooms deleted before this fix also
        // reopen with a clean visible timeline.
        const historyClearedAt = mySettings.historyClearedAt || mySettings.hiddenAt || null;
        const hasHistoryCutoff = toMillis(historyClearedAt) > 0;
        let preparedData = data;
        let conversationKey = null;
        let encryptionPending = false;
        let encryptionError = null;

        if (!isHidden) {
          try {
            if (isValidConversationEncryption(data.encryption) && hasCurrentDeviceEnvelope(data.encryption, currentUserId, identity)) {
              try {
                conversationKey = getConversationKey(data.encryption, currentUserId, identity);
              } catch {
                conversationKey = null;
              }
            }
            const otherUserId = preparedData.participants?.find((participantId) => participantId !== currentUserId);
            const otherEnvelopes = data.encryption?.keyEnvelopes?.[otherUserId];
            const isMissingOtherEnvelope = Boolean(
              otherUserId
              && (!otherEnvelopes || Object.keys(otherEnvelopes).length === 0)
            );

            if (!conversationKey || isMissingOtherEnvelope) {
              const prepared = await ensureConversationEncryption(
                conversationId,
                currentUserId,
                data.participantProfiles || {}
              );
              conversationKey = prepared.conversationKey;
              preparedData = {
                ...data,
                ...prepared.data,
                encryption: prepared.encryption,
                messages: prepared.messages,
              };
            }
          } catch (error) {
            console.warn(`[Firestore] E2EE unavailable for conversation ${conversationId}:`, error?.message || error);
            encryptionPending = true;
            encryptionError = error?.code || 'E2EE_KEY_UNAVAILABLE';
          }
        }

        const legacyMessages = isHidden ? [] : decryptConversationMessageList(
          conversationId,
          preparedData.messages,
          encryptionPending ? null : conversationKey,
          currentUserId,
          historyClearedAt
        );
        const secureMessages = isHidden ? [] : decryptConversationMessageList(
          conversationId,
          secureMessageSnapshot,
          encryptionPending ? null : conversationKey,
          currentUserId,
          historyClearedAt
        );
        const messagesById = new Map(legacyMessages.map((message) => [message.id, message]));
        secureMessages.forEach((message) => messagesById.set(message.id, message));
        // The parent conversation snapshot can arrive before the first
        // per-message snapshot. Reuse the last hydrated timeline during that
        // gap instead of publishing an empty history to the UI.
        if (!isHidden && !encryptionPending && !secureMessageSnapshotsReady.has(conversationId)) {
          const previousMessages = previousEntries.get(conversationId)?.conversation?.messages || [];
          previousMessages
            .filter((message) => (
              !isMessageHiddenForUser(message, currentUserId)
                && (!hasHistoryCutoff || toMillis(message.createdAt || message.time) > toMillis(historyClearedAt))
            ))
            .forEach((message) => messagesById.set(message.id, message));
        }
        const messages = [...messagesById.values()]
          .sort((first, second) => toMillis(first.createdAt || first.time) - toMillis(second.createdAt || second.time));

        const participantProfiles = Object.fromEntries(
          Object.entries(preparedData.participantProfiles || {}).map(([userId, participantProfile]) => [
            userId,
            toSafePublicProfile(userId, participantProfile),
          ])
        );
        const otherUserId = preparedData.participants?.find((participantId) => participantId !== currentUserId);
        const otherProfile = otherUserId ? participantProfiles[otherUserId] || {} : {};
        const latestMessage = messages[messages.length - 1];
        const visibleUnreadCounts = { ...(preparedData.unreadCounts || {}) };
        if (hasHistoryCutoff && !latestMessage) visibleUnreadCounts[currentUserId] = 0;
        const hydratedConversation = {
          id: conversationId,
          ...preparedData,
          isHidden,
          participantProfiles,
          profileId: otherUserId || preparedData.profileId,
          name: otherProfile.name || preparedData.name || 'CampusMate',
          avatar: otherProfile.avatar || preparedData.avatar,
          avatarColor: otherProfile.avatarColor || preparedData.avatarColor,
          avatarUri: otherProfile.avatarUri || preparedData.avatarUri,
          subtitle: [otherProfile.faculty, otherProfile.year].filter(Boolean).join(' · '),
          readReceipts: preparedData.readReceipts || {},
          unreadCounts: visibleUnreadCounts,
          participantSettings: preparedData.participantSettings || {},
          mySettings,
          lastMessage: encryptionPending
            ? ENCRYPTED_PREVIEW
            : (latestMessage?.text || ENCRYPTED_PREVIEW),
          lastMessageSenderId: latestMessage?.senderId
            || (hasHistoryCutoff ? null : preparedData.lastMessageSenderId),
          lastMessageAt: !hasHistoryCutoff && toMillis(preparedData.lastMessageAt) > toMillis(latestMessage?.createdAt)
            ? preparedData.lastMessageAt
            : (latestMessage?.createdAt || (hasHistoryCutoff ? null : preparedData.lastMessageAt)),
          lastMessageId: latestMessage?.id || (hasHistoryCutoff ? null : preparedData.lastMessageId),
          messages,
          messagesHydrating: !isHidden && !secureSnapshotReady,
          encryptionPending,
          encryptionError,
        };
        hydratedConversations.set(conversationId, {
          rawEntry: entry,
          secureMessages: secureMessageSnapshot,
          secureSnapshotReady,
          conversation: hydratedConversation,
        });
        return hydratedConversation;
      };

      const publish = (conversations, loadingConversationIds = []) => {
        if (disposed || currentEmitVersion !== emitVersion) return;
        const nextEntries = new Map();
        const loadingIds = new Set(loadingConversationIds);
        const retained = (previousConversations || []).filter((conversation) => loadingIds.has(conversation.id));
        const stableConversations = [...conversations, ...retained].map((conversation) => {
          const signature = conversationRenderSignature(conversation);
          const previousEntry = previousEntries.get(conversation.id);
          const stableConversation = previousEntry?.signature === signature
            ? previousEntry.conversation
            : conversation;
          nextEntries.set(conversation.id, { conversation: stableConversation, signature });
          return stableConversation;
        });
        stableConversations.sort(compareConversationsByActivity);
        const changed = previousConversations === null
          || stableConversations.length !== previousConversations.length
          || stableConversations.some((conversation, index) => conversation !== previousConversations[index]);
        const serverSnapshotArrived = latestRootSnapshotInfo.fromCache === false
          && previousRootSnapshotInfo?.fromCache !== false;
        previousEntries = nextEntries;
        if (changed || serverSnapshotArrived) {
          previousConversations = stableConversations;
          previousRootSnapshotInfo = latestRootSnapshotInfo;
          callback(stableConversations, { ...latestRootSnapshotInfo, loadingConversationIds });
        } else {
          previousRootSnapshotInfo = latestRootSnapshotInfo;
        }
      };

      // Prepare recent rooms first and publish each small batch immediately.
      // Root metadata remains a complete subscription for unread counts/search.
      const entries = [...rawConversations.entries()].sort((first, second) => (
        compareConversationsByActivity({ ...first[1].data, id: first[0] }, { ...second[1].data, id: second[0] })
      ));
      const conversations = [];
      if (entries.length === 0) publish([]);
      for (let offset = 0; offset < entries.length; offset += 5) {
        if (disposed || currentEmitVersion !== emitVersion) return;
        const batch = await Promise.all(entries.slice(offset, offset + 5).map(hydrateConversation));
        if (disposed || currentEmitVersion !== emitVersion) return;
        conversations.push(...batch);
        publish(conversations, entries.slice(offset + 5).map(([id]) => id));
        // Let the rendered batch reach the screen before decrypting more rooms.
        if (offset + 5 < entries.length) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      console.error('[Firestore] Failed to decrypt conversations:', error);
      onError?.(error);
    }
  };

  // A root snapshot and its message subcollection snapshots often arrive in
  // the same turn. Coalesce them so decryption, sorting, and React updates run
  // once instead of once per listener callback.
  const scheduleEmit = () => {
    emitRequested = true;
    if (emitTimer !== null || emitInFlight) return;
    emitTimer = setTimeout(async () => {
      emitTimer = null;
      if (disposed) {
        emitRequested = false;
        return;
      }
      emitRequested = false;
      emitInFlight = true;
      try {
        await emit();
      } finally {
        emitInFlight = false;
        if (emitRequested && !disposed) scheduleEmit();
      }
    }, 0);
  };

  const subscribeToMessageSubcollection = (conversationId) => {
    if (messageUnsubscribers.has(conversationId)) return;
    const messagesQuery = query(
      collection(db, 'conversations', conversationId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(25)
    );
    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        secureMessagesByConversation.set(
          conversationId,
          snapshot.docs.map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() })).reverse()
        );
        secureMessageSnapshotsReady.add(conversationId);
        scheduleEmit();
      },
      (error) => {
        console.warn('[Firestore] Messages subscription failed, falling back:', conversationId, error?.message || error);
        // Keep the last successful snapshot. Clearing it here made a
        // transient listener error look like a deleted conversation history.
        if (!secureMessagesByConversation.has(conversationId)) {
          secureMessagesByConversation.set(conversationId, []);
        }
        scheduleEmit();
      }
    );
    messageUnsubscribers.set(conversationId, unsubscribe);
  };

  const rootUnsubscribe = onSnapshot(
    conversationsQuery,
    (snapshot) => {
      if (disposed) return;
      emitVersion += 1;
      latestRootSnapshotInfo = {
        fromCache: snapshot.metadata?.fromCache === true,
        hasPendingWrites: snapshot.metadata?.hasPendingWrites === true,
      };
      const activeIds = new Set(snapshot.docs.map((conversationDoc) => conversationDoc.id));
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') {
          rawConversations.delete(change.doc.id);
          hydratedConversations.delete(change.doc.id);
          secureMessagesByConversation.delete(change.doc.id);
          secureMessageSnapshotsReady.delete(change.doc.id);
          messageUnsubscribers.get(change.doc.id)?.();
          messageUnsubscribers.delete(change.doc.id);
          return;
        }
        rawConversations.set(change.doc.id, { data: change.doc.data() });
      });
      [...rawConversations.keys()].forEach((conversationId) => {
        if (activeIds.has(conversationId)) return;
        rawConversations.delete(conversationId);
        hydratedConversations.delete(conversationId);
        secureMessagesByConversation.delete(conversationId);
        secureMessageSnapshotsReady.delete(conversationId);
        messageUnsubscribers.get(conversationId)?.();
        messageUnsubscribers.delete(conversationId);
      });
      scheduleEmit();
    },
    (error) => {
      console.error('[Firestore] Conversation subscription failed:', {
        code: error?.code || 'unknown',
        message: error?.message || String(error),
      });
      onError?.(error);
    }
  );

  return () => {
    disposed = true;
    if (emitTimer !== null) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    emitRequested = false;
    rootUnsubscribe?.();
    messageUnsubscribers.forEach((unsubscribe) => unsubscribe?.());
    messageUnsubscribers.clear();
    rawConversations.clear();
    hydratedConversations.clear();
    secureMessagesByConversation.clear();
    secureMessageSnapshotsReady.clear();
  };
}

function subscribeToConversationsLegacy(currentUserId, callback, onError) {
  const { db } = requireFirebase();
  let previousEntries = new Map();
  let previousConversations = null;
  let snapshotVersion = 0;
  const identityPromise = ensureEncryptionIdentity(currentUserId);
  const conversationsQuery = query(
    collection(db, 'conversations'),
    where('participants', 'array-contains', currentUserId)
  );

  const processSnapshot = async (snapshot) => {
    const currentSnapshotVersion = ++snapshotVersion;
    let identity;
    try {
      identity = await identityPromise;
    } catch (error) {
      onError?.(error);
      return;
    }

    try {
      const conversations = await Promise.all(snapshot.docs.map(async (conversationDoc) => {
        const data = conversationDoc.data();
        let preparedData = data;
        let messages = [];
        let encryptionPending = false;
        let encryptionError = null;
        try {
          let conversationKey = null;
          if (isValidConversationEncryption(data.encryption) && hasCurrentDeviceEnvelope(data.encryption, currentUserId, identity)) {
            try {
              conversationKey = getConversationKey(data.encryption, currentUserId, identity);
            } catch {
              conversationKey = null;
            }
          }
          if (!conversationKey) {
            const prepared = await ensureConversationEncryption(
              conversationDoc.id,
              currentUserId,
              data.participantProfiles || {}
            );
            conversationKey = prepared.conversationKey;
            preparedData = {
              ...data,
              ...prepared.data,
              encryption: prepared.encryption,
              messages: prepared.messages,
            };
          }
          messages = (Array.isArray(preparedData.messages) ? preparedData.messages : [])
            .map((message, index) => {
              const withId = {
                ...message,
                id: message.id || `${conversationDoc.id}-m-${toMillis(message.createdAt || message.time)}-${message.senderId || message.sender || 'unknown'}-${index}`,
              };
              const decrypted = decryptMessageRecord(withId, conversationKey);
              return {
                ...decrypted,
                sender: decrypted.senderId
                  ? (decrypted.senderId === currentUserId ? 'me' : 'other')
                  : decrypted.sender,
              };
            })
            .filter((message) => !(message.hiddenFor || []).includes(currentUserId))
            .sort((first, second) => toMillis(first.createdAt || first.time) - toMillis(second.createdAt || second.time));
        } catch (error) {
          console.warn(`[Firestore] E2EE unavailable for legacy conversation ${conversationDoc.id}:`, error?.message || error);
          encryptionPending = true;
          encryptionError = error?.code || 'E2EE_KEY_UNAVAILABLE';
          // Keep message rows visible with safe placeholders while the key is
          // unavailable. Never expose stored plaintext or ciphertext content.
          messages = (Array.isArray(data.messages) ? data.messages : [])
            .map((message, index) => {
              const withId = {
                ...message,
                id: message.id || `${conversationDoc.id}-m-${toMillis(message.createdAt || message.time)}-${message.senderId || message.sender || 'unknown'}-${index}`,
              };
              const safeMessage = decryptMessageRecord(withId, null);
              return {
                ...safeMessage,
                sender: safeMessage.senderId
                  ? (safeMessage.senderId === currentUserId ? 'me' : 'other')
                  : safeMessage.sender,
              };
            })
            .filter((message) => !(message.hiddenFor || []).includes(currentUserId))
            .sort((first, second) => toMillis(first.createdAt || first.time) - toMillis(second.createdAt || second.time));
        }

        const participantProfiles = Object.fromEntries(
          Object.entries(preparedData.participantProfiles || {}).map(([userId, participantProfile]) => [
            userId,
            toSafePublicProfile(userId, participantProfile),
          ])
        );
        const otherUserId = preparedData.participants?.find((participantId) => participantId !== currentUserId);
        const otherProfile = otherUserId ? participantProfiles[otherUserId] || {} : {};
        return {
          id: conversationDoc.id,
          ...preparedData,
          participantProfiles,
          profileId: otherUserId || preparedData.profileId,
          name: otherProfile.name || preparedData.name || 'ผู้ใช้ CampusMate',
          avatar: otherProfile.avatar || preparedData.avatar,
          avatarColor: otherProfile.avatarColor || preparedData.avatarColor,
          avatarUri: otherProfile.avatarUri || preparedData.avatarUri,
          subtitle: [otherProfile.faculty, otherProfile.year].filter(Boolean).join(' · '),
          readReceipts: preparedData.readReceipts || {},
          participantSettings: preparedData.participantSettings || {},
          mySettings: preparedData.participantSettings?.[currentUserId] || {},
          lastMessage: encryptionPending
            ? ENCRYPTED_PREVIEW
            : (messages[messages.length - 1]?.text || ENCRYPTED_PREVIEW),
          messages,
          encryptionPending,
          encryptionError,
        };
      }));

      if (currentSnapshotVersion !== snapshotVersion) return;
      const nextEntries = new Map();
      const stableConversations = conversations.map((conversation) => {
        const signature = conversationRenderSignature(conversation);
        const previousEntry = previousEntries.get(conversation.id);
        const stableConversation = previousEntry?.signature === signature
          ? previousEntry.conversation
          : conversation;
        nextEntries.set(conversation.id, { conversation: stableConversation, signature });
        return stableConversation;
      });
      stableConversations.sort((first, second) => toMillis(second.updatedAt) - toMillis(first.updatedAt));
      const changed = previousConversations === null
        || stableConversations.length !== previousConversations.length
        || stableConversations.some((conversation, index) => conversation !== previousConversations[index]);
      previousEntries = nextEntries;
      if (changed) {
        console.log('[Firestore] Conversations updated');
        previousConversations = stableConversations;
        callback(stableConversations);
      }
    } catch (error) {
      console.error('[Firestore] Failed to decrypt conversations:', error);
      onError?.(error);
    }
  };

  return onSnapshot(
    conversationsQuery,
    (snapshot) => { void processSnapshot(snapshot); },
    (error) => {
      console.error('[Firestore] Conversation subscription failed');
      onError?.(error);
    }
  );
}

function conversationRenderSignature(conversation) {
  const unreadCounts = Object.entries(conversation.unreadCounts || {})
    .sort(([firstId], [secondId]) => firstId.localeCompare(secondId));
  const readReceipts = Object.entries(conversation.readReceipts || {})
    .map(([uid, ts]) => [uid, toMillis(ts)])
    .sort(([firstId], [secondId]) => firstId.localeCompare(secondId));
  const participantSettings = Object.entries(conversation.participantSettings || {})
    .sort(([firstId], [secondId]) => firstId.localeCompare(secondId));
  const messages = (conversation.messages || []).map((message) => [
    message.id,
    message.sender,
    message.text,
    toMillis(message.createdAt || message.time),
    JSON.stringify(message.reactions || {}),
    JSON.stringify(message.reactionTimes || {}),
    JSON.stringify(message.replyTo || null),
    Boolean(message.forwarded),
    JSON.stringify(message.hiddenFor || []),
  ]);
  return JSON.stringify([
    conversation.id,
    conversation.profileId,
    conversation.name,
    conversation.avatar,
    conversation.avatarColor,
    conversation.avatarUri,
    conversation.subtitle,
    conversation.lastMessage,
    conversation.lastMessageSenderId,
    toMillis(conversation.lastMessageAt),
    conversation.lastMessageId,
    Boolean(conversation.encryptionPending),
    conversation.encryptionError,
    Boolean(conversation.messagesHydrating),
    unreadCounts,
    readReceipts,
    participantSettings,
    messages,
  ]);
}

export async function saveDecision(currentUserId, otherUserId, type, likeMessage = '', status = 'pending') {
  const { db } = requireFirebase();
  const decisionRef = doc(db, 'decisions', `${currentUserId}_${otherUserId}`);
  
  let existingData = null;
  let docExists = false;
  try {
    const existingDecision = await getDoc(decisionRef);
    if (existingDecision.exists()) {
      docExists = true;
      existingData = existingDecision.data();
    }
  } catch (error) {
    // Permission denied implies the document doesn't exist
  }

  let finalStatus = status;
  let isMutual = false;

  if (type === 'like') {
    const reverseDecisionRef = doc(db, 'decisions', `${otherUserId}_${currentUserId}`);
    try {
      const reverseSnap = await getDoc(reverseDecisionRef);
      if (reverseSnap.exists()) {
        const reverseData = reverseSnap.data();
        if (reverseData.type === 'like' && reverseData.status !== 'removed' && reverseData.status !== 'rejected') {
          isMutual = true;
          finalStatus = 'accepted';
          if (reverseData.status !== 'accepted') {
            await updateDoc(reverseDecisionRef, { status: 'accepted', updatedAt: serverTimestamp() }).catch((err) => {
              console.warn('[saveDecision] reverse status update skipped:', err?.message || err);
            });
          }
        }
      }
    } catch (error) {
      // Reverse decision may not exist or permission denied
    }
  }

  if (
    existingData?.fromUserId === currentUserId
    && existingData?.toUserId === otherUserId
    && existingData?.type === type
    && existingData?.status === finalStatus
  ) {
    return { matched: isMutual };
  }

  if (docExists) {
    await updateDoc(decisionRef, withoutUndefined({
      type,
      status: finalStatus,
      likeMessage: type === 'like' ? likeMessage : '',
      updatedAt: serverTimestamp(),
    }));
  } else {
    try {
      await setDoc(decisionRef, withoutUndefined({
        fromUserId: currentUserId,
        toUserId: otherUserId,
        type,
        status: finalStatus,
        likeMessage: type === 'like' ? likeMessage : '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
    } catch (createError) {
      // If document already exists on server, fallback to updateDoc
      try {
        await updateDoc(decisionRef, withoutUndefined({
          type,
          status: finalStatus,
          likeMessage: type === 'like' ? likeMessage : '',
          updatedAt: serverTimestamp(),
        }));
        return { matched: isMutual };
      } catch (_) {
        throw createError;
      }
    }
  }

  return { matched: isMutual };
}

export async function respondToDecision(decisionId, currentUserId, status, otherUserId = '') {
  const { db } = requireFirebase();
  const candidateId = String(otherUserId || '').trim();
  const targetIds = Array.from(new Set([
    String(decisionId || '').trim(),
    candidateId && candidateId !== currentUserId ? `${candidateId}_${currentUserId}` : '',
  ].filter(Boolean)));
  let decisionRef = null;
  let snapshot = null;
  const matchesRequest = (candidateSnapshot) => {
    if (!candidateSnapshot?.exists()) return false;
    const data = candidateSnapshot.data() || {};
    return data.toUserId === currentUserId
      && data.type === 'like'
      && (!candidateId || data.fromUserId === candidateId);
  };

  for (const targetId of targetIds) {
    try {
      const candidateRef = doc(db, 'decisions', targetId);
      const candidateSnapshot = await getDoc(candidateRef);
      if (matchesRequest(candidateSnapshot)) {
        decisionRef = candidateRef;
        snapshot = candidateSnapshot;
        break;
      }
    } catch (_) {
      // A stale/non-canonical ID may point at a document the current user
      // cannot read. Resolve it by the authenticated sender/recipient pair.
    }
  }

  if (!snapshot && candidateId && candidateId !== currentUserId) {
    try {
      const candidateQuery = query(
        collection(db, 'decisions'),
        where('fromUserId', '==', candidateId),
        where('toUserId', '==', currentUserId)
      );
      const candidateSnapshot = await getDocs(candidateQuery);
      const matchingDoc = [...candidateSnapshot.docs]
        .filter((candidateDoc) => matchesRequest(candidateDoc))
        .sort((first, second) => (
          toMillis(second.data().updatedAt || second.data().createdAt)
          - toMillis(first.data().updatedAt || first.data().createdAt)
        ))[0];
      if (matchingDoc) {
        decisionRef = matchingDoc.ref;
        snapshot = matchingDoc;
      }
    } catch (_) {
      // Convert stale cached likes into a user-facing "not found" result
      // instead of exposing an unrelated permission error from a bad ID.
    }
  }
  if (!snapshot || !snapshot.exists()) {
    throw Object.assign(new Error('Like request not found'), { code: 'not-found' });
  }
  if (snapshot.data().toUserId !== currentUserId) {
    throw new Error('คุณไม่มีสิทธิ์ตอบรับคำขอนี้');
  }
  if (snapshot.data().status === status) {
    return;
  }
  await updateDoc(decisionRef, { status, updatedAt: serverTimestamp() });
}

export async function hideConversation(conversationId, currentUserId) {
  if (!conversationId || !currentUserId) return false;
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  const snap = await getDoc(convRef);
  if (!snap.exists()) return false;
  await updateDoc(convRef, {
    [`participantSettings.${currentUserId}.isHidden`]: true,
    [`participantSettings.${currentUserId}.hiddenAt`]: serverTimestamp(),
    [`participantSettings.${currentUserId}.historyClearedAt`]: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return true;
}

export async function unhideConversation(conversationId, currentUserId) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  const snap = await getDoc(convRef);
  if (!snap.exists()) return false;
  await updateDoc(convRef, {
    [`participantSettings.${currentUserId}.isHidden`]: false,
    updatedAt: serverTimestamp(),
  });
  return true;
}

export async function unmatchUser(currentUserId, otherUserId) {
  const { db } = requireFirebase();
  if (!currentUserId || !otherUserId || currentUserId === otherUserId) return false;
  const batch = writeBatch(db);

  // 1. อัพเดท decision ทั้งสองฝั่งเป็น 'removed'
  const decisionA = doc(db, 'decisions', `${currentUserId}_${otherUserId}`);
  const decisionB = doc(db, 'decisions', `${otherUserId}_${currentUserId}`);

  const [snapA, snapB] = await Promise.all([
    getDoc(decisionA),
    getDoc(decisionB),
  ]);

  const conversationId = `c-${[currentUserId, otherUserId].sort().join('-')}`;
  const conversationRef = doc(db, 'conversations', conversationId);
  const conversationSnap = await getDoc(conversationRef);

  let hasOps = false;
  if (snapA.exists()) {
    batch.update(decisionA, { status: 'removed', updatedAt: serverTimestamp() });
    hasOps = true;
  }
  if (snapB.exists()) {
    batch.update(decisionB, { status: 'removed', updatedAt: serverTimestamp() });
    hasOps = true;
  }

  // Keep the room for the other participant and for the trusted account
  // deletion cascade, but make this user's delete action a real history reset.
  // The cutoff is applied to both the legacy root array and the encrypted
  // message subcollection when this user opens the room again.
  if (conversationSnap.exists()) {
    batch.update(conversationRef, {
      [`participantSettings.${currentUserId}.isHidden`]: true,
      [`participantSettings.${currentUserId}.hiddenAt`]: serverTimestamp(),
      [`participantSettings.${currentUserId}.historyClearedAt`]: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    hasOps = true;
  }

  if (hasOps) {
    await batch.commit();
  }
  return hasOps;
}

/**
 * Submits a safety report for offensive/inappropriate content or users.
 * Writes to `reports` collection for review by administrators.
 */
export async function submitContentReport({
  reporterId,
  reportedUserId,
  conversationId = null,
  messageId = null,
  mediaUrl = null,
  messageText = null,
  reason,
  details = '',
}) {
  const { db } = requireFirebase();
  if (!reporterId || !reason) {
    throw new Error('กรุณาระบุข้อมูลการรายงานให้ครบถ้วน');
  }

  const reportsCol = collection(db, 'reports');
  const reportDocRef = doc(reportsCol);
  const reportData = {
    id: reportDocRef.id,
    reporterId,
    reportedUserId: reportedUserId || null,
    conversationId: conversationId || null,
    messageId: messageId || null,
    mediaUrl: mediaUrl || null,
    messageText: messageText || null,
    reason,
    details: (details || '').trim(),
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(reportDocRef, reportData);

  // If a specific message was reported, hide it immediately for the reporting user
  if (conversationId && messageId) {
    try {
      await hideMessageForUser(conversationId, messageId, reporterId);
    } catch (hideErr) {
      console.warn('[Report] Failed to hide message immediately after reporting:', hideErr);
    }
  }

  return { success: true, reportId: reportDocRef.id };
}

/**
 * Hides a specific message for a given user by appending their UID to `hiddenFor`.
 */
export async function hideMessageForUser(conversationId, messageId, userId) {
  const { db } = requireFirebase();
  if (!conversationId || !messageId || !userId) return;

  const msgRef = doc(db, 'conversations', conversationId, 'messages', messageId);
  await updateDoc(msgRef, {
    hiddenFor: arrayUnion(userId),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Blocks a user account.
 * 1. Writes block record in `users/{currentUserId}/blockedUsers/{targetUserId}`.
 * 2. Unmatches and hides conversations between the two users.
 */
export async function blockUserAccount(currentUserId, targetUserId, conversationId = null) {
  const { db } = requireFirebase();
  if (!currentUserId || !targetUserId || currentUserId === targetUserId) {
    throw new Error('ข้อมูลผู้ใช้ไม่ถูกต้อง');
  }

  const blockRef = doc(db, 'users', currentUserId, 'blockedUsers', targetUserId);
  await setDoc(blockRef, {
    targetUserId,
    blockedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });

  // Break matching decisions and hide conversation
  try {
    await unmatchUser(currentUserId, targetUserId);
  } catch (err) {
    console.warn('[BlockUser] unmatchUser warning during block:', err);
  }

  return true;
}

/**
 * Unblocks a previously blocked user account.
 */
export async function unblockUserAccount(currentUserId, targetUserId) {
  const { db } = requireFirebase();
  if (!currentUserId || !targetUserId) return;

  const blockRef = doc(db, 'users', currentUserId, 'blockedUsers', targetUserId);
  await deleteDoc(blockRef);
  return true;
}

/**
 * Retrieves the list of blocked user IDs for a user.
 */
export async function getBlockedUserIds(currentUserId) {
  const { db } = requireFirebase();
  if (!currentUserId) return [];

  try {
    const blockedCol = collection(db, 'users', currentUserId, 'blockedUsers');
    const snap = await getDocs(blockedCol);
    return snap.docs.map((d) => d.id);
  } catch (err) {
    console.warn('[BlockedUsers] Failed to fetch blocked user list:', err);
    return [];
  }
}


export async function cancelOutgoingLike(currentUserId, otherUserId, decisionId) {
  const { db } = requireFirebase();
  const targetId = decisionId || `${currentUserId}_${otherUserId}`;
  const decisionRef = doc(db, 'decisions', targetId);
  try {
    const snap = await getDoc(decisionRef);
    if (snap.exists()) {
      await updateDoc(decisionRef, {
        status: 'removed',
        updatedAt: serverTimestamp(),
      });
      return;
    }
  } catch (err) {
    // Fallback if direct ID failed
  }

  try {
    const q = query(
      collection(db, 'decisions'),
      where('fromUserId', '==', currentUserId),
      where('toUserId', '==', otherUserId)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      await updateDoc(snap.docs[0].ref, {
        status: 'removed',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    console.warn('[cancelOutgoingLike] Error:', error?.message || error);
    throw error;
  }
}

export async function resetSkippedDecisions(currentUserId) {
  if (!currentUserId) return;
  const { db } = requireFirebase();
  try {
    const outgoingQuery = query(
      collection(db, 'decisions'),
      where('fromUserId', '==', currentUserId)
    );
    const snapshot = await getDocs(outgoingQuery);
    await Promise.all(snapshot.docs
      .filter((decisionDoc) => decisionDoc.data().type === 'skip')
      .map((decisionDoc) => deleteDoc(decisionDoc.ref).catch((err) => {
        console.warn('[resetSkippedDecisions] deleteDoc failed for', decisionDoc.id, err?.message || err);
      })));
  } catch (error) {
    console.warn('[resetSkippedDecisions] query failed:', error?.message || error);
    throw error;
  }
}

export async function createConversation(currentUserId, currentProfile, otherProfile) {
  const { db } = requireFirebase();
  if (!currentUserId || !otherProfile?.id || currentUserId === otherProfile.id) {
    throw Object.assign(new Error('ข้อมูลผู้ร่วมสนทนาไม่ถูกต้อง'), { code: 'invalid-argument' });
  }
  const identity = await ensureEncryptionIdentity(currentUserId);
  const participantIds = [currentUserId, otherProfile.id].sort();
  const conversationRef = doc(db, 'conversations', `c-${participantIds.join('-')}`);
  const existingConversation = await getDoc(conversationRef);
  if (existingConversation.exists()) {
    // Reuse the deterministic room only as a container. `historyClearedAt`
    // from the previous unmatch is intentionally preserved, so this match
    // starts with an empty visible timeline while older ciphertext remains
    // unavailable to this participant.
    await updateDoc(conversationRef, {
      [`participantSettings.${currentUserId}.isHidden`]: false,
      updatedAt: serverTimestamp(),
    });
    try {
      await ensureConversationEncryption(conversationRef.id, currentUserId, {
        [currentUserId]: currentProfile,
        [otherProfile.id]: otherProfile,
      });
    } catch (encryptionError) {
      console.warn('[createConversation] E2EE warmup warning on existing room:', encryptionError?.message || encryptionError);
    }
    return conversationRef.id;
  }

  const [currentProfileSnapshot, otherProfileSnapshot] = await Promise.all([
    getDoc(doc(db, 'profiles', currentUserId)),
    getDoc(doc(db, 'profiles', otherProfile.id)),
  ]);
  const currentDisplayProfile = {
    ...(currentProfile || {}),
    ...(currentProfileSnapshot.exists() ? currentProfileSnapshot.data() : {}),
  };
  const otherDisplayProfile = {
    ...(otherProfile || {}),
    ...(otherProfileSnapshot.exists() ? otherProfileSnapshot.data() : {}),
  };
  const encryptionSetup = createConversationEncryption(
    participantIds,
    {
      [currentUserId]: currentDisplayProfile,
      [otherProfile.id]: otherDisplayProfile,
    },
    currentUserId,
    identity
  );

  await setDoc(conversationRef, {
    participants: participantIds,
    participantProfiles: {
      [currentUserId]: toConversationProfile(currentUserId, currentDisplayProfile),
      [otherProfile.id]: toConversationProfile(otherProfile.id, otherDisplayProfile),
    },
    unreadCounts: {
        [currentUserId]: 0,
        [otherProfile.id]: 0,
      },
    lastMessage: ENCRYPTED_PREVIEW,
    lastMessageSenderId: null,
    lastMessageAt: null,
    lastMessageId: null,
    messages: [],
    encryption: encryptionSetup.encryption,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return conversationRef.id;
}

function normalizeMessageId(value) {
  const candidate = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(candidate)) {
    throw Object.assign(new Error('Invalid message id'), { code: 'invalid-argument' });
  }
  return candidate;
}

function conversationMessageRef(db, conversationId, messageId) {
  return doc(db, 'conversations', conversationId, 'messages', normalizeMessageId(messageId));
}

/**
 * Write one encrypted message document and only the conversation metadata in
 * the parent document. Keeping the ciphertext in its own document lets
 * Firestore rules validate sender, envelope sizes, and per-message updates.
 */
export async function updateConversationMessage(conversationId, currentUserId, text, options = {}) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  const encryptionSetup = await ensureConversationEncryption(conversationId, currentUserId);
  const messageId = normalizeMessageId(options.clientMessageId || `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const messageRef = conversationMessageRef(db, conversationId, messageId);
  const safeText = String(text || '').trim();
  if (!safeText || safeText.length > 1000) {
    throw Object.assign(new Error('Message length is invalid'), { code: 'invalid-argument' });
  }
  let created = false;

  await runTransaction(db, async (transaction) => {
    const convSnap = await transaction.get(convRef);
    const existingMessageSnap = await transaction.get(messageRef);
    if (!convSnap.exists()) throw new Error('Conversation not found');
    if (existingMessageSnap.exists()) return;

    const data = convSnap.data();
    const participants = Array.isArray(data.participants) ? data.participants : [];
    if (!participants.includes(currentUserId)) throw new Error('Not a conversation participant');

    const sentAt = Number.isFinite(options.clientSentAt)
      ? Timestamp.fromMillis(options.clientSentAt)
      : Timestamp.now();
    const message = {
      id: messageId,
      senderId: currentUserId,
      text: safeText,
      createdAt: sentAt,
      time: sentAt,
    };
    if (options.mediaType) message.mediaType = options.mediaType;
    if (options.mediaType === 'video') {
      if (!['once', 'replay', 'chat'].includes(options.videoMode)
        || !Number.isFinite(options.videoDuration) || options.videoDuration <= 0 || options.videoDuration > 60000) {
        throw new Error('วิดีโอต้องยาวไม่เกิน 60 วินาทีและมีรูปแบบการส่งที่ถูกต้อง');
      }
      message.videoMode = options.videoMode;
      message.videoDuration = options.videoDuration;
      if (Number.isFinite(options.videoStartMs)) message.videoStartMs = options.videoStartMs;
      if (Number.isFinite(options.videoEndMs)) message.videoEndMs = options.videoEndMs;
    }
    if (options.mediaType === 'image' && options.viewMode) {
      if (!['once', 'replay', 'chat'].includes(options.viewMode)) throw new Error('รูปแบบการดูรูปภาพไม่ถูกต้อง');
      message.viewMode = options.viewMode;
    }
    if (options.callType) message.callType = options.callType;
    if (typeof options.callDuration === 'number') message.callDuration = options.callDuration;
    if (options.callStatus) message.callStatus = options.callStatus;
    if (options.callTime) message.callTime = options.callTime;
    if (options.mediaUrl) message.mediaUrl = options.mediaUrl;
    if (Array.isArray(options.mediaUrls)) message.mediaUrls = options.mediaUrls;
    if (typeof options.audioDuration === 'number') message.audioDuration = options.audioDuration;

    if (options.replyTo?.id) {
      message.replyTo = { ...createReplySnapshot(options.replyTo), id: normalizeMessageId(options.replyTo.id) };
    }
    if (options.forwarded) {
      message.forwarded = true;
      if (options.forwardedFrom?.conversationId && options.forwardedFrom?.messageId) {
        message.forwardedFrom = {
          conversationId: String(options.forwardedFrom.conversationId).slice(0, 200),
          messageId: normalizeMessageId(options.forwardedFrom.messageId),
        };
      }
    }
    const encryptedMessage = encryptMessageRecord(message, encryptionSetup.conversationKey);
    encryptedMessage.preview = safeText.slice(0, 500);
    const unreadCounts = { ...(data.unreadCounts || {}) };
    participants.forEach((uid) => {
      if (uid !== currentUserId) unreadCounts[uid] = (unreadCounts[uid] || 0) + 1;
    });

    transaction.set(messageRef, encryptedMessage);
    transaction.update(convRef, {
      lastMessage: ENCRYPTED_PREVIEW,
      lastMessageSenderId: currentUserId,
      lastMessageAt: serverTimestamp(),
      lastMessageId: messageId,
      unreadCounts,
      updatedAt: serverTimestamp(),
    });
    created = true;
  });
  return created;
}

async function updateConversationMessageLegacy(conversationId, currentUserId, text, options = {}) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  const encryptionSetup = await ensureConversationEncryption(conversationId, currentUserId);

  await runTransaction(db, async (transaction) => {
    const convSnap = await transaction.get(convRef);
    if (!convSnap.exists()) throw new Error('ไม่พบห้องสนทนา');

    const data = convSnap.data();
    const participants = Array.isArray(data.participants) ? data.participants : [];
    if (!participants.includes(currentUserId)) throw new Error('คุณไม่มีสิทธิ์ส่งข้อความในห้องนี้');

    const sentAt = Number.isFinite(options.clientSentAt)
      ? Timestamp.fromMillis(options.clientSentAt)
      : Timestamp.now();
    const message = {
      id: options.clientMessageId || `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      senderId: currentUserId,
      text,
      createdAt: sentAt,
      time: sentAt,
    };
    if (options.mediaType) message.mediaType = options.mediaType;
    if (options.mediaType === 'video') {
      if (!['once', 'replay', 'chat'].includes(options.videoMode)
        || !Number.isFinite(options.videoDuration) || options.videoDuration <= 0 || options.videoDuration > 60000) {
        throw new Error('วิดีโอต้องยาวไม่เกิน 60 วินาทีและมีรูปแบบการส่งที่ถูกต้อง');
      }
      message.videoMode = options.videoMode;
      message.videoDuration = options.videoDuration;
      if (Number.isFinite(options.videoStartMs)) message.videoStartMs = options.videoStartMs;
      if (Number.isFinite(options.videoEndMs)) message.videoEndMs = options.videoEndMs;
    }
    if (options.mediaUrl) message.mediaUrl = options.mediaUrl;
    if (Array.isArray(options.mediaUrls)) message.mediaUrls = options.mediaUrls;
    if (typeof options.audioDuration === 'number') message.audioDuration = options.audioDuration;

    if (options.replyTo?.id) {
      message.replyTo = createReplySnapshot(options.replyTo);
    }
    if (options.forwarded) {
      message.forwarded = true;
      if (options.forwardedFrom?.conversationId && options.forwardedFrom?.messageId) {
        message.forwardedFrom = {
          conversationId: options.forwardedFrom.conversationId,
          messageId: options.forwardedFrom.messageId,
        };
      }
    }
    const encryptedMessage = encryptMessageRecord(message, encryptionSetup.conversationKey);

    const unreadCounts = { ...(data.unreadCounts || {}) };
    participants.forEach((uid) => {
      if (uid !== currentUserId) unreadCounts[uid] = (unreadCounts[uid] || 0) + 1;
    });

    const existingMessages = Array.isArray(data.messages) ? data.messages : [];
    if (existingMessages.some((existingMessage) => existingMessage.id === encryptedMessage.id)) return;
    transaction.update(convRef, {
      messages: [...existingMessages.slice(-499), encryptedMessage],
      lastMessage: ENCRYPTED_PREVIEW,
      unreadCounts,
      updatedAt: serverTimestamp(),
    });
  });
  return true;
}

export async function deleteConversation(conversationId) {
  const { db } = requireFirebase();
  try {
    await deleteDoc(doc(db, "conversations", conversationId));
  } catch (error) {
    // If we try to delete a conversation that doesn't exist (e.g. rejecting a pending like),
    // Firestore rules will reject it with a permission error because resource is null.
    // We can safely ignore this since the goal is for the conversation to not exist anyway.
    if (error.code !== 'permission-denied') {
      console.warn("deleteConversation warning:", error);
    }
  }
}

export async function markConversationAsRead(conversationId, currentUserId) {
  const { db } = requireFirebase();
  await ensureConversationEncryption(conversationId, currentUserId);
  await updateDoc(doc(db, 'conversations', conversationId), {
    [`unreadCounts.${currentUserId}`]: 0,
    [`readReceipts.${currentUserId}`]: serverTimestamp(),
  });
}

export async function toggleMeetupAcceptance(conversationId, currentUserId, hostUserId, spotName, options = {}) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  const encryptionSetup = await ensureConversationEncryption(conversationId, currentUserId);
  const messageId = normalizeMessageId(options.clientMessageId || `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const messageRef = conversationMessageRef(db, conversationId, messageId);
  let nextState = false;

  // Some older deployed rules do not allow a participant to read an
  // appointment document that does not exist. Try the complete transaction
  // first so existing/cancelled appointments can be restored safely. If the
  // only denied operation is that existence check, retry as a create/repair
  // transaction without reading the missing appointment.
  let appointmentReadDenied = false;
  const commitMeetupTransaction = (skipAppointmentRead = false, skipAppointmentWrite = false) => runTransaction(db, async (transaction) => {
    const snap = await transaction.get(convRef);
    const existingMessageSnap = await transaction.get(messageRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const participants = Array.isArray(data.participants) ? data.participants : [];
    if (!participants.includes(currentUserId)) return;

    const hostId = participants.includes(hostUserId) && hostUserId !== currentUserId
      ? hostUserId
      : participants.find((participantId) => participantId !== currentUserId);
    const appointmentId = hostId ? appointmentDocumentId(conversationId, hostId) : null;

    const currentAccepted = Array.isArray(data.meetupAcceptedUsers) ? data.meetupAcceptedUsers : [];
    const isAccepted = currentAccepted.includes(currentUserId);
    const shouldAccept = typeof options.shouldAccept === 'boolean' ? options.shouldAccept : !isAccepted;
    nextState = shouldAccept;

    // The deployed appointment rule uses getAfter(conversationPath), so the
    // conversation acceptance and appointment history must be committed by
    // this same transaction. Read all dependent documents before any write.
    const appointmentRef = (!skipAppointmentWrite && appointmentId) ? doc(db, 'appointments', appointmentId) : null;
    let appointmentSnapshot = null;
    let appointmentExists = false;
    if (appointmentRef && !skipAppointmentRead) {
      try {
        appointmentSnapshot = await transaction.get(appointmentRef);
        appointmentExists = appointmentSnapshot.exists();
      } catch (error) {
        if (error?.code === 'permission-denied') appointmentReadDenied = true;
        throw error;
      }
    }
    let hostProfileSnapshot = null;
    if (shouldAccept && appointmentRef && !appointmentExists) {
      try {
        hostProfileSnapshot = await transaction.get(doc(db, 'profiles', hostId));
      } catch (error) {
        // If profile read in transaction fails, we still allow conversation acceptance
      }
    }
    const candidateMeetup = hostProfileSnapshot?.exists() && hostProfileSnapshot.data()?.meetup
      ? hostProfileSnapshot.data().meetup
      : (options.meetup || null);
    const hostMeetup = (!appointmentExists && appointmentRef)
      ? appointmentMeetupSnapshot(candidateMeetup)
      : null;
    const hasStateChange = isAccepted !== shouldAccept;

    if (hasStateChange) {
      const nextAccepted = shouldAccept
        ? Array.from(new Set([...currentAccepted, currentUserId]))
        : currentAccepted.filter((id) => id !== currentUserId);
      const sentAt = Number.isFinite(options.clientSentAt)
        ? Timestamp.fromMillis(options.clientSentAt)
        : Timestamp.now();
      const safeSpotName = String(spotName || 'Meetup').slice(0, 200);
      const noticeText = shouldAccept
        ? `Accepted meetup at ${safeSpotName}`
        : `Cancelled meetup at ${safeSpotName}`;
      const encryptedMessage = encryptMessageRecord({
        id: messageId,
        senderId: currentUserId,
        text: noticeText,
        isSystem: true,
        createdAt: sentAt,
        time: sentAt,
      }, encryptionSetup.conversationKey);

      if (!existingMessageSnap.exists()) transaction.set(messageRef, encryptedMessage);
      transaction.update(convRef, {
        meetupAcceptedUsers: nextAccepted,
        lastMessage: ENCRYPTED_PREVIEW,
        lastMessageSenderId: currentUserId,
        lastMessageAt: serverTimestamp(),
        lastMessageId: messageId,
        updatedAt: serverTimestamp(),
      });
    } else if (shouldAccept && appointmentRef && !appointmentExists && hostMeetup) {
      // Repair an older acceptance that was saved before appointment history
      // existed. The harmless timestamp update makes getAfter() available to
      // the appointment create rule even though acceptance is already true.
      transaction.update(convRef, { updatedAt: serverTimestamp() });
    }

    if (appointmentRef) {
      if (shouldAccept) {
        if (!skipAppointmentRead && appointmentExists) {
          const existingAppointment = appointmentSnapshot.data() || {};
          if (existingAppointment.status !== 'active') {
            transaction.update(appointmentRef, {
              status: 'active',
              cancelledBy: null,
              cancelledAt: null,
              updatedAt: serverTimestamp(),
            });
          }
        } else if (hostMeetup) {
          transaction.set(appointmentRef, {
            id: appointmentId,
            conversationId,
            participants: [hostId, currentUserId].sort(),
            hostId,
            guestId: currentUserId,
            meetup: hostMeetup,
            scheduledFor: hostMeetup.schedule.scheduledFor,
            status: 'active',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } else if (!skipAppointmentRead && appointmentExists && appointmentSnapshot.data()?.status === 'active') {
        transaction.update(appointmentRef, {
          status: 'cancelled',
          cancelledBy: currentUserId,
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
  });

  try {
    await commitMeetupTransaction(false, false);
  } catch (error) {
    if (error?.code === 'permission-denied') {
      if (appointmentReadDenied) {
        appointmentReadDenied = false;
        try {
          await commitMeetupTransaction(true, false);
          return nextState;
        } catch (retryError) {
          if (retryError?.code !== 'permission-denied') throw retryError;
        }
      }
      // If appointment write or read is blocked by security rules, gracefully
      // commit the conversation acceptance and message notice alone.
      console.warn('[Firestore] toggleMeetupAcceptance: appointment write permission denied, committing conversation acceptance only');
      try {
        await commitMeetupTransaction(true, true);
      } catch (convError) {
        if (convError?.code === 'permission-denied') {
          console.warn('[Firestore] Falling back to toggleMeetupAcceptanceLegacy');
          return await toggleMeetupAcceptanceLegacy(conversationId, currentUserId, hostUserId, spotName, options);
        }
        throw convError;
      }
    } else {
      throw error;
    }
  }
  return nextState;
}

async function toggleMeetupAcceptanceLegacy(conversationId, currentUserId, hostUserId, spotName, options = {}) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  const encryptionSetup = await ensureConversationEncryption(conversationId, currentUserId);
  let nextState = false;

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(convRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const participants = Array.isArray(data.participants) ? data.participants : [];
    if (!participants.includes(currentUserId)) return;

    const currentAccepted = Array.isArray(data.meetupAcceptedUsers) ? data.meetupAcceptedUsers : [];
    const isAccepted = currentAccepted.includes(currentUserId);
    const shouldAccept = typeof options.shouldAccept === 'boolean' ? options.shouldAccept : !isAccepted;
    nextState = shouldAccept;
    if (isAccepted === shouldAccept) return;

    const nextAccepted = shouldAccept
      ? Array.from(new Set([...currentAccepted, currentUserId]))
      : currentAccepted.filter((id) => id !== currentUserId);
    const sentAt = Number.isFinite(options.clientSentAt)
      ? Timestamp.fromMillis(options.clientSentAt)
      : Timestamp.now();
    const noticeText = shouldAccept
      ? `ตอบรับนัดหมายที่ ${spotName || 'จุดนัดพบ'} แล้ว`
      : `ยกเลิกการตอบรับนัดหมายที่ ${spotName || 'จุดนัดพบ'}`;
    const messageId = options.clientMessageId || `m-${Date.now()}`;
    const existingMessages = Array.isArray(data.messages) ? data.messages : [];
    const nextMessages = existingMessages.some((message) => message.id === messageId)
      ? existingMessages
      : [...existingMessages.slice(-499), encryptMessageRecord({
          id: messageId,
          senderId: currentUserId,
          text: noticeText,
          isSystem: true,
          createdAt: sentAt,
          time: sentAt,
        }, encryptionSetup.conversationKey)];

    transaction.update(convRef, {
      meetupAcceptedUsers: nextAccepted,
      messages: nextMessages,
      lastMessage: ENCRYPTED_PREVIEW,
      updatedAt: serverTimestamp(),
    });
  });
  return nextState;
}

export async function cancelAppointment(appointmentId, currentUserId) {
  if (!appointmentId || !currentUserId) return false;
  const { db } = requireFirebase();
  const appointmentRef = doc(db, 'appointments', appointmentId);
  let cancelled = false;

  try {
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(appointmentRef);
      if (!snapshot.exists()) return;
      const data = snapshot.data() || {};
      if (!Array.isArray(data.participants) || !data.participants.includes(currentUserId)) return;
      if (data.status !== 'active') return;
      cancelled = true;
      transaction.update(appointmentRef, {
        status: 'cancelled',
        cancelledBy: currentUserId,
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (error?.code === 'permission-denied') {
      console.warn('[Firestore] cancelAppointment: permission denied, skipping appointment document cancellation');
      return false;
    }
    throw error;
  }

  return cancelled;
}

export async function updateChatSettings(conversationId, currentUserId, settings) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  const allowedSettings = new Set(['isMuted', 'showPinnedMeetup', 'isHidden']);
  const updates = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!allowedSettings.has(key) || typeof value !== 'boolean') {
      throw Object.assign(new Error('Invalid chat setting'), { code: 'invalid-argument' });
    }
    updates[`participantSettings.${currentUserId}.${key}`] = value;
  }
  if (!Object.keys(updates).length) return false;
  await updateDoc(convRef, updates);
  return true;
}

export async function unsendMessage(conversationId, messageId, currentUserId) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  const messageRef = conversationMessageRef(db, conversationId, messageId);
  let removed = false;
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(convRef);
    if (!snap.exists()) return;
    const data = snap.data();
    if (!(data.participants || []).includes(currentUserId)) return;

    const messageSnap = await transaction.get(messageRef);
    if (messageSnap.exists()) {
      if (messageSnap.data().senderId !== currentUserId) return;
      transaction.delete(messageRef);
      transaction.update(convRef, {
        lastMessage: ENCRYPTED_PREVIEW,
        updatedAt: serverTimestamp(),
      });
      removed = true;
    } else {
      const existingMessages = Array.isArray(data.messages) ? data.messages : [];
      const targetIndex = findStoredMessageIndex(convRef.id, existingMessages, messageId);
      if (targetIndex === -1 || existingMessages[targetIndex].senderId !== currentUserId) return;

      const updatedMessages = existingMessages.filter((_, index) => index !== targetIndex);
      transaction.update(convRef, {
        messages: updatedMessages,
        lastMessage: ENCRYPTED_PREVIEW,
        updatedAt: serverTimestamp(),
      });
      removed = true;
    }
  });
  return removed;
}

export async function reactToMessage(conversationId, messageId, currentUserId, emoji, desiredReaction) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  const messageRef = conversationMessageRef(db, conversationId, messageId);
  const safeEmoji = String(emoji || '').trim().slice(0, 16);
  if (!safeEmoji) return false;
  let changed = false;
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(convRef);
    if (!snap.exists()) return;
    const data = snap.data();
    if (!(data.participants || []).includes(currentUserId)) return;

    const messageSnap = await transaction.get(messageRef);
    if (messageSnap.exists()) {
      const targetMessage = messageSnap.data();
      if (targetMessage.senderId === undefined || targetMessage.encrypted !== true) return;
      const reactions = { ...(targetMessage.reactions || {}) };
      const reactionTimes = { ...(targetMessage.reactionTimes || {}) };
      const nextReaction = desiredReaction !== undefined
        ? (desiredReaction ? String(desiredReaction).slice(0, 16) : null)
        : (reactions[currentUserId] === safeEmoji ? null : safeEmoji);
      if ((reactions[currentUserId] || null) === (nextReaction || null)) {
        changed = true;
        return;
      }
      if (nextReaction) reactions[currentUserId] = nextReaction;
      if (nextReaction) reactionTimes[currentUserId] = serverTimestamp();
      else {
        delete reactions[currentUserId];
        delete reactionTimes[currentUserId];
      }
      transaction.update(messageRef, { reactions, reactionTimes, updatedAt: serverTimestamp() });
      changed = true;
    } else {
      const existingMessages = Array.isArray(data.messages) ? data.messages : [];
      const targetIndex = findStoredMessageIndex(convRef.id, existingMessages, messageId);
      if (targetIndex === -1) return;

      const targetMessage = { ...existingMessages[targetIndex] };
      const reactions = { ...(targetMessage.reactions || {}) };
      const reactionTimes = { ...(targetMessage.reactionTimes || {}) };
      const nextReaction = desiredReaction !== undefined
        ? (desiredReaction ? String(desiredReaction).slice(0, 16) : null)
        : (reactions[currentUserId] === safeEmoji ? null : safeEmoji);
      if ((reactions[currentUserId] || null) === (nextReaction || null)) {
        changed = true;
        return;
      }
      if (nextReaction) reactions[currentUserId] = nextReaction;
      if (nextReaction) reactionTimes[currentUserId] = serverTimestamp();
      else {
        delete reactions[currentUserId];
        delete reactionTimes[currentUserId];
      }
      targetMessage.reactionTimes = reactionTimes;
      targetMessage.reactions = reactions;

      const updatedMessages = [...existingMessages];
      updatedMessages[targetIndex] = targetMessage;
      transaction.update(convRef, { messages: updatedMessages, updatedAt: serverTimestamp() });
      changed = true;
    }
  });
  return changed;
}

export async function deleteMessageForUser(conversationId, messageId, currentUserId) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  const messageRef = conversationMessageRef(db, conversationId, messageId);
  let changed = false;

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(convRef);
    if (!snap.exists()) return;
    const data = snap.data();
    if (!(data.participants || []).includes(currentUserId)) return;

    const messageSnap = await transaction.get(messageRef);
    if (messageSnap.exists()) {
      const targetMessage = messageSnap.data();
      const hiddenFor = Array.isArray(targetMessage.hiddenFor) ? targetMessage.hiddenFor : [];
      if (hiddenFor.includes(currentUserId)) {
        changed = true;
        return;
      }
      transaction.update(messageRef, {
        hiddenFor: Array.from(new Set([...hiddenFor, currentUserId])),
        updatedAt: serverTimestamp(),
      });
      changed = true;
    } else {
      const existingMessages = Array.isArray(data.messages) ? data.messages : [];
      const targetIndex = findStoredMessageIndex(convRef.id, existingMessages, messageId);
      if (targetIndex === -1) return;

      const targetMessage = { ...existingMessages[targetIndex] };
      const hiddenFor = Array.isArray(targetMessage.hiddenFor) ? targetMessage.hiddenFor : [];
      if (hiddenFor.includes(currentUserId)) {
        changed = true;
        return;
      }
      targetMessage.hiddenFor = Array.from(new Set([...hiddenFor, currentUserId]));
      const updatedMessages = [...existingMessages];
      updatedMessages[targetIndex] = targetMessage;
      transaction.update(convRef, { messages: updatedMessages, updatedAt: serverTimestamp() });
      changed = true;
    }
  });
  return changed;
}

function findStoredMessageIndex(conversationId, messages, messageId) {
  return messages.findIndex((message, index) => (
    message.id === messageId
    || `${conversationId}-m-${toMillis(message.createdAt || message.time)}-${message.senderId || message.sender || 'unknown'}-${index}` === messageId
  ));
}
