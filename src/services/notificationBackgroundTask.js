import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { BACKGROUND_NOTIFICATION_TASK } from './notificationConstants';

if (!TaskManager.isTaskDefined(BACKGROUND_NOTIFICATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
    const { handleBackgroundNotificationTask } = require('./notificationService');
    await handleBackgroundNotificationTask({ data, error });
  });
}

if (Platform.OS === 'android') {
  try {
    const Notifications = require('expo-notifications');
    if (typeof Notifications.registerTaskAsync === 'function') {
      Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch((error) => {
        console.warn('[NotificationService] Failed to register background notification task:', error);
      });
    }
  } catch (error) {
    console.warn('[NotificationService] expo-notifications unavailable for background task:', error?.message);
  }

  try {
    const notifyKit = require('react-native-notify-kit');
    const notifee = notifyKit.default || notifyKit;
    if (typeof notifee?.onBackgroundEvent === 'function') {
      notifee.onBackgroundEvent(async () => {});
    }
  } catch {
    // NotifyKit is optional in Expo Go / web.
  }
}
