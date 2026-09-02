import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import NetInfo from '@react-native-community/netinfo';
import { ActivityIndicator, ImageBackground, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from './AuthContext';
import FeatureIcon from '../components/FeatureIcon';
import { requireFirebase } from '../services/dbService';
import {
  createConversation,
  createSharedProfilesSubscription,
  deleteConversation,
  createUserProfile,
  getUserProfile,
  getSpotDistanceFromUser,
  formatDistance,
  resetSkippedDecisions,
  respondToDecision,
  saveDecision,
  subscribeToAvailableProfiles,
  subscribeToConversations,
  subscribeToIncomingLikes,
  subscribeToSpots,
  updateConversationMessage,
  markConversationAsRead,
  toggleMeetupAcceptance,
  deleteMessageForUser,
  unsendMessage,
  reactToMessage,
  updateChatSettings,
  uploadImage,
} from '../services/firestoreService';
import {
  enqueueOfflineOperation,
  flushOfflineQueue,
  getOfflineQueueCount,
  isRetryableNetworkError,
  loadOfflineSnapshot,
  saveOfflineSnapshot,
} from '../services/offlineStorage';
import { CAMPUS_SPOTS } from '../data/campusSpots';
import { saveAccount } from '../services/accountStorage';
import AppSplashScreen from '../components/AppSplashScreen';
import ConsentModal from '../components/ConsentModal';
import { deleteAccountData } from '../services/deleteAccount';

const loginHeroPhoto = require('../../assets/login-campus-hero.png');

const AppContext = createContext(null);

const defaultPrivacy = {
  showAge: true,
  showGender: true,
  showFaculty: true,
  showActivity: true,
  showAvailability: true,
  showLocation: true,
};

const defaultMatchingPreferences = {
  ageMin: 18,
  ageMax: 35,
  genders: [],
  years: [],
  activities: [],
  faculty: 'all',
  sameFacultyOnly: false,
  maxDistance: 25,
};

function normalizeCoordinate(value, min, max) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max ? coordinate : null;
}

function withProfileDefaults(profile) {
  return {
    ...profile,
    privacy: { ...defaultPrivacy, ...(profile.privacy || {}) },
    matchingPreferences: {
      ...defaultMatchingPreferences,
      ...(profile.matchingPreferences || {}),
    },
  };
}

function createClientMessageId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildOptimisticConversation(userId, currentProfile, candidate) {
  const participantIds = [userId, candidate.id].sort();
  return {
    id: `c-${participantIds.join('-')}`,
    participants: participantIds,
    participantProfiles: {
      [userId]: currentProfile,
      [candidate.id]: candidate,
    },
    profileId: candidate.id,
    name: candidate.nickname || candidate.name || 'ผู้ใช้ CampusMate',
    avatar: candidate.avatar,
    avatarColor: candidate.avatarColor,
    avatarUri: candidate.avatarUri,
    subtitle: [candidate.faculty, candidate.year].filter(Boolean).join(' · '),
    unreadCounts: { [userId]: 0, [candidate.id]: 0 },
    lastMessage: 'เริ่มบทสนทนาได้เลย',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pendingSync: true,
  };
}

async function persistProfileToFirestore(userId, profileData) {
  const nextProfile = { ...profileData };
  if (
    nextProfile.avatarUri
    && (nextProfile.avatarUri.startsWith('data:image') || nextProfile.avatarUri.startsWith('file:'))
  ) {
    nextProfile.avatarUri = await uploadImage(nextProfile.avatarUri, userId);
  }
  await createUserProfile(userId, nextProfile);
  return nextProfile;
}

async function persistLikeResponse(userId, currentProfile, candidate, response) {
  if (response === 'accept') {
    await Promise.all([
      respondToDecision(candidate.decisionId, userId, 'accepted'),
      saveDecision(userId, candidate.id, 'like', '', 'accepted'),
    ]);
    await createConversation(userId, currentProfile, candidate);
    return;
  }

  const skipStatus = candidate.status === 'accepted' ? 'removed' : 'pending';
  const { db } = requireFirebase();
  const reverseDecisionRef = doc(db, 'decisions', `${candidate.id}_${userId}`);
  await Promise.all([
    respondToDecision(candidate.decisionId, userId, 'rejected'),
    saveDecision(userId, candidate.id, 'skip', '', skipStatus),
    getDocs(query(collection(db, 'decisions'), where('fromUserId', '==', candidate.id), where('toUserId', '==', userId)))
      .then((snapshot) => {
        const reverseDoc = snapshot.docs[0];
        if (!reverseDoc || reverseDoc.data().type !== 'like') return null;
        return updateDoc(reverseDecisionRef, {
          status: 'rejected',
          updatedAt: serverTimestamp(),
        });
      }),
  ]);
  const participantIds = [userId, candidate.id].sort();
  await deleteConversation(`c-${participantIds.join('-')}`);
}

