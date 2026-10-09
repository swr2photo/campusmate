import { markPushInboxRead } from '../services/notificationInboxService';
import React, { useEffect, useRef, useState } from 'react';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { AppState, Platform } from 'react-native';
import { useAppProfile, useAppSync } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import { useMembership } from '../context/MembershipContext';
import {
  clearNotificationBadgeAsync,
  clearPrivateLikeNotifications,
  getActiveConversation,
  getNotificationsModule,
  isNotificationsAvailable,
  notifyKitModule,
  registerForPushNotificationsAsync,
  unregisterPushNotificationsAsync,
} from '../services/notificationService';
import { openChatRoom } from '../utils/openChatRoom';
import { showInAppNotification } from './InAppNotificationBanner';

let lastNotificationOpenKey = '';
let lastNotificationOpenAt = 0;

function shouldSkipDuplicateOpen(key) {
  const now = Date.now();
  if (lastNotificationOpenKey === key && now - lastNotificationOpenAt < 2000) {
    return true;
  }
  lastNotificationOpenKey = key;
  lastNotificationOpenAt = now;
  return false;
}

function openChatRoomFromNotification(conversationId, route = {}) {
  const id = String(conversationId || '');
  if (!id) return;
  if (shouldSkipDuplicateOpen(`chat:${id}`)) return;

  openChatRoom(id, {
    pathname: route.pathname,
    currentChatId: route.chatId || getActiveConversation() || '',
  });
}

