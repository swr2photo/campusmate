/**
 * Imperative in-app alert API (drop-in replacement for react-native's Alert).
 *
 *   showAlert(title, message?, buttons?, options?)
 *     buttons: [{ text, style: 'default' | 'cancel' | 'destructive', onPress }]
 *     options: { cancelable, onDismiss, tone: 'info' | 'success' | 'warning' | 'danger', icon }
 *   The third argument may also be the options object when there are no custom buttons:
 *     showAlert('บันทึกไม่สำเร็จ', message, { tone: 'danger' })
 *
 *   showPrompt(title, message?, callbackOrButtons?, type?, defaultValue?, keyboardType?, options?)
 *     Same shape as Alert.prompt; button onPress receives the entered text.
 *
 * Alerts are queued and rendered one at a time by <AppAlertHost /> (mounted once in
 * app/_layout.js). Calls made before the host mounts simply wait in the queue.
 */

const DEFAULT_OK = 'ตกลง';
const DEFAULT_CANCEL = 'ยกเลิก';
const TONES = new Set(['info', 'success', 'warning', 'danger']);

let queue = [];
let nextId = 1;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* A broken listener must not block other alerts. */
    }
  });
}

/** Best-effort tone from a Thai/English title when the caller did not pass one. */
export function inferAlertTone(title, buttons) {
  if (Array.isArray(buttons) && buttons.some((b) => b?.style === 'destructive')) return 'danger';
  const text = String(title ?? '');
  if (/ไม่สำเร็จ|ไม่สามารถ|ผิดพลาด|ไม่ได้|ไม่ถูกต้อง|ถูกระงับ|error|failed/i.test(text)) return 'danger';
  if (/สำเร็จ|เรียบร้อย|แล้ว$|success/i.test(text)) return 'success';
  if (/คำเตือน|ต้อง|กรุณา|เกินไป|สูงสุด|warning/i.test(text)) return 'warning';
  return 'info';
}

function normalizeButtons(buttons, fallbackText = DEFAULT_OK) {
  const list = Array.isArray(buttons) ? buttons.filter(Boolean) : [];
  if (!list.length) return [{ style: 'default', text: fallbackText }];
  return list.map((button) => ({
    onPress: typeof button.onPress === 'function' ? button.onPress : undefined,
    style: button.style === 'cancel' || button.style === 'destructive' ? button.style : 'default',
    text: button.text == null || button.text === '' ? DEFAULT_OK : String(button.text),
  }));
}

function enqueue(entry) {
  queue = [...queue, entry];
  emit();
  return entry.id;
}

export function showAlert(title, message, buttons, options) {
  let customButtons = buttons;
  let opts = options;
  if (customButtons && !Array.isArray(customButtons) && typeof customButtons === 'object' && opts === undefined) {
    opts = customButtons;
    customButtons = undefined;
  }
  opts = opts || {};
  const hasCustomButtons = Array.isArray(customButtons) && customButtons.filter(Boolean).length > 0;
  const tone = TONES.has(opts.tone) ? opts.tone : inferAlertTone(title, customButtons);
  return enqueue({
    buttons: normalizeButtons(customButtons),
    // Plain "OK" notices can be dismissed with back / tap outside, like a toast-y alert.
    cancelable: typeof opts.cancelable === 'boolean' ? opts.cancelable : !hasCustomButtons,
    closing: false,
    icon: opts.icon,
    id: nextId++,
    kind: 'alert',
    message: message == null ? '' : String(message),
    onDismiss: typeof opts.onDismiss === 'function' ? opts.onDismiss : undefined,
    title: title == null ? '' : String(title),
    tone,
  });
}

export function showPrompt(title, message, callbackOrButtons, type = 'plain-text', defaultValue = '', keyboardType, options) {
  const opts = options || {};
  let buttons = callbackOrButtons;
  if (typeof callbackOrButtons === 'function') {
    buttons = [
      { style: 'cancel', text: DEFAULT_CANCEL },
      { onPress: callbackOrButtons, style: 'default', text: DEFAULT_OK },
    ];
  } else if (!Array.isArray(buttons) || !buttons.length) {
    buttons = [
      { style: 'cancel', text: DEFAULT_CANCEL },
      { style: 'default', text: DEFAULT_OK },
    ];
  }
  return enqueue({
    buttons: normalizeButtons(buttons),
    cancelable: typeof opts.cancelable === 'boolean' ? opts.cancelable : false,
    closing: false,
    defaultValue: defaultValue == null ? '' : String(defaultValue),
    icon: opts.icon,
    id: nextId++,
    keyboardType: keyboardType || 'default',
    kind: 'prompt',
    message: message == null ? '' : String(message),
    onDismiss: typeof opts.onDismiss === 'function' ? opts.onDismiss : undefined,
    placeholder: opts.placeholder,
    secureTextEntry: type === 'secure-text' || type === 'login-password',
    title: title == null ? '' : String(title),
    tone: TONES.has(opts.tone) ? opts.tone : 'info',
  });
}

/** Starts the exit animation of an alert (the host removes it once hidden). */
export function closeAlert(id) {
  let changed = false;
  queue = queue.map((entry) => {
    if (entry.id !== id || entry.closing) return entry;
    changed = true;
    return { ...entry, closing: true };
  });
  if (changed) emit();
}

/** Removes an alert from the queue immediately (used by the host after its exit animation). */
export function removeAlert(id) {
  const before = queue.length;
  queue = queue.filter((entry) => entry.id !== id);
  if (queue.length !== before) emit();
}

/** Programmatic dismiss without pressing a button (no callbacks fire). */
export function dismissAlert(id) {
  if (id == null) {
    if (queue[0]) closeAlert(queue[0].id);
    return;
  }
  if (queue[0]?.id === id) closeAlert(id);
  else removeAlert(id);
}

export function subscribeAlerts(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCurrentAlert() {
  return queue[0] || null;
}

/** True while any alert is shown or waiting (lets startup popups wait for an empty queue). */
export function hasPendingAlerts() {
  return queue.length > 0;
}

const AppAlert = { alert: showAlert, prompt: showPrompt, dismiss: dismissAlert };

export default AppAlert;
