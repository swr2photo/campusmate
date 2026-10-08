export const ANDROID_MESSAGING_NOTIFICATION_MODE = 'android-messaging-style-v1';

export function stringifyPushData(data = {}) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value == null || value === '') continue;
    out[key] = typeof value === 'string' ? value : String(value);
  }
  return out;
}

/**
 * Build an Expo push payload for one registered device.
 *
 * Android messaging-style clients still get enriched data (avatar, preview) so
 * the foreground handler can upgrade to MessagingStyle — but they also receive
 * a visible title/body/channel so the OS tray can show alerts when the app
 * process is killed (data-only FCM alone is unreliable on many OEMs).
 */
export function buildExpoPushMessage(registration, notification) {
  const isMessage = notification?.data?.type === 'message';
  const useAndroidMessagingStyle = registration?.platform === 'android'
    && registration?.notificationMode === ANDROID_MESSAGING_NOTIFICATION_MODE
    && isMessage;
  const isCall = notification?.data?.type === 'incoming_call';

  const data = stringifyPushData(
    useAndroidMessagingStyle
      ? {
        ...(notification.data || {}),
        notificationTitle: notification.title || '',
        notificationBody: notification.body || '',
        notificationChannelId: notification.channelId || 'messages',
        notificationThreadId: notification.threadId || '',
        notificationAvatarUri: notification.avatarUri || '',
        notificationBadge: typeof notification.badge === 'number' ? String(notification.badge) : '',
      }
      : (notification.data || {})
  );

  const pushMessage = {
    to: registration.expoPushToken,
    priority: 'high',
    data,
    sound: 'default',
    title: notification.title,
    body: notification.body,
    channelId: notification.channelId,
    threadId: notification.threadId,
    ...(useAndroidMessagingStyle ? {
      contentAvailable: true,
      ttl: 60 * 60,
      ...(notification.threadId ? { collapseId: String(notification.threadId) } : {}),
    } : {}),
    ...(isCall ? {
      ttl: 45,
      expiration: Math.floor(Date.now() / 1000) + 45,
      _displayInForeground: true,
    } : {}),
  };

  if (typeof notification.badge === 'number') {
    pushMessage.badge = notification.badge;
  }

  const notificationImage = notification.avatarUri || notification.mediaUrl;
  if (notificationImage && registration.platform === 'android') {
    pushMessage.richContent = {
      image: notificationImage,
    };
  }

  return pushMessage;
}