function openNotification(data, openIncomingCallFromNotification, route = {}) {
  if (!data || typeof data !== 'object') return;
  void markPushInboxRead(data.notificationId).catch(() => {});
  const type = String(data.type || '');
  const conversationId = typeof data.conversationId === 'string' ? data.conversationId : '';
  const callId = typeof data.callId === 'string' ? data.callId : '';
  const partyId = typeof data.partyId === 'string' ? data.partyId : '';

  if (type === 'moderation_warning') { router.push('/notifications'); return; }

  if (type === 'admin_announcement') {
    const target = String(data.route || '/home');
    if (['/home', '/discover', '/meetup', '/me', '/chat'].includes(target)
      && !shouldSkipDuplicateOpen('announcement:' + String(data.announcementId || target))) {
      router.push(target);
    }
    return;
  }

  if (type === 'party_request' || type === 'party_status') { router.push({ pathname: '/party-finder', params: { partyId } }); return; }
  if (type === 'appointment') { router.push('/appointments'); return; }
  if (type === 'group_message' && partyId) {
    if (!shouldSkipDuplicateOpen(`group:${partyId}`)) {
      router.push({ pathname: '/group-chat', params: { partyId } });
    }
    return;
  }

  if (type === 'incoming_call' || type === 'call') {
    if (callId && typeof openIncomingCallFromNotification === 'function') {
      openIncomingCallFromNotification(callId, data);
    }
    if (conversationId) {
      openChatRoomFromNotification(conversationId, route);
    }
    return;
  }

  if ((type === 'message' || type === 'match') && conversationId) {
    openChatRoomFromNotification(conversationId, route);
    return;
  }
  if (type === 'like') {
    if (shouldSkipDuplicateOpen('likes')) return;
    const pathname = String(route.pathname || '');
    if (pathname.includes('likes')) return;
    router.push('/likes');
  }
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
  const { user } = useAuth();
  const { profile } = useAppProfile();
  const { isOnline } = useAppSync();
  const { openIncomingCallFromNotification, rejectCall } = useCall();
  const { plus } = useMembership();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const [retryKey, setRetryKey] = useState(0);
  const handledResponseId = useRef(null);
  const routeRef = useRef({ pathname: '', chatId: '' });
  routeRef.current = {
    pathname: pathname || '',
    chatId: String(params?.chatId || ''),
  };
  const registrationStateRef = useRef({
    blocked: false,
    inFlight: null,
    retryTimer: null,
    userId: null,
    warned: false,
  });
  const hasCurrentProfile = Boolean(user?.id && profile?.id === user.id);
  const notificationsEnabled = hasCurrentProfile && !profile?.isNewUser ? profile.notificationsEnabled !== false : null;

  useEffect(() => {
    // Also runs while entitlement is unknown: a cached legacy like must not reveal an identity.
    void clearPrivateLikeNotifications();
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void clearPrivateLikeNotifications();
    });
    return () => foreground.remove();
  }, [user?.id, plus]);

  const dispatchNotification = React.useCallback((data) => {
    openNotification(data, openIncomingCallFromNotification, routeRef.current);
  }, [openIncomingCallFromNotification]);

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
      dispatchNotification(response.notification.request.content.data);
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    };

    // Stale check for cold start: Expo retains the last response across reloads/restarts.
    // If notification date is > 5 minutes old, ignore it and clear immediately.
    const initialResponse = Notifications.getLastNotificationResponse();
    if (initialResponse) {
      const notifDate = initialResponse.notification?.date;
      const time = typeof notifDate === 'number' ? notifDate : (notifDate ? new Date(notifDate).getTime() : 0);
      const isStale = time > 0 && (Date.now() - time > 5 * 60 * 1000);
      if (isStale) {
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      } else {
        setTimeout(() => handleResponse(initialResponse), 0);
      }
    }

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(handleResponse);

    // Foreground Push Notification Listener:
    // When a notification arrives while the user is inside the app, display Instagram-style top banner!
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const content = notification?.request?.content;
      const data = content?.data || {};
      const conversationId = data.conversationId;
      const type = String(data.type || '');

      // Suppress if the user is already viewing this exact chat room
      if (type === 'message' && conversationId && routeRef.current?.chatId === conversationId) {
        return;
      }
      // Suppress for incoming call (handled by CallContext / incoming call screen)
      if (type === 'incoming_call' || type === 'call') {
        return;
      }

      showInAppNotification({
        title: content?.title || 'CampusMate',
        message: content?.body || '',
        avatarUri: data.avatarUri || data.notificationAvatarUri || null,
        type: type || 'general',
        data,
        onPress: () => {
          dispatchNotification(data);
        },
      });
    });

    return () => {
      responseSubscription.remove();
      receivedSubscription.remove();
    };
  }, [dispatchNotification, user?.id]);

  useEffect(() => {
    if (!notifyKitModule?.notifee || !user?.id) return undefined;

    try {
      notifyKitModule.notifee.getInitialNotification().then((initial) => {
        if (initial?.notification?.data) {
          const notifTime = initial.notification?.date || initial.notification?.timestamp;
          const time = typeof notifTime === 'number' ? notifTime : (notifTime ? new Date(notifTime).getTime() : 0);
          const isStale = time > 0 && (Date.now() - time > 5 * 60 * 1000);
          if (!isStale) {
            dispatchNotification(initial.notification.data);
          }
        }
      }).catch(() => undefined);
    } catch {
      return undefined;
    }

    let unsubscribe;
    try {
      unsubscribe = notifyKitModule.notifee.onForegroundEvent(({ type, detail }) => {
        const actionId = detail?.pressAction?.id;
        const data = detail?.notification?.data;

        if (actionId === 'reject' && data?.callId) {
          rejectCall?.(data.callId, 'declined');
          notifyKitModule.notifee.cancelNotification(detail?.notification?.id || `call-${data.callId}`).catch(() => {});
          return;
        }

        if (
          (type === notifyKitModule.EventType?.PRESS || type === notifyKitModule.EventType?.ACTION_PRESS || type === 1 || type === 2) &&
          data
        ) {
          dispatchNotification(data);
        }
      });
    } catch {
      return undefined;
    }

    return () => {
      try {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      } catch {}
    };
  }, [dispatchNotification, user?.id]);

  return null;
}
