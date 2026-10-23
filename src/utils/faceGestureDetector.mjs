// On-device guidance for the photo verification gesture phase. It only
// decides when a camera frame is worth sending: the server judges every
// frame with Rekognition. Thresholds sit slightly above the server's so a
// frame that looks ready here is likely to pass there.
//
// Left and right are compared with each other, never with an absolute
// sign: camera mirroring and SDK conventions differ between platforms.

const CENTER_MAX_DEG = 10;
const TURN_MIN_DEG = 20;
const NOD_MIN_DEG = 15;
const OFF_AXIS_MAX_DEG = 20;
const EYE_OPEN_MIN = 0.55;
const EYE_CLOSED_MAX = 0.3;
const SIZE_MIN = 0.22;
const SIZE_MAX = 0.82;
const CENTER_OFFSET_MAX = 0.18;

/**
 * Ready updates (about 80 ms apart) before a frame is taken. Movements pass
 * on the first one; looking straight needs two so it is not caught mid-turn.
 */
export const HOLD_UPDATES = { CENTER: 2, BLINK: 1, TURN_LEFT: 1, TURN_RIGHT: 1, NOD_DOWN: 1 };

const clamp = (value) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
const number = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Normalise a native `onFaceUpdate` payload; `null` when it is unusable. */
export function readFace(event) {
  if (!event || typeof event !== 'object') return null;
  const faces = Number.isInteger(event.faces) && event.faces >= 0 ? event.faces : 0;
  return {
    faces,
    yaw: number(event.yaw, 0),
    pitch: number(event.pitch, 0),
    roll: number(event.roll, 0),
    leftEyeOpen: number(event.leftEyeOpen, -1),
    rightEyeOpen: number(event.rightEyeOpen, -1),
    centerX: number(event.centerX, 0.5),
    centerY: number(event.centerY, 0.5),
    size: number(event.size, 0),
  };
}

function framingHint(face, centred) {
  if (!face || face.faces === 0) return 'NO_FACE';
  if (face.faces > 1) return 'MULTIPLE_FACES';
  if (face.size < SIZE_MIN) return 'TOO_FAR';
  if (face.size > SIZE_MAX) return 'TOO_CLOSE';
  if (centred && (Math.abs(face.centerX - 0.5) > CENTER_OFFSET_MAX || Math.abs(face.centerY - 0.5) > CENTER_OFFSET_MAX + 0.05)) {
    return 'OFF_CENTER';
  }
  return null;
}

/**
 * How far `face` is into `gesture`: `{ progress, ready, hint, sign }`.
 * `firstTurnSign` is the yaw sign of the head turn that already passed, so
 * the other turn has to go the opposite way.
 */
export function assessGesture(gesture, face, { firstTurnSign = null } = {}) {
  const hint = framingHint(face, gesture === 'CENTER' || gesture === 'BLINK');
  if (hint) return { progress: 0, ready: false, hint, sign: null };
  const yaw = Math.abs(face.yaw);
  const pitch = Math.abs(face.pitch);
  const eyes = [face.leftEyeOpen, face.rightEyeOpen].filter((value) => value >= 0);
  const openness = eyes.length ? Math.max(...eyes) : null;
  switch (gesture) {
    case 'CENTER': {
      const ready = yaw <= CENTER_MAX_DEG && pitch <= CENTER_MAX_DEG && (openness === null || openness >= EYE_OPEN_MIN);
      return { progress: clamp(1 - Math.max(yaw, pitch) / 30), ready, hint: ready ? null : 'LOOK_STRAIGHT', sign: null };
    }
    case 'BLINK': {
      if (eyes.length !== 2) return { progress: 0, ready: false, hint: null, sign: null };
      const ready = openness <= EYE_CLOSED_MAX && yaw <= 15 && pitch <= 15;
      return { progress: clamp((1 - openness) / (1 - EYE_CLOSED_MAX)), ready, hint: null, sign: null };
    }
    case 'TURN_LEFT':
    case 'TURN_RIGHT': {
      const sign = face.yaw > 0 ? 1 : -1;
      const wrongWay = firstTurnSign !== null && sign === firstTurnSign && yaw >= 8;
      const ready = !wrongWay && yaw >= TURN_MIN_DEG && pitch <= OFF_AXIS_MAX_DEG;
      return { progress: wrongWay ? 0 : clamp(yaw / TURN_MIN_DEG), ready, hint: wrongWay ? 'OTHER_WAY' : null, sign };
    }
    case 'NOD_DOWN': {
      const ready = pitch >= NOD_MIN_DEG && yaw <= OFF_AXIS_MAX_DEG;
      return { progress: clamp(pitch / NOD_MIN_DEG), ready, hint: null, sign: null };
    }
    default:
      return { progress: 0, ready: false, hint: null, sign: null };
  }
}

/**
 * Colour state of each tick around the camera ring: `done` for passed
 * steps, `active` for the current step's progress, `idle` otherwise.
 */
export function ringTicks({ total, steps, passed, progress }) {
  const perStep = total / Math.max(1, steps);
  return Array.from({ length: total }, (_, index) => {
    const step = Math.floor(index / perStep);
    if (step < passed) return 'done';
    if (step === passed && index - step * perStep < clamp(progress) * perStep) return 'active';
    return 'idle';
  });
}
