export function availabilityDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function nextAvailabilityDays(now = new Date()) {
  // Use local calendar dates, rather than UTC strings or 24-hour arithmetic.
  return Array.from({ length: 14 }, (_, offset) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12));
}

export function availabilityMonths(days) {
  return [...new Set(days.map((day) => availabilityDateKey(day).slice(0, 7)))];
}

export function availabilityMonthCells(month, days) {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(year, monthNumber - 1, 1, 12);
  const offset = (first.getDay() + 6) % 7; // Monday first.
  const count = new Date(year, monthNumber, 0, 12).getDate();
  const available = new Set(days.map(availabilityDateKey));
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > count) return null;
    const date = new Date(year, monthNumber - 1, day, 12);
    const key = availabilityDateKey(date);
    return { key, day, available: available.has(key) };
  });
}

export function availabilitySlotKey(slot) {
  return `${slot.date || slot.day || slot.label || ''}|${slot.start}|${slot.end}`;
}

export function removeAvailabilitySlot(slots, key) {
  return slots.filter((slot) => availabilitySlotKey(slot) !== key);
}
