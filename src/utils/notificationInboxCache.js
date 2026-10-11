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
