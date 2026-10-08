export function scheduleIdleTask(callback) {
  let cancelled = false;
  let handle;

  const run = (...args) => {
    if (!cancelled) callback(...args);
  };

  if (typeof globalThis.requestIdleCallback === 'function') {
    handle = globalThis.requestIdleCallback(run);
    return {
      cancel: () => {
        cancelled = true;
        globalThis.cancelIdleCallback?.(handle);
      },
    };
  }

  handle = setTimeout(run, 80);
  return {
    cancel: () => {
      cancelled = true;
      clearTimeout(handle);
    },
  };
}
