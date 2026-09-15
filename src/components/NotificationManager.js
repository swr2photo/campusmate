import React, { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import {
  clearNotificationBadgeAsync,
  getNotificationsModule,
  isNotificationsAvailable,
  notifyKitModule,
  registerForPushNotificationsAsync,
  unregisterPushNotificationsAsync,
} from '../services/notificationService';

function openNotification(data, openIncomingCallFromNotification) {
  if (!data || typeof data !== 'object') return;
  const type = String(data.type || '');
  const conversationId = typeof data.conversationId === 'string' ? data.conversationId : '';
  const callId = typeof data.callId === 'string' ? data.callId : '';

  if (type === 'incoming_call' || type === 'call') {
    if (callId && typeof openIncomingCallFromNotification === 'function') {
      openIncomingCallFromNotification(callId, data);
    }
    if (conversationId) {
      router.push({ pathname: '/chat-room', params: { chatId: conversationId } });
    }
    return;
  }

  if ((type === 'message' || type === 'match') && conversationId) {
    router.push({ pathname: '/chat-room', params: { chatId: conversationId } });
    return;
  }
  if (type === 'like') router.push('/likes');
}

function isUnavailableRegistrationEndpoint(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'functions/not-found'
    || code.endsWith('/not-found')
    || message.includes('not-found')
    || /\b404\b/.test(message);
}

function isPermanentRegistrationFailure(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return isUnavailableRegistrationEndpoint(error)
    || [
      'functions/failed-precondition',
      'functions/invalid-argument',
      'functions/permission-denied',
      'functions/resource-exhausted',
    ].includes(code)
    || message.includes('eas projectid');
}

// Keep the 404 guard and in-flight request shared across Strict Mode/Fast Refresh
// remounts so a permanently missing endpoint cannot produce duplicate calls/logs.
const unavailableRegistrationUserIds = new Set();
const registrationInFlightByUserId = new Map();

export default function NotificationManager() {
  const { profile, isOnline } = useApp();
  const { user } = useAuth();
  const { openIncomingCallFromNotification } = useCall();
  const [retryKey, setRetryKey] = useState(0);
  const handledResponseId = useRef(null);
  const registrationStateRef = useRef({
    blocked: false,
    inFlight: null,
    retryTimer: null,
    userId: null,
    warned: false,
  });
  const hasCurrentProfile = Boolean(user?.id && profile?.id === user.id);
  const notificationsEnabled = hasCurrentProfile ? profile.notificationsEnabled !== false : null;

  useEffect(() => {
    const state = registrationStateRef.current;
    if (state.userId === (user?.id || null)) return;
    if (state.userId) unavailableRegistrationUserIds.delete(state.userId);
    if (state.retryTimer) clearTimeout(state.retryTimer);
    registrationStateRef.current = {
      blocked: false,
      inFlight: null,
      retryTimer: null,
      userId: user?.id || null,
      warned: false,
    };
  }, [user?.id]);

  useEffect(() => () => {
    const timer = registrationStateRef.current.retryTimer;
    if (timer) clearTimeout(timer);
  }, []);

  const syncRegistration = React.useCallback(() => {
    const userId = user?.id;
    const state = registrationStateRef.current;
    if (
      !userId
      || Platform.OS === 'web'
      || !isOnline
      || notificationsEnabled === null
      || state.userId !== userId
      || state.blocked
      || state.retryTimer
    ) return Promise.resolve();
    if (state.inFlight) return state.inFlight;
    if (unavailableRegistrationUserIds.has(userId)) {
      state.blocked = true;
      state.warned = true;
      return Promise.resolve();
    }
    const sharedTask = registrationInFlightByUserId.get(userId);
    if (sharedTask) {
      state.inFlight = sharedTask;
      return sharedTask;
    }

    const task = (async () => {
      try {
        if (!notificationsEnabled) {
          await unregisterPushNotificationsAsync(userId);
          return;
        }
        await registerForPushNotificationsAsync(userId);
      } catch (error) {
        if (isPermanentRegistrationFailure(error)) {
          if (isUnavailableRegistrationEndpoint(error)) unavailableRegistrationUserIds.add(userId);
          state.blocked = true;
          if (!state.warned) {
            state.warned = true;
            const code = String(error?.code || '').toLowerCase();
            const reason = isUnavailableRegistrationEndpoint(error)
              ? 'endpoint is unavailable (404)'
              : `registration is unavailable (${code || 'configuration error'})`;
            console.warn(`[Notifications] Push ${reason}; skipping retries until the next account session.`);
          }
          return;
        }

        console.warn('[Notifications] Registration failed; retrying.');
        if (!state.retryTimer) {
          state.retryTimer = setTimeout(() => {
            state.retryTimer = null;
            setRetryKey((value) => value + 1);
          }, 30000);
        }
      } finally {
        if (state.inFlight === task) state.inFlight = null;
      }
    })();
    state.inFlight = task;
    registrationInFlightByUserId.set(userId, task);
    task.then(
      () => {
        if (registrationInFlightByUserId.get(userId) === task) registrationInFlightByUserId.delete(userId);
      },
      () => {
        if (registrationInFlightByUserId.get(userId) === task) registrationInFlightByUserId.delete(userId);
      }
    );
    return task;
  }, [isOnline, notificationsEnabled, user?.id]);

  useEffect(() => {
    void syncRegistration();
  }, [retryKey, syncRegistration]);

  useEffect(() => {
    const Notifications = getNotificationsModule();
    if (!Notifications || !user?.id || !hasCurrentProfile || !notificationsEnabled) return undefined;
    const subscription = Notifications.addPushTokenListener(() => {
      void syncRegistration();
    });
    return () => subscription.remove();
  }, [hasCurrentProfile, notificationsEnabled, syncRegistration, user?.id]);

  useEffect(() => {
    const Notifications = getNotificationsModule();
    if (!Notifications || !isNotificationsAvailable || !user?.id) return undefined;

    const handleResponse = (response) => {
      const identifier = response?.notification?.request?.identifier;
      if (!response?.notification || (identifier && handledResponseId.current === identifier)) return;
      handledResponseId.current = identifier || Date.now();
      void clearNotificationBadgeAsync();
      openNotification(response.notification.request.content.data, openIncomingCallFromNotification);
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    };

    const initialResponse = Notifications.getLastNotificationResponse();
    if (initialResponse) setTimeout(() => handleResponse(initialResponse), 0);
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(handleResponse);

    return () => {
      responseSubscription.remove();
    };
  }, [user?.id]);

  useEffect(() => {
    if (!notifyKitModule?.notifee || !user?.id) return undefined;

    notifyKitModule.notifee.getInitialNotification().then((initial) => {
      if (initial?.notification?.data) {
        openNotification(initial.notification.data, openIncomingCallFromNotification);
      }
    }).catch(() => undefined);

    const unsubscribe = notifyKitModule.notifee.onForegroundEvent(({ type, detail }) => {
      if (
        (type === notifyKitModule.EventType?.PRESS || type === notifyKitModule.EventType?.ACTION_PRESS || type === 1 || type === 2) &&
        detail?.notification?.data
      ) {
        openNotification(detail.notification.data, openIncomingCallFromNotification);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [openIncomingCallFromNotification, user?.id]);

  return null;
}
