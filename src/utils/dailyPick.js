export function getDailySeed(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function hashSeed(seed) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(index)) | 0;
  }
  hash ^= hash << 13;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  return hash >>> 0;
}

export function dailyPick(items, seed) {
  if (!Array.isArray(items) || items.length <= 1) return items || [];
  let best = items[0];
  let bestScore = hashSeed(`${seed}:${best.id}`);
  for (let index = 1; index < items.length; index += 1) {
    const item = items[index];
    const score = hashSeed(`${seed}:${item.id}`);
    if (score > bestScore || (score === bestScore && String(item.id) < String(best.id))) {
      best = item;
      bestScore = score;
    }
  }
  return [best];
}

export function pickDailyProfile(items, seed, pinnedId) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (pinnedId) {
    const pinned = items.find((item) => item.id === pinnedId);
    if (pinned) return [pinned];
  }
  return dailyPick(items, seed);
}
