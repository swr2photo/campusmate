import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert } from 'react-native';
import { useAuth } from './AuthContext';
import { useApp } from './AppContext';
import CallModal from '../components/CallModal';
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

const CallContext = createContext(null);

const CALL_TIMEOUT_MS = 45000; // 45 seconds timeout for unanswered calls

export function CallProvider({ children }) {
  const { user } = useAuth();
  const { profile, sendMessage, availableProfiles, conversations, activeConversations } = useApp();
  const currentUserId = user?.id || user?.uid || profile?.id || null;

  const [activeCall, setActiveCall] = useState(null);
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);

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

  // Write call summary record to chat conversation
  const recordCallInChat = useCallback(
    async (call, durationSeconds = 0) => {
      if (!call?.conversationId || !sendMessage) return;
      try {
        const isVoice = call.callType === CALL_TYPES.VOICE;
        const typeLabel = isVoice ? 'การโทรด้วยเสียง' : 'วิดีโอคอล';

        const now = new Date();
        const thaiMillis = now.getTime() + 7 * 60 * 60 * 1000;
        const thaiDate = new Date(thaiMillis);
        const hours = String(thaiDate.getUTCHours()).padStart(2, '0');
        const minutes = String(thaiDate.getUTCMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${minutes}`;

        let callText = '';
        let callStatus = call.status || 'ended';

        if (call.status === CALL_STATUS.MISSED || call.endReason === 'timeout') {
          callText = `ไม่ได้รับสาย (${typeLabel}) • ${timeStr}`;
          callStatus = 'missed';
        } else if (call.status === CALL_STATUS.REJECTED || call.endReason === 'declined') {
          callText = `สายถูกปฏิเสธ (${typeLabel}) • ${timeStr}`;
          callStatus = 'rejected';
        } else if (durationSeconds > 0) {
          callText = `${typeLabel}สิ้นสุดลงแล้ว • ${timeStr} (${formatCallDuration(durationSeconds)})`;
          callStatus = 'ended';
        } else {
          callText = `${typeLabel}สิ้นสุดลงแล้ว • ${timeStr}`;
          callStatus = 'ended';
        }

        await sendMessage(call.conversationId, callText, {
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
    [sendMessage]
  );

  // Start outgoing call
  const startCall = useCallback(
    async ({ receiverId, receiverProfile, callerProfile, callType, conversationId }) => {
      const myId = currentUserId || user?.id || user?.uid || profile?.id;
      if (!myId) {
        Alert.alert('กรุณาเข้าสู่ระบบ', 'ต้องเข้าสู่ระบบก่อนทำการโทร');
        return;
      }
      if (!receiverId) {
        Alert.alert('ไม่สามารถโทรได้', 'ไม่พบข้อมูลคู่สนทนาในห้องแชตนี้');
        return;
      }
      if (receiverId === myId) {
        Alert.alert('ไม่สามารถโทรได้', 'ไม่สามารถโทรหาตนเองได้');
        return;
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
        Alert.alert('เกิดข้อผิดพลาดในการโทร', err?.message || 'ไม่สามารถเชื่อมต่อสัญญาณการโทรได้ กรุณาลองใหม่อีกครั้ง');
      }
    },
    [currentUserId, user, profile, clearCallTimeout, recordCallInChat]
  );

  const startVoiceCall = useCallback(
    (target, conversationId) => {
      const myId = currentUserId || user?.id || user?.uid || profile?.id;
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
    [startCall, currentUserId, user, profile]
  );

  const startVideoCall = useCallback(
    (target, conversationId) => {
      const myId = currentUserId || user?.id || user?.uid || profile?.id;
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
    [startCall, currentUserId, user, profile]
  );

  // Accept incoming call
  const handleAcceptCall = useCallback(async () => {
    if (!activeCall?.id) return;
    clearCallTimeout();
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
    setIsCallModalOpen(false);
    setActiveCall(null);
  }, [clearCallTimeout]);

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
            await markCallMissed(incomingCall.id);
            recordCallInChat(incomingCall, 0);
          }
        }, CALL_TIMEOUT_MS);
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
      startVoiceCall,
      startVideoCall,
      acceptCall: handleAcceptCall,
      rejectCall: handleRejectCall,
      endCall: handleEndCall,
      openIncomingCallFromNotification,
    }),
    [activeCall, startVoiceCall, startVideoCall, handleAcceptCall, handleRejectCall, handleEndCall, openIncomingCallFromNotification]
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallModal
        availableProfiles={availableProfiles}
        callData={activeCall}
        conversations={activeConversations || conversations}
        currentUserId={currentUserId}
        isOpen={isCallModalOpen}
        onAccept={handleAcceptCall}
        onClose={handleCloseModal}
        onEnd={handleEndCall}
        onReject={handleRejectCall}
      />
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
