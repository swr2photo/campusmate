import { getActivityCategory } from '../data/activityCategories';
import { CAMPUS_SPOTS } from '../data/campusSpots';

// What someone is up to, derived only from what their profile already says
// (their chosen meetup spot and activities) or real presence data. Nothing
// here is invented: with no signal the status is simply null.

const SPOT_BY_ID = Object.fromEntries(CAMPUS_SPOTS.map((spot) => [spot.id, spot]));
const ACTIVITY_KIND = { study: 'studying', chill: 'cafe', food: 'cafe', running: 'running', sports: 'sports', gym: 'sports' };

function meetupTime(meetup) {
  const raw = meetup?.schedule?.time || meetup?.time;
  if (typeof raw === 'string' && /^\d{1,2}[:.]\d{2}/.test(raw)) return `${raw.slice(0, 5).replace('.', ':')} น.`;
  const date = meetup?.schedule?.scheduledFor || meetup?.scheduledFor;
  const parsed = date ? new Date(date?.toDate ? date.toDate() : date) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')} น.`;
  }
  return '';
}

/** Badge for a discovery card: `{ kind, text }` or null. */
export function statusBadgeFor(profile) {
  const meetup = profile?.meetup;
  if (meetup?.name) {
    const spot = SPOT_BY_ID[meetup.id] || SPOT_BY_ID[meetup.spotId];
    const category = spot?.category || meetup.category;
    const kind = category === 'cafe' ? 'cafe' : category === 'study' ? 'studying' : ACTIVITY_KIND[category] || 'online';
    const time = meetupTime(meetup);
    return { kind, text: `นัดที่ ${meetup.name}${time ? ` ${time}` : ''}` };
  }
  const activities = Array.isArray(profile?.activities) && profile.activities.length ? profile.activities : [profile?.activity].filter(Boolean);
  const first = activities.map(getActivityCategory).find((category) => category && category.id !== 'other' && category.id !== 'all');
  if (!first) return null;
  return { kind: ACTIVITY_KIND[first.id] || 'online', text: `หาเพื่อน${first.shortLabel}` };
}

/** Ring status for an avatar from real presence (`chatPresence` shape). */
export function presenceStatus(presence) {
  if (!presence?.visible) return null;
  return presence.isOnline ? 'online' : 'offline';
}
