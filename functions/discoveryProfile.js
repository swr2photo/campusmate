import { Timestamp } from 'firebase-admin/firestore';

const TEXT_LIMITS = {
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

const ARRAY_LIMITS = {
  activities: 30,
  tags: 50,
  interests: 50,
};

const MEETUP_FIELDS = [
  'id',
  'name',
  'description',
  'category',
  'categoryLabel',
  'group',
  'emoji',
  'rating',
  'busyTime',
  'image',
  'scheduledAt',
];

const MEETUP_TEXT_LIMITS = {
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
  scheduledAt: 100,
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function copyString(target, source, field, maxLength = TEXT_LIMITS[field]) {
  if (typeof source[field] !== 'string') return;
  const value = source[field].trim().slice(0, maxLength);
  if (value) target[field] = value;
}

function copyNumber(target, source, field, minimum, maximum) {
  const value = typeof source[field] === 'number' ? source[field] : Number(source[field]);
  if (!Number.isFinite(value)) return;
  if (value < minimum || value > maximum) return;
  target[field] = value;
}

function copyStringList(target, source, field, maxItems) {
  if (!Array.isArray(source[field])) return;
  const values = source[field]
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, maxItems);
  if (values.length) target[field] = values;
}

function compactAvailabilitySlots(value) {
  if (!Array.isArray(value)) return undefined;
  const slots = value
    .filter(isObject)
    .map((slot) => {
      const compact = {};
      ['day', 'start', 'end', 'label'].forEach((field) => {
        if (typeof slot[field] === 'string' && slot[field].trim()) {
          compact[field] = slot[field].trim().slice(0, 100);
        }
      });
      return compact;
    })
    .filter((slot) => Object.keys(slot).length > 0)
    .slice(0, 50);
  return slots.length ? slots : undefined;
}

function compactMeetupSchedule(value) {
  if (!isObject(value)) return undefined;
  const schedule = {};
  ['date', 'startTime', 'endTime', 'message'].forEach((field) => {
    if (typeof value[field] === 'string' && value[field].trim()) {
      schedule[field] = value[field].trim().slice(0, field === 'message' ? 500 : 32);
    }
  });
  if (typeof value.maxPeople === 'number' && Number.isInteger(value.maxPeople)) {
    schedule.maxPeople = Math.min(50, Math.max(1, value.maxPeople));
  }
  if (value.scheduledFor !== undefined && value.scheduledFor !== null) {
    schedule.scheduledFor = normalizeTimestamp(value.scheduledFor);
  }
  return Object.keys(schedule).length ? schedule : undefined;
}

function compactMeetup(value, { includeCoordinates = false, includeSchedule = true } = {}) {
  if (!isObject(value)) return undefined;
  const meetup = {};
  MEETUP_FIELDS.forEach((field) => {
    if (typeof value[field] === 'string' && value[field].trim()) {
      meetup[field] = value[field].trim().slice(0, MEETUP_TEXT_LIMITS[field]);
    }
  });
  if (includeCoordinates) {
    if (typeof value.latitude === 'number' && Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90) {
      meetup.latitude = value.latitude;
    }
    if (typeof value.longitude === 'number' && Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180) {
      meetup.longitude = value.longitude;
    }
  }
  if (includeSchedule) {
    const schedule = compactMeetupSchedule(value.schedule);
    if (schedule) meetup.schedule = schedule;
  }
  return Object.keys(meetup).length ? meetup : undefined;
}

function compactEncryptionDevices(value) {
  if (!isObject(value)) return undefined;
  const devices = {};
  Object.entries(value).slice(0, 10).forEach(([deviceId, entry]) => {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(deviceId)) return;
    const publicKey = typeof entry === 'string' ? entry : entry?.publicKey;
    if (typeof publicKey !== 'string' || !publicKey.trim()) return;
    devices[deviceId] = { publicKey: publicKey.trim().slice(0, 4096) };
  });
  return Object.keys(devices).length ? devices : undefined;
}

function normalizeTimestamp(value) {
  if (value && typeof value.toMillis === 'function') return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return Timestamp.fromDate(value);
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Timestamp.fromMillis(value);
  }
  if (typeof value === 'string') {
    const millis = Date.parse(value);
    if (!Number.isNaN(millis)) return Timestamp.fromMillis(millis);
  }
  return Timestamp.now();
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim();
}

function isVisible(privacy, field) {
  return privacy?.[field] !== false;
}

/**
 * Rebuild the public profile from the owner document. This is used by the
 * migration and by the users/{uid} trigger because profiles can be left
 * stale when an older client successfully writes only the private document.
 * Only allowlisted fields leave the private collection, and privacy flags
 * are applied before anything is written to profiles.
 */
