// Party finder and group chat over the native backend. Function names and
// callback shapes match services/partyService.js.
import { rpc } from './backend';
import { liveQuery } from './events';
import { ts, withTimes } from './time';

const partyJson = (party) => {
  if (!party) return null;
  const out = withTimes(party, ['createdAt', 'updatedAt', 'cancelledAt']);
  out.schedule = withTimes(party.schedule || {}, ['startsAt', 'endsAt']);
  return out;
};
const requestJson = (request) => withTimes(request, ['createdAt', 'updatedAt']);
const chatJson = (chat) => withTimes(chat, ['createdAt', 'updatedAt', 'lastMessageAt']);
const messageJson = (message) => ({
  ...withTimes(message, ['createdAt']),
  pendingSync: false,
  sendStatus: 'sent',
});

function paged(topics, load, map, onData, onError, pageSize = 30) {
  let limit = pageSize;
  const stop = liveQuery(topics, () => load(limit), (page) => {
    onData(map(page), { hasMore: page?.hasMore === true, loadingMore: false });
  }, onError);
  const unsubscribe = () => stop();
  unsubscribe.loadMore = () => { limit += pageSize; void stop.refresh(); };
  return unsubscribe;
}

export const subscribeParties = (onData, onError) => paged('parties',
  (limit) => rpc('listParties', { scope: 'open', limit }), (page) => (page?.parties || []).map(partyJson), onData, onError);

export const subscribeOwnParties = (userId, onData, onError) => paged('parties',
  (limit) => rpc('listParties', { scope: 'mine', limit }), (page) => (page?.parties || []).map(partyJson), onData, onError);

export function subscribePartyById(partyId, onData, onError) {
  return liveQuery('parties', () => rpc('listParties', { scope: 'one', partyId }),
    (page) => onData(partyJson(page?.parties?.[0] || null)), onError, { id: partyId });
}

export function subscribeMyPartyRequest(partyId, userId, onData, onError) {
  return liveQuery('parties', () => rpc('listPartyRequests', { scope: 'one', partyId }),
    (page) => onData(page?.requests?.[0] ? requestJson(page.requests[0]) : null), onError);
}

export function subscribeLegacyPartiesToActivate(hostId, onData, onError) {
  return liveQuery('parties', () => rpc('listParties', { scope: 'legacyActivation' }),
    (page) => onData((page?.parties || []).map(partyJson)), onError);
}

export const subscribeMyPartyRequests = (userId, onData, onError) => paged('parties',
  (limit) => rpc('listPartyRequests', { scope: 'mine', limit }), (page) => (page?.requests || []).map(requestJson), onData, onError);

export const subscribeHostedPartyRequests = (partyId, hostId, onData, onError) => paged('parties',
  (limit) => rpc('listPartyRequests', { scope: 'hosted', partyId, limit }), (page) => (page?.requests || []).map(requestJson), onData, onError);

export const subscribeGroupChats = (userId, onData, onError) => paged(['group-messages', 'parties'],
  (limit) => rpc('listGroupChats', { limit }), (page) => (page?.chats || []).map(chatJson), onData, onError, 20);

export function subscribeGroupChat(partyId, onData, onError) {
  return liveQuery('group-messages', () => rpc('listGroupChats', { partyId }),
    (page) => onData(page?.chats?.[0] ? chatJson(page.chats[0]) : null), onError, { id: partyId });
}

export function subscribeGroupReads(userId, onData, onError, partyIds = []) {
  if (!partyIds.length) { onData({}); return () => {}; }
  const wanted = new Set(partyIds);
  return liveQuery('group-messages', () => rpc('listGroupChats', { limit: 200 }), (page) => {
    const reads = {};
    for (const [partyId, read] of Object.entries(page?.reads || {})) {
      if (wanted.has(partyId)) reads[partyId] = withTimes(read, ['lastReadMessageAt']);
    }
    onData(reads);
  }, onError);
}

// One page request returns epochs, receipts and the newest messages; the
// three subscriptions share it through a short-lived cache.
const latest = new Map();
function groupPage(partyId) {
  const cached = latest.get(partyId);
  if (cached && Date.now() - cached.at < 300) return cached.promise;
  const promise = rpc('groupMessages', { partyId });
  latest.set(partyId, { at: Date.now(), promise });
  promise.catch(() => latest.delete(partyId));
  return promise;
}

export function subscribeGroupReadReceipts(partyId, onData, onError) {
  return liveQuery('group-messages', () => groupPage(partyId), (page) => {
    const receipts = {};
    for (const [uid, receipt] of Object.entries(page?.readReceipts || {})) receipts[uid] = withTimes(receipt, ['lastReadMessageAt']);
    onData(receipts);
  }, onError, { id: partyId });
}

export function subscribeGroupEpochs(partyId, onData, onError) {
  return liveQuery('group-messages', () => groupPage(partyId),
    (page) => onData((page?.epochs || []).map((epoch) => ({ ...epoch, createdAt: ts(epoch.createdAt) }))), onError, { id: partyId });
}

export function subscribeGroupMessages(partyId, onData, onError) {
  return liveQuery('group-messages', () => groupPage(partyId), (page) => {
    const messages = (page?.messages || []).map(messageJson);
    onData(messages, page?.beforeSequence ? { beforeSequence: page.beforeSequence } : null, page?.hasMore === true);
  }, onError, { id: partyId });
}

export async function loadOlderGroupMessages(partyId, cursor) {
  if (!cursor?.beforeSequence) return { messages: [], cursor: null, hasMore: false };
  const page = await rpc('groupMessages', { partyId, beforeSequence: cursor.beforeSequence });
  return {
    messages: (page?.messages || []).map(messageJson),
    cursor: page?.beforeSequence ? { beforeSequence: page.beforeSequence } : null,
    hasMore: page?.hasMore === true,
  };
}

export async function markGroupRead(partyId, userId, message) {
  if (!message?.id || message.pendingSync || message.decryptionFailed) return;
  await rpc('markGroupRead', { partyId, messageId: message.id });
}

/** Offline-queue writer: the server deduplicates retries by message ID. */
export async function writeQueuedGroupMessage(payload) {
  latest.delete(payload.partyId);
  await rpc('sendGroupMessage', {
    partyId: payload.partyId,
    id: payload.id,
    record: payload.record,
    ...(payload.previousCiphertext ? { previousCiphertext: payload.previousCiphertext } : {}),
  });
}
