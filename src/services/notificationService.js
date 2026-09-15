import Constants from 'expo-constants';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService';
import {
  ANDROID_MESSAGING_NOTIFICATION_MODE,
  BACKGROUND_NOTIFICATION_TASK,
} from './notificationConstants';
import { extractBackgroundNotificationData } from './notificationPayload';
import {
  getEncryptedItem,
  removeEncryptedItem,
  setEncryptedItem,
} from '../utils/encryptedStorage';

const REGISTRATION_KEY = 'campusmate_push_registration_v1';
const CHANNELS = {
  messages: 'messages',
  social: 'social',
  calls: 'calls',
};
const FUNCTIONS_REGION = 'asia-southeast1';
export { ANDROID_MESSAGING_NOTIFICATION_MODE, BACKGROUND_NOTIFICATION_TASK };
export { extractBackgroundNotificationData };

export const isNotificationsAvailable = Platform.OS !== 'web'
  && Constants.appOwnership !== 'expo'
  && Constants.executionEnvironment !== 'storeClient';

export function getNotificationsModule() {
  if (!isNotificationsAvailable) return null;
  return require('expo-notifications');
}

export function getNotifeeModule() {
  if (Platform.OS === 'web') return null;
  try {
    const notifyKit = require('react-native-notify-kit');
    return {
      notifee: notifyKit.default || notifyKit,
      AndroidStyle: notifyKit.AndroidStyle,
      AndroidImportance: notifyKit.AndroidImportance,
      AndroidCategory: notifyKit.AndroidCategory,
      EventType: notifyKit.EventType,
    };
  } catch (err) {
    console.warn('[NotificationService] Notifee/NotifyKit not available:', err?.message);
    return null;
  }
}

export const notifyKitModule = getNotifeeModule();
const Notifications = getNotificationsModule();

let currentActiveConversationId = null;

export function setActiveConversation(conversationId) {
  currentActiveConversationId = conversationId ? String(conversationId) : null;
}

export function getActiveConversation() {
  return currentActiveConversationId;
}

function isRemoteHttpUri(value) {
  return typeof value === 'string'
    && (value.startsWith('http://') || value.startsWith('https://'));
}

/**
 * LINE-style Android chat notification: sender/chat photo as the circular
 * large icon / MessagingStyle person, app icon as the small status-bar icon.
 */
export async function displayChatMessageNotification({
  senderName,
  senderId,
  avatarUri,
  text,
  conversationId,
  messageId,
  badgeCount,
}) {
  if (!notifyKitModule?.notifee) return;
  try {
    if (conversationId && currentActiveConversationId && currentActiveConversationId === String(conversationId)) {
      return;
    }

    const title = senderName || 'ข้อความใหม่';
    const body = text || 'มีข้อความใหม่';
    const timestamp = Date.now();
    const hasRemoteAvatar = isRemoteHttpUri(avatarUri);

    const person = {
      name: title,
      ...(senderId ? { id: String(senderId) } : {}),
      ...(hasRemoteAvatar ? { icon: avatarUri } : {}),
    };

    await notifyKitModule.notifee.displayNotification({
      id: conversationId ? String(conversationId) : (messageId ? String(messageId) : undefined),
      title,
      body,
      data: {
        type: 'message',
        conversationId: String(conversationId || ''),
        messageId: String(messageId || ''),
        senderId: String(senderId || ''),
        avatarUri: hasRemoteAvatar ? avatarUri : '',
      },
      android: {
        channelId: CHANNELS.messages,
        category: notifyKitModule.AndroidCategory?.MESSAGE || 'msg',
        pressAction: {
          id: 'default',
        },
        showTimestamp: true,
        timestamp,
        // Android's small icon stays the app notification icon. The sender
        // photo is the large/circular avatar and MessagingStyle person icon.
        ...(hasRemoteAvatar ? {
          largeIcon: avatarUri,
          circularLargeIcon: true,
        } : {}),
        ...(Number.isFinite(Number(badgeCount)) && Number(badgeCount) > 0 ? {
          badgeCount: Number(badgeCount),
        } : {}),
        style: {
          type: notifyKitModule.AndroidStyle.MESSAGING,
          person,
          messages: [
            {
              text: body,
              timestamp,
              person,
            },
          ],
        },
      },
    });
  } catch (err) {
    console.warn('[NotificationService] Failed to display messaging notification:', err);
  }
}

