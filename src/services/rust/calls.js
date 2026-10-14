// Call sessions over the native backend (LiveKit carries the media). Same
// exports as services/callSignalingService.js; ICE candidates are not used.
import { rpc } from './backend';
import { liveQuery, onBackendChange } from './events';
import { withTimes } from './time';

const callJson = (call) => (call ? withTimes(call, ['createdAt', 'startedAt', 'endedAt']) : null);

export async function initiateCall({ receiverId, callType = 'voice' }) {
  const call = await rpc('initiateCall', { receiverId, callType });
  return { ...callJson(call), callId: call.callId || call.id };
}

const update = (callId, action, extra = {}) => rpc('updateCall', { callId, action, ...extra });

export const acceptCall = (callId) => update(callId, 'accept');
export const setCallRinging = (callId) => update(callId, 'ringing').catch(() => {});
export const rejectCall = (callId, reason = 'declined') => update(callId, 'reject', { reason });
export const markCallMissed = (callId) => update(callId, 'missed');
export const endCall = (callId, durationSeconds = 0, reason = 'hangup') =>
  update(callId, 'end', { durationSeconds, reason }).catch(() => {});

export function subscribeToCall(callId, onUpdate) {
  if (!callId) return () => {};
  return liveQuery('calls', () => rpc('getCall', { callId }), (result) => onUpdate(callJson(result?.call)),
    (error) => console.warn('[callSignaling] subscribeToCall error:', error), { id: callId, debounceMs: 50 });
}

export function subscribeToIncomingCalls(userId, onIncomingCall) {
  if (!userId) return () => {};
  return liveQuery('calls', () => rpc('getIncomingCall'), (result) => onIncomingCall(callJson(result?.call)),
    (error) => console.warn('[callSignaling] subscribeToIncomingCalls error:', error), { debounceMs: 50 });
}

export async function sendIceCandidate() {}

export function subscribeToRemoteIceCandidates() {
  return () => {};
}

export async function getCall(callId) {
  if (!callId) return null;
  return callJson((await rpc('getCall', { callId }))?.call);
}

export { onBackendChange };
