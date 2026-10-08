import React, {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import { useAuth } from './AuthContext';
import { useAppActions, useAppConversations, useAppFeed, useAppProfile } from './AppContext';
import {
  CALL_STATUS,
  CALL_TYPES,
  acceptCall,
  endCall,
  formatCallDuration,
  getCall,
  initiateCall,
  markCallMissed,
  rejectCall,
  setCallRinging,
  subscribeToCall,
  subscribeToIncomingCalls,
} from '../services/callSignalingService';
import { dismissIncomingCallNotification } from '../services/notificationService';
import { isCallFeatureAllowed } from '../utils/featureFlags';
import { showAlert } from '../utils/appAlert';

const CallContext = createContext(null);

// The call UI drags in LiveKit and WebRTC, which are irrelevant to every session
// that never places a call, so the chunk is only fetched once one starts.
const CallModal = lazy(async () => {
  try {
    const { registerGlobals } = await import('@livekit/react-native');
    if (typeof registerGlobals === 'function') registerGlobals();
  } catch (_) {}
  return import('../components/CallModal');
});

const CALL_TIMEOUT_MS = 45000; // 45 seconds timeout for unanswered calls

export function CallProvider({ children }) {
  const { user } = useAuth();
  const { profile } = useAppProfile();
  const { sendMessage } = useAppActions();
  const { conversations } = useAppConversations();
  const { availableProfiles } = useAppFeed();
  const currentUserId = user?.id || user?.uid || null;
  const canCall = useMemo(() => isCallFeatureAllowed(user, profile), [user, profile]);

  const [activeCall, setActiveCall] = useState(null);
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  // CallModal owns ringtone teardown that only runs while it is mounted, so it
  // stays mounted for the rest of the session once the first call happens.
  const [hasOpenedCall, setHasOpenedCall] = useState(false);

  useEffect(() => {
    if (isCallModalOpen) setHasOpenedCall(true);
  }, [isCallModalOpen]);

  const activeCallRef = useRef(null);
  activeCallRef.current = activeCall;

  const callTimeoutTimerRef = useRef(null);

  // Clear timeout timer
  const clearCallTimeout = useCallback(() => {
    if (callTimeoutTimerRef.current) {
      clearTimeout(callTimeoutTimerRef.current);
      callTimeoutTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (currentUserId) return undefined;
    clearCallTimeout();
    setActiveCall(null);
    setIsCallModalOpen(false);
    return undefined;
  }, [clearCallTimeout, currentUserId]);

  // Write call summary record to chat conversation
  const recordCallInChat = useCallback(
    async (call, durationSeconds = 0) => {
      if (!call?.conversationId || !sendMessage) return;
      try {
        const isVoice = call.callType === CALL_TYPES.VOICE;
        const typeLabel = isVoice ? 'การโทรด้วยเสียง' : 'วิดีโอคอล';
        const callId = call.id || call.callId;

        const now = new Date();
        const thaiMillis = now.getTime() + 7 * 60 * 60 * 1000;
        const thaiDate = new Date(thaiMillis);
        const hours = String(thaiDate.getUTCHours()).padStart(2, '0');
        const minutes = String(thaiDate.getUTCMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${minutes}`;

        let callText = '';
        let callStatus = call.status || 'ended';

        const isCaller = call.callerId === currentUserId;
        if (call.status === CALL_STATUS.MISSED || call.endReason === 'timeout') {
          callText = `ไม่ได้รับสาย (${typeLabel}) • ${timeStr}`;
          callStatus = 'missed';
        } else if (call.status === CALL_STATUS.BUSY || call.endReason === 'busy') {
          callText = `สายไม่ว่าง (${typeLabel}) • ${timeStr}`;
          callStatus = 'busy';
        } else if (call.status === CALL_STATUS.REJECTED || call.endReason === 'declined') {
          callText = `สายถูกปฏิเสธ (${typeLabel}) • ${timeStr}`;
          callStatus = 'rejected';
        } else if (durationSeconds > 0) {
          callText = `${typeLabel}สิ้นสุดลงแล้ว • ${timeStr} (${formatCallDuration(durationSeconds)})`;
          callStatus = 'ended';
        } else if (durationSeconds === 0 && (call.status === CALL_STATUS.CALLING || call.status === CALL_STATUS.RINGING || call.endReason === 'hangup' || call.endReason === 'canceled')) {
          callText = isCaller ? `ยกเลิกการโทร (${typeLabel}) • ${timeStr}` : `ไม่ได้รับสาย (${typeLabel}) • ${timeStr}`;
          callStatus = isCaller ? 'canceled' : 'missed';
        } else {
          callText = `${typeLabel}สิ้นสุดลงแล้ว • ${timeStr}`;
          callStatus = 'ended';
        }

        await sendMessage(call.conversationId, callText, {
          clientMessageId: callId ? `call-summary-${callId}` : undefined,
          mediaType: 'call',
          callType: call.callType || 'voice',
          callDuration: durationSeconds,
          callStatus,
          callTime: timeStr,
        });
      } catch (err) {
        console.warn('[CallContext] Failed to log call in chat:', err);
      }
    },
    [currentUserId, sendMessage]
  );

  // Start outgoing call
  const startCall = useCallback(
    async ({ receiverId, receiverProfile, callerProfile, callType, conversationId }) => {
      const myId = currentUserId;
      if (!myId) {
        showAlert('กรุณาเข้าสู่ระบบ', 'ต้องเข้าสู่ระบบก่อนทำการโทร', { tone: 'warning' });
        return;
      }
      if (!isCallFeatureAllowed(user, profile)) {
        showAlert(
          'ฟีเจอร์การโทรอยู่ในช่วงทดลอง',
          'ระบบการโทรและวิดีโอคอลเปิดให้ใช้งานเฉพาะบัญชีที่ได้รับเลือกเท่านั้น',
          { tone: 'info' }
        );
        return;
      }
      if (!receiverId) {
        showAlert('ไม่สามารถโทรได้', 'ไม่พบข้อมูลคู่สนทนาในห้องแชตนี้', { tone: 'danger' });
        return;
      }
      if (receiverId === myId) {
        showAlert('ไม่สามารถโทรได้', 'ไม่สามารถโทรหาตนเองได้', { tone: 'danger' });
        return;
      }

      if (Platform.OS === 'android') {
        try {
          const { PermissionsAndroid } = require('react-native');
          const hasMic = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
          if (!hasMic) {
            const reqMic = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
            if (reqMic !== PermissionsAndroid.RESULTS.GRANTED) {
              showAlert('ต้องใช้สิทธิ์ไมโครโฟน', 'กรุณาอนุญาตการเข้าถึงไมโครโฟนเพื่อทำการโทร', { tone: 'warning' });
              return;
            }
          }
          if (callType === CALL_TYPES.VIDEO) {
            const hasCam = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
            if (!hasCam) {
              const reqCam = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
              if (reqCam !== PermissionsAndroid.RESULTS.GRANTED) {
                showAlert('ต้องใช้สิทธิ์กล้อง', 'กรุณาอนุญาตการเข้าถึงกล้องเพื่อใช้วิดีโอคอล', { tone: 'warning' });
                return;
              }
            }
          }
        } catch (permErr) {
          console.warn('[CallContext] Pre-flight permission check failed:', permErr);
        }
      }

      const myProfile = callerProfile || {
        ...profile,
        avatarUri:
          profile?.avatarUri ||
          profile?.photoURL ||
          profile?.photoUrl ||
          profile?.photos?.[0] ||
          user?.photoURL ||
          null,
      };

      try {
        const newCall = await initiateCall({
          callerId: myId,
          receiverId,
          callerProfile: myProfile,
          receiverProfile,
          callType,
          conversationId,
        });

        setActiveCall(newCall);
        setIsCallModalOpen(true);

        // Set timeout to automatically mark as missed if not answered in 45s
        clearCallTimeout();
        callTimeoutTimerRef.current = setTimeout(async () => {
          const current = activeCallRef.current;
          if (current?.id === newCall.callId && (current.status === CALL_STATUS.CALLING || current.status === CALL_STATUS.RINGING)) {
            await markCallMissed(newCall.callId);
            recordCallInChat(newCall, 0);
          }
        }, CALL_TIMEOUT_MS);
      } catch (err) {
        console.error('[CallContext] Failed to start call:', err);
        showAlert('เกิดข้อผิดพลาดในการโทร', err?.message || 'ไม่สามารถเชื่อมต่อสัญญาณการโทรได้ กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
      }
    },
    [currentUserId, profile, user, clearCallTimeout, recordCallInChat]
  );

  const startVoiceCall = useCallback(
    (target, conversationId) => {
      const myId = currentUserId;
      const receiverId =
        (target?.participants && target.participants.find((uid) => uid !== myId)) ||
        target?.profileId ||
        (target?.id && !String(target.id).startsWith('c-') ? target.id : null);

      const participantP = (receiverId && target?.participantProfiles?.[receiverId]) || {};
      const receiverProfile = {
        ...target,
        ...participantP,
        name: participantP.name || participantP.nickname || target?.name || target?.nickname || 'คู่สนทนา',
        avatarUri:
          participantP.avatarUri ||
          participantP.photoURL ||
          participantP.photoUrl ||
          participantP.photos?.[0] ||
          target?.avatarUri ||
          target?.photoURL ||
          target?.photoUrl ||
          target?.photos?.[0] ||
          (typeof target?.avatar === 'string' && (target.avatar.startsWith('http') || target.avatar.startsWith('file:') || target.avatar.startsWith('data:')) ? target.avatar : null) ||
          null,
        avatarColor: participantP.avatarColor || target?.avatarColor || '#3B5AFE',
        avatar: participantP.avatar || target?.avatar || '👤',
      };

      startCall({
        receiverId,
        receiverProfile,
        callType: CALL_TYPES.VOICE,
        conversationId: conversationId || (target?.id && String(target.id).startsWith('c-') ? target.id : null),
      });
    },
    [startCall, currentUserId]
  );

  const startVideoCall = useCallback(
    (target, conversationId) => {
      const myId = currentUserId;
      const receiverId =
        (target?.participants && target.participants.find((uid) => uid !== myId)) ||
        target?.profileId ||
        (target?.id && !String(target.id).startsWith('c-') ? target.id : null);

      const participantP = (receiverId && target?.participantProfiles?.[receiverId]) || {};
      const receiverProfile = {
        ...target,
        ...participantP,
        name: participantP.name || participantP.nickname || target?.name || target?.nickname || 'คู่สนทนา',
        avatarUri:
          participantP.avatarUri ||
          participantP.photoURL ||
          participantP.photoUrl ||
          participantP.photos?.[0] ||
          target?.avatarUri ||
          target?.photoURL ||
          target?.photoUrl ||
          target?.photos?.[0] ||
          (typeof target?.avatar === 'string' && (target.avatar.startsWith('http') || target.avatar.startsWith('file:') || target.avatar.startsWith('data:')) ? target.avatar : null) ||
          null,
        avatarColor: participantP.avatarColor || target?.avatarColor || '#3B5AFE',
        avatar: participantP.avatar || target?.avatar || '👤',
      };

      startCall({
        receiverId,
        receiverProfile,
        callType: CALL_TYPES.VIDEO,
        conversationId: conversationId || (target?.id && String(target.id).startsWith('c-') ? target.id : null),
      });
    },
    [startCall, currentUserId]
  );

  // Accept incoming call
  const handleAcceptCall = useCallback(async () => {
    if (!activeCall?.id) return;
    clearCallTimeout();
    dismissIncomingCallNotification(activeCall.id);
    try {
      await acceptCall(activeCall.id);
    } catch (err) {
      console.error('[CallContext] Failed to accept call:', err);
    }
  }, [activeCall, clearCallTimeout]);

  // Reject incoming call
  const handleRejectCall = useCallback(
    async (reason = 'declined') => {
      if (!activeCall?.id) return;
      clearCallTimeout();
      dismissIncomingCallNotification(activeCall.id);
      try {
        await rejectCall(activeCall.id, reason);
        recordCallInChat(activeCall, 0);
      } catch (err) {
        console.error('[CallContext] Failed to reject call:', err);
      }
    },
    [activeCall, clearCallTimeout, recordCallInChat]
  );

  // End active call
  const handleEndCall = useCallback(
    async (durationSeconds = 0) => {
      if (!activeCall?.id) return;
      clearCallTimeout();
      dismissIncomingCallNotification(activeCall.id);
      try {
        await endCall(activeCall.id, durationSeconds);
        recordCallInChat(activeCall, durationSeconds);
      } catch (err) {
        console.error('[CallContext] Failed to end call:', err);
      }
    },
    [activeCall, clearCallTimeout, recordCallInChat]
  );

  // Close modal cleanup
  const handleCloseModal = useCallback(() => {
    clearCallTimeout();
    if (activeCall?.id) {
      dismissIncomingCallNotification(activeCall.id);
    }
    setIsCallModalOpen(false);
    setActiveCall(null);
  }, [activeCall?.id, clearCallTimeout]);

  // Subscribe to incoming calls
  useEffect(() => {
    if (!currentUserId) return;

    const unsubscribe = subscribeToIncomingCalls(currentUserId, (incomingCall) => {
      if (incomingCall && !activeCallRef.current) {
        setActiveCall(incomingCall);
        setIsCallModalOpen(true);
        // Let the caller know the phone is ringing
        setCallRinging(incomingCall.id);

        // Receiver auto-missed timeout
        clearCallTimeout();
        callTimeoutTimerRef.current = setTimeout(async () => {
          const current = activeCallRef.current;
          if (current?.id === incomingCall.id && (current.status === CALL_STATUS.CALLING || current.status === CALL_STATUS.RINGING)) {
            // Caller owns the missed-call chat row; receiver only marks signaling state.
            await markCallMissed(incomingCall.id);
          }
        }, CALL_TIMEOUT_MS);
      } else if (incomingCall && activeCallRef.current && incomingCall.id !== activeCallRef.current.id) {
        // Automatically respond busy if already in another call
        rejectCall(incomingCall.id, 'busy').catch(() => {});
      }
    });

    return () => {
      unsubscribe();
      clearCallTimeout();
    };
  }, [currentUserId, clearCallTimeout, recordCallInChat]);

  // Subscribe to active call state updates
  useEffect(() => {
    if (!activeCall?.id) return;

    const unsubscribe = subscribeToCall(activeCall.id, (updated) => {
      if (!updated) {
        handleCloseModal();
        return;
      }
      setActiveCall(updated);
    });

    return () => {
      unsubscribe();
    };
  }, [activeCall?.id, handleCloseModal]);

  // Open incoming call triggered by notification tap
  const openIncomingCallFromNotification = useCallback(
    async (callId, fallbackData = null) => {
      if (!callId && !fallbackData) return;
      try {
        let callObj = null;
        if (callId) {
          callObj = await getCall(callId);
        }
        if (callObj && (callObj.status === CALL_STATUS.CALLING || callObj.status === CALL_STATUS.RINGING || callObj.status === CALL_STATUS.CONNECTED)) {
          setActiveCall(callObj);
          setIsCallModalOpen(true);
        } else if (fallbackData) {
          setActiveCall(fallbackData);
          setIsCallModalOpen(true);
        }
      } catch (err) {
        console.warn('[CallContext] openIncomingCallFromNotification error:', err);
        if (fallbackData) {
          setActiveCall(fallbackData);
          setIsCallModalOpen(true);
        }
      }
    },
    []
  );

  const value = useMemo(
    () => ({
      activeCall,
      isCallActive: Boolean(activeCall),
      canCall,
      startVoiceCall,
      startVideoCall,
      acceptCall: handleAcceptCall,
      rejectCall: handleRejectCall,
      endCall: handleEndCall,
      openIncomingCallFromNotification,
    }),
    [activeCall, canCall, startVoiceCall, startVideoCall, handleAcceptCall, handleRejectCall, handleEndCall, openIncomingCallFromNotification]
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      {hasOpenedCall ? (
        <Suspense fallback={null}>
          <CallModal
            availableProfiles={availableProfiles}
            callData={activeCall}
            conversations={conversations}
            currentUserId={currentUserId}
            isOpen={isCallModalOpen}
            onAccept={handleAcceptCall}
            onClose={handleCloseModal}
            onEnd={handleEndCall}
            onReject={handleRejectCall}
          />
        </Suspense>
      ) : null}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return ctx;
}
