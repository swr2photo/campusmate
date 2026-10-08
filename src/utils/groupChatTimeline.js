export function messageMillis(message) {
  const value = message?.createdAt;
  return value?.toMillis?.() || (typeof value === 'number' ? value :
    value?.seconds * 1000 + (value?.nanoseconds || 0) / 1e6) || message?.clientSentAt || 0;
}

export function mergeGroupMessages(...pages) {
  const byId = new Map();
  pages.flat().forEach((message) => {
    if (message?.id) byId.set(message.id, { ...byId.get(message.id), ...message });
  });
  return [...byId.values()].sort((a, b) => messageMillis(a) - messageMillis(b)
    || String(a.id).localeCompare(String(b.id)));
}

export function receiveGroupWindow(history, recent, cursor, hasMore) {
  return {
    ...history, recent,
    older: mergeGroupMessages(history.older, history.recent)
      .filter((message) => !recent.some((entry) => entry.id === message.id)),
    cursor: history.loadedOlder ? history.cursor : cursor,
    hasMore: history.loadedOlder ? history.hasMore : hasMore,
  };
}
