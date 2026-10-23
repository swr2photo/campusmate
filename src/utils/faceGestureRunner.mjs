import { HOLD_UPDATES, assessGesture, readFace } from './faceGestureDetector.mjs';

const RETRYABLE = new Set(['SERVICE_UNAVAILABLE', 'AWAITING_RESULT', 'CAPTURE_TIMEOUT', 'CAPTURE_FAILED', 'CAMERA_INACTIVE', 'FRAME_UNUSABLE']);
const codeOf = (error) => error?.details?.reason || error?.code || 'SERVICE_UNAVAILABLE';
/** Newest frames one fallback request carries (the server accepts three). */
export const BATCH_FRAMES = 3;
/** Pause between fallback captures so the camera and JS thread keep up. */
export const CAPTURE_GAP_MS = 150;
/** How long a passed step shows its check mark before the next one. */
const PASSED_PAUSE_MS = 450;

/** Camera/HTTP flow. Only a server acknowledgement advances a step.
 * Native detection uploads the exact frame that showed the movement. A camera
 * without detection keeps capturing while the previous request is in flight
 * and sends the newest frames together, so a brief movement between round
 * trips is still seen; the server's hint and progress drive the guidance.
 */
export function createGestureRunner({ gestures, nativeTracking, capture, submit, onChange, onDone, onFail, onCancel,
  schedule = setTimeout, unschedule = clearTimeout }) {
  let state = { step: 0, passed: 0, progress: 0, hint: null, phase: 'tracking' };
  let active = false;
  let ready = false;
  let busy = false;
  let closed = false;
  let timer = null;
  let continuation = null;
  let consecutive = 0;
  let firstTurnSign = null;
  let retries = 0;
  // Fallback camera: frames for the current step, newest last. A capture
  // that started before a step change or a pause is dropped by generation.
  let capturing = false;
  let captureTimer = null;
  let frames = [];
  let generation = 0;
  const update = (patch) => {
    if (closed) return;
    state = { ...state, ...patch };
    onChange(state);
  };
  const clearTimer = () => {
    if (timer !== null) unschedule(timer);
    timer = null;
  };
  const clearCapture = () => {
    if (captureTimer !== null) unschedule(captureTimer);
    captureTimer = null;
    frames = [];
    generation += 1;
  };
  const finish = (outcome, code) => {
    if (closed) return;
    closed = true;
    clearTimer();
    clearCapture();
    continuation = null;
    if (outcome === 'done') onDone?.();
    else if (outcome === 'cancel') onCancel?.();
    else if (outcome === 'fail') onFail?.(code);
  };
  const later = (callback, delay) => {
    clearTimer();
    timer = schedule(() => {
      timer = null;
      if (closed) return;
      if (!active) continuation = callback;
      else callback();
    }, delay);
  };
  const sampling = () => !closed && active && ready && !nativeTracking && timer === null && state.phase === 'tracking';
  const pump = () => {
    if (!sampling()) return;
    captureNext();
    void flush();
  };
  const rearm = (delay) => {
    consecutive = 0;
    // A fallback request still in flight keeps `busy` until it settles.
    later(() => { if (nativeTracking) busy = false; pump(); }, delay);
  };

  function failed(error) {
    if (closed) return;
    if (!active) { busy = false; update({ phase: 'tracking', progress: 0 }); return; }
    const code = codeOf(error);
    if (RETRYABLE.has(code) && retries < 3) {
      retries += 1;
      if (!nativeTracking) clearCapture();
      update({ phase: 'tracking', progress: 0, hint: code.startsWith('CAPTURE_') || code === 'CAMERA_INACTIVE' ? 'FRAME_UNUSABLE' : code });
      rearm(900);
    } else finish('fail', code);
  }

  /** Apply the server's answer for `step`; `sign` is the native turn sign. */
  function accept(reply, step, sign) {
    retries = 0;
    if (!reply?.passed) {
      if (reply?.retriesLeft === 0) { finish('fail', reply.reason || 'GESTURE_NOT_DETECTED'); return; }
      // Identity/crowd failures take precedence over framing advice.
      const hint = ['FACE_NOT_MATCHED', 'MULTIPLE_FACES'].includes(reply?.reason)
        ? reply.reason : reply?.hint || reply?.reason || 'GESTURE_NOT_DETECTED';
      if (nativeTracking) {
        update({ phase: 'tracking', progress: 0, hint });
        rearm(400);
        return;
      }
      const progress = Number.isFinite(reply?.progress) ? Math.min(Math.max(reply.progress, 0), 1) : 0;
      busy = false;
      update({ phase: 'tracking', progress, hint });
      // Frames captured during the round trip go out at once.
      pump();
      return;
    }
    const next = step + 1;
    // Never skip a challenge or start AWS on a malformed acknowledgement.
    if (reply.complete !== (next === gestures.length)
      || (!reply.complete && (reply.nextStep !== next || reply.nextGesture !== gestures[next]))) {
      finish('fail', 'SERVICE_UNAVAILABLE');
      return;
    }
    if (gestures[step].startsWith('TURN_') && firstTurnSign === null) firstTurnSign = sign;
    clearCapture();
    update({ passed: next, phase: reply.complete ? 'done' : 'passed', progress: 0, hint: null });
    later(() => {
      if (reply.complete) finish('done');
      else {
        consecutive = 0;
        busy = false;
        update({ step: next, phase: 'tracking' });
        pump();
      }
    }, PASSED_PAUSE_MS);
  }

  function captureNext() {
    if (!sampling() || capturing || captureTimer !== null) return;
    capturing = true;
    const taken = generation;
    Promise.resolve().then(() => capture()).then((frame) => {
      capturing = false;
      if (closed || taken !== generation) { pump(); return; }
      if (!frame?.base64) throw Object.assign(new Error('No camera frame'), { code: 'CAPTURE_FAILED' });
      frames.push(frame.base64);
      if (frames.length > BATCH_FRAMES) frames.shift();
      void flush();
      captureTimer = schedule(() => { captureTimer = null; captureNext(); }, CAPTURE_GAP_MS);
    }).catch((error) => {
      capturing = false;
      // A capture that outlived its step or a pause is simply dropped.
      if (closed || taken !== generation) return;
      failed(error);
    });
  }

  async function flush() {
    if (!sampling() || busy || frames.length === 0) return;
    busy = true;
    const batch = frames;
    frames = [];
    const step = state.step;
    try {
      const reply = await submit(step, batch, { probe: true });
      if (closed) return;
      // Applied even in the background; completion waits for foreground.
      accept(reply, step, null);
    } catch (error) {
      if (closed) return;
      busy = false;
      failed(error);
    }
  }

  async function send(sign, frameId) {
    if (closed || !active || busy || state.phase !== 'tracking') return;
    busy = true;
    const step = state.step;
    update({ phase: 'sending' });
    try {
      const frame = await capture(frameId);
      if (closed) return;
      // Do not upload a frame collected while the camera was being suspended.
      if (!active) { busy = false; update({ phase: 'tracking', progress: 0 }); return; }
      if (!frame?.base64) throw Object.assign(new Error('No camera frame'), { code: 'CAPTURE_FAILED' });
      const reply = await submit(step, frame.base64, { probe: true });
      if (closed) return;
      accept(reply, step, sign);
    } catch (error) {
      failed(error);
    }
  }

  return {
    getState: () => state,
    setActive(value) {
      if (closed) return;
      active = value;
      consecutive = 0;
      if (!active) { ready = false; clearCapture(); return; }
      const resume = continuation;
      continuation = null;
      if (resume) resume();
      else pump();
    },
    cameraReady() { ready = true; pump(); },
    faceUpdate(event) {
      if (closed || !active || busy || timer !== null || state.phase !== 'tracking' || !nativeTracking) return;
      const assessed = assessGesture(gestures[state.step], readFace(event), { firstTurnSign });
      if (Math.abs(state.progress - assessed.progress) >= 1 / 12 || state.hint !== assessed.hint || (assessed.progress === 0 && state.progress !== 0)) {
        update({ progress: assessed.progress, hint: assessed.hint });
      }
      consecutive = assessed.ready ? consecutive + 1 : 0;
      if (consecutive >= (HOLD_UPDATES[gestures[state.step]] || 2)) {
        consecutive = 0;
        void send(assessed.sign, event?.frameId);
      }
    },
    fail: (code) => finish('fail', code),
    cancel: () => finish('cancel'),
    dispose: () => finish('dispose'),
  };
}