export async function handleBackgroundNotificationTask({ data, error } = {}) {
  if (error) return;

  const notificationData = extractBackgroundNotificationData(data || {});
  if (String(notificationData.type || '') !== 'message') return;

  const conversationId = notificationData.conversationId;
  if (!conversationId) return;

  try {
    await configureAndroidChannels();
    await displayChatMessageNotification({
      senderName: notificationData.senderName || notificationData.notificationTitle || 'ข้อความใหม่',
      senderId: notificationData.senderId,
      avatarUri: notificationData.avatarUri || notificationData.notificationAvatarUri,
      text: notificationData.notificationBody
        || notificationData.messagePreview
        || notificationData.preview
        || (notificationData.mediaType === 'image' ? 'ส่งรูปภาพ' : 'มีข้อความใหม่'),
      conversationId,
      messageId: notificationData.messageId || notificationData.id,
      badgeCount: notificationData.notificationBadge,
    });
  } catch (taskError) {
    console.warn('[NotificationService] Failed to render headless message notification:', taskError);
  }
}

function registerBackgroundNotificationTask() {
  if (Platform.OS !== 'android' || !Notifications || !notifyKitModule?.notifee) return;

  // defineTask lives in notificationBackgroundTask.js (imported from index.js).
  // Registration is persistent on the device.
  void TaskManager.isTaskRegisteredAsync(BACKGROUND_NOTIFICATION_TASK)
    .then((registered) => {
      if (!registered) return Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
      return null;
    })
    .catch((error) => {
      console.warn('[NotificationService] Failed to register background notification task:', error);
    });
}

registerBackgroundNotificationTask();

if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification?.request?.content?.data || {};
      const conversationId = data.conversationId;
      const type = String(data.type || '');
      const isViewingCurrentChat = Boolean(
        conversationId && currentActiveConversationId && currentActiveConversationId === String(conversationId)
      );

      // On Android, if notifyKit (Notifee) is available and this is a chat message,
      // render using AndroidStyle.MESSAGING (circular sender avatar + small app icon badge),
      // and suppress Expo's default banner to avoid duplicate notifications.
      if (
        Platform.OS === 'android' &&
        notifyKitModule?.notifee &&
        (type === 'message' || (!type && conversationId)) &&
        !isViewingCurrentChat
      ) {
        displayChatMessageNotification({
          senderName: data.senderName
            || data.notificationTitle
            || notification.request?.content?.title,
          senderId: data.senderId,
          avatarUri: data.avatarUri || data.notificationAvatarUri,
          text: data.notificationBody || data.messagePreview || notification.request?.content?.body,
          conversationId,
          messageId: data.messageId,
          badgeCount: data.notificationBadge,
        });
        return {
          shouldPlaySound: false,
          shouldSetBadge: true,
          shouldShowBanner: false,
          shouldShowList: false,
        };
      }

      return {
        shouldPlaySound: !isViewingCurrentChat,
        shouldSetBadge: true,
        shouldShowBanner: !isViewingCurrentChat,
        shouldShowList: !isViewingCurrentChat,
      };
    },
  });
}

function hasNotificationPermission(permission) {
  if (Platform.OS !== 'ios') return permission?.granted || permission?.status === 'granted';
  const iosStatus = permission?.ios?.status;
  return [
    Notifications.IosAuthorizationStatus.AUTHORIZED,
    Notifications.IosAuthorizationStatus.PROVISIONAL,
    Notifications.IosAuthorizationStatus.EPHEMERAL,
  ].includes(iosStatus);
}

