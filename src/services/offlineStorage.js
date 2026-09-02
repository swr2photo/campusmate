import {
  getEncryptedItem,
  setEncryptedItem,
  multiRemoveEncryptedItems,
} from '../utils/encryptedStorage';

const CACHE_VERSION = 1;
const SNAPSHOT_PREFIX = `campusmate_offline_snapshot_v${CACHE_VERSION}`;
const QUEUE_PREFIX = `campusmate_offline_queue_v${CACHE_VERSION}`;
const FAILED_PREFIX = `campusmate_offline_failed_v${CACHE_VERSION}`;
const queueLocks = new Map();

function userKey(prefix, userId) {
  return `${prefix}:${encodeURIComponent(String(userId || 'anonymous'))}`;
}

function operationId() {
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseArray(raw) {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function withQueueLock(userId, task) {
  const lockKey = String(userId || 'anonymous');
  const previous = queueLocks.get(lockKey) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queueLocks.set(lockKey, next);
  try {
    return await next;
  } finally {
    if (queueLocks.get(lockKey) === next) queueLocks.delete(lockKey);
  }
}

export async function loadOfflineSnapshot(userId) {
  if (!userId) return null;
  try {
    const raw = await getEncryptedItem(userKey(SNAPSHOT_PREFIX, userId));
    if (!raw) return null;
    const snapshot = JSON.parse(raw);
    if (!snapshot || snapshot.version !== CACHE_VERSION || snapshot.userId !== userId) return null;
    return snapshot;
  } catch (error) {
    console.warn('[Offline] Unable to load cached snapshot:', error);
    return null;
  }
}

export async function saveOfflineSnapshot(userId, data) {
  if (!userId) return;
  const snapshot = {
    version: CACHE_VERSION,
    userId,
    cachedAt: Date.now(),
    ...data,
  };
  try {
    await setEncryptedItem(userKey(SNAPSHOT_PREFIX, userId), JSON.stringify(snapshot));
  } catch (error) {
    console.warn('[Offline] Unable to save cached snapshot:', error);
  }
}

export async function getOfflineQueue(userId) {
  if (!userId) return [];
  const raw = await getEncryptedItem(userKey(QUEUE_PREFIX, userId));
  return parseArray(raw).filter((operation) => operation?.userId === userId && operation?.type);
}

export async function getOfflineQueueCount(userId) {
  return (await getOfflineQueue(userId)).length;
}

export async function enqueueOfflineOperation(userId, type, payload, options = {}) {
  if (!userId || !type) throw new Error('Offline operation requires a user and type');
  return withQueueLock(userId, async () => {
    const key = userKey(QUEUE_PREFIX, userId);
    const queue = await getOfflineQueue(userId);
    const existingIndex = options.dedupeKey
      ? queue.findIndex((item) => item.dedupeKey === options.dedupeKey)
      : -1;
    const operation = {
      // Always issue a new id when replacing a deduplicated operation. If the
      // previous revision is currently being flushed, its completion must not
      // remove the newer payload that arrived while the request was in flight.
      id: operationId(),
      userId,
      type,
      payload,
      dedupeKey: options.dedupeKey || null,
      createdAt: existingIndex >= 0 ? queue[existingIndex].createdAt : Date.now(),
      updatedAt: Date.now(),
      attempts: 0,
    };
    if (existingIndex >= 0) queue[existingIndex] = operation;
    else queue.push(operation);
    await setEncryptedItem(key, JSON.stringify(queue));
    return operation;
  });
}

async function removeQueuedOperation(userId, operationIdToRemove) {
  return withQueueLock(userId, async () => {
    const key = userKey(QUEUE_PREFIX, userId);
    const queue = await getOfflineQueue(userId);
    const nextQueue = queue.filter((operation) => operation.id !== operationIdToRemove);
    await AsyncStorage.setItem(key, JSON.stringify(nextQueue));
    return nextQueue.length;
  });
}

async function markQueuedOperationAttempt(userId, operationIdToUpdate, error) {
  return withQueueLock(userId, async () => {
    const key = userKey(QUEUE_PREFIX, userId);
    const queue = await getOfflineQueue(userId);
    const nextQueue = queue.map((operation) => (
      operation.id === operationIdToUpdate
        ? {
            ...operation,
            attempts: (operation.attempts || 0) + 1,
            lastAttemptAt: Date.now(),
            lastError: String(error?.message || error || 'Unknown sync error').slice(0, 300),
          }
        : operation
    ));
    await AsyncStorage.setItem(key, JSON.stringify(nextQueue));
    return nextQueue.length;
  });
}

async function archiveFailedOperation(userId, operation, error) {
  const key = userKey(FAILED_PREFIX, userId);
  const failed = parseArray(await getEncryptedItem(key));
  failed.push({
    ...operation,
    failedAt: Date.now(),
    lastError: String(error?.message || error || 'Unknown sync error').slice(0, 300),
  });
  await setEncryptedItem(key, JSON.stringify(failed.slice(-20)));
}

export function isRetryableNetworkError(error) {
  const code = String(error?.code || '').toLowerCase().replace(/^firestore\//, '');
  const message = String(error?.message || '').toLowerCase();
  if (['permission-denied', 'unauthenticated', 'invalid-argument', 'not-found', 'already-exists', 'failed-precondition'].includes(code)) {
    return false;
  }
  if (['unavailable', 'deadline-exceeded', 'cancelled', 'resource-exhausted', 'aborted', 'network-request-failed'].includes(code)) {
    return true;
  }
  return /network|offline|internet|connection|timeout|timed out|failed to fetch/.test(message);
}

export async function flushOfflineQueue(userId, executeOperation) {
  if (!userId) return { failed: [], pendingCount: 0, syncedCount: 0 };
  const initialQueue = await getOfflineQueue(userId);
  const failed = [];
  let syncedCount = 0;

  for (const operation of initialQueue) {
    try {
      await executeOperation(operation);
      await removeQueuedOperation(userId, operation.id);
      syncedCount += 1;
    } catch (error) {
      if (isRetryableNetworkError(error)) {
        const pendingCount = await markQueuedOperationAttempt(userId, operation.id, error);
        return { failed, pendingCount, syncedCount, retryableError: error };
      }
      await archiveFailedOperation(userId, operation, error);
      await removeQueuedOperation(userId, operation.id);
      failed.push({ operation, error });
    }
  }

  return {
    failed,
    pendingCount: await getOfflineQueueCount(userId),
    syncedCount,
  };
}

export async function clearOfflineDataForUser(userId) {
  if (!userId) return;
  await multiRemoveEncryptedItems([
    userKey(SNAPSHOT_PREFIX, userId),
    userKey(QUEUE_PREFIX, userId),
    userKey(FAILED_PREFIX, userId),
  ]);
}
