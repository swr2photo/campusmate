function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function parseNotificationDataString(value) {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function fcmDataFrom(value) {
  const object = asObject(value);
  if (!object) return {};
  if (typeof object.type === 'string') return object;
  if (asObject(object.data)) return fcmDataFrom(object.data);
  return object;
}

/**
 * Expo delivers a headless Android push as a serialized Firebase RemoteMessage.
 * Accept the task body, a RemoteMessage bundle, a `{ notification }` job wrap,
 * or the FCM data map itself.
 */
export function extractBackgroundNotificationData(taskPayload = {}) {
  const root = asObject(taskPayload) || {};
  const nestedRemoteMessage = asObject(root.notification);
  const remoteMessage = nestedRemoteMessage && (
    asObject(nestedRemoteMessage.data) || nestedRemoteMessage.messageId
  )
    ? nestedRemoteMessage
    : root;
  const fcmData = fcmDataFrom(remoteMessage);
  const encodedData = fcmData.dataString || fcmData.body;
  return {
    ...fcmData,
    ...parseNotificationDataString(encodedData),
  };
}
