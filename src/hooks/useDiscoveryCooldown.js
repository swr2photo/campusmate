// Skipped profiles are not timed back into the deck. The hook remains so
// older screens can call it without starting a one-second re-render.
export function useDiscoveryCooldown() {
  return { waiting: false, timeLeft: '' };
}