async function executeQueuedOperation(operation) {
  const { payload = {}, type, userId } = operation;
  switch (type) {
    case 'saveProfile':
      return persistProfileToFirestore(userId, payload.profile);
    case 'saveDecision':
      return saveDecision(userId, payload.otherUserId, payload.decisionType, payload.likeMessage, payload.status);
    case 'matchProfile': {
      const result = await saveDecision(userId, payload.candidate.id, 'like', '', 'pending');
      if (result?.matched) await createConversation(userId, payload.profile, payload.candidate);
      return result;
    }
    case 'respondToLike':
      return persistLikeResponse(userId, payload.profile, payload.candidate, payload.response);
    case 'resetMatching': {
      const { db } = requireFirebase();
      const outgoingQuery = query(collection(db, 'decisions'), where('fromUserId', '==', userId));
      const snapshot = await getDocs(outgoingQuery);
      return Promise.all(snapshot.docs.map((decisionDoc) => deleteDoc(decisionDoc.ref)));
    }
    case 'resetSkippedDecisions':
      return resetSkippedDecisions(userId);
    case 'createConversation':
      return createConversation(userId, payload.profile, payload.candidate);
    case 'sendMessage':
      return updateConversationMessage(payload.conversationId, userId, payload.text, payload.options);
    case 'markConversationAsRead':
      return markConversationAsRead(payload.conversationId, userId);
    case 'toggleMeetupAcceptance':
      return toggleMeetupAcceptance(payload.conversationId, userId, payload.hostUserId, payload.spotName, payload.options);
    case 'updateChatSettings':
      return updateChatSettings(payload.conversationId, userId, payload.settings);
    case 'unsendMessage':
      return unsendMessage(payload.conversationId, payload.messageId, userId);
    case 'deleteMessageForUser':
      return deleteMessageForUser(payload.conversationId, payload.messageId, userId);
    case 'reactToMessage':
      return reactToMessage(payload.conversationId, payload.messageId, userId, payload.emoji, payload.desiredReaction);
    default:
      throw Object.assign(new Error(`Unknown offline operation: ${type}`), { code: 'invalid-argument' });
  }
}

/**
 * แปลง date string (YYYY-MM-DD) เป็นข้อความภาษาไทย เช่น "จ. 1 ก.ย."
 */
function formatScheduleDate(dateStr) {
  if (!dateStr) return 'ยังไม่ได้เลือกวัน';
  const date = new Date(dateStr + 'T00:00:00');
  const days = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
}

