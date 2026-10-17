export function restoreInboxCache(previous, uid, cached) {
  if (!cached || previous.uid !== uid || previous.serverSeen || previous.rows.length) return previous;
  return { ...previous, rows: Array.isArray(cached.rows) ? cached.rows : [], count: Math.max(0, Number(cached.count) || 0), offline: true, loading: false };
}

export function mergeInboxSnapshot(previous, uid, rows, hasMore, offline) {
  const sameAccount = previous.uid === uid;
  return { ...(sameAccount ? previous : { count: 0 }), uid,
    rows: offline && !rows.length && sameAccount ? previous.rows : rows,
    serverSeen: (sameAccount && previous.serverSeen) || !offline,
    hasMore, offline, loading: false, error: null };
}

export function overlayInboxReadReceipts(rows, receipts) {
  const pending = new Map(receipts.map(receipt => [receipt.id, receipt.readAt]));
  return rows.map(row => row.readAt || !pending.has(row.id) ? row : {
    ...row, readAt: { seconds: Math.floor(pending.get(row.id) / 1000) },
  });
}

// "อ่านทั้งหมด" marks every row created up to the tap on the server. Show that
// at once instead of waiting for the callable and the listener echo; rows
// that arrive afterwards stay unread.
const createdMillis = value => value?.toMillis?.() || (value?.seconds ? value.seconds * 1000 : Number(value) || 0);
export function inboxMarkedAllTimestamp(rows = [], now = Date.now()) {
  return rows.reduce((latest, row) => Math.max(latest, createdMillis(row?.createdAt)), now);
}
export function hasUnconfirmedMarkedAllRows(rows = [], markedAt = 0) {
  return Boolean(markedAt) && rows.some(row => !row.readAt && createdMillis(row.createdAt) <= markedAt);
}
export function overlayInboxMarkedAll(rows, markedAt) {
  if (!markedAt) return rows;
  return rows.map(row => row.readAt || createdMillis(row.createdAt) > markedAt ? row : {
    ...row, readAt: { seconds: Math.floor(markedAt / 1000) },
  });
}
