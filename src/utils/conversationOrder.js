function timestampMillis(value) {
  if (!value) return 0;
  let millis = 0;
  if (value instanceof Date) millis = value.getTime();
  else if (typeof value === 'number') millis = value < 1e11 ? value * 1000 : value;
  else if (typeof value.toMillis === 'function') millis = value.toMillis();
  else if (typeof value.seconds === 'number') millis = value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
  else if (typeof value._seconds === 'number') millis = value._seconds * 1000 + (value._nanoseconds || 0) / 1e6;
  else if (typeof value === 'string') millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : 0;
}

// Read receipts, reactions and profile edits must not move a room to the top.
export function conversationActivityMillis(conversation) {
  const messages = conversation?.messages || [];
  const messageTime = messages.reduce((latest, message) => Math.max(
    latest, timestampMillis(message.createdAt || message.time)
  ), 0);
  return Math.max(timestampMillis(conversation?.lastMessageAt), messageTime)
    || timestampMillis(conversation?.createdAt);
}

export function compareConversationsByActivity(first, second) {
  return conversationActivityMillis(second) - conversationActivityMillis(first)
    || String(first.id || '').localeCompare(String(second.id || ''));
}

// Retain cached rooms while a batch is loading, but never resurrect rooms
// removed from the authoritative root snapshot.
export function retainLoadingConversations(current, incoming, loadingIds = []) {
  const incomingIds = new Set(incoming.map((conversation) => conversation.id));
  const loading = new Set(loadingIds);
  return [...incoming, ...current.filter((conversation) => (
    loading.has(conversation.id) && !incomingIds.has(conversation.id)
  ))];
}
