// Party schedules are interpreted by the server as Asia/Bangkok wall-clock time
// (see scheduleFrom in functions/partyFunctions.js: `${date}T${time}:00+07:00`).
// These helpers mirror that contract on the device so a past/invalid time is
// caught before calling createParty (which otherwise fails with a 400).

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
// Small buffer so a request that takes a moment to reach the server is not
// rejected because "now" moved past the start time in transit.
const MIN_LEAD_MS = 60 * 1000;

const pad = (value) => String(value).padStart(2, '0');

/** Bangkok wall-clock parts for an instant: { date: 'YYYY-MM-DD', time: 'HH:mm' }. */
export function toBangkokParts(ms) {
  const iso = new Date(ms + BANGKOK_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** Bangkok calendar date (YYYY-MM-DD) for an instant. Never use toISOString() alone (UTC). */
export function bangkokDateString(ms = Date.now()) {
  return toBangkokParts(ms).date;
}

/** Instant for a Bangkok date + HH:mm, or NaN when invalid. */
export function bangkokMillis(date, time) {
  return Date.parse(`${date}T${time}:00+07:00`);
}

/**
 * A sensible default window that is always in the future: the next full hour
 * (at least ~30 minutes away) for two hours. Late at night it rolls to
 * tomorrow 09:00–11:00 so the default never crosses midnight.
 * Returns local Date objects (for native date/time pickers).
 */
export function defaultScheduleWindow(now = new Date()) {
  const start = new Date(now.getTime() + 30 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const sameDay = start.toDateString() === now.toDateString() && end.toDateString() === now.toDateString();
  if (!sameDay || start.getHours() < 6) {
    const date = new Date(now);
    if (start.toDateString() !== now.toDateString() || start.getHours() >= 6 || now.getHours() >= 6) {
      date.setDate(date.getDate() + (now.getHours() >= 6 ? 1 : 0));
    }
    const morningStart = new Date(date); morningStart.setHours(9, 0, 0, 0);
    const morningEnd = new Date(date); morningEnd.setHours(11, 0, 0, 0);
    return { date: morningStart, start: morningStart, end: morningEnd };
  }
  return { date: new Date(start), start, end };
}

/**
 * Validates Bangkok date/time strings exactly like the server.
 * Returns { ok: true, schedule } or { ok: false, message }.
 */
export function validatePartySchedule({ date, startTime, endTime }, now = Date.now()) {
  const start = bangkokMillis(date, startTime);
  const end = bangkokMillis(date, endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, message: 'วันและเวลานัดหมายไม่ถูกต้อง' };
  }
  if (end <= start) return { ok: false, message: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม' };
  if (start <= now + MIN_LEAD_MS) {
    return { ok: false, message: 'เวลาเริ่มผ่านไปแล้ว กรุณาเลือกเวลาในอนาคต' };
  }
  return { ok: true, schedule: { date, startTime, endTime } };
}

/**
 * Combines a picked day + picked start/end clock times (local Date objects
 * from native pickers) into the server's Bangkok strings, then validates.
 */
export function buildPartySchedule({ day, start, end }, now = Date.now()) {
  const at = (clock) => new Date(
    day.getFullYear(), day.getMonth(), day.getDate(),
    clock.getHours(), clock.getMinutes(), 0, 0,
  ).getTime();
  const startMs = at(start);
  const endMs = at(end);
  if (endMs <= startMs) return { ok: false, message: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม' };
  const startParts = toBangkokParts(startMs);
  const endParts = toBangkokParts(endMs);
  if (startParts.date !== endParts.date) {
    return { ok: false, message: 'นัดหมายต้องเริ่มและจบภายในวันเดียวกัน (เวลาไทย)' };
  }
  return validatePartySchedule({ date: startParts.date, startTime: startParts.time, endTime: endParts.time }, now);
}

export { pad as padTime };
