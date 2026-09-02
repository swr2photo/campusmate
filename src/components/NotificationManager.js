import React, { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import {
  clearNotificationBadgeAsync,
  registerForPushNotificationsAsync,
  unregisterPushNotificationsAsync,
} from '../services/notificationService';

function openNotification(data) {
  if (!data || typeof data !== 'object') return;
  const type = String(data.type || '');
  const conversationId = typeof data.conversationId === 'string' ? data.conversationId : '';

  if ((type === 'message' || type === 'match') && conversationId) {
    router.push({ pathname: '/chat-room', params: { chatId: conversationId } });
    return;
  }
  if (type === 'like') router.push('/likes');
}

export default function NotificationManager() {
  const { profile, isOnline } = useApp();
  const { user } = useAuth();
  const [retryKey, setRetryKey] = useState(0);
  const handledResponseId = useRef(null);
  const notificationsEnabled = profile?.notificationsEnabled !== false;

  useEffect(() => {
    if (!user?.id || Platform.OS === 'web') return undefined;
    let active = true;
    let retryTimer;

    const syncRegistration = async () => {
      try {
        if (!notificationsEnabled) {
          await unregisterPushNotificationsAsync(user.id);
          return;
        }
        if (!isOnline) return;
        await registerForPushNotificationsAsync(user.id);
      } catch (error) {
        console.warn('[Notifications] Registration failed; retrying:', error);
        if (active) retryTimer = setTimeout(() => setRetryKey((value) => value + 1), 30000);
      }
    };

    void syncRegistration();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isOnline, notificationsEnabled, retryKey, user?.id]);

  useEffect(() => {
    if (!user?.id || !notificationsEnabled || Platform.OS === 'web') return undefined;
    const subscription = Notifications.addPushTokenListener(() => {
      void registerForPushNotificationsAsync(user.id).catch((error) => {
        console.warn('[Notifications] Push token refresh failed:', error);
      });
    });
    return () => subscription.remove();
  }, [notificationsEnabled, user?.id]);

  useEffect(() => {
    if (!user?.id || Platform.OS === 'web') return undefined;

    const handleResponse = (response) => {
      const identifier = response?.notification?.request?.identifier;
      if (!response?.notification || (identifier && handledResponseId.current === identifier)) return;
      handledResponseId.current = identifier || Date.now();
      void clearNotificationBadgeAsync();
      openNotification(response.notification.request.content.data);
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    };

    const initialResponse = Notifications.getLastNotificationResponse();
    if (initialResponse) setTimeout(() => handleResponse(initialResponse), 0);
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    const receivedSubscription = Notifications.addNotificationReceivedListener(() => {
      void clearNotificationBadgeAsync();
    });
    void clearNotificationBadgeAsync();

    return () => {
      responseSubscription.remove();
      receivedSubscription.remove();
    };
  }, [user?.id]);

  return null;
}
