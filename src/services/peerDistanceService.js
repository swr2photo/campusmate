import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService';
import { applyDistancePrivacyFloor } from '../utils/distance';

const FUNCTIONS_REGION = 'asia-southeast1';
const PEER_DISTANCE_CHUNK = 50;

function uniquePeerIds(userIds) {
  const uniqueIds = [];
  const seen = new Set();
  (Array.isArray(userIds) ? userIds : []).forEach((userId) => {
    if (typeof userId !== 'string' || !userId || seen.has(userId)) return;
    seen.add(userId);
    uniqueIds.push(userId);
  });
  return uniqueIds;
}

export async function fetchPeerDistances(userIds) {
  const ids = uniquePeerIds(userIds);
  if (ids.length === 0) return {};

  const { app } = requireFirebase();
  const getPeerDistances = httpsCallable(getFunctions(app, FUNCTIONS_REGION), 'getPeerDistances', {
    timeout: 15000,
  });
  const distances = {};
  for (let index = 0; index < ids.length; index += PEER_DISTANCE_CHUNK) {
    const chunk = ids.slice(index, index + PEER_DISTANCE_CHUNK);
    try {
      const response = await getPeerDistances({ userIds: chunk });
      const payload = response?.data?.distances;
      if (!payload || typeof payload !== 'object') continue;
      Object.entries(payload).forEach(([peerId, value]) => {
        const km = applyDistancePrivacyFloor(typeof value === 'number' ? value : Number(value));
        if (km != null) distances[peerId] = km;
      });
    } catch (error) {
      console.warn('[peerDistance] Failed to load distances:', error?.message || error);
    }
  }
  return distances;
}
