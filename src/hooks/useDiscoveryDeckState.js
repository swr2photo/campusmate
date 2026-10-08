import { useCallback, useEffect, useState } from 'react';

/** How long the deck may stay in its loading skeleton before it offers a retry. */
export const DISCOVERY_STALL_MS = 20000;

/**
 * Resolves what the Home discovery deck should show:
 *   'card'    a candidate is ready
 *   'loading' the feed (or a "load more" / distance check) is still in flight
 *   'error'   the feed failed, the device is offline, or loading took too long
 *   'empty'   the feed answered and nobody matches
 * The loading state can never last forever: after DISCOVERY_STALL_MS it turns into
 * an error with a retry, and it resolves on its own if the feed answers later.
 */
export function useDiscoveryDeckState({
  hasCandidate,
  isDiscoveryReady,
  isLoadingMoreProfiles,
  isResolvingDistances,
  discoveryError,
  retryDiscovery,
}) {
  const loading = !hasCandidate && (!isDiscoveryReady || isLoadingMoreProfiles || isResolvingDistances);
  const [stalled, setStalled] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!loading || discoveryError) {
      setStalled(false);
      return undefined;
    }
    const timer = setTimeout(() => setStalled(true), DISCOVERY_STALL_MS);
    return () => clearTimeout(timer);
  }, [attempt, discoveryError, loading]);

  const retry = useCallback(() => {
    setStalled(false);
    setAttempt((value) => value + 1);
    retryDiscovery?.();
  }, [retryDiscovery]);

  let state = 'empty';
  if (hasCandidate) state = 'card';
  else if (discoveryError || (loading && stalled)) state = 'error';
  else if (loading) state = 'loading';
  return {
    state,
    offline: discoveryError?.code === 'offline',
    stalled: !discoveryError && loading && stalled,
    retry,
  };
}
