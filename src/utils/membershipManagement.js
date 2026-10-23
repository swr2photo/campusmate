import { isPlusRecord } from '../data/plans.js';

// A customer-level management URL may exist even when Plus comes from an
// admin grant or an expired subscription. Only expose a current store record.
export function membershipManagement(record, now = Date.now()) {
  if (!isPlusRecord(record, now) || typeof record.managementUrl !== 'string') return null;
  const store = String(record.store || '').toLowerCase();
  const host = { app_store: 'apps.apple.com', play_store: 'play.google.com' }[store];
  if (!host) return null;
  try {
    const url = new URL(record.managementUrl);
    if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password) return null;
    return { url: url.toString(), store };
  } catch {
    return null;
  }
}