export function buildPublicProfile(userId, source = {}) {
  if (!userId || !isObject(source)) return null;

  const privacy = isObject(source.privacy) ? source.privacy : {};
  const profile = {
    id: String(userId),
    // Legacy user documents may not have the flag. Keep the historical
    // discoverable-by-default behavior while respecting an explicit opt-out.
    isDiscoverable: source.isDiscoverable !== false,
    updatedAt: normalizeTimestamp(source.updatedAt),
  };

  const name = firstString(source.name, source.displayName, source.nickname, source.userName, source.username);
  if (name) profile.name = name.slice(0, TEXT_LIMITS.name);
  copyString(profile, source, 'nickname');
  copyString(profile, source, 'bio');
  copyString(profile, source, 'avatar');
  copyString(profile, source, 'avatarColor');

  const avatarUri = firstString(
    source.avatarUri,
    source.photoURL,
    source.photoUrl,
    source.avatarUrl,
    Array.isArray(source.photos) ? source.photos[0] : null,
  );
  if (avatarUri) profile.avatarUri = avatarUri.slice(0, TEXT_LIMITS.avatarUri);

  copyNumber(profile, source, 'compatibility', 0, 100);
  ['tags', 'interests'].forEach((field) => copyStringList(profile, source, field, ARRAY_LIMITS[field]));

  if (isVisible(privacy, 'showAge')) copyNumber(profile, source, 'age', 18, 100);
  if (isVisible(privacy, 'showGender')) copyString(profile, source, 'gender');
  if (isVisible(privacy, 'showFaculty')) {
    copyString(profile, source, 'faculty');
    copyString(profile, source, 'year');
  }
  if (isVisible(privacy, 'showActivity')) {
    ['activity', 'activityLabel', 'skill', 'pace'].forEach((field) => copyString(profile, source, field));
    copyStringList(profile, source, 'activities', ARRAY_LIMITS.activities);
  }
  if (isVisible(privacy, 'showAvailability')) {
    copyString(profile, source, 'availability');
    const availabilitySlots = compactAvailabilitySlots(source.availabilitySlots);
    if (availabilitySlots) profile.availabilitySlots = availabilitySlots;
  }
  if (isVisible(privacy, 'showLocation')) {
    const meetup = compactMeetup(source.meetup, {
      includeCoordinates: true,
      includeSchedule: isVisible(privacy, 'showAvailability'),
    });
    if (meetup) profile.meetup = meetup;
  }

  const encryptionDevices = compactEncryptionDevices(source.encryptionDevices);
  if (encryptionDevices) profile.encryptionDevices = encryptionDevices;

  return profile;
}

/**
 * Build the server-owned, public projection used by discovery pagination.
 * The source is already a public profile, but this allowlist is intentional:
 * old profile documents must never copy private fields into the new index.
 */
export function buildDiscoveryProfile(userId, source = {}) {
  if (!userId || !isObject(source) || source.isDiscoverable === false || source.isNewUser === true) return null;

  const profile = {
    id: String(userId),
    isDiscoverable: true,
    updatedAt: normalizeTimestamp(source.updatedAt),
  };

  const name = firstString(source.name, source.displayName, source.nickname, source.userName, source.username);
  if (name) profile.name = name.slice(0, TEXT_LIMITS.name);
  const avatarUri = firstString(
    source.avatarUri,
    source.photoURL,
    source.photoUrl,
    source.avatarUrl,
    Array.isArray(source.photos) ? source.photos[0] : null,
  );
  if (avatarUri) profile.avatarUri = avatarUri.slice(0, TEXT_LIMITS.avatarUri);

  Object.keys(TEXT_LIMITS).forEach((field) => {
    if (field === 'name' || field === 'avatarUri') return;
    copyString(profile, source, field);
  });
  copyNumber(profile, source, 'age', 18, 100);
  copyNumber(profile, source, 'compatibility', 0, 100);

  Object.entries(ARRAY_LIMITS).forEach(([field, maxItems]) => {
    copyStringList(profile, source, field, maxItems);
  });
  const availabilitySlots = compactAvailabilitySlots(source.availabilitySlots);
  if (availabilitySlots) profile.availabilitySlots = availabilitySlots;

  const meetup = compactMeetup(source.meetup);
  if (meetup) profile.meetup = meetup;
  const encryptionDevices = compactEncryptionDevices(source.encryptionDevices);
  if (encryptionDevices) profile.encryptionDevices = encryptionDevices;

  return profile;
}
