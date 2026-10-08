import { useEffect, useState } from 'react';

const listeners = new Set();
let timer = null;

function publish() {
  listeners.forEach((listener) => listener());
}

function ensureTimer() {
  if (timer || listeners.size === 0) return;
  timer = setInterval(publish, 30000);
}

function stopTimer() {
  if (listeners.size > 0 || !timer) return;
  clearInterval(timer);
  timer = null;
}

/** One 30s clock shared by every visible row that shows a relative time. */
export function useRelativeClock() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    ensureTimer();
    return () => {
      listeners.delete(listener);
      stopTimer();
    };
  }, []);
}
