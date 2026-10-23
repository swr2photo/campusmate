export const AUTO_RECYCLE_DELAY_MS = 5 * 60 * 1000;

/**
 * Skipped profiles stay skipped. Rewind is the only way to see one again.
 * The old path scanned the discovery pool on every feed request, then put
 * those people back after five minutes and forced the deck to reload.
 */
export async function autoRecycleExpiredSkipsIfPoolExhausted() {
  return { recycledIds: [], poolExhausted: false, nextRecycleAt: null };
}
