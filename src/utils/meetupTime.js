/**
 * Meetup schedule time and validation utilities.
 * Enforces:
 * 1. Cannot accept meetups if the scheduled date/time has already passed.
 * 2. Cannot cancel meetups within 1 day (24 hours) before the actual scheduled date/time.
 */

export function parseMeetupScheduledDate(meetup) {
  if (!meetup || typeof meetup !== 'object') return null;

  const scheduledFor = meetup.scheduledFor || meetup.schedule?.scheduledFor;
  if (scheduledFor) {
    if (scheduledFor instanceof Date && !Number.isNaN(scheduledFor.getTime())) {
      return scheduledFor;
    }
    if (typeof scheduledFor.toDate === 'function') {
      const d = scheduledFor.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
    }
    if (typeof scheduledFor.toMillis === 'function') {
      const d = new Date(scheduledFor.toMillis());
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (typeof scheduledFor === 'number' && Number.isFinite(scheduledFor)) {
      return new Date(scheduledFor);
    }
  }

  const dateStr = meetup.schedule?.date || meetup.scheduledAt || (typeof scheduledFor === 'string' ? scheduledFor : null);
  if (!dateStr || typeof dateStr !== 'string') return null;

  const parts = dateStr.trim().split('T')[0].split('-').map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    const [year, month, day] = parts;
    const timeStr = meetup.schedule?.startTime || '00:00';
    const timeParts = String(timeStr).split(':').map(Number);
    const hour = Number.isFinite(timeParts[0]) ? timeParts[0] : 0;
    const minute = Number.isFinite(timeParts[1]) ? timeParts[1] : 0;
    const d = new Date(year, month - 1, day, hour, minute, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseMeetupEndTimestamp(meetup) {
  if (!meetup || typeof meetup !== 'object') return null;

  const dateStr = meetup.schedule?.date || meetup.scheduledAt;
  if (dateStr && typeof dateStr === 'string') {
    const parts = dateStr.trim().split('T')[0].split('-').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      const [year, month, day] = parts;
      const timeStr = meetup.schedule?.endTime || meetup.schedule?.startTime || '23:59';
      const timeParts = String(timeStr).split(':').map(Number);
      const hour = Number.isFinite(timeParts[0]) ? timeParts[0] : 23;
      const minute = Number.isFinite(timeParts[1]) ? timeParts[1] : 59;
      const d = new Date(year, month - 1, day, hour, minute, 59, 999);
      return Number.isNaN(d.getTime()) ? null : d.getTime();
    }
  }

  const scheduledDate = parseMeetupScheduledDate(meetup);
  return scheduledDate ? scheduledDate.getTime() : null;
}

/**
 * Returns true if the meetup schedule has already passed.
 * When expired, users cannot accept the meetup.
 */
export function isMeetupExpired(meetup, now = Date.now()) {
  if (!meetup) return false;
  const endTimestamp = parseMeetupEndTimestamp(meetup);
  if (endTimestamp === null) return false;
  return now > endTimestamp;
}

/**
 * Returns whether a meetup/appointment is eligible for cancellation.
 * Rule: Cancellation is forbidden within 1 day (24 hours) before the scheduled start time.
 */
export function canCancelMeetup(meetup, now = Date.now()) {
  if (!meetup) {
    return { allowed: false, reason: 'ไม่พบข้อมูลนัดหมาย' };
  }

  // Already expired/passed
  if (isMeetupExpired(meetup, now)) {
    return { allowed: false, reason: 'ไม่สามารถยกเลิกได้ เนื่องจากนัดหมายนี้เลยกำหนดเวลาแล้ว' };
  }

  const scheduledDate = parseMeetupScheduledDate(meetup);
  if (!scheduledDate) {
    return { allowed: true };
  }

  const scheduledTime = scheduledDate.getTime();
  const oneDayMillis = 24 * 60 * 60 * 1000;
  const cancellationDeadline = scheduledTime - oneDayMillis;

  if (now >= cancellationDeadline) {
    return {
      allowed: false,
      reason: 'ไม่สามารถยกเลิกนัดหมายได้ เนื่องจากไม่อนุญาตให้ยกเลิกก่อนวันนัดจริง 1 วัน (ต้องยกเลิกล่วงหน้าอย่างน้อย 24 ชั่วโมง)',
    };
  }

  return { allowed: true };
}
