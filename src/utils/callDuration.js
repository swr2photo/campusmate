/**
 * Format call duration seconds into MM:SS format.
 * Examples: 0 -> '00:00', 65 -> '01:05', 3600 -> '60:00'
 */
export function formatCallDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}
