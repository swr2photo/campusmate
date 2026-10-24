import { useSyncExternalStore } from 'react';

// What the app shows instead of its screens: a maintenance or incident
// notice from the server (`getServiceStatus`, or the details of a refused
// RPC), or an outage this device noticed itself.
//
// The server refuses app requests during maintenance, so the notice is
// enforced there; this store only decides what to draw.

// Server failures in a row (with the network up) before the app says the
// service is down, and how long one counts.
const LOCAL_FAILURES = 4;
const FAILURE_WINDOW_MS = 60_000;

let state = { notice: null, local: null };
let failures = [];
let refresher = null;
// Offline failures are the offline banner's business, not an outage.
let online = true;
const listeners = new Set();

export function setNetworkOnline(value) {
  online = value !== false;
  if (!online) failures = [];
}

function emit(next) {
  state = next;
  listeners.forEach((listener) => listener());
}

const sameNotice = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

/** Only well-formed notices from the server are shown. */
function cleanNotice(value) {
  if (!value || typeof value !== 'object' || !['maintenance', 'incident'].includes(value.kind)) return null;
  const text = (input, limit) => (typeof input === 'string' ? input.trim().slice(0, limit) : '');
  const endsAt = text(value.endsAt, 40);
  return {
    kind: value.kind,
    title: text(value.title, 80),
    message: text(value.message, 600),
    endsAt: endsAt && Number.isFinite(Date.parse(endsAt)) ? endsAt : null,
  };
}

/** Called with the server's answer; `null` lifts the notice. */
export function setServiceNotice(value) {
  const notice = cleanNotice(value);
  if (sameNotice(notice, state.notice)) return;
  emit({ ...state, notice });
}

/** A refused RPC carries the notice in its details. */
export function noteRefusal(error) {
  const notice = cleanNotice(error?.details?.maintenance);
  if (notice) setServiceNotice(notice);
  return Boolean(notice);
}

function serverFault(error) {
  const code = String(error?.code || '');
  if (error?.details?.maintenance) return false;
  return Number(error?.status) >= 500 || /(unavailable|internal|deadline-exceeded)$/.test(code);
}

/** Feeds every RPC outcome; repeated server faults raise a local notice. */
export function noteOutcome(error) {
  if (!error) {
    failures = [];
    if (state.local) emit({ ...state, local: null });
    return;
  }
  if (!online || !serverFault(error)) return;
  const now = Date.now();
  failures = [...failures.filter((at) => now - at < FAILURE_WINDOW_MS), now];
  if (failures.length >= LOCAL_FAILURES && !state.local) emit({ ...state, local: { kind: 'incident', title: '', message: '', endsAt: null, local: true } });
}

/** Clears a local outage after a successful check of the service. */
export function clearLocalIncident() {
  failures = [];
  if (state.local) emit({ ...state, local: null });
}

/** The function that asks the server again (set by the gate). */
export function setServiceRefresher(fn) {
  refresher = fn;
}

export function refreshServiceStatus() {
  return refresher ? refresher() : Promise.resolve();
}

export function subscribeServiceStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => state;

/** `{ notice, local }`: the server's notice, or an outage seen on this device. */
export function useServiceStatus() {
  return useSyncExternalStore(subscribeServiceStatus, snapshot, snapshot);
}
