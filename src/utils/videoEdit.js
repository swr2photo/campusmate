import { MAX_VIDEO_DURATION_MS } from './chatVideoPolicy';

export function initialVideoRange(duration) {
  return { startMs: 0, endMs: Math.min(duration, MAX_VIDEO_DURATION_MS) };
}

export function moveVideoHandle(range, handle, value, duration) {
  const minimum = Math.min(1000, duration);
  const position = Math.round(Math.max(0, Math.min(duration, value)));
  if (handle === 'start') {
    const startMs = Math.min(position, range.endMs - minimum);
    return { startMs, endMs: Math.min(range.endMs, startMs + MAX_VIDEO_DURATION_MS) };
  }
  const endMs = Math.max(position, range.startMs + minimum);
  return { startMs: Math.max(range.startMs, endMs - MAX_VIDEO_DURATION_MS), endMs };
}

export function validateVideoEdit(duration, { startMs, endMs }) {
  if (![duration, startMs, endMs].every(Number.isFinite)
    || duration <= 0 || startMs < 0 || endMs > duration || endMs <= startMs
    || endMs - startMs > MAX_VIDEO_DURATION_MS) {
    throw new Error('กรุณาเลือกช่วงวิดีโอไม่เกิน 60 วินาที');
  }
  return { startMs, endMs };
}

export function videoTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
