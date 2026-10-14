// The native backend sends epoch milliseconds. Existing screens were written
// against Firestore Timestamps (`toMillis()`, `seconds`, `toDate()`), so the
// adapters wrap server times in this small compatible value.
export function ts(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1e6,
    toMillis: () => ms,
    toDate: () => new Date(ms),
    valueOf: () => ms,
    toJSON: () => new Date(ms).toISOString(),
  };
}

/** Wrap the named top-level fields of a record in `ts`. */
export function withTimes(record, fields) {
  if (!record || typeof record !== 'object') return record;
  const out = { ...record };
  for (const field of fields) {
    if (typeof out[field] === 'number') out[field] = ts(out[field]);
  }
  return out;
}
