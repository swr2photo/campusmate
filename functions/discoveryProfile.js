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

function copyAvatarRevision(profile, source) {
  if (Number.isSafeInteger(source.avatarRevision) && source.avatarRevision >= 0) {
    profile.avatarRevision = source.avatarRevision;
  }
}

const ARRAY_LIMITS = {
  activities: 30,
  tags: 50,
  interests: 50,
};

// One main photo is stored separately in avatarUri.
const GALLERY_LIMIT = 8;
const GALLERY_URL_LIMIT = 5000;

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

function compactGallery(value) {
  if (!Array.isArray(value)) return undefined;
  const gallery = [...new Set(value
    .filter((uri) => typeof uri === 'string')
    .map((uri) => uri.trim())
    .filter((uri) => uri.length <= GALLERY_URL_LIMIT && /^https:\/\/[^/\s?#]+(?:[/?#][^\s]*)?$/i.test(uri)))];
  return gallery.slice(0, GALLERY_LIMIT);
}

const FAVORITE_TRACK_LIMIT = 10;
const FAVORITE_TRACK_FIELD_LIMITS = {
  id: 64,
  name: 200,
  artists: 200,
  albumArt: 2000,
  previewUrl: 2000,
  externalUrl: 500,
};

function compactFavoriteTracks(value) {
  if (!Array.isArray(value)) return undefined;
  const tracks = [];
  const seen = new Set();
  for (const item of value) {
    if (!isObject(item)) continue;
    const id = typeof item.id === 'string' ? item.id.trim().slice(0, FAVORITE_TRACK_FIELD_LIMITS.id) : '';
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, FAVORITE_TRACK_FIELD_LIMITS.name) : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const track = {
      id,
      name,
      artists: typeof item.artists === 'string'
        ? item.artists.trim().slice(0, FAVORITE_TRACK_FIELD_LIMITS.artists) || 'Unknown'
        : 'Unknown',
      albumArt: typeof item.albumArt === 'string'
        ? item.albumArt.trim().slice(0, FAVORITE_TRACK_FIELD_LIMITS.albumArt)
        : '',
      externalUrl: typeof item.externalUrl === 'string' && item.externalUrl.trim()
        ? item.externalUrl.trim().slice(0, FAVORITE_TRACK_FIELD_LIMITS.externalUrl)
        : `https://open.spotify.com/track/${id}`,
    };
    if (typeof item.previewUrl === 'string' && item.previewUrl.trim()) {
      track.previewUrl = item.previewUrl.trim().slice(0, FAVORITE_TRACK_FIELD_LIMITS.previewUrl);
    }
    if (Number.isFinite(Number(item.previewStartMs))) {
      track.previewStartMs = Math.max(0, Math.round(Number(item.previewStartMs)));
    }
    if (Number.isFinite(Number(item.previewEndMs))) {
      track.previewEndMs = Math.max(0, Math.round(Number(item.previewEndMs)));
    }
    if (
      Number.isFinite(track.previewStartMs)
      && Number.isFinite(track.previewEndMs)
      && track.previewEndMs <= track.previewStartMs
    ) {
      delete track.previewStartMs;
      delete track.previewEndMs;
    }
    tracks.push(track);
    if (tracks.length >= FAVORITE_TRACK_LIMIT) break;
  }
  return tracks.length ? tracks : undefined;
}

// Per-activity answers from the profile form: { running: { pace: '...',
// timeOfDay: ['เย็น'] }, ... }. Values are short strings or string lists.
const ACTIVITY_DETAIL_LIMITS = { activities: 30, fields: 6, items: 10, text: 120 };

function compactActivityDetails(value) {
  if (!isObject(value)) return undefined;
  const details = {};
  Object.entries(value).slice(0, ACTIVITY_DETAIL_LIMITS.activities).forEach(([activityId, entry]) => {
    if (!/^[a-z][a-z0-9_-]{0,49}$/.test(activityId) || !isObject(entry)) return;
    const compact = {};
    Object.entries(entry).slice(0, ACTIVITY_DETAIL_LIMITS.fields).forEach(([key, raw]) => {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(key)) return;
      if (typeof raw === 'string') {
        const text = raw.trim().slice(0, ACTIVITY_DETAIL_LIMITS.text);
        if (text) compact[key] = text;
      } else if (Array.isArray(raw)) {
        const list = raw
          .filter((item) => typeof item === 'string')
          .map((item) => item.trim().slice(0, ACTIVITY_DETAIL_LIMITS.text))
          .filter(Boolean)
          .slice(0, ACTIVITY_DETAIL_LIMITS.items);
        if (list.length) compact[key] = list;
      }
    });
    if (Object.keys(compact).length) details[activityId] = compact;
  });
  return Object.keys(details).length ? details : undefined;
}

function compactAvailabilitySlots(value) {
  if (!Array.isArray(value)) return undefined;
  const slots = value
    .filter(isObject)
    .map((slot) => {
      const compact = {};
      ['date', 'day', 'start', 'end', 'label'].forEach((field) => {
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

  copyAvatarRevision(profile, source);
  const gallery = compactGallery(source.gallery);
  if (gallery?.length) profile.gallery = gallery;

  copyNumber(profile, source, 'compatibility', 0, 100);
  ['tags', 'interests'].forEach((field) => copyStringList(profile, source, field, ARRAY_LIMITS[field]));
  const favoriteTracks = compactFavoriteTracks(source.favoriteTracks);
  if (favoriteTracks) profile.favoriteTracks = favoriteTracks;

  if (isVisible(privacy, 'showAge')) copyNumber(profile, source, 'age', 18, 100);
  if (isVisible(privacy, 'showGender')) copyString(profile, source, 'gender');
  if (isVisible(privacy, 'showFaculty')) {
    copyString(profile, source, 'faculty');
    copyString(profile, source, 'year');
  }
  if (isVisible(privacy, 'showActivity')) {
    ['activity', 'activityLabel', 'skill', 'pace'].forEach((field) => copyString(profile, source, field));
    copyStringList(profile, source, 'activities', ARRAY_LIMITS.activities);
    const activityDetails = compactActivityDetails(source.activityDetails) || {};
    // Keep the legacy `pace` column and the running detail in sync in both
    // directions so old and new clients read the same value.
    const runsFromList = Array.isArray(profile.activities) && profile.activities.includes('running');
    const runs = runsFromList || profile.activity === 'running';
    if (runs && profile.pace && !activityDetails.running?.pace) {
      activityDetails.running = { ...(activityDetails.running || {}), pace: profile.pace };
    }
    if (!profile.pace && typeof activityDetails.running?.pace === 'string') {
      profile.pace = activityDetails.running.pace;
    }
    if (Object.keys(activityDetails).length) profile.activityDetails = activityDetails;
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

  if (source.isFaceVerified === true) {
    profile.isFaceVerified = true;
    if (typeof source.faceMatchScore === 'number') {
      profile.faceMatchScore = source.faceMatchScore;
    }
  }

  return profile;
}

/**
 * Build the server-owned, public projection used by discovery pagination.
 * The source is already a public profile, but this allowlist is intentional:
 * old profile documents must never copy private fields into the new index.
 */
export function buildDiscoveryProfile(userId, source = {}) {
  if (!userId || !isObject(source) || source.isDiscoverable === false || source.isNewUser === true) return null;
  // Only face-verified owners enter discovery. Older accounts without the server-written
  // flag are left out until they verify (see profileVisibilityPolicy.canViewProfile).
  if (source.isFaceVerified !== true) return null;

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

  copyAvatarRevision(profile, source);
  const gallery = compactGallery(source.gallery);
  if (gallery?.length) profile.gallery = gallery;

  Object.keys(TEXT_LIMITS).forEach((field) => {
    if (field === 'name' || field === 'avatarUri') return;
    copyString(profile, source, field);
  });
  copyNumber(profile, source, 'age', 18, 100);
  copyNumber(profile, source, 'compatibility', 0, 100);

  Object.entries(ARRAY_LIMITS).forEach(([field, maxItems]) => {
    copyStringList(profile, source, field, maxItems);
  });
  const favoriteTracks = compactFavoriteTracks(source.favoriteTracks);
  if (favoriteTracks) profile.favoriteTracks = favoriteTracks;
  const availabilitySlots = compactAvailabilitySlots(source.availabilitySlots);
  if (availabilitySlots) profile.availabilitySlots = availabilitySlots;
  const activityDetails = compactActivityDetails(source.activityDetails);
  if (activityDetails) profile.activityDetails = activityDetails;

  const meetup = compactMeetup(source.meetup);
  if (meetup) profile.meetup = meetup;
  const encryptionDevices = compactEncryptionDevices(source.encryptionDevices);
  if (encryptionDevices) profile.encryptionDevices = encryptionDevices;

  if (source.isFaceVerified === true) {
    profile.isFaceVerified = true;
    if (typeof source.faceMatchScore === 'number') {
      profile.faceMatchScore = source.faceMatchScore;
    }
  }

  return profile;
}
