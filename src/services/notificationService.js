import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { requireFirebase } from './dbService';

const REGISTRATION_KEY = 'campusmate_push_registration_v1';
const CHANNELS = {
  messages: 'messages',
  social: 'social',
};
const FUNCTIONS_REGION = 'asia-southeast1';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
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
  await Promise.all([
    Notifications.setNotificationChannelAsync(CHANNELS.messages, {
      name: 'ข้อความ',
      description: 'แจ้งเตือนเมื่อมีข้อความใหม่',
      importance: Notifications.AndroidImportance.MAX,
      lightColor: '#5B5CE2',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      sound: 'default',
      vibrationPattern: [0, 250, 180, 250],
    }),
    Notifications.setNotificationChannelAsync(CHANNELS.social, {
      name: 'ไลก์และแมตช์',
      description: 'แจ้งเตือนเมื่อมีคนกดใจหรือแมตช์กับคุณ',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#FF7A6F',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      sound: 'default',
      vibrationPattern: [0, 220, 160, 220],
    }),
  ]);
}

function getProjectId() {
  return Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId || '';
}

async function readStoredRegistration() {
  try {
    const raw = await AsyncStorage.getItem(REGISTRATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveRegistration(userId, expoPushToken, nativeToken) {
  const { app } = requireFirebase();
  const projectId = getProjectId();
  const registration = {
    userId,
    expoPushToken,
  };
  await AsyncStorage.setItem(REGISTRATION_KEY, JSON.stringify(registration));
  const registerPushToken = httpsCallable(getFunctions(app, FUNCTIONS_REGION), 'registerPushToken');
  await registerPushToken({
    expoPushToken,
    nativePushToken: typeof nativeToken?.data === 'string' ? nativeToken.data : '',
    nativeTokenType: String(nativeToken?.type || ''),
    platform: Platform.OS,
    projectId,
    appVersion: String(Constants.expoConfig?.version || ''),
  });
  return registration;
}

export async function registerForPushNotificationsAsync(userId) {
  if (!userId || Platform.OS === 'web') return null;
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
  const nativeToken = await Notifications.getDevicePushTokenAsync().catch(() => null);
  return saveRegistration(userId, expoPushToken, nativeToken);
}

export async function unregisterPushNotificationsAsync(userId) {
  if (!userId || Platform.OS === 'web') return false;
  const registration = await readStoredRegistration();
  if (!registration?.expoPushToken || registration.userId !== userId) return false;

  const { app } = requireFirebase();
  const unregisterPushToken = httpsCallable(getFunctions(app, FUNCTIONS_REGION), 'unregisterPushToken');
  await unregisterPushToken({ expoPushToken: registration.expoPushToken });
  await AsyncStorage.removeItem(REGISTRATION_KEY);
  return true;
}

export async function clearNotificationBadgeAsync() {
  if (Platform.OS === 'web') return;
  await Notifications.setBadgeCountAsync(0).catch(() => undefined);
}

export { CHANNELS };