async function configureAndroidChannels() {
  if (Platform.OS !== 'android') return;

  if (notifyKitModule?.notifee) {
    try {
      await notifyKitModule.notifee.createChannel({
        id: CHANNELS.messages,
        name: 'ข้อความแชต',
        importance: notifyKitModule.AndroidImportance.HIGH,
        sound: 'default',
        vibration: true,
        badge: true,
      });
    } catch (e) {
      console.warn('[NotificationService] Failed to create notifee channel:', e);
    }
  }

  if (!Notifications) return;
  await Promise.all([
    Notifications.setNotificationChannelAsync(CHANNELS.messages, {
      name: 'ข้อความ',
      description: 'แจ้งเตือนเมื่อมีข้อความใหม่',
      importance: Notifications.AndroidImportance.MAX,
      lightColor: '#5B5CE2',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      vibrationPattern: [0, 250, 180, 250],
    }),
    Notifications.setNotificationChannelAsync(CHANNELS.social, {
      name: 'ไลก์และแมตช์',
      description: 'แจ้งเตือนเมื่อมีคนกดใจหรือแมตช์กับคุณ',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#FF7A6F',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      vibrationPattern: [0, 220, 160, 220],
    }),
    Notifications.setNotificationChannelAsync(CHANNELS.calls, {
      name: 'สายเรียกเข้า (Calls)',
      description: 'แจ้งเตือนเมื่อมีสายโทรเข้าหรือวิดีโอคอล',
      importance: Notifications.AndroidImportance.MAX,
      lightColor: '#10B981',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      vibrationPattern: [0, 1000, 1000, 1000],
    }),
  ]);
}

function getProjectId() {
  return Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId || '';
}

async function readStoredRegistration() {
  try {
    const raw = await getEncryptedItem(REGISTRATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveRegistration(userId, expoPushToken) {
  const { app } = requireFirebase();
  const projectId = getProjectId();
  const registerPushToken = httpsCallable(getFunctions(app, FUNCTIONS_REGION), 'registerPushToken');
  await registerPushToken({
    expoPushToken,
    platform: Platform.OS,
    projectId,
    appVersion: String(Constants.expoConfig?.version || ''),
    notificationMode: Platform.OS === 'android' ? ANDROID_MESSAGING_NOTIFICATION_MODE : '',
  });
  // Persist only after the server has accepted the token. This prevents a
  // failed registration from being treated as an active logout token later.
  const registration = { userId, expoPushToken };
  await setEncryptedItem(REGISTRATION_KEY, JSON.stringify(registration));
  return registration;
}

export async function registerForPushNotificationsAsync(userId) {
  if (!userId || !isNotificationsAvailable) return null;
  await configureAndroidChannels();

  let permission = await Notifications.getPermissionsAsync();
  if (!hasNotificationPermission(permission)) {
    permission = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
  }
  if (!hasNotificationPermission(permission)) return null;

  const projectId = getProjectId();
  if (!projectId) throw new Error('ไม่พบ EAS projectId สำหรับ Push Notification');

  const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  return saveRegistration(userId, expoPushToken);
}

export async function unregisterPushNotificationsAsync(userId) {
  if (!userId || !isNotificationsAvailable) return false;
  const registration = await readStoredRegistration();
  if (!registration?.expoPushToken || registration.userId !== userId) return false;

  const { app } = requireFirebase();
  const unregisterPushToken = httpsCallable(getFunctions(app, FUNCTIONS_REGION), 'unregisterPushToken');
  await unregisterPushToken({ expoPushToken: registration.expoPushToken });
  await removeEncryptedItem(REGISTRATION_KEY);
  return true;
}

export async function updateNotificationBadgeAsync(count = 0) {
  if (!isNotificationsAvailable || !Notifications) return;
  const safeCount = Math.max(0, parseInt(count, 10) || 0);
  await Notifications.setBadgeCountAsync(safeCount).catch(() => undefined);
}

export async function clearNotificationBadgeAsync() {
  if (!isNotificationsAvailable || !Notifications) return;
  await Notifications.setBadgeCountAsync(0).catch(() => undefined);
}

export { CHANNELS };