export function AppProvider({ children }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [availableProfiles, setAvailableProfiles] = useState([]);
  const [campusSpots, setCampusSpots] = useState([]);
  const [incomingLikes, setIncomingLikes] = useState([]);
  const [selectedMeetup, setSelectedMeetup] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const [optimisticHiddenIds, setOptimisticHiddenIds] = useState([]);
  const [isOnline, setIsOnline] = useState(true);
  const [networkReady, setNetworkReady] = useState(false);
  const [cacheHydratedUserId, setCacheHydratedUserId] = useState(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [lastSyncError, setLastSyncError] = useState(null);
  const [showConsent, setShowConsent] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const previousOnlineRef = useRef(true);
  const networkReadyRef = useRef(false);
  const flushingQueueRef = useRef(false);

  useEffect(() => {
    let active = true;
    const updateNetworkState = (state) => {
      if (!active) return;
      // Treat isInternetReachable === null as online (optimistic).
      // On Android, NetInfo often reports null before the first connectivity
      // probe completes, which would block data subscriptions unnecessarily.
      const nextOnline = state.isConnected !== false && state.isInternetReachable !== false;
      if (networkReadyRef.current && !previousOnlineRef.current && nextOnline) {
        setRetryKey((current) => current + 1);
      }
      previousOnlineRef.current = nextOnline;
      networkReadyRef.current = true;
      setIsOnline(nextOnline);
      setNetworkReady(true);
    };
    const unsubscribe = NetInfo.addEventListener(updateNetworkState);
    NetInfo.fetch().then(updateNetworkState).catch(() => setNetworkReady(true));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!user?.id) {
      setCacheHydratedUserId(null);
      setPendingSyncCount(0);
      return undefined;
    }

    const userId = user.id;
    setCacheHydratedUserId(null);
    setProfile(null);
    setConversations([]);
    setAvailableProfiles([]);
    setIncomingLikes([]);
    setCampusSpots([]);
    setSelectedMeetup(null);
    setOptimisticHiddenIds([]);

    Promise.all([loadOfflineSnapshot(userId), getOfflineQueueCount(userId)])
      .then(([snapshot, queueCount]) => {
        if (!active) return;
        if (snapshot) {
          const cachedProfile = snapshot.profile ? withProfileDefaults(snapshot.profile) : null;
          setProfile(cachedProfile);
          setConversations(Array.isArray(snapshot.conversations) ? snapshot.conversations : []);
          setAvailableProfiles(Array.isArray(snapshot.availableProfiles) ? snapshot.availableProfiles : []);
          setIncomingLikes(Array.isArray(snapshot.incomingLikes) ? snapshot.incomingLikes : []);
          setCampusSpots(Array.isArray(snapshot.campusSpots) ? snapshot.campusSpots : []);
          setSelectedMeetup(snapshot.selectedMeetup || cachedProfile?.meetup || null);
          setOptimisticHiddenIds(Array.isArray(snapshot.optimisticHiddenIds) ? snapshot.optimisticHiddenIds : []);
          setLastSyncedAt(snapshot.cachedAt || null);
        }
        setPendingSyncCount(queueCount);
      })
      .catch((error) => console.warn('[Offline] Cache hydration failed:', error))
      .finally(() => {
        if (active) setCacheHydratedUserId(userId);
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    let active = true;

    if (!user?.id) {
      setProfile(null);
      setProfileLoading(false);
      setConversations([]);
      setAvailableProfiles([]);
      setIncomingLikes([]);
      setCampusSpots([]);
      setDataError(null);
      return undefined;
    }

    if (cacheHydratedUserId !== user.id) return undefined;
    if (!isOnline) {
      setProfileLoading(false);
      setDataError(null);
      return undefined;
    }
    if (pendingSyncCount > 0) {
      setProfileLoading(false);
      return undefined;
    }

    if (!profile) setProfileLoading(true);
    setDataError(null);
    getUserProfile(user.id)
      .then(async (storedProfile) => {
        if (!active) return;

        // Request GPS Location
        let lat = null;
        let lon = null;
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            lat = loc.coords.latitude;
            lon = loc.coords.longitude;
          }
        } catch (e) {
          console.log("Location fetch error:", e);
        }

        if (storedProfile) {
          const defaults = withProfileDefaults(storedProfile);
          if (lat != null && lon != null) {
            defaults.latitude = lat;
            defaults.longitude = lon;
            createUserProfile(user.id, defaults).catch(e => console.log('Failed to save location', e));
          }
          if (defaults.meetup) {
            setSelectedMeetup(defaults.meetup);
          }
          saveAccount({
            id: user.id,
            email: user.email || defaults.email,
            displayName: defaults.nickname || defaults.name || user.displayName,
            photoURL: defaults.avatarUri || defaults.photos?.[0] || user.photoURL,
            faculty: defaults.faculty || '',
          });
          setProfile(defaults);
          return;
        }

        const newProfile = withProfileDefaults({
          id: user.id,
          email: user.email || '',
          name: user.displayName || '',
          nickname: '',
          avatarUri: user.photoURL || '',
          bio: '',
          isDiscoverable: true,
          isNewUser: true,
          notificationsEnabled: true,
          ...(lat != null && lon != null ? { latitude: lat, longitude: lon } : {}),
        });
        await createUserProfile(user.id, newProfile);
        if (active) setProfile(newProfile);
      })
      .catch((error) => {
        if (!active) return;
        if (!profile) setDataError(error);
        else if (!isRetryableNetworkError(error)) console.warn('[AppContext] Profile refresh failed:', error);
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });

    return () => {
      active = false;
    };
  }, [cacheHydratedUserId, isOnline, pendingSyncCount, retryKey, user]);

  // Shared profiles state — one listener feeds both available profiles and incoming likes
  const [sharedProfiles, setSharedProfiles] = useState([]);

  useEffect(() => {
    if (!user?.id || !isOnline || pendingSyncCount > 0 || cacheHydratedUserId !== user.id) return undefined;
    const handleError = (error) => {
      console.error('[AppContext] Subscription error:', error);
      if (!isRetryableNetworkError(error)) setDataError(error);
    };
    console.log('[AppContext] Starting core subscriptions for user:', user.id);
    const unsubscribers = [
      subscribeToSpots(setCampusSpots, handleError),
      subscribeToConversations(user.id, (convs) => {
        console.log('[AppContext] setConversations called with', convs.length, 'items');
        setConversations(convs);
      }, handleError),
      // Single shared profiles listener (replaces two separate listeners)
      createSharedProfilesSubscription(setSharedProfiles, handleError),
    ];
    return () => {
      console.log('[AppContext] Cleaning up core subscriptions for user:', user.id);
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
      setSharedProfiles([]);
    };
  }, [cacheHydratedUserId, isOnline, pendingSyncCount, retryKey, user?.id]);

  // Incoming likes — derived from shared profiles + decisions listener
  useEffect(() => {
    if (!user?.id || !isOnline || pendingSyncCount > 0 || cacheHydratedUserId !== user.id || sharedProfiles.length === 0) return undefined;
    const handleError = (error) => {
      console.error('[AppContext] Incoming likes error:', error);
      if (!isRetryableNetworkError(error)) setDataError(error);
    };
    const unsubscribe = subscribeToIncomingLikes(user.id, sharedProfiles, (likes) => {
      console.log('[AppContext] setIncomingLikes called with', likes.length, 'items');
      setIncomingLikes(likes);
    }, handleError);
    return () => {
      unsubscribe?.();
    };
  }, [cacheHydratedUserId, isOnline, pendingSyncCount, retryKey, sharedProfiles, user?.id]);

  // Available profiles — derived from shared profiles + decisions + preferences
  useEffect(() => {
    if (!user?.id || !profile || !isOnline || pendingSyncCount > 0 || cacheHydratedUserId !== user.id || sharedProfiles.length === 0) return undefined;
    const handleError = (error) => {
      console.error('[AppContext] Available profiles error:', error);
      if (!isRetryableNetworkError(error)) setDataError(error);
    };
    const preferences = {
      ...profile.matchingPreferences,
      currentFaculty: profile.faculty || '',
    };
    const unsubscribe = subscribeToAvailableProfiles(user.id, preferences, sharedProfiles, setAvailableProfiles, handleError);
    return () => {
      unsubscribe?.();
    };
  }, [cacheHydratedUserId, isOnline, pendingSyncCount, profile?.faculty, profile?.matchingPreferences, retryKey, sharedProfiles, user?.id]);

  useEffect(() => {
    if (!user?.id || cacheHydratedUserId !== user.id) return undefined;
    const timer = setTimeout(() => {
      void saveOfflineSnapshot(user.id, {
        profile,
        conversations,
        availableProfiles,
        incomingLikes,
        campusSpots,
        selectedMeetup,
        optimisticHiddenIds,
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [availableProfiles, cacheHydratedUserId, campusSpots, conversations, incomingLikes, optimisticHiddenIds, profile, selectedMeetup, user?.id]);

  const refreshQueueCount = useCallback(async () => {
    if (!user?.id) return 0;
    const count = await getOfflineQueueCount(user.id);
    setPendingSyncCount(count);
    return count;
  }, [user?.id]);

  const queueOperation = useCallback(async (type, payload, options) => {
    if (!user?.id) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งานออฟไลน์');
    await enqueueOfflineOperation(user.id, type, payload, options);
    await refreshQueueCount();
    return { queued: true };
  }, [refreshQueueCount, user?.id]);

  const runOrQueue = useCallback(async (type, payload, execute, options) => {
    if (!isOnline) return queueOperation(type, payload, options);
    try {
      return await execute();
    } catch (error) {
      if (!isRetryableNetworkError(error)) throw error;
      setLastSyncError(error);
      return queueOperation(type, payload, options);
    }
  }, [isOnline, queueOperation]);

  const syncNow = useCallback(async () => {
    if (!user?.id || !isOnline || flushingQueueRef.current) return;
    flushingQueueRef.current = true;
    setIsSyncing(true);
    setLastSyncError(null);
    try {
      const result = await flushOfflineQueue(user.id, executeQueuedOperation);
      setPendingSyncCount(result.pendingCount);
      if (result.syncedCount > 0) {
        setLastSyncedAt(Date.now());
        setRetryKey((current) => current + 1);
      }
      if (result.retryableError) setLastSyncError(result.retryableError);
      else if (result.failed.length) setLastSyncError(result.failed[0].error);
    } catch (error) {
      setLastSyncError(error);
      await refreshQueueCount();
    } finally {
      flushingQueueRef.current = false;
      setIsSyncing(false);
    }
  }, [isOnline, refreshQueueCount, user?.id]);

  useEffect(() => {
    if (isOnline && cacheHydratedUserId === user?.id) void syncNow();
  }, [cacheHydratedUserId, isOnline, syncNow, user?.id]);

  useEffect(() => {
    if (
      !isOnline
      || isSyncing
      || pendingSyncCount === 0
      || cacheHydratedUserId !== user?.id
    ) return undefined;

    // NetInfo triggers an immediate flush when connectivity returns. This
    // fallback also handles short Firestore outages where the device itself
    // never reports an offline transition.
    const retryTimer = setTimeout(() => {
      void syncNow();
    }, lastSyncError ? 15000 : 1000);
    return () => clearTimeout(retryTimer);
  }, [cacheHydratedUserId, isOnline, isSyncing, lastSyncError, pendingSyncCount, syncNow, user?.id]);

  const pendingIncomingLikes = useMemo(
    () => incomingLikes.filter((item) => item.status === 'pending'),
    [incomingLikes]
  );
  const acceptedIncomingLikes = useMemo(
    () => incomingLikes.filter((item) => item.status === 'accepted'),
    [incomingLikes]
  );
  const matchedProfileIds = useMemo(() => {
    const ids = conversations.flatMap((conversation) => {
      if (conversation.profileId) return [conversation.profileId];
      if (Array.isArray(conversation.participants)) {
        return conversation.participants.filter((participantId) => participantId && participantId !== user?.id);
      }
      return [];
    });
    return [...new Set(ids)];
  }, [conversations, user?.id]);

  const dismissProfile = async (profileId) => {
    if (!user?.id || !profileId) return;
    setOptimisticHiddenIds((prev) => [...prev, profileId]);
    return runOrQueue(
      'saveDecision',
      { otherUserId: profileId, decisionType: 'skip', likeMessage: '', status: 'pending' },
      () => saveDecision(user.id, profileId, 'skip'),
      { dedupeKey: `decision:${profileId}` }
    );
  };

  const resetMatching = async () => {
    if (!user?.id) return;
    setOptimisticHiddenIds([]);

    return runOrQueue('resetMatching', {}, async () => {
      const { db } = requireFirebase();
      const outgoingQuery = query(collection(db, 'decisions'), where('fromUserId', '==', user.id));
      const snapshot = await getDocs(outgoingQuery);
      await Promise.all(snapshot.docs.map((decisionDoc) => deleteDoc(decisionDoc.ref)));
    }, { dedupeKey: 'resetMatching' });
  };

  const recycleSkippedProfiles = async () => {
    if (!user?.id) return;
    setOptimisticHiddenIds([]);
    return runOrQueue(
      'resetSkippedDecisions',
      {},
      () => resetSkippedDecisions(user.id),
      { dedupeKey: 'resetSkippedDecisions' }
    );
  };

  const respondToLike = async (candidate, response) => {
    if (!user?.id || !candidate?.decisionId || !['accept', 'reject'].includes(response)) return;
    const previousLikes = incomingLikes;
    setIncomingLikes((current) => current.filter((item) => item.decisionId !== candidate.decisionId));
    if (response === 'accept' && profile) {
      const optimisticConversation = buildOptimisticConversation(user.id, profile, candidate);
      setConversations((current) => (
        current.some((conversation) => conversation.id === optimisticConversation.id)
          ? current
          : [optimisticConversation, ...current]
      ));
    } else if (response === 'reject' && candidate.status === 'accepted') {
      const conversationId = `c-${[user.id, candidate.id].sort().join('-')}`;
      setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
    }
    try {
      return await runOrQueue(
        'respondToLike',
        { candidate, profile, response },
        () => persistLikeResponse(user.id, profile, candidate, response),
        { dedupeKey: `respondLike:${candidate.decisionId}` }
      );
    } catch (error) {
      setIncomingLikes(previousLikes);
      throw error;
    }
  };

  const ensureConversation = async (candidate) => {
    if (!user?.id || !profile || !candidate?.id) {
      throw new Error('ไม่พบข้อมูลสำหรับเปิดห้องแชต');
    }
    const conversationId = `c-${[user.id, candidate.id].sort().join('-')}`;
    if (conversations.some((conversation) => conversation.id === conversationId)) {
      return conversationId;
    }
    const optimisticConversation = buildOptimisticConversation(user.id, profile, candidate);
    setConversations((current) => [optimisticConversation, ...current]);
    await runOrQueue(
      'saveDecision',
      { otherUserId: candidate.id, decisionType: 'like', likeMessage: '', status: 'accepted' },
      () => saveDecision(user.id, candidate.id, 'like', '', 'accepted'),
      { dedupeKey: `decision:${candidate.id}` }
    );
    await runOrQueue(
      'createConversation',
      { profile, candidate },
      () => createConversation(user.id, profile, candidate),
      { dedupeKey: `conversation:${conversationId}` }
    );
    return conversationId;
  };

  const sendActivityInvite = async (candidate) => {
    if (!user?.id || !profile || !candidate?.id) {
      throw new Error('ไม่พบคู่สนทนาสำหรับส่งคำขอ');
    }
    const conversationId = await ensureConversation(candidate);
    const activityName = candidate.meetup?.name || candidate.activityLabel || candidate.activity || 'ทำกิจกรรมที่สนใจ';
    const message = `สวัสดี! อยากชวนคุณ ${candidate.nickname || candidate.name} ไปร่วมกิจกรรม "${activityName}" ด้วยกันนะ 💬✨`;
    await sendMessage(conversationId, message);
    return conversationId;
  };

  const matchProfile = async (candidate) => {
    if (!user?.id || !candidate?.id) return { matched: false };
    setOptimisticHiddenIds((prev) => [...prev, candidate.id]);
    try {
      const existingConvo = conversations.find(
        (c) => c.profileId === candidate.id || c.participants?.includes(candidate.id)
      );
      if (existingConvo) {
        return { matched: true, conversationId: existingConvo.id, alreadyMatched: true };
      }

      const result = await runOrQueue(
        'matchProfile',
        { profile, candidate },
        () => saveDecision(user.id, candidate.id, 'like', '', 'pending'),
        { dedupeKey: `decision:${candidate.id}` }
      );
      if (result?.queued) return { matched: false, queued: true };
      if (result?.matched) {
        const conversationId = await createConversation(user.id, profile, candidate);
        return { matched: true, conversationId };
      }
      return { matched: false };
    } catch (error) {
      console.error('matchProfile error:', error);
      throw error;
    }
  };

  const sendMessage = async (conversationId, text, options = {}) => {
    const trimmedText = text.trim();
    if (!trimmedText || !user?.id) return false;
    const clientOptions = {
      ...options,
      clientMessageId: options.clientMessageId || createClientMessageId(),
      clientSentAt: options.clientSentAt || Date.now(),
    };
    const optimisticMessage = {
      id: clientOptions.clientMessageId,
      sender: 'me',
      senderId: user.id,
      text: trimmedText,
      createdAt: clientOptions.clientSentAt,
      time: clientOptions.clientSentAt,
      ...(clientOptions.replyTo ? { replyTo: clientOptions.replyTo } : {}),
      ...(clientOptions.forwarded ? { forwarded: true, forwardedFrom: clientOptions.forwardedFrom } : {}),
      pendingSync: true,
    };
    setConversations((current) => current.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      if ((conversation.messages || []).some((message) => message.id === optimisticMessage.id)) return conversation;
      const unreadCounts = { ...(conversation.unreadCounts || {}) };
      (conversation.participants || []).forEach((participantId) => {
        if (participantId !== user.id) unreadCounts[participantId] = (unreadCounts[participantId] || 0) + 1;
      });
      return {
        ...conversation,
        messages: [...(conversation.messages || []).slice(-499), optimisticMessage],
        lastMessage: trimmedText,
        unreadCounts,
        updatedAt: clientOptions.clientSentAt,
      };
    }));
    try {
      await runOrQueue(
        'sendMessage',
        { conversationId, text: trimmedText, options: clientOptions },
        () => updateConversationMessage(conversationId, user.id, trimmedText, clientOptions),
        { dedupeKey: `message:${clientOptions.clientMessageId}` }
      );
      return true;
    } catch (error) {
      setConversations((current) => current.map((conversation) => (
        conversation.id === conversationId
          ? { ...conversation, messages: (conversation.messages || []).filter((message) => message.id !== clientOptions.clientMessageId) }
          : conversation
      )));
      throw error;
    }
  };

  const markAsRead = async (conversationId) => {
    if (!user?.id || !conversationId) return;
    setConversations((current) => current.map((conversation) => (
      conversation.id === conversationId
        ? { ...conversation, unreadCounts: { ...(conversation.unreadCounts || {}), [user.id]: 0 } }
        : conversation
    )));
    return runOrQueue(
      'markConversationAsRead',
      { conversationId },
      () => markConversationAsRead(conversationId, user.id),
      { dedupeKey: `markRead:${conversationId}` }
    );
  };

  const saveProfile = async (profileData) => {
    if (!user?.id) throw new Error('กรุณาเข้าสู่ระบบก่อนบันทึกโปรไฟล์');
    const nextProfileData = { ...profileData };
    const nextProfile = withProfileDefaults({
      ...profile,
      ...nextProfileData,
      id: user.id,
      email: user.email || profile?.email || '',
      privacy: { ...profile?.privacy, ...nextProfileData.privacy },
      matchingPreferences: {
        ...profile?.matchingPreferences,
        ...nextProfileData.matchingPreferences,
      },
    });
    setProfile(nextProfile);
    void saveAccount({
      id: user.id,
      email: user.email || nextProfile.email,
      displayName: nextProfile.nickname || nextProfile.name || user.displayName,
      photoURL: nextProfile.avatarUri || nextProfile.photos?.[0] || user.photoURL,
      faculty: nextProfile.faculty || '',
    });
    const savedProfile = await runOrQueue(
      'saveProfile',
      { profile: nextProfile },
      () => persistProfileToFirestore(user.id, nextProfile),
      { dedupeKey: 'saveProfile' }
    );
    if (savedProfile && !savedProfile.queued) setProfile(withProfileDefaults(savedProfile));
    return nextProfile;
  };

  const saveMatchingPreferences = async (matchingPreferences) => {
    await saveProfile({ matchingPreferences });
  };

  // คำนวณระยะห่างจริงจาก GPS ของผู้ใช้ + รวม CAMPUS_SPOTS ทั้งหมด
  const computedSpots = useMemo(() => {
    const firestoreSpotMap = new Map(campusSpots.map((s) => [s.id, s]));

    // นำ CAMPUS_SPOTS ทั้งหมดมาแสดงเสมอ
    const mergedList = CAMPUS_SPOTS.map((localSpot) => {
      const remote = firestoreSpotMap.get(localSpot.id);
      if (remote) {
        firestoreSpotMap.delete(localSpot.id);
        const localLatitude = normalizeCoordinate(localSpot.latitude, -90, 90);
        const localLongitude = normalizeCoordinate(localSpot.longitude, -180, 180);
        const remoteLatitude = normalizeCoordinate(remote.latitude, -90, 90)
          ?? normalizeCoordinate(remote.lat, -90, 90);
        const remoteLongitude = normalizeCoordinate(remote.longitude, -180, 180)
          ?? normalizeCoordinate(remote.lng, -180, 180);
        return {
          ...localSpot,
          ...remote,
          category: localSpot.category || remote.category,
          categoryLabel: localSpot.categoryLabel || remote.categoryLabel,
          group: localSpot.group || remote.group,
          // Static campus entries are the source of truth for known spots.
          // Firestore still provides coordinates when a local entry is missing
          // a valid coordinate.
          latitude: localLatitude ?? remoteLatitude,
          longitude: localLongitude ?? remoteLongitude,
        };
      }
      return localSpot;
    });

    // รวม spots เพิ่มเติมจาก Firestore (ถ้ามี)
    firestoreSpotMap.forEach((remoteSpot) => {
      const latitude = normalizeCoordinate(remoteSpot.latitude, -90, 90)
        ?? normalizeCoordinate(remoteSpot.lat, -90, 90);
      const longitude = normalizeCoordinate(remoteSpot.longitude, -180, 180)
        ?? normalizeCoordinate(remoteSpot.lng, -180, 180);
      mergedList.push({
        ...remoteSpot,
        ...(latitude !== null ? { latitude } : {}),
        ...(longitude !== null ? { longitude } : {}),
      });
    });

    return mergedList.map((spot) => {
      const distKm = getSpotDistanceFromUser(profile, spot);
      const distanceKm = Number.isFinite(distKm) ? distKm : null;
      return {
        ...spot,
        distanceKm,
        distance: formatDistance(distanceKm),
      };
    }).sort((a, b) => {
      // เรียงจากใกล้ไปไกล
      const aDistance = a.distanceKm ?? Number.POSITIVE_INFINITY;
      const bDistance = b.distanceKm ?? Number.POSITIVE_INFINITY;
      if (aDistance !== bDistance) return aDistance - bDistance;
      return String(a.name || '').localeCompare(String(b.name || ''), 'th');
    });
  }, [campusSpots, profile?.latitude, profile?.longitude]);

  const chooseMeetup = async (spot, schedule = null) => {
    const scheduleInfo = schedule || { date: null, startTime: null, endTime: null };
    const scheduledAtText = schedule
      ? `${formatScheduleDate(schedule.date)} · ${schedule.startTime}–${schedule.endTime}`
      : 'ยังไม่ได้กำหนดเวลา';
    const newMeetup = { ...spot, schedule: scheduleInfo, scheduledAt: scheduledAtText };
    setSelectedMeetup(newMeetup);
    if (user?.id) {
      await saveProfile({ meetup: newMeetup });
    }
  };

  const updateMeetupSchedule = async (schedule) => {
    if (!selectedMeetup) return;
    const scheduledAtText = `${formatScheduleDate(schedule.date)} · ${schedule.startTime}–${schedule.endTime}`;
    const updatedMeetup = { ...selectedMeetup, schedule, scheduledAt: scheduledAtText };
    setSelectedMeetup(updatedMeetup);
    if (user?.id) {
      await saveProfile({ meetup: updatedMeetup });
    }
  };

  const clearMeetup = async () => {
    setSelectedMeetup(null);
    if (user?.id) {
      await saveProfile({ meetup: null });
    }
  };

  const toggleMeetupAcceptanceInChat = async (conversationId, hostUserId, spotName) => {
    if (!user?.id || !conversationId) return false;
    const currentConversation = conversations.find((conversation) => conversation.id === conversationId);
    const currentlyAccepted = (currentConversation?.meetupAcceptedUsers || []).includes(user.id);
    const shouldAccept = !currentlyAccepted;
    const clientSentAt = Date.now();
    const clientMessageId = createClientMessageId();
    const noticeText = shouldAccept
      ? `ตอบรับนัดหมายที่ ${spotName || 'จุดนัดพบ'} แล้ว`
      : `ยกเลิกการตอบรับนัดหมายที่ ${spotName || 'จุดนัดพบ'}`;
    setConversations((current) => current.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const acceptedUsers = Array.isArray(conversation.meetupAcceptedUsers) ? conversation.meetupAcceptedUsers : [];
      return {
        ...conversation,
        meetupAcceptedUsers: shouldAccept
          ? Array.from(new Set([...acceptedUsers, user.id]))
          : acceptedUsers.filter((id) => id !== user.id),
        messages: [...(conversation.messages || []).slice(-499), {
          id: clientMessageId,
          senderId: user.id,
          sender: 'me',
          text: noticeText,
          isSystem: true,
          createdAt: clientSentAt,
          time: clientSentAt,
          pendingSync: true,
        }],
        lastMessage: noticeText,
        updatedAt: clientSentAt,
      };
    }));
    const options = { shouldAccept, clientMessageId, clientSentAt };
    await runOrQueue(
      'toggleMeetupAcceptance',
      { conversationId, hostUserId, spotName, options },
      () => toggleMeetupAcceptance(conversationId, user.id, hostUserId, spotName, options),
      { dedupeKey: `meetupAcceptance:${conversationId}:${user.id}` }
    );
    return shouldAccept;
  };

  const updateChatSettingsInChat = async (conversationId, settings) => {
    if (!user?.id || !conversationId) return;
    setConversations((current) => current.map((conversation) => (
      conversation.id === conversationId
        ? {
            ...conversation,
            participantSettings: {
              ...(conversation.participantSettings || {}),
              [user.id]: { ...(conversation.participantSettings?.[user.id] || {}), ...settings },
            },
            mySettings: { ...(conversation.mySettings || {}), ...settings },
          }
        : conversation
    )));
    return runOrQueue(
      'updateChatSettings',
      { conversationId, settings },
      () => updateChatSettings(conversationId, user.id, settings),
      { dedupeKey: `chatSettings:${conversationId}:${Object.keys(settings).sort().join(',')}` }
    );
  };

  const unsendMessageInChat = async (conversationId, messageId) => {
    if (!user?.id || !conversationId || !messageId) return false;
    setConversations((current) => current.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const messages = (conversation.messages || []).filter((message) => message.id !== messageId);
      return { ...conversation, messages, lastMessage: messages[messages.length - 1]?.text || 'เริ่มบทสนทนาได้เลย' };
    }));
    await runOrQueue(
      'unsendMessage',
      { conversationId, messageId },
      () => unsendMessage(conversationId, messageId, user.id),
      { dedupeKey: `unsend:${conversationId}:${messageId}` }
    );
    return true;
  };

  const deleteMessageForMeInChat = async (conversationId, messageId) => {
    if (!user?.id || !conversationId || !messageId) return false;
    setConversations((current) => current.map((conversation) => (
      conversation.id === conversationId
        ? { ...conversation, messages: (conversation.messages || []).filter((message) => message.id !== messageId) }
        : conversation
    )));
    await runOrQueue(
      'deleteMessageForUser',
      { conversationId, messageId },
      () => deleteMessageForUser(conversationId, messageId, user.id),
      { dedupeKey: `deleteForUser:${conversationId}:${messageId}` }
    );
    return true;
  };

  const reactToMessageInChat = async (conversationId, messageId, emoji) => {
    if (!user?.id || !conversationId || !messageId || !emoji) return false;

    const currentConversation = conversations.find((conversation) => conversation.id === conversationId);
    const currentMessage = currentConversation?.messages?.find((message) => message.id === messageId);
    const previousReaction = currentMessage?.reactions?.[user.id] || null;
    const nextReaction = previousReaction === emoji ? null : emoji;

    const applyLocalReaction = (reaction, expectedReaction) => {
      setConversations((currentConversations) => currentConversations.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        let messageChanged = false;
        const messages = (conversation.messages || []).map((message) => {
          if (message.id !== messageId) return message;
          const reactions = { ...(message.reactions || {}) };
          const currentReaction = reactions[user.id] || null;

          // Rollbacks should not overwrite a newer tap that has already changed
          // this message again while the previous Firestore request was pending.
          if (expectedReaction !== undefined && currentReaction !== expectedReaction) return message;
          if (reaction) {
            if (currentReaction === reaction) return message;
            reactions[user.id] = reaction;
          } else {
            if (!Object.prototype.hasOwnProperty.call(reactions, user.id)) return message;
            delete reactions[user.id];
          }
          messageChanged = true;
          return { ...message, reactions };
        });
        return messageChanged ? { ...conversation, messages } : conversation;
      }));
    };

    // Show the reaction immediately while Firestore completes its transaction.
    applyLocalReaction(nextReaction);
    try {
      await runOrQueue(
        'reactToMessage',
        { conversationId, messageId, emoji, desiredReaction: nextReaction },
        () => reactToMessage(conversationId, messageId, user.id, emoji, nextReaction)
      );
      return true;
    } catch (error) {
      applyLocalReaction(previousReaction, nextReaction);
      throw error;
    }
  };

  const getMeetupStats = useCallback((candidateOrProfile) => {
    if (!candidateOrProfile?.meetup) return null;
    const meetup = candidateOrProfile.meetup;
    const maxPeople = parseInt(meetup.schedule?.maxPeople, 10) || 2;
    const hostId = candidateOrProfile.id;

    const acceptedUsersSet = new Set();
    if (hostId) acceptedUsersSet.add(hostId);

    conversations.forEach((conv) => {
      if (conv.participants?.includes(hostId) && Array.isArray(conv.meetupAcceptedUsers)) {
        conv.meetupAcceptedUsers.forEach((uid) => {
          if (uid && uid !== hostId) {
            acceptedUsersSet.add(uid);
          }
        });
      }
    });

    const acceptedCount = acceptedUsersSet.size;
    const isFull = acceptedCount >= maxPeople;
    const remaining = Math.max(0, maxPeople - acceptedCount);

    return {
      maxPeople,
      acceptedCount,
      isFull,
      remaining,
      isAcceptedByMe: user?.id ? (acceptedUsersSet.has(user.id) && user.id !== hostId) : false,
    };
  }, [conversations, user?.id]);

  const filteredAvailableProfiles = useMemo(() => {
    if (optimisticHiddenIds.length === 0) return availableProfiles;
    return availableProfiles.filter((p) => !optimisticHiddenIds.includes(p.id));
  }, [availableProfiles, optimisticHiddenIds]);

  const value = useMemo(() => ({
    profile,
    conversations,
    availableProfiles: filteredAvailableProfiles,
    matchedProfileIds,
    incomingLikes,
    pendingIncomingLikes,
    acceptedIncomingLikes,
    campusSpots: computedSpots,
    selectedMeetup,
    dismissProfile,
    resetMatching,
    recycleSkippedProfiles,
    matchProfile,
    respondToLike,
    ensureConversation,
    sendActivityInvite,
    sendMessage,
    deleteMessageForMeInChat,
    unsendMessageInChat,
    reactToMessageInChat,
    markAsRead,
    saveProfile,
    saveMatchingPreferences,
    chooseMeetup,
    updateMeetupSchedule,
    clearMeetup,
    toggleMeetupAcceptanceInChat,
    updateChatSettingsInChat,
    getMeetupStats,
    isOnline,
    networkReady,
    pendingSyncCount,
    isSyncing,
    lastSyncedAt,
    lastSyncError,
    syncNow,
    deleteAccount: async () => {
      if (!user?.id) throw new Error('กรุณาเข้าสู่ระบบก่อนลบบัญชี');
      await deleteAccountData(user.id);
    },
    showPrivacyPolicy: () => setShowPrivacyPolicy(true),
    hidePrivacyPolicy: () => setShowPrivacyPolicy(false),
    privacyPolicyVisible: showPrivacyPolicy,
  }), [
    acceptedIncomingLikes,
    availableProfiles,
    computedSpots,
    conversations,
    filteredAvailableProfiles,
    getMeetupStats,
    incomingLikes,
    matchedProfileIds,
    isOnline,
    isSyncing,
    lastSyncError,
    lastSyncedAt,
    networkReady,
    pendingIncomingLikes,
    pendingSyncCount,
    profile,
    selectedMeetup,
    syncNow,
    showConsent,
    showPrivacyPolicy,
    user?.id,
  ]);

  if (!networkReady || (user?.id && cacheHydratedUserId !== user.id)) {
    return <AppSplashScreen message="กำลังโหลดข้อมูลในเครื่อง..." />;
  }

  if (profileLoading) {
    return <AppSplashScreen message="กำลังเข้าสู่ระบบ กรุณารอสักครู่..." />;
  }

  const blockingError = dataError || (!isOnline && user?.id && !profile
    ? new Error('อุปกรณ์นี้ยังไม่มีข้อมูลที่บันทึกไว้ กรุณาเชื่อมต่ออินเทอร์เน็ตอย่างน้อยหนึ่งครั้ง')
    : null);

  if (blockingError) {
    return (
      <ImageBackground
        source={loginHeroPhoto}
        style={{ flex: 1, backgroundColor: '#0B0D14' }}
        imageStyle={{ resizeMode: 'cover' }}
      >
        <LinearGradient
          colors={['rgba(11,13,20,0.5)', 'rgba(11,13,20,0.78)', 'rgba(11,13,20,0.95)']}
          locations={[0, 0.45, 0.9]}
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 }}
        >
          <View style={{ alignItems: 'center', maxWidth: 340, width: '100%', backgroundColor: 'rgba(20,24,34,0.92)', padding: 24, borderRadius: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}>
            <View style={{ alignItems: 'center', backgroundColor: 'rgba(255,75,75,0.15)', borderRadius: 28, height: 56, justifyContent: 'center', marginBottom: 12, width: 56 }}>
              <FeatureIcon color="#FF4B4B" name="exclamationmark.triangle.fill" size={26} />
            </View>
            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800', textAlign: 'center' }}>
              {!isOnline ? 'ยังไม่มีข้อมูลออฟไลน์' : 'โหลดข้อมูลไม่สำเร็จ'}
            </Text>
            <Text style={{ color: '#B6BDC8', marginTop: 8, textAlign: 'center', fontSize: 13, lineHeight: 18 }}>
              {blockingError.message || 'กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่อีกครั้ง'}
            </Text>
            <Pressable
              onPress={() => {
                setDataError(null);
                setRetryKey((current) => current + 1);
                void syncNow();
              }}
              style={{ backgroundColor: '#111318', borderColor: 'rgba(255,255,255,0.2)', borderRadius: 24, borderWidth: 1, marginTop: 20, paddingHorizontal: 22, paddingVertical: 12 }}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 14 }}>{isOnline ? 'ลองใหม่อีกครั้ง' : 'รอการเชื่อมต่อ'}</Text>
            </Pressable>
          </View>
        </LinearGradient>
      </ImageBackground>
    );
  }

  // Show consent modal for new users who haven't accepted yet
  const needsConsent = profile?.isNewUser && !profile?.consentAcceptedAt;

  const handleConsentAccept = async () => {
    setShowConsent(false);
    if (user?.id) {
      await saveProfile({ consentAcceptedAt: Date.now(), isNewUser: false });
    }
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      <ConsentModal
        visible={needsConsent && !showConsent === false}
        onAccept={handleConsentAccept}
        onViewPolicy={() => setShowPrivacyPolicy(true)}
      />
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp ต้องอยู่ภายใน AppProvider');
  return context;
}
