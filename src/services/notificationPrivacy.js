const isPendingLike = (data) => data?.type === 'like';

/** Remove pending-like banners only. Accepted matches, chat messages and calls remain available. */
export async function dismissPendingLikeNotifications(expo, notifee) {
  const failures = [];
  const clean = async (list, getData, getId, dismiss) => {
    if (!list || !dismiss) return;
    try {
      for (const item of await list()) {
        if (isPendingLike(getData(item)) && getId(item)) {
          try { await dismiss(getId(item)); } catch (error) { failures.push(error); }
        }
      }
    } catch (error) { failures.push(error); }
  };
  await clean(expo?.getPresentedNotificationsAsync?.bind(expo),
    (item) => item.request?.content?.data, (item) => item.request?.identifier,
    expo?.dismissNotificationAsync?.bind(expo));
  await clean(expo?.getAllScheduledNotificationsAsync?.bind(expo),
    (item) => item.content?.data, (item) => item.identifier,
    expo?.cancelScheduledNotificationAsync?.bind(expo));
  await clean(notifee?.getDisplayedNotifications?.bind(notifee),
    (item) => item.notification?.data, (item) => item.notification?.id,
    notifee?.cancelDisplayedNotification?.bind(notifee));
  await clean(notifee?.getTriggerNotifications?.bind(notifee),
    (item) => item.notification?.data, (item) => item.notification?.id,
    notifee?.cancelTriggerNotification?.bind(notifee));
  try {
    const response = expo?.getLastNotificationResponse?.();
    if (isPendingLike(response?.notification?.request?.content?.data)) await expo?.clearLastNotificationResponseAsync?.();
  } catch (error) { failures.push(error); }
  return { failures: failures.length };
}

export function isLegacyLikeIdentity(data) {
  return isPendingLike(data) && Boolean(data.profileId || data.senderId || data.avatarUri
    || data.notificationAvatarUri || data.senderName);
}
