export function startMillis(party) {
  if (typeof party?.schedule?.startsAt?.toMillis === 'function') return party.schedule.startsAt.toMillis();
  return Date.parse(`${party?.schedule?.date || ''}T${party?.schedule?.startTime || '00:00'}:00+07:00`);
}

export function nextPartyRefreshDelay(parties, now) {
  const next = Math.min(...parties.map(startMillis).filter((time) => time > now));
  return Math.max(10, Math.min(next - now, 30000));
}
