import { retainLoadingConversations } from '../utils/conversationOrder';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, getDocFromServer, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import NetInfo from '@react-native-community/netinfo';
import { ActivityIndicator, AppState, ImageBackground, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const runAfterInteractionsHelper = (callback) => {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(callback);
    return { cancel: () => cancelIdleCallback(handle) };
  }
  const timer = setTimeout(callback, 80);
  return { cancel: () => clearTimeout(timer) };
};
import { useAuth } from './AuthContext';
import FeatureIcon from '../components/FeatureIcon';
import { requireFirebase } from '../services/dbService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createConversation,
  createSharedProfilesSubscription,
  createUserProfile,
  getUserProfile,
  getPublicProfilesByIds,
  getSpotDistanceFromUser,
  formatDistance,
  filterAvailableProfiles,
  hydrateDecisionLikes,
  ensurePublicProfileProjection,
  isProfileReadyForDiscovery,
  mergeProfileRecords,
  normalizeProfileRecord,
  resetSkippedDecisions,
  respondToDecision,
  saveDecision,
  subscribeToConversations,
  subscribeToUserDecisions,
  cancelOutgoingLike,
  subscribeToSpots,
  updateConversationMessage,
  markConversationAsRead,
  toggleMeetupAcceptance,
  cancelAppointment,
  ensureAppointmentHistory,
  subscribeToAppointments,
  deleteMessageForUser,
  unsendMessage,
  reactToMessage,
  updateChatSettings,
  uploadImage,
  updateUserLocation,
  updateUserMeetup,
  updateUserMatchingPreferences,
  hideConversation,
  unhideConversation,
  unmatchUser,
  blockUserAccount,
  unblockUserAccount,
  getBlockedUserIds,
  submitContentReport,
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
import { getFastBootData, getFastBootMemory, saveFastBootData } from '../services/fastBootService';
import AppSplashScreen from '../components/AppSplashScreen';
import ConsentModal from '../components/ConsentModal';
import { canCancelMeetup, isMeetupExpired } from '../utils/meetupTime';
import { deleteAccountData } from '../services/deleteAccount';
import {
  clearNotificationBadgeAsync,
  updateNotificationBadgeAsync,
} from '../services/notificationService';
import {
  E2EE_PENDING_PREVIEW,
  ENCRYPTED_PREVIEW,
  ensureEncryptionIdentity,
  getEncryptionDevices,
} from '../services/chatEncryptionService';

const loginHeroPhoto = require('../../assets/login-campus-hero.png');

const OFFLINE_SNAPSHOT_DEBOUNCE_MS = 2500;

const AppContext = createContext(null);

// Narrow slices of the app state. Consumers that only need one of these should
// subscribe to the slice instead of `useApp()`, which changes identity on every
// conversation, like, or sync update.
const AppActionsContext = createContext(null);
const AppProfileContext = createContext(null);
const AppBadgeContext = createContext(null);
const AppConversationsContext = createContext(null);
const AppSyncContext = createContext(null);

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
  paces: [],
  availabilityPeriods: [],
  faculty: 'all',
  sameFacultyOnly: false,
  maxDistance: 25,
};

const PROFILE_BOOTSTRAP_TIMEOUT_MS = 8000;

function runWithTimeout(task, timeoutMs, message) {
  let timeoutId;
  const taskPromise = Promise.resolve().then(task);
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([taskPromise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function normalizeCoordinate(value, min, max) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max ? coordinate : null;
}

function getFastBootFeedProfiles() {
  const cached = getFastBootMemory();
  if (!cached?.user?.id || cached.profile?.id !== cached.user.id) return [];
  if (!Array.isArray(cached.availableProfiles)) return [];
  return cached.availableProfiles
    .map((item) => normalizeProfileRecord(item?.id, item))
    .filter(isProfileReadyForDiscovery);
}

function withProfileDefaults(profile) {
  return {
    ...profile,
    // Older profile documents may not have this field. Keep the historical
    // discoverable-by-default behavior while honoring an explicit opt-out.
    isDiscoverable: profile?.isDiscoverable !== false,
    privacy: { ...defaultPrivacy, ...(profile.privacy || {}) },
    matchingPreferences: {
      ...defaultMatchingPreferences,
      ...(profile.matchingPreferences || {}),
    },
  };
}

function areProfileRecordsEquivalent(firstRecord, secondRecord) {
  if (firstRecord === secondRecord) return true;
  if (!firstRecord || !secondRecord) return false;
  const keys = new Set([...Object.keys(firstRecord), ...Object.keys(secondRecord)]);
  return [...keys].every((key) => firstRecord[key] === secondRecord[key]);
}

function mergeConversationWithLiveProfile(conversation, latestProfile, currentUserId) {
  const otherUserId = conversation.profileId
    || conversation.participants?.find((participantId) => participantId !== currentUserId);
  if (!otherUserId || !latestProfile) return conversation;

  const storedProfile = conversation.participantProfiles?.[otherUserId] || {};
  const participantProfile = mergeProfileRecords(storedProfile, latestProfile);
  const subtitle = [participantProfile.faculty, participantProfile.year].filter(Boolean).join(' · ');
  const nextName = participantProfile.name || conversation.name || 'ผู้ใช้ CampusMate';
  const nextAvatar = participantProfile.avatar ?? conversation.avatar;
  const nextAvatarColor = participantProfile.avatarColor ?? conversation.avatarColor;
  const nextAvatarUri = participantProfile.avatarUri ?? conversation.avatarUri;
  const nextSubtitle = subtitle || conversation.subtitle;

  if (
    areProfileRecordsEquivalent(storedProfile, participantProfile)
    && conversation.name === nextName
    && conversation.avatar === nextAvatar
    && conversation.avatarColor === nextAvatarColor
    && conversation.avatarUri === nextAvatarUri
    && conversation.subtitle === nextSubtitle
  ) return conversation;

  return {
    ...conversation,
    participantProfiles: {
      ...(conversation.participantProfiles || {}),
      [otherUserId]: participantProfile,
    },
    name: nextName,
    avatar: nextAvatar,
    avatarColor: nextAvatarColor,
    avatarUri: nextAvatarUri,
    subtitle: nextSubtitle,
  };
}

function sortConversationMessages(messages) {
  return [...messages].sort((first, second) => {
    const timestampDifference = toCachedTimestampMillis(first?.createdAt || first?.time)
      - toCachedTimestampMillis(second?.createdAt || second?.time);
    if (timestampDifference !== 0) return timestampDifference;
    return String(first?.id || '').localeCompare(String(second?.id || ''));
  });
}

function mergeConversationSnapshots(currentConversations, incomingConversations, preserveOptimistic = true) {
  const currentById = new Map((currentConversations || []).map((conversation) => [conversation.id, conversation]));
  const incomingIds = new Set((incomingConversations || []).map((conversation) => conversation.id));
  const mergedConversations = (incomingConversations || []).map((incomingConversation) => {
    const currentConversation = currentById.get(incomingConversation.id);
    if (!currentConversation) return incomingConversation;

    const currentMessages = Array.isArray(currentConversation.messages) ? currentConversation.messages : [];
    const incomingMessages = Array.isArray(incomingConversation.messages) ? incomingConversation.messages : [];
    const incomingMessageIds = new Set(incomingMessages.map((message) => message?.id).filter(Boolean));
    const pendingLocalMessages = currentMessages.filter(
      (message) => message?.pendingSync && !incomingMessageIds.has(message.id)
    );
    const isHydratingMessages = incomingConversation.messagesHydrating === true
      && incomingConversation.encryptionPending !== true;
    const messagesById = new Map();

    // While the per-message listener is still hydrating, keep the last local
    // timeline so a parent-document update cannot blank the chat history.
    if (isHydratingMessages) {
      currentMessages.forEach((message) => {
        if (message?.id) messagesById.set(message.id, message);
      });
    }
    incomingMessages.forEach((message) => {
      if (message?.id) messagesById.set(message.id, message);
    });
    pendingLocalMessages.forEach((message) => {
      if (message?.id) messagesById.set(message.id, message);
    });

    const messages = sortConversationMessages([...messagesById.values()]);
    const shouldUseLocalLatest = isHydratingMessages || pendingLocalMessages.length > 0;
    const latestMessage = messages[messages.length - 1];
    const currentUpdatedAt = toCachedTimestampMillis(currentConversation.updatedAt);
    const incomingUpdatedAt = toCachedTimestampMillis(incomingConversation.updatedAt);

    return {
      ...incomingConversation,
      messages,
      ...(shouldUseLocalLatest && latestMessage ? {
        lastMessage: latestMessage.text || incomingConversation.lastMessage,
        lastMessageSenderId: latestMessage.senderId || incomingConversation.lastMessageSenderId,
        lastMessageAt: latestMessage.createdAt || incomingConversation.lastMessageAt,
        lastMessageId: latestMessage.id || incomingConversation.lastMessageId,
        updatedAt: currentUpdatedAt > incomingUpdatedAt
          ? currentConversation.updatedAt
          : incomingConversation.updatedAt,
      } : {}),
    };
  });

  // Keep an optimistic room visible until its create/match operation has
  // appeared in the realtime query.
  const optimisticOnly = preserveOptimistic
    ? (currentConversations || []).filter((conversation) => (
      !incomingIds.has(conversation.id)
        && (conversation.pendingSync || (conversation.messages || []).some((message) => message?.pendingSync))
    ))
    : [];
  return [...optimisticOnly, ...mergedConversations];
}

function toCachedTimestampMillis(value) {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (value?.toMillis) return value.toMillis();
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  if (typeof value?._seconds === 'number') {
    return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1e6);
  }
  return 0;
}

function getOfflineSnapshotSignature(snapshot) {
  const compactMessage = (message) => [
    message?.id,
    toCachedTimestampMillis(message?.createdAt || message?.time),
    message?.text,
    message?.isDeleted,
    message?.unsent,
    message?.pendingSync,
    message?.hiddenFor,
    message?.reactions,
  ];
  const compactConversation = (conversation) => [
    conversation?.id,
    toCachedTimestampMillis(conversation?.updatedAt),
    conversation?.lastMessageId,
    toCachedTimestampMillis(conversation?.lastMessageAt),
    conversation?.messages?.length || 0,
    (conversation?.messages || []).map(compactMessage),
  ];
  const compactProfile = (candidate) => [
    candidate?.id,
    candidate?.name,
    candidate?.nickname,
    candidate?.avatarUri,
    candidate?.avatar,
    candidate?.isMatched,
    candidate?.distance,
    candidate?.decisionId,
    candidate?.status,
    candidate?.likeMessage,
    toCachedTimestampMillis(candidate?.createdAt),
    toCachedTimestampMillis(candidate?.updatedAt),
    candidate?.meetup,
    candidate?.selectedMeetup,
  ];

  return JSON.stringify({
    profile: snapshot.profile,
    conversations: (snapshot.conversations || []).map(compactConversation),
    hiddenConversationIds: snapshot.hiddenConversationIds,
    availableProfiles: (snapshot.availableProfiles || []).map(compactProfile),
    incomingLikes: (snapshot.incomingLikes || []).map(compactProfile),
    outgoingLikes: (snapshot.outgoingLikes || []).map(compactProfile),
    appointments: (snapshot.appointments || []).map((appointment) => [
      appointment?.id,
      appointment?.status,
      toCachedTimestampMillis(appointment?.updatedAt),
      toCachedTimestampMillis(appointment?.createdAt),
    ]),
    campusSpots: (snapshot.campusSpots || []).map((spot) => [
      spot?.id,
      spot?.name,
      spot?.updatedAt,
    ]),
    selectedMeetup: snapshot.selectedMeetup,
    optimisticHiddenIds: snapshot.optimisticHiddenIds,
    blockedUserIds: snapshot.blockedUserIds,
  });
}

function areDiscoveryProfileListsEqual(firstList, secondList) {
  if (firstList === secondList) return true;
  if (!Array.isArray(firstList) || !Array.isArray(secondList) || firstList.length !== secondList.length) return false;
  return firstList.every((firstProfile, index) => {
    const secondProfile = secondList[index];
    if (!secondProfile) return false;
    return firstProfile.id === secondProfile.id
      && firstProfile.name === secondProfile.name
      && firstProfile.nickname === secondProfile.nickname
      && firstProfile.age === secondProfile.age
      && firstProfile.faculty === secondProfile.faculty
      && firstProfile.year === secondProfile.year
      && firstProfile.activity === secondProfile.activity
      && firstProfile.activityLabel === secondProfile.activityLabel
      && firstProfile.bio === secondProfile.bio
      && firstProfile.gender === secondProfile.gender
      && firstProfile.skill === secondProfile.skill
      && firstProfile.pace === secondProfile.pace
      && firstProfile.availability === secondProfile.availability
      && firstProfile.compatibility === secondProfile.compatibility
      && firstProfile.avatar === secondProfile.avatar
      && firstProfile.avatarColor === secondProfile.avatarColor
      && firstProfile.avatarUri === secondProfile.avatarUri
      && firstProfile.isMatched === secondProfile.isMatched
      && firstProfile.distance === secondProfile.distance
      && firstProfile.decisionId === secondProfile.decisionId
      && firstProfile.status === secondProfile.status
      && firstProfile.likeMessage === secondProfile.likeMessage
      && toCachedTimestampMillis(firstProfile.createdAt) === toCachedTimestampMillis(secondProfile.createdAt)
      && toCachedTimestampMillis(firstProfile.updatedAt) === toCachedTimestampMillis(secondProfile.updatedAt)
      && firstProfile.activities === secondProfile.activities
      && firstProfile.availabilitySlots === secondProfile.availabilitySlots
      && firstProfile.tags === secondProfile.tags
      && firstProfile.interests === secondProfile.interests
      && firstProfile.encryptionDevices === secondProfile.encryptionDevices
      && firstProfile.meetup === secondProfile.meetup
      && firstProfile.selectedMeetup === secondProfile.selectedMeetup;
  });
}

function applyCachedHistoryCutoff(conversation, currentUserId) {
  const mySettings = conversation?.participantSettings?.[currentUserId] || {};
  const historyClearedAt = mySettings.historyClearedAt || mySettings.hiddenAt;
  const cutoffMillis = toCachedTimestampMillis(historyClearedAt);
  if (!cutoffMillis) return conversation;

  const messages = (Array.isArray(conversation?.messages) ? conversation.messages : [])
    .filter((message) => toCachedTimestampMillis(message?.createdAt || message?.time) > cutoffMillis);
  const latestMessage = messages[messages.length - 1];
  const unreadCounts = { ...(conversation?.unreadCounts || {}) };
  if (!latestMessage) unreadCounts[currentUserId] = 0;

  return {
    ...conversation,
    messages,
    unreadCounts,
    lastMessage: latestMessage?.text || ENCRYPTED_PREVIEW,
    lastMessageSenderId: latestMessage?.senderId || null,
    lastMessageAt: latestMessage?.createdAt || null,
    lastMessageId: latestMessage?.id || null,
  };
}

function normalizeCachedConversation(conversation, currentUserId) {
  const cachedConversation = applyCachedHistoryCutoff(conversation, currentUserId);
  const cachedMessages = Array.isArray(cachedConversation?.messages) ? cachedConversation.messages : [];
  const hasLegacyPlaintext = cachedMessages.some((message) => !message?.encrypted && !message?.pendingSync)
    || (!cachedConversation?.encryption
      && !cachedConversation?.pendingSync
      && cachedConversation?.lastMessage
      && cachedConversation.lastMessage !== ENCRYPTED_PREVIEW);
  if (hasLegacyPlaintext) {
    return applyCachedHistoryCutoff({
      ...cachedConversation,
      messages: cachedMessages.filter((message) => message?.pendingSync),
      lastMessage: E2EE_PENDING_PREVIEW,
      encryptionPending: true,
    }, currentUserId);
  }
  const participantProfiles = Object.fromEntries(
    Object.entries(cachedConversation?.participantProfiles || {}).map(([userId, participantProfile]) => [
      userId,
      normalizeProfileRecord(userId, participantProfile),
    ])
  );
  const otherUserId = cachedConversation?.profileId
    || cachedConversation?.participants?.find((participantId) => participantId !== currentUserId);
  const otherProfile = otherUserId ? participantProfiles[otherUserId] : null;
  if (!otherProfile) return cachedConversation;
  return applyCachedHistoryCutoff({
    ...cachedConversation,
    participantProfiles,
    name: cachedConversation.name || otherProfile.name || 'ผู้ใช้ CampusMate',
    avatar: cachedConversation.avatar ?? otherProfile.avatar,
    avatarColor: cachedConversation.avatarColor ?? otherProfile.avatarColor,
    avatarUri: cachedConversation.avatarUri ?? otherProfile.avatarUri,
    subtitle: cachedConversation.subtitle || [otherProfile.faculty, otherProfile.year].filter(Boolean).join(' · '),
  }, currentUserId);
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
  const decisionId = candidate.decisionId || `${candidate.id}_${userId}`;
  if (response === 'accept') {
    // 1. Await updating incoming like decision to 'accepted' first so Firestore security
    //    rules pass acceptedLike(candidate.id, userId) for subsequent operations.
    await respondToDecision(decisionId, userId, 'accepted', candidate.id);

    // 2. Await saving reciprocal decision from current user with status 'accepted'.
    await saveDecision(userId, candidate.id, 'like', '', 'accepted');

    // 3. Create conversation document between both users and return its ID.
    const conversationId = await createConversation(userId, currentProfile, candidate);
    return conversationId;
  }

  const skipStatus = candidate.status === 'accepted' ? 'removed' : 'pending';
  const conversationId = `c-${[userId, candidate.id].sort().join('-')}`;
  // Reject the incoming request before writing our skip decision. Running
  // these in parallel can make saveDecision observe a still-pending like,
  // attempt an accepted reciprocal write, and be rejected by Firestore rules.
  await respondToDecision(decisionId, userId, 'rejected', candidate.id);
  await saveDecision(userId, candidate.id, 'skip', '', skipStatus);
  if (candidate.status === 'accepted') await hideConversation(conversationId, userId);
}

async function executeQueuedOperation(operation) {
  const { payload = {}, type, userId } = operation;
  switch (type) {
    case 'saveProfile':
      return persistProfileToFirestore(userId, payload.profile);
    case 'updateMeetup':
      return updateUserMeetup(userId, payload.meetup, payload.privacy);
    case 'saveMatchingPreferences':
      return updateUserMatchingPreferences(userId, payload.matchingPreferences);
    case 'saveDecision':
      return saveDecision(userId, payload.otherUserId, payload.decisionType, payload.likeMessage, payload.status);
    case 'matchProfile': {
      const result = await saveDecision(userId, payload.candidate.id, 'like', '', 'pending');
      if (result?.matched) await createConversation(userId, payload.profile, payload.candidate);
      return result;
    }
    case 'respondToLike':
      return persistLikeResponse(userId, payload.profile, payload.candidate, payload.response);
    case 'cancelOutgoingLike':
      return cancelOutgoingLike(userId, payload.otherUserId, payload.decisionId);
    case 'unmatchUser':
      return unmatchUser(userId, payload.otherUserId);
    case 'resetMatching': {
      const { db } = requireFirebase();
      const outgoingQuery = query(collection(db, 'decisions'), where('fromUserId', '==', userId));
      const snapshot = await getDocs(outgoingQuery);
      return Promise.all(snapshot.docs.map((decisionDoc) => deleteDoc(decisionDoc.ref).catch((err) => {
        console.warn('[queue resetMatching] deleteDoc error:', decisionDoc.id, err?.message || err);
      })));
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
    case 'cancelAppointment':
      return cancelAppointment(payload.appointmentId, userId);
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

function withScheduleTimestamp(schedule) {
  if (!schedule || !schedule.date) return schedule;
  const existing = schedule.scheduledFor;
  if (existing instanceof Date && !Number.isNaN(existing.getTime())) return schedule;
  if (existing && typeof existing.toMillis === 'function') return schedule;

  const dateParts = String(schedule.date).split('-').map(Number);
  const timeParts = String(schedule.startTime || '00:00').split(':').map(Number);
  if (dateParts.length !== 3 || dateParts.some((value) => !Number.isFinite(value))) return schedule;
  const [year, month, day] = dateParts;
  const hour = Number.isFinite(timeParts[0]) ? timeParts[0] : 0;
  const minute = Number.isFinite(timeParts[1]) ? timeParts[1] : 0;
  const scheduledFor = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(scheduledFor.getTime())) return schedule;
  return { ...schedule, scheduledFor };
}

export function AppProvider({ children }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(() => {
    const cached = getFastBootMemory();
    return cached?.profile || null;
  });
  const [profileLoading, setProfileLoading] = useState(false);
  const [conversations, setConversations] = useState([]);
  useEffect(() => {
    if (!user?.id) return;
    // Imported on demand: this module pulls in the image picker, the image
    // manipulator and Firebase Storage, none of which are needed to boot.
    const resume = async () => {
      if (AppState.currentState !== 'active') return;
      try {
        const { resumeVideoUpgrades } = await import('../services/videoUpgradeService');
        await resumeVideoUpgrades(user.id);
      } catch (error) {
        console.warn('[AppContext] resumeVideoUpgrades failed:', error?.message || error);
      }
    };
    void resume();
    const timer = setInterval(() => { void resume(); }, 60000);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void resume(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [user?.id]);

  const [hiddenConversationIds, setHiddenConversationIds] = useState([]);
  const [availableProfiles, setAvailableProfiles] = useState(() => getFastBootFeedProfiles());
  const [campusSpots, setCampusSpots] = useState([]);
  const [incomingLikes, setIncomingLikes] = useState([]);
  const [outgoingLikes, setOutgoingLikes] = useState([]);
  const [blockedUserIds, setBlockedUserIds] = useState([]);
  const [decisionSnapshots, setDecisionSnapshots] = useState(null);
  const [decisionProfiles, setDecisionProfiles] = useState([]);
  const [appointments, setAppointments] = useState([]);
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
  const [consentDismissed, setConsentDismissed] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const previousOnlineRef = useRef(true);
  const networkReadyRef = useRef(false);
  const latestPublicProfileRef = useRef(null);
  const flushingQueueRef = useRef(false);
  const encryptionProfileFingerprintRef = useRef('');
  const offlineSnapshotSignatureRef = useRef('');
  const matchedConversationSyncRef = useRef(new Set());
  const appointmentRepairRef = useRef(new Set());
  const discoverySubscriptionRef = useRef(null);
  const discoveryProfileFetchesRef = useRef(new Set());
  const discoveryAutoLoadRef = useRef(0);
  const liveDiscoveryReadyRef = useRef(false);
  const fastBootFeedSigRef = useRef('');
  const previousUserIdRef = useRef(null);

  const updateHiddenConversations = useCallback((nextIdsOrUpdater) => {
    setHiddenConversationIds((prev) => {
      const next = typeof nextIdsOrUpdater === 'function' ? nextIdsOrUpdater(prev) : nextIdsOrUpdater;
      if (user?.id) {
        AsyncStorage.setItem(`@campusmate:hidden_conversations:${user.id}`, JSON.stringify(next)).catch(() => {});
      }
      return next;
    });
  }, [user?.id]);

  useEffect(() => {
    let active = true;
    const updateNetworkState = (state) => {
      if (!active) return;
      // On mobile networks (5G/4G) and Android emulators, NetInfo's reachability
      // probe (generate_204) often fails or times out, falsely reporting
      // isInternetReachable: false even with active data connection.
      // Treat the device as online whenever isConnected is true.
      const nextOnline = state.isConnected !== false && (Boolean(state.isConnected) || state.isInternetReachable !== false);
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
      previousUserIdRef.current = null;
      liveDiscoveryReadyRef.current = false;
      fastBootFeedSigRef.current = '';
      setCacheHydratedUserId(null);
      setPendingSyncCount(0);
      setProfile(null);
      setConversations([]);
      setHiddenConversationIds([]);
      setAvailableProfiles([]);
      setIncomingLikes([]);
      setOutgoingLikes([]);
      setDecisionSnapshots(null);
      setDecisionProfiles([]);
      setAppointments([]);
      setCampusSpots([]);
      setSelectedMeetup(null);
      setOptimisticHiddenIds([]);
      setBlockedUserIds([]);
      return undefined;
    }

    const userId = user.id;
    const isUserSwitch = previousUserIdRef.current && previousUserIdRef.current !== userId;
    previousUserIdRef.current = userId;

    matchedConversationSyncRef.current.clear();
    discoveryProfileFetchesRef.current.clear();
    discoveryAutoLoadRef.current = 0;
    liveDiscoveryReadyRef.current = false;
    setCacheHydratedUserId(null);

    const fastBoot = getFastBootMemory();
    const fastProfile = fastBoot?.profile?.id === userId ? withProfileDefaults(fastBoot.profile) : null;
    const fastFeed = fastBoot?.profile?.id === userId ? getFastBootFeedProfiles() : [];

    setProfile((current) => {
      if (current?.id === userId) return current;
      if (fastProfile) return fastProfile;
      return null;
    });

    if (isUserSwitch) {
      setConversations([]);
      setHiddenConversationIds([]);
      setRemovedUserIds(new Set());
      setAvailableProfiles(fastFeed);
      setIncomingLikes([]);
      setOutgoingLikes([]);
      setDecisionSnapshots(null);
      setDecisionProfiles([]);
      setAppointments([]);
      setCampusSpots([]);
      setSelectedMeetup(null);
      setOptimisticHiddenIds([]);
      setBlockedUserIds([]);
    } else if (fastFeed.length) {
      setAvailableProfiles((current) => (current.length ? current : fastFeed));
    }

    void getBlockedUserIds(userId)
      .then((blockedIds) => {
        if (active && Array.isArray(blockedIds)) setBlockedUserIds(blockedIds);
      })
      .catch(() => {});

    Promise.all([
      loadOfflineSnapshot(userId),
      getOfflineQueueCount(userId),
      AsyncStorage.getItem(`@campusmate:hidden_conversations:${userId}`).catch(() => null),
    ])
      .then(([snapshot, queueCount, rawHidden]) => {
        if (!active) return;
        let storedHidden = [];
        if (rawHidden) {
          try {
            const parsed = JSON.parse(rawHidden);
            if (Array.isArray(parsed)) storedHidden = parsed;
          } catch (_) {}
        }
        if (snapshot) {
          const cachedProfile = snapshot.profile ? withProfileDefaults(snapshot.profile) : null;
          if (cachedProfile) {
            setProfile(cachedProfile);
            saveFastBootData({ profile: cachedProfile });
          }
          setConversations(
            Array.isArray(snapshot.conversations)
              ? snapshot.conversations.map((item) => normalizeCachedConversation(item, userId))
              : []
          );
          const snapshotHidden = Array.isArray(snapshot.hiddenConversationIds) ? snapshot.hiddenConversationIds : [];
          const combinedHidden = Array.from(new Set([...storedHidden, ...snapshotHidden]));
          setHiddenConversationIds(combinedHidden);
          if (
            !liveDiscoveryReadyRef.current
            && Array.isArray(snapshot.availableProfiles)
            && snapshot.availableProfiles.length
          ) {
            setAvailableProfiles(
              snapshot.availableProfiles
                .map((item) => normalizeProfileRecord(item?.id, item))
                .filter(isProfileReadyForDiscovery)
            );
          }
          setIncomingLikes(
            Array.isArray(snapshot.incomingLikes)
              ? snapshot.incomingLikes
                .map((item) => normalizeProfileRecord(item?.id, item))
                .filter(isProfileReadyForDiscovery)
              : []
          );
          setAppointments(Array.isArray(snapshot.appointments) ? snapshot.appointments : []);
          setCampusSpots(Array.isArray(snapshot.campusSpots) ? snapshot.campusSpots : []);
          setSelectedMeetup(snapshot.selectedMeetup || cachedProfile?.meetup || null);
          setOptimisticHiddenIds(Array.isArray(snapshot.optimisticHiddenIds) ? snapshot.optimisticHiddenIds : []);
          if (Array.isArray(snapshot.blockedUserIds) && snapshot.blockedUserIds.length) {
            setBlockedUserIds((current) => (current.length ? current : snapshot.blockedUserIds));
          }
          setLastSyncedAt(snapshot.cachedAt || null);
        } else {
          setHiddenConversationIds(storedHidden);
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
    let backgroundProfileTask = null;

    if (!user?.id) {
      discoveryProfileFetchesRef.current.clear();
      discoveryAutoLoadRef.current = 0;
      setProfile(null);
      setProfileLoading(false);
      setConversations([]);
      setAvailableProfiles([]);
      setIncomingLikes([]);
      setOutgoingLikes([]);
      setDecisionSnapshots(null);
      setDecisionProfiles([]);
      setAppointments([]);
      setCampusSpots([]);
      setBlockedUserIds([]);
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
    runWithTimeout(
      () => getUserProfile(user.id),
      PROFILE_BOOTSTRAP_TIMEOUT_MS,
      'โหลดข้อมูลโปรไฟล์ไม่เสร็จภายในเวลาที่กำหนด'
    )
      .then(async (storedProfile) => {
        if (!active) return;

        const refreshLocationInBackground = async () => {
          try {
            const Location = await import('expo-location');
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            if (active) setProfile((current) => ({
              ...(current || {}),
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            }));
            await updateUserLocation(user.id, loc.coords.latitude, loc.coords.longitude);
          } catch (error) {
            console.log('Location fetch error:', error);
          }
        };

        if (storedProfile) {
          const defaults = withProfileDefaults(storedProfile);
          saveFastBootData({ profile: defaults });
          if (defaults.meetup) {
            setSelectedMeetup(defaults.meetup);
          }
          saveAccount({
            id: user.id,
            email: user.email || defaults.email,
            displayName: defaults.nickname || defaults.name || user.displayName,
            photoURL: defaults.avatarUri || defaults.photos?.[0] || user.photoURL,
            avatarUri: defaults.avatarUri || defaults.photos?.[0] || user.photoURL,
            avatarColor: defaults.avatarColor || null,
            faculty: defaults.faculty || '',
            updatedAt: defaults.updatedAt,
          });
          // Older releases could update `users/{uid}` without refreshing the
          // public projection. Repair the owner-selected fields once so other
          // devices stop receiving an image-only/stale profile.
          setProfile(defaults);
          backgroundProfileTask = runAfterInteractionsHelper(() => {
            if (!active) return;
            void ensurePublicProfileProjection(user.id, defaults);
            void refreshLocationInBackground();
          });
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
        });
        if (active) setProfile(newProfile);
        void createUserProfile(user.id, newProfile).catch((error) => {
          console.warn('[AppContext] Background profile setup failed:', error?.message || error);
        });
        backgroundProfileTask = runAfterInteractionsHelper(() => {
          if (active) void refreshLocationInBackground();
        });
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
      backgroundProfileTask?.cancel?.();
    };
  }, [cacheHydratedUserId, isOnline, pendingSyncCount, user?.displayName, user?.email, user?.id]);

  // Shared profiles state — paged discovery listeners feed available profiles;
  // decision-only profiles are hydrated separately when needed.
  const [sharedProfiles, setSharedProfiles] = useState([]);
  const [hasMoreDiscoveryProfiles, setHasMoreDiscoveryProfiles] = useState(false);
  const [isLoadingMoreDiscoveryProfiles, setIsLoadingMoreDiscoveryProfiles] = useState(false);
  const decisionProfilesById = useMemo(
    () => new Map(decisionProfiles.map((item) => [item.id, item])),
    [decisionProfiles]
  );
  const decisionProfileRecords = useMemo(() => {
    const profilesById = new Map(sharedProfiles.map((item) => [item.id, item]));
    decisionProfiles.forEach((item) => {
      profilesById.set(item.id, mergeProfileRecords(profilesById.get(item.id), item));
    });
    return [...profilesById.values()];
  }, [decisionProfiles, sharedProfiles]);
  const decisionProfileRecordsRef = useRef(decisionProfileRecords);
  decisionProfileRecordsRef.current = decisionProfileRecords;
  const [removedUserIds, setRemovedUserIds] = useState(() => new Set());
  const sharedProfilesById = useMemo(
    () => new Map(sharedProfiles.map((item) => [item.id, item])),
    [sharedProfiles]
  );
  const availableProfilesById = useMemo(
    () => new Map(availableProfiles.map((item) => [item.id, item])),
    [availableProfiles]
  );

  const loadMoreDiscoveryProfiles = useCallback(async () => {
    const loadMore = discoverySubscriptionRef.current?.loadMore;
    if (typeof loadMore !== 'function') return false;
    return loadMore();
  }, []);
  const liveConversations = useMemo(() => {
    if (!sharedProfiles.length || !conversations.length) return conversations;
    return conversations.map((conversation) => {
      const otherUserId = conversation.profileId
        || conversation.participants?.find((participantId) => participantId !== user?.id);
      return mergeConversationWithLiveProfile(
        conversation,
        sharedProfilesById.get(otherUserId),
        user?.id
      );
    });
  }, [conversations, sharedProfiles.length, sharedProfilesById, user?.id]);

  const hiddenConversationIdSet = useMemo(
    () => new Set(hiddenConversationIds),
    [hiddenConversationIds]
  );
  const activeConversations = useMemo(() => {
    return liveConversations.filter((conversation) => {
      if (conversation.isHidden) return false;
      if (hiddenConversationIdSet.has(conversation.id)) return false;
      const mySettings = conversation.participantSettings?.[user?.id];
      if (mySettings?.isHidden) return false;
      const otherUserId = conversation.profileId
        || conversation.participants?.find((participantId) => participantId !== user?.id);
      if (otherUserId && removedUserIds.has(otherUserId)) return false;
      if (otherUserId && blockedUserIds.includes(otherUserId)) return false;
      return true;
    });
  }, [blockedUserIds, hiddenConversationIdSet, liveConversations, removedUserIds, user?.id]);

  const hasPendingEncryptionConversation = useMemo(
    () => activeConversations.some((conversation) => conversation.encryptionPending),
    [activeConversations]
  );

  const pendingEncryptionProfileIds = useMemo(() => {
    if (!hasPendingEncryptionConversation) return new Set();
    const profileIds = new Set();
    activeConversations.forEach((conversation) => {
      if (!conversation.encryptionPending) return;
      (conversation.participants || []).forEach((participantId) => profileIds.add(participantId));
    });
    return profileIds;
  }, [activeConversations, hasPendingEncryptionConversation]);

  const encryptionProfileFingerprint = useMemo(() => (
    hasPendingEncryptionConversation
      ? JSON.stringify(
          sharedProfiles
            .filter((item) => pendingEncryptionProfileIds.has(item.id))
            .map((item) => [
              item.id,
              Object.entries(getEncryptionDevices(item))
                .sort(([firstId], [secondId]) => firstId.localeCompare(secondId)),
            ])
            .sort(([firstId], [secondId]) => String(firstId).localeCompare(String(secondId)))
        )
      : ''
  ), [hasPendingEncryptionConversation, pendingEncryptionProfileIds, sharedProfiles]);

  // A participant publishing a new device key changes the shared profile,
  // not the conversation document. Re-run the conversation hydration once so
  // a pending legacy room can migrate as soon as that key becomes available.
  useEffect(() => {
    if (!user?.id || !sharedProfiles.length || !hasPendingEncryptionConversation) return;
    if (encryptionProfileFingerprintRef.current === encryptionProfileFingerprint) return;
    encryptionProfileFingerprintRef.current = encryptionProfileFingerprint;
    setRetryKey((current) => current + 1);
  }, [encryptionProfileFingerprint, hasPendingEncryptionConversation, sharedProfiles.length, user?.id]);

  useEffect(() => {
    if (!user?.id || !sharedProfiles.length) return;
    const latestPublicProfile = sharedProfilesById.get(user.id);
    if (!latestPublicProfile) return;
    if (latestPublicProfileRef.current === latestPublicProfile) return;
    latestPublicProfileRef.current = latestPublicProfile;
    setProfile((currentProfile) => withProfileDefaults({
      ...(currentProfile || {}),
      ...latestPublicProfile,
      id: user.id,
      privacy: currentProfile?.privacy || latestPublicProfile.privacy,
      matchingPreferences: currentProfile?.matchingPreferences || latestPublicProfile.matchingPreferences,
    }));
  }, [sharedProfiles.length, sharedProfilesById, user?.id]);

  useEffect(() => {
    // Public discovery is read-only and must remain available while another
    // operation is waiting in the offline queue. Do not wait for encrypted
    // snapshot hydration: decrypting chat history was blocking the first
    // Home card. Cached cards can render immediately and this listener
    // replaces them as soon as the first page arrives.
    if (!user?.id || !isOnline) return undefined;
    let active = true;
    liveDiscoveryReadyRef.current = false;
    const handleSubscriptionError = (source) => (error) => {
      console.error(`[AppContext] ${source} subscription error:`, {
        code: error?.code || 'unknown',
        message: error?.message || String(error),
      });
      if (!isRetryableNetworkError(error)) setDataError(error);
    };
    discoveryAutoLoadRef.current = 0;
    const subscription = createSharedProfilesSubscription(
      (nextProfiles) => {
        liveDiscoveryReadyRef.current = true;
        setSharedProfiles((currentProfiles) => (
          areDiscoveryProfileListsEqual(currentProfiles, nextProfiles) ? currentProfiles : nextProfiles
        ));
      },
      handleSubscriptionError('discoveryProfiles'),
      {
        pageSize: 40,
        onPageInfo: ({ source, hasMore, loading }) => {
          if (!active) return;
          setHasMoreDiscoveryProfiles(
            ['discovery', 'discoveryProfiles', 'profiles'].includes(source) && hasMore
          );
          setIsLoadingMoreDiscoveryProfiles(Boolean(loading));
        },
      }
    );
    discoverySubscriptionRef.current = subscription;
    return () => {
      active = false;
      if (discoverySubscriptionRef.current === subscription) {
        discoverySubscriptionRef.current = null;
      }
      subscription?.unsubscribe?.();
      setSharedProfiles([]);
      setHasMoreDiscoveryProfiles(false);
      setIsLoadingMoreDiscoveryProfiles(false);
    };
  }, [isOnline, retryKey, user?.id]);

  // Spots and appointments are secondary to discovery. Start them after the
  // first render and keep them independent from conversation retries.
  useEffect(() => {
    if (!user?.id || !isOnline || pendingSyncCount > 0 || cacheHydratedUserId !== user.id) return undefined;
    let active = true;
    let unsubscribeSecondarySubscriptions = null;
    const handleSubscriptionError = (source, { blocking = true } = {}) => (error) => {
      console.error(`[AppContext] ${source} subscription error:`, {
        code: error?.code || 'unknown',
        message: error?.message || String(error),
      });
      if (blocking && !isRetryableNetworkError(error)) setDataError(error);
    };
    const interactionTask = runAfterInteractionsHelper(() => {
      if (!active) return;
      const unsubscribers = [
        subscribeToSpots(setCampusSpots, handleSubscriptionError('spots')),
        subscribeToAppointments(user.id, setAppointments, handleSubscriptionError('appointments', { blocking: false })),
      ];
      unsubscribeSecondarySubscriptions = () => {
        unsubscribers.forEach((unsubscribe) => unsubscribe?.());
      };
    });
    return () => {
      active = false;
      interactionTask?.cancel?.();
      unsubscribeSecondarySubscriptions?.();
    };
  }, [cacheHydratedUserId, isOnline, pendingSyncCount, user?.id]);

  // Conversations decrypt every message and can be much heavier than the
  // discovery data. Let the first profile card render before starting this
  // subscription, and only restart it when conversation hydration needs a
  // retry.
  useEffect(() => {
    if (!user?.id || !isOnline || pendingSyncCount > 0 || cacheHydratedUserId !== user.id) return undefined;
    let active = true;
    let unsubscribeConversation = null;
    const handleSubscriptionError = (error) => {
      console.error('[AppContext] conversations subscription error:', {
        code: error?.code || 'unknown',
        message: error?.message || String(error),
      });
      if (!isRetryableNetworkError(error)) setDataError(error);
    };
    const interactionTask = runAfterInteractionsHelper(() => {
      if (!active) return;
      unsubscribeConversation = subscribeToConversations(user.id, (convs, snapshotInfo = {}) => {
        const preserveOptimistic = snapshotInfo.fromCache !== false
          || snapshotInfo.hasPendingWrites === true
          || pendingSyncCount > 0;
        setConversations((current) => mergeConversationSnapshots(current, retainLoadingConversations(current, convs, snapshotInfo.loadingConversationIds), preserveOptimistic));
      }, handleSubscriptionError);
    });
    return () => {
      active = false;
      interactionTask?.cancel?.();
      unsubscribeConversation?.();
    };
  }, [cacheHydratedUserId, isOnline, pendingSyncCount, retryKey, user?.id]);

  // Older accepted meetups may have a conversation acceptance but no
  // appointments document because appointment history was introduced later.
  // Repair those records once per conversation; the service only permits the
  // accepted guest to create the missing document.
  useEffect(() => {
    if (!user?.id || !isOnline || pendingSyncCount > 0 || cacheHydratedUserId !== user.id) return undefined;
    conversations.forEach((conversation) => {
      if (!conversation?.id || !Array.isArray(conversation.participants)) return;
      if (!conversation.meetupAcceptedUsers?.includes(user.id)) return;

      const hostId = conversation.participants.find((participantId) => participantId !== user.id);
      const hostMeetup = hostId
        ? (conversation.participantProfiles?.[hostId]?.meetup
          || conversation.participantProfiles?.[hostId]?.selectedMeetup
          || sharedProfilesById.get(hostId)?.meetup
          || availableProfilesById.get(hostId)?.meetup
          || conversation.meetup)
        : null;
      if (!hostId || !hostMeetup?.schedule?.date) return;

      const repairKey = `${user.id}:${conversation.id}`;
      if (appointmentRepairRef.current.has(repairKey)) return;
      appointmentRepairRef.current.add(repairKey);

      void ensureAppointmentHistory(conversation.id, user.id, hostId)
        .then((created) => {
          if (created) console.info('[AppContext] Repaired appointment history:', conversation.id);
        })
        .catch((error) => {
          if (isRetryableNetworkError(error)) appointmentRepairRef.current.delete(repairKey);
          else console.warn('[AppContext] Appointment history repair skipped:', error?.message || error);
        });
    });

    return undefined;
  }, [availableProfilesById, cacheHydratedUserId, conversations, isOnline, pendingSyncCount, sharedProfilesById, user?.id]);

  useEffect(() => {
    if (!user?.id) appointmentRepairRef.current.clear();
  }, [user?.id]);

  // Publish this device's public key as soon as the account is online. The
  // private key never leaves SecureStore, so another participant can prepare
  // an encrypted conversation without learning it.
  useEffect(() => {
    if (!user?.id || !isOnline || cacheHydratedUserId !== user.id) return undefined;
    ensureEncryptionIdentity(user.id).catch((error) => {
      console.warn('[E2EE] Unable to publish this device key:', error?.message || error);
    });
    return undefined;
  }, [cacheHydratedUserId, isOnline, retryKey, user?.id]);

  // Keep the two decision listeners independent from the shared profile
  // snapshot. Profile changes now re-hydrate locally instead of tearing down
  // and recreating all decision listeners.
  useEffect(() => {
    // Decision listeners are also read-only. Let them start independently of
    // queued writes so the profile list can reconcile as soon as the server
    // snapshot is available.
    if (!user?.id || !isOnline || cacheHydratedUserId !== user.id) return undefined;
    const handleError = (error) => {
      console.error('[AppContext] Decisions subscription error:', error);
      if (!isRetryableNetworkError(error)) setDataError(error);
    };
    const unsubscribe = subscribeToUserDecisions(user.id, (next) => {
      setDecisionSnapshots(next);
      const latestProfiles = decisionProfileRecordsRef.current;
      const nextIncomingLikes = hydrateDecisionLikes(next.incomingDecisions, latestProfiles, 'incoming');
      const nextOutgoingLikes = hydrateDecisionLikes(next.outgoingDecisions, latestProfiles, 'outgoing');
      setIncomingLikes((currentLikes) => (
        areDiscoveryProfileListsEqual(currentLikes, nextIncomingLikes) ? currentLikes : nextIncomingLikes
      ));
      setOutgoingLikes((currentLikes) => (
        areDiscoveryProfileListsEqual(currentLikes, nextOutgoingLikes) ? currentLikes : nextOutgoingLikes
      ));
    }, handleError);
    return () => {
      unsubscribe?.();
    };
  }, [cacheHydratedUserId, isOnline, retryKey, user?.id]);

  const outgoingDecisionSnapshot = decisionSnapshots?.outgoingDecisions || null;
  const remoteAvailableResult = useMemo(() => {
    // Discovery data must not wait for the decision listeners. A device can
    // have a pending offline queue, a slow decision query, or an empty local
    // decision cache while the public profile list is already available. In
    // that state we still show the server profiles and reconcile consumed
    // profiles as soon as the decision snapshot arrives.
    if (!profile || !user?.id || sharedProfiles.length === 0) return null;
    const outgoingDecisions = outgoingDecisionSnapshot?.outgoingDecisions
      || outgoingLikes.map((like) => ({
        toUserId: like.id,
        type: 'like',
        status: like.status || 'pending',
      }));
    return filterAvailableProfiles(
      user.id,
      {
        ...(profile.matchingPreferences || {}),
        currentFaculty: profile.faculty || '',
      },
      sharedProfiles,
      outgoingDecisions,
      profile
    );
  }, [outgoingDecisionSnapshot, outgoingLikes, profile, sharedProfiles, user?.id]);

  useEffect(() => {
    if (!decisionSnapshots || !decisionProfileRecords.length) return undefined;
    const nextIncomingLikes = hydrateDecisionLikes(decisionSnapshots.incomingDecisions, decisionProfileRecords, 'incoming');
    const nextOutgoingLikes = hydrateDecisionLikes(decisionSnapshots.outgoingDecisions, decisionProfileRecords, 'outgoing');
    setIncomingLikes((currentLikes) => (
      areDiscoveryProfileListsEqual(currentLikes, nextIncomingLikes) ? currentLikes : nextIncomingLikes
    ));
    setOutgoingLikes((currentLikes) => (
      areDiscoveryProfileListsEqual(currentLikes, nextOutgoingLikes) ? currentLikes : nextOutgoingLikes
    ));
    return undefined;
  }, [decisionProfileRecords, decisionSnapshots]);

  useEffect(() => {
    if (!remoteAvailableResult) return undefined;
    setAvailableProfiles((currentProfiles) => (
      areDiscoveryProfileListsEqual(currentProfiles, remoteAvailableResult.profiles)
        ? currentProfiles
        : remoteAvailableResult.profiles
    ));
    setRemovedUserIds((previousIds) => {
      const nextIds = remoteAvailableResult.removedUserIds;
      if (previousIds.size === nextIds.size && [...previousIds].every((id) => nextIds.has(id))) return previousIds;
      return nextIds;
    });
    setOptimisticHiddenIds((previousIds) => {
      const nextIds = previousIds.filter((id) => !remoteAvailableResult.removedUserIds.has(id));
      return nextIds.length === previousIds.length ? previousIds : nextIds;
    });
    return undefined;
  }, [remoteAvailableResult]);

  useEffect(() => {
    if (!user?.id || !availableProfiles.length) return undefined;
    const signature = availableProfiles.slice(0, 8).map((item) => item?.id).join(',');
    if (fastBootFeedSigRef.current === signature) return undefined;
    fastBootFeedSigRef.current = signature;
    saveFastBootData({ availableProfiles });
    return undefined;
  }, [availableProfiles, user?.id]);

  useEffect(() => {
    if (!user?.id || cacheHydratedUserId !== user.id) return undefined;
    let interactionTask = null;
    // Building the signature stringifies every conversation and message, so the
    // window is wide enough for a burst of incoming messages to collapse into
    // one pass. The snapshot is an offline cache; staleness here is harmless.
    const timer = setTimeout(() => {
      interactionTask = runAfterInteractionsHelper(() => {
        const snapshotData = {
          profile,
          conversations,
          hiddenConversationIds,
          availableProfiles,
          incomingLikes,
          outgoingLikes,
          appointments,
          campusSpots,
          selectedMeetup,
          optimisticHiddenIds,
          blockedUserIds,
        };
        const signature = getOfflineSnapshotSignature(snapshotData);
        const snapshotKey = `${user.id}:${signature}`;
        if (offlineSnapshotSignatureRef.current === snapshotKey) return;
        offlineSnapshotSignatureRef.current = snapshotKey;
        void saveOfflineSnapshot(user.id, snapshotData);
      });
    }, OFFLINE_SNAPSHOT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      interactionTask?.cancel?.();
    };
  }, [appointments, availableProfiles, blockedUserIds, cacheHydratedUserId, campusSpots, conversations, hiddenConversationIds, incomingLikes, outgoingLikes, optimisticHiddenIds, profile, selectedMeetup, user?.id]);

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
    const queueCount = await getOfflineQueueCount(user.id);
    if (queueCount === 0) {
      setPendingSyncCount(0);
      setLastSyncError(null);
      return;
    }
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
    () => incomingLikes.filter((item) => item.status === 'pending' && !blockedUserIds.includes(item.id)),
    [blockedUserIds, incomingLikes]
  );
  const acceptedIncomingLikes = useMemo(
    () => incomingLikes.filter((item) => item.status === 'accepted' && !blockedUserIds.includes(item.id)),
    [blockedUserIds, incomingLikes]
  );
  const pendingOutgoingLikes = useMemo(
    () => outgoingLikes.filter((item) => item.status === 'pending' && !blockedUserIds.includes(item.id)),
    [blockedUserIds, outgoingLikes]
  );

  // A paged discovery list cannot contain every profile referenced by a like.
  // Fetch only those missing IDs so the likes and matched-chat flows keep the
  // same behavior without restoring an unbounded profiles listener.
  useEffect(() => {
    if (!user?.id || !decisionSnapshots) return undefined;
    const loadedIds = new Set(sharedProfiles.map((item) => item.id));
    decisionProfilesById.forEach((_, id) => loadedIds.add(id));
    const referencedIds = [
      ...(decisionSnapshots.incomingDecisions || []),
      ...(decisionSnapshots.outgoingDecisions || []),
    ]
      .map((decision) => decision?.fromUserId === user.id ? decision.toUserId : decision?.fromUserId)
      .filter((id) => typeof id === 'string' && id !== user.id);
    const missingIds = [...new Set(referencedIds)].filter((id) => (
      !loadedIds.has(id) && !discoveryProfileFetchesRef.current.has(id)
    ));
    if (!missingIds.length) return undefined;

    missingIds.forEach((id) => discoveryProfileFetchesRef.current.add(id));
    let active = true;
    getPublicProfilesByIds(missingIds)
      .then((profiles) => {
        if (!active || !profiles.length) return;
        setDecisionProfiles((currentProfiles) => {
          const profilesById = new Map(currentProfiles.map((item) => [item.id, item]));
          let changed = false;
          profiles.forEach((item) => {
            const nextProfile = mergeProfileRecords(profilesById.get(item.id), item);
            if (profilesById.get(item.id) !== nextProfile) changed = true;
            profilesById.set(item.id, nextProfile);
          });
          return changed ? [...profilesById.values()] : currentProfiles;
        });
      })
      .catch((error) => {
        missingIds.forEach((id) => discoveryProfileFetchesRef.current.delete(id));
        if (!isRetryableNetworkError(error)) {
          console.warn('[AppContext] Decision profile hydration skipped:', error?.message || error);
        }
      });
    return () => {
      active = false;
    };
  }, [decisionProfilesById, decisionSnapshots, sharedProfiles, user?.id]);

  const visibleDiscoveryProfileCount = useMemo(() => {
    if (!remoteAvailableResult) return sharedProfiles.length === 0 ? 0 : null;
    const hiddenIds = new Set(optimisticHiddenIds);
    return remoteAvailableResult.profiles.reduce(
      (count, item) => count + (hiddenIds.has(item.id) ? 0 : 1),
      0
    );
  }, [optimisticHiddenIds, remoteAvailableResult, sharedProfiles.length]);

  // If a page contains no local match (or the user has consumed it), scan a
  // few more pages automatically. The cap keeps an account with no matching
  // profiles from turning the screen back into an unbounded read.
  useEffect(() => {
    if (
      !profile
      || !decisionSnapshots
      || !hasMoreDiscoveryProfiles
      || isLoadingMoreDiscoveryProfiles
      || visibleDiscoveryProfileCount == null
      || visibleDiscoveryProfileCount > 0
      || pendingIncomingLikes.length > 0
      || discoveryAutoLoadRef.current >= 3
    ) return undefined;
    discoveryAutoLoadRef.current += 1;
    void loadMoreDiscoveryProfiles();
    return undefined;
  }, [
    decisionSnapshots,
    hasMoreDiscoveryProfiles,
    isLoadingMoreDiscoveryProfiles,
    loadMoreDiscoveryProfiles,
    pendingIncomingLikes.length,
    profile,
    visibleDiscoveryProfileCount,
  ]);

  const cancelOutgoingLikeAction = async (candidate) => {
    if (!user?.id || !candidate?.id) return;
    const candidateId = candidate.id;
    const decisionId = candidate.decisionId || `${user.id}_${candidateId}`;
    setOutgoingLikes((prev) => prev.filter((item) => item.id !== candidateId));
    setOptimisticHiddenIds((prev) => prev.filter((id) => id !== candidateId));
    return runOrQueue(
      'cancelOutgoingLike',
      { otherUserId: candidateId, decisionId },
      () => cancelOutgoingLike(user.id, candidateId, decisionId),
      { dedupeKey: `cancelLike:${candidateId}` }
    );
  };
  const matchedProfileIds = useMemo(() => {
    const ids = activeConversations.flatMap((conversation) => {
      if (conversation.profileId) return [conversation.profileId];
      if (Array.isArray(conversation.participants)) {
        return conversation.participants.filter((participantId) => participantId && participantId !== user?.id);
      }
      return [];
    });
    return [...new Set(ids)];
  }, [activeConversations, user?.id]);

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

    try {
      return await runOrQueue('resetMatching', {}, async () => {
        const { db } = requireFirebase();
        const outgoingQuery = query(collection(db, 'decisions'), where('fromUserId', '==', user.id));
        const snapshot = await getDocs(outgoingQuery);
        await Promise.all(snapshot.docs.map((decisionDoc) => deleteDoc(decisionDoc.ref).catch((err) => {
          console.warn('[resetMatching] deleteDoc failed:', decisionDoc.id, err?.message || err);
        })));
      }, { dedupeKey: 'resetMatching' });
    } catch (error) {
      console.warn('[AppContext] resetMatching error:', error?.message || error);
    }
  };

  const recycleSkippedProfiles = async () => {
    if (!user?.id) return;
    setOptimisticHiddenIds([]);
    try {
      return await runOrQueue(
        'resetSkippedDecisions',
        {},
        () => resetSkippedDecisions(user.id),
        { dedupeKey: 'resetSkippedDecisions' }
      );
    } catch (error) {
      console.warn('[AppContext] recycleSkippedProfiles error:', error?.message || error);
    }
  };

  const respondToLike = async (candidate, response) => {
    if (!user?.id || (!candidate?.decisionId && !candidate?.id) || !['accept', 'reject'].includes(response)) return;
    const previousLikes = incomingLikes;
    const previousConversations = conversations;
    const previousHiddenConversationIds = hiddenConversationIds;
    const previousRemovedUserIds = removedUserIds;
    const previousOptimisticHiddenIds = optimisticHiddenIds;
    const decisionId = candidate.decisionId || `${candidate.id}_${user.id}`;
    const candidateWithDecision = { ...candidate, decisionId };
    const optimisticConversationId = `c-${[user.id, candidate.id].sort().join('-')}`;
    if (response === 'accept') {
      setRemovedUserIds((current) => {
        if (!current.has(candidate.id)) return current;
        const next = new Set(current);
        next.delete(candidate.id);
        return next;
      });
    }
    setIncomingLikes((current) => current.filter((item) => (item.decisionId || `${item.id}_${user.id}`) !== decisionId));
    if (response === 'accept' && profile) {
      const optimisticConversation = buildOptimisticConversation(user.id, profile, candidateWithDecision);
      setConversations((current) => (
        current.some((conversation) => conversation.id === optimisticConversation.id)
          ? current
          : [optimisticConversation, ...current]
      ));
    } else if (response === 'reject' && candidate.status === 'accepted') {
      const conversationId = `c-${[user.id, candidate.id].sort().join('-')}`;
      updateHiddenConversations((current) => (current.includes(conversationId) ? current : [...current, conversationId]));
      setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
      setOptimisticHiddenIds((current) => current.filter((id) => id !== candidate.id));
      hideConversation(conversationId, user.id).catch((e) => console.warn('[respondToLike] Failed to hide conversation:', e));
    }
    try {
      const result = await runOrQueue(
        'respondToLike',
        { candidate: candidateWithDecision, profile, response },
        () => persistLikeResponse(user.id, profile, candidateWithDecision, response),
        { dedupeKey: `respondLike:${decisionId}` }
      );
      if (response === 'accept') {
        // Offline operations return `{ queued: true }`, but the optimistic
        // room is already usable locally. Return its deterministic id so the
        // match action can open it without waiting for a message.
        return optimisticConversationId;
      }
      return result;
    } catch (error) {
      if (error?.code === 'not-found') {
        // A cleared server record can still be present in the encrypted local
        // snapshot until the realtime listener catches up. Do not resurrect
        // that ghost like after a failed response.
        setIncomingLikes((current) => current.filter((item) => (
          (item.decisionId || `${item.id}_${user.id}`) !== decisionId
        )));
      } else {
        setIncomingLikes(previousLikes);
      }
      setConversations(error?.code === 'not-found'
        ? previousConversations.filter((conversation) => conversation.id !== optimisticConversationId)
        : previousConversations);
      updateHiddenConversations(previousHiddenConversationIds);
      setRemovedUserIds(previousRemovedUserIds);
      setOptimisticHiddenIds(previousOptimisticHiddenIds);
      throw error;
    }
  };

  const ensureConversation = async (candidate) => {
    if (!user?.id || !profile || !candidate?.id) {
      throw new Error('ไม่พบข้อมูลสำหรับเปิดห้องแชต');
    }
    const conversationId = `c-${[user.id, candidate.id].sort().join('-')}`;
    const { db } = requireFirebase();
    const conversationRef = doc(db, 'conversations', conversationId);

    // A cached accepted like is not proof that the match still exists. This
    // is especially important after an admin cleanup or an unmatch: trusting
    // the cache here would recreate deleted decisions and conversations.
    // When offline, an already accepted local room can still be opened; no
    // server write is attempted until the queued operation is synchronized.
    const isLocallyAccepted = acceptedIncomingLikes.some((like) => like.id === candidate.id);
    let isMutualMatch = !isOnline && isLocallyAccepted;

    try {
      const readDecision = isOnline ? getDocFromServer : getDoc;
      const [myDecSnap, theirDecSnap] = await Promise.all([
        readDecision(doc(db, 'decisions', `${user.id}_${candidate.id}`)),
        readDecision(doc(db, 'decisions', `${candidate.id}_${user.id}`)),
      ]);
      const myDec = myDecSnap.exists() ? myDecSnap.data() : null;
      const theirDec = theirDecSnap.exists() ? theirDecSnap.data() : null;
      if (
        myDec?.status === 'accepted' && myDec?.type === 'like' &&
        theirDec?.status === 'accepted' && theirDec?.type === 'like'
      ) {
        isMutualMatch = true;
      }
    } catch (_) {
      // Keep only the offline-cache fallback above. An online read failure
      // must not turn stale local data into a new server match.
    }

    if (!isMutualMatch) {
      throw new Error('ยังไม่ได้จับคู่กัน ต้องกดใจทั้งสองฝ่ายหรือให้อีกฝ่ายรับเพื่อนก่อนจึงจะสามารถเปิดห้องแชตได้');
    }

    // Mutual match is confirmed. Check if conversation already exists in Firestore
    try {
      const existingSnap = await getDoc(conversationRef);
      if (existingSnap.exists()) {
        await unhideConversation(conversationId, user.id);
        setRemovedUserIds((current) => {
          if (!current.has(candidate.id)) return current;
          const next = new Set(current);
          next.delete(candidate.id);
          return next;
        });
        updateHiddenConversations((current) => current.filter((id) => id !== conversationId));
        const optimisticConversation = buildOptimisticConversation(user.id, profile, candidate);
        setConversations((current) => (
          current.some((c) => c.id === conversationId) ? current : [optimisticConversation, ...current]
        ));
        return conversationId;
      }
    } catch (_) {}

    updateHiddenConversations((current) => current.filter((id) => id !== conversationId));
    const optimisticConversation = buildOptimisticConversation(user.id, profile, candidate);
    setConversations((current) => (
      current.some((c) => c.id === conversationId) ? current : [optimisticConversation, ...current]
    ));

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

  // The other participant may complete the match on a different device. If
  // that device fails before creating the room, repair it as soon as this
  // device observes the accepted incoming decision. Room creation must not
  // depend on sending the first message.
  useEffect(() => {
    if (!user?.id || !profile || !isOnline || pendingSyncCount > 0 || cacheHydratedUserId !== user.id) return undefined;

    acceptedIncomingLikes.forEach((like) => {
      if (!like?.id) return;
      const conversationId = `c-${[user.id, like.id].sort().join('-')}`;
      const hasConversation = activeConversations.some((conversation) => (
        conversation.id === conversationId && !conversation.isHidden
      ));
      if (hasConversation || matchedConversationSyncRef.current.has(conversationId)) return;

      matchedConversationSyncRef.current.add(conversationId);
      void ensureConversation(like)
        .catch((error) => {
          console.warn('[AppContext] Failed to repair matched conversation:', error?.message || error);
        })
        .finally(() => {
          matchedConversationSyncRef.current.delete(conversationId);
        });
    });

    return undefined;
  }, [acceptedIncomingLikes, activeConversations, cacheHydratedUserId, isOnline, pendingSyncCount, profile, user?.id]);

  const removeConversation = useCallback(async (conversationId, targetOtherUserId) => {
    if (!user?.id || !conversationId) return;
    const resolvedOtherUserId = targetOtherUserId
      || conversationId.replace('c-', '').split('-').find((id) => id !== user.id);
    if (!resolvedOtherUserId || resolvedOtherUserId === user.id) {
      throw Object.assign(new Error('Conversation participant is unavailable'), { code: 'invalid-argument' });
    }

    // Wait for Firestore to accept the operation before changing local state.
    // This keeps a failed or offline delete visible instead of turning it into
    // a locally hidden conversation that looks as if it was deleted.
    const result = await runOrQueue(
      'unmatchUser',
      { otherUserId: resolvedOtherUserId },
      () => unmatchUser(user.id, resolvedOtherUserId),
      { dedupeKey: `unmatch:${conversationId}` }
    );

    // A queued operation has not changed Firestore yet, so keep the row until
    // the realtime listener reflects the successful sync.
    if (result?.queued) return result;
    // A stale cached row may no longer have a matching server record. Do not
    // hide it locally unless the delete operation actually changed something.
    if (result === false) return result;

    updateHiddenConversations((current) => (current.includes(conversationId) ? current : [...current, conversationId]));
    setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
    setRemovedUserIds((prev) => new Set([...prev, resolvedOtherUserId]));
    setOptimisticHiddenIds((current) => current.filter((id) => id !== resolvedOtherUserId));
    return result;
  }, [runOrQueue, updateHiddenConversations, user?.id]);

  const blockUser = useCallback(async (targetUserId, conversationId = null) => {
    if (!user?.id || !targetUserId) return;
    setBlockedUserIds((prev) => Array.from(new Set([...prev, targetUserId])));
    setRemovedUserIds((prev) => new Set([...prev, targetUserId]));
    setOptimisticHiddenIds((prev) => [...prev, targetUserId]);
    if (conversationId) {
      updateHiddenConversations((current) => (current.includes(conversationId) ? current : [...current, conversationId]));
      setConversations((current) => current.filter((conv) => conv.id !== conversationId));
    }
    await blockUserAccount(user.id, targetUserId, conversationId);
  }, [updateHiddenConversations, user?.id]);

  const unblockUser = useCallback(async (targetUserId) => {
    if (!user?.id || !targetUserId) return;
    setBlockedUserIds((prev) => prev.filter((id) => id !== targetUserId));
    await unblockUserAccount(user.id, targetUserId);
  }, [user?.id]);

  const reportContent = useCallback(async (reportData) => {
    if (!user?.id) throw new Error('กรุณาเข้าสู่ระบบก่อนส่งรายงาน');
    return submitContentReport({
      ...reportData,
      reporterId: user.id,
    });
  }, [user?.id]);

  const sendActivityInvite = async (candidate) => {
    if (!user?.id || !profile || !candidate?.id) {
      throw new Error('ไม่พบคู่สนทนาสำหรับส่งคำขอ');
    }
    const conversationId = `c-${[user.id, candidate.id].sort().join('-')}`;
    const alreadyMatched = acceptedIncomingLikes.some((like) => like.id === candidate.id)
      || (
        activeConversations.some((c) => c.id === conversationId && !c.isHidden)
        && !removedUserIds.has(candidate.id)
      );

    const activityName = candidate.meetup?.name || candidate.activityLabel || candidate.activity || 'ทำกิจกรรมที่สนใจ';
    const message = `สวัสดี! อยากชวนคุณ ${candidate.nickname || candidate.name} ไปร่วมกิจกรรม "${activityName}" ด้วยกันนะ 💬✨`;

    if (alreadyMatched) {
      const targetConversationId = await ensureConversation(candidate);
      await sendMessage(targetConversationId, message);
      return { matched: true, conversationId: targetConversationId };
    }

    // Not matched yet: Send like with invite message as pending decision
    setOptimisticHiddenIds((prev) => [...prev, candidate.id]);
    const result = await runOrQueue(
      'saveDecision',
      { otherUserId: candidate.id, decisionType: 'like', likeMessage: message, status: 'pending' },
      () => saveDecision(user.id, candidate.id, 'like', message, 'pending'),
      { dedupeKey: `decision:${candidate.id}` }
    );
    if (result?.matched) {
      const targetConversationId = await ensureConversation(candidate);
      updateHiddenConversations((current) => current.filter((id) => id !== targetConversationId));
      await sendMessage(targetConversationId, message);
      return { matched: true, conversationId: targetConversationId };
    }
    return { matched: false };
  };

  const matchProfile = async (candidate) => {
    if (!user?.id || !candidate?.id) return { matched: false };
    setRemovedUserIds((current) => {
      if (!current.has(candidate.id)) return current;
      const next = new Set(current);
      next.delete(candidate.id);
      return next;
    });
    setOptimisticHiddenIds((prev) => [...prev, candidate.id]);
    try {
      const isAlreadyAccepted = acceptedIncomingLikes.some((like) => like.id === candidate.id);
      const existingConvo = activeConversations.find(
        (c) => (c.profileId === candidate.id || c.participants?.includes(candidate.id)) && !c.isHidden
      );
      if (existingConvo && isAlreadyAccepted && !removedUserIds.has(candidate.id)) {
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
        const conversationId = await ensureConversation(candidate);
        updateHiddenConversations((current) => current.filter((id) => id !== conversationId));
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
    const targetConversation = conversations.find((conversation) => conversation.id === conversationId);
    if (targetConversation?.encryptionPending) {
      throw Object.assign(
        new Error('ห้องนี้กำลังรอคีย์เข้ารหัสจากผู้ร่วมสนทนา กรุณาให้อีกฝ่ายเปิดแอปเวอร์ชันล่าสุด'),
        { code: 'E2EE_KEY_MISSING' }
      );
    }
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
      ...(clientOptions.mediaType === 'video' ? {
        videoMode: clientOptions.videoMode,
        videoDuration: clientOptions.videoDuration,
        ...(Number.isFinite(clientOptions.videoStartMs) ? { videoStartMs: clientOptions.videoStartMs } : {}),
        ...(Number.isFinite(clientOptions.videoEndMs) ? { videoEndMs: clientOptions.videoEndMs } : {}),
      } : {}),
      ...(clientOptions.mediaType === 'image' && clientOptions.viewMode ? { viewMode: clientOptions.viewMode } : {}),
      ...(clientOptions.mediaType ? { mediaType: clientOptions.mediaType } : {}),
      ...(clientOptions.callType ? { callType: clientOptions.callType } : {}),
      ...(typeof clientOptions.callDuration === 'number' ? { callDuration: clientOptions.callDuration } : {}),
      ...(clientOptions.callStatus ? { callStatus: clientOptions.callStatus } : {}),
      ...(clientOptions.callTime ? { callTime: clientOptions.callTime } : {}),
      ...(clientOptions.mediaUrl ? { mediaUrl: clientOptions.mediaUrl } : {}),
      ...(Array.isArray(clientOptions.mediaUrls) ? { mediaUrls: clientOptions.mediaUrls } : {}),
      ...(typeof clientOptions.audioDuration === 'number' ? { audioDuration: clientOptions.audioDuration } : {}),
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
        lastMessageSenderId: user.id,
        lastMessageAt: clientOptions.clientSentAt,
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
      setConversations((current) => current.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        return {
          ...conversation,
          messages: (conversation.messages || []).map((msg) =>
            msg.id === clientOptions.clientMessageId ? { ...msg, pendingSync: false } : msg
          ),
        };
      }));
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
    const meetupOnly = Boolean(
      profileData
      && typeof profileData === 'object'
      && Object.keys(profileData).length === 1
      && Object.prototype.hasOwnProperty.call(profileData, 'meetup')
    );
    if (!user?.id) throw new Error('กรุณาเข้าสู่ระบบก่อนบันทึกโปรไฟล์');
    const nextProfileData = {
      ...profileData,
      ...(typeof profileData.name === 'string' ? { name: profileData.name.trim() } : {}),
    };
    const nextProfile = withProfileDefaults({
      ...profile,
      ...nextProfileData,
      id: user.id,
      email: user.email || profile?.email || '',
      // Keep a local revision so avatar caches invalidate immediately after
      // saving, before Firestore returns its server timestamp.
      updatedAt: Date.now(),
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
      avatarUri: nextProfile.avatarUri || nextProfile.photos?.[0] || user.photoURL,
      avatarColor: nextProfile.avatarColor || null,
      faculty: nextProfile.faculty || '',
      updatedAt: nextProfile.updatedAt,
    });
    const savedProfile = await runOrQueue(
      meetupOnly ? 'updateMeetup' : 'saveProfile',
      meetupOnly
        ? { meetup: nextProfile.meetup, privacy: nextProfile.privacy }
        : { profile: nextProfile },
      meetupOnly
        ? () => updateUserMeetup(user.id, nextProfile.meetup, nextProfile.privacy)
        : () => persistProfileToFirestore(user.id, nextProfile),
      { dedupeKey: meetupOnly ? 'saveMeetup' : 'saveProfile' }
    );
    // The focused meetup patch returns a boolean; the optimistic local state
    // above is already authoritative for this small update.
    if (savedProfile && !savedProfile.queued && !meetupOnly) {
      setProfile(withProfileDefaults(savedProfile));
    }
    return nextProfile;
  };

  const saveMatchingPreferences = async (matchingPreferences) => {
    if (!user?.id) throw new Error('กรุณาเข้าสู่ระบบก่อนบันทึกการตั้งค่าค้นหา');
    const nextPreferences = {
      ...(profile?.matchingPreferences || {}),
      ...matchingPreferences,
    };
    setProfile((current) => withProfileDefaults({
      ...(current || {}),
      matchingPreferences: nextPreferences,
    }));
    await runOrQueue(
      'saveMatchingPreferences',
      { matchingPreferences: nextPreferences },
      () => updateUserMatchingPreferences(user.id, nextPreferences),
      { dedupeKey: 'saveMatchingPreferences' }
    );
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
    const scheduleInfo = schedule
      ? withScheduleTimestamp(schedule)
      : { date: null, startTime: null, endTime: null };
    const scheduledAtText = schedule
      ? `${formatScheduleDate(scheduleInfo.date)} · ${scheduleInfo.startTime}–${scheduleInfo.endTime}`
      : 'ยังไม่ได้กำหนดเวลา';
    const newMeetup = { ...spot, schedule: scheduleInfo, scheduledAt: scheduledAtText };
    setSelectedMeetup(newMeetup);
    if (user?.id) {
      await saveProfile({ meetup: newMeetup });
    }
  };

  const updateMeetupSchedule = async (schedule) => {
    if (!selectedMeetup) return;
    const scheduleInfo = withScheduleTimestamp(schedule);
    const scheduledAtText = `${formatScheduleDate(scheduleInfo.date)} · ${scheduleInfo.startTime}–${scheduleInfo.endTime}`;
    const updatedMeetup = { ...selectedMeetup, schedule: scheduleInfo, scheduledAt: scheduledAtText };
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

  const toggleMeetupAcceptanceInChat = async (conversationId, hostUserId, spotName, meetup = null) => {
    if (!user?.id || !conversationId) return false;
    const currentConversation = conversations.find((conversation) => conversation.id === conversationId);
    if (currentConversation?.encryptionPending) return false;
    const currentlyAccepted = (currentConversation?.meetupAcceptedUsers || []).includes(user.id);
    const shouldAccept = !currentlyAccepted;

    const resolvedMeetup = meetup
      || currentConversation?.meetup
      || currentConversation?.selectedMeetup
      || currentConversation?.participantProfiles?.[hostUserId]?.meetup
      || null;

    if (shouldAccept) {
      if (resolvedMeetup && isMeetupExpired(resolvedMeetup)) {
        throw new Error('นัดหมายนี้เลยกำหนดเวลาแล้ว ไม่สามารถตอบรับได้');
      }
    } else {
      if (resolvedMeetup) {
        const cancelCheck = canCancelMeetup(resolvedMeetup);
        if (!cancelCheck.allowed) {
          throw new Error(cancelCheck.reason || 'ไม่อนุญาตให้ยกเลิกก่อนวันนัดจริง 1 วัน');
        }
      }
    }

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
        lastMessageSenderId: user.id,
        lastMessageAt: clientSentAt,
        updatedAt: clientSentAt,
      };
    }));
    const options = { shouldAccept, clientMessageId, clientSentAt, meetup: resolvedMeetup };
    await runOrQueue(
      'toggleMeetupAcceptance',
      { conversationId, hostUserId, spotName, options },
      () => toggleMeetupAcceptance(conversationId, user.id, hostUserId, spotName, options),
      { dedupeKey: `meetupAcceptance:${conversationId}:${user.id}` }
    );
    return shouldAccept;
  };

  const cancelAppointmentAction = useCallback(async (appointment) => {
    if (!user?.id || !appointment?.id) return false;
    const targetMeetup = appointment.meetup || appointment;
    const cancelCheck = canCancelMeetup(targetMeetup);
    if (!cancelCheck.allowed) {
      throw new Error(cancelCheck.reason || 'ไม่อนุญาตให้ยกเลิกก่อนวันนัดจริง 1 วัน');
    }
    const previousAppointments = appointments;
    const cancelledAt = Date.now();
    setAppointments((current) => {
      const exists = current.some((item) => item.id === appointment.id);
      if (exists) {
        return current.map((item) => (
          item.id === appointment.id
            ? { ...item, status: 'cancelled', cancelledBy: user.id, cancelledAt, updatedAt: cancelledAt }
            : item
        ));
      }
      return [...current, { ...appointment, status: 'cancelled', cancelledBy: user.id, cancelledAt, updatedAt: cancelledAt }];
    });

    if (appointment.conversationId) {
      const targetConv = conversations.find((c) => c.id === appointment.conversationId);
      const isAcceptedInConv = Array.isArray(targetConv?.meetupAcceptedUsers)
        && targetConv.meetupAcceptedUsers.includes(user.id);
      if (isAcceptedInConv) {
        setConversations((current) => current.map((c) => {
          if (c.id !== appointment.conversationId) return c;
          return {
            ...c,
            meetupAcceptedUsers: (c.meetupAcceptedUsers || []).filter((uid) => uid !== user.id),
          };
        }));
        void toggleMeetupAcceptanceInChat(
          appointment.conversationId,
          appointment.hostId || user.id,
          appointment.meetup?.name || 'จุดนัดพบ',
          appointment.meetup
        ).catch((e) => console.warn('[AppContext] Could not un-accept in chat:', e));
      }
    }

    try {
      const firestoreResult = await runOrQueue(
        'cancelAppointment',
        { appointmentId: appointment.id },
        () => cancelAppointment(appointment.id, user.id),
        { dedupeKey: `cancelAppointment:${appointment.id}` }
      );
      return firestoreResult !== false || Boolean(appointment.isConversationDerived);
    } catch (error) {
      if (appointment.isConversationDerived) {
        return true;
      }
      setAppointments(previousAppointments);
      throw error;
    }
  }, [appointments, conversations, runOrQueue, toggleMeetupAcceptanceInChat, user?.id]);

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
    const previousReactionTime = currentMessage?.reactionTimes?.[user.id] || null;
    const nextReaction = previousReaction === emoji ? null : emoji;
    const nextReactionTime = nextReaction ? Date.now() : null;

    const applyLocalReaction = (reaction, expectedReaction, reactionTime) => {
      setConversations((currentConversations) => currentConversations.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        let messageChanged = false;
        const messages = (conversation.messages || []).map((message) => {
          if (message.id !== messageId) return message;
          const reactions = { ...(message.reactions || {}) };
          const reactionTimes = { ...(message.reactionTimes || {}) };
          const currentReaction = reactions[user.id] || null;

          // Rollbacks should not overwrite a newer tap that has already changed
          // this message again while the previous Firestore request was pending.
          if (expectedReaction !== undefined && currentReaction !== expectedReaction) return message;
          if (reaction) {
            if (currentReaction === reaction) return message;
            reactions[user.id] = reaction;
            if (reactionTime) reactionTimes[user.id] = reactionTime;
            else delete reactionTimes[user.id];
          } else {
            if (!Object.prototype.hasOwnProperty.call(reactions, user.id)) return message;
            delete reactions[user.id];
            delete reactionTimes[user.id];
          }
          messageChanged = true;
          return { ...message, reactions, reactionTimes };
        });
        return messageChanged ? { ...conversation, messages } : conversation;
      }));
    };

    // Show the reaction immediately while Firestore completes its transaction.
    applyLocalReaction(nextReaction, undefined, nextReactionTime);
    try {
      await runOrQueue(
        'reactToMessage',
        { conversationId, messageId, emoji, desiredReaction: nextReaction },
        () => reactToMessage(conversationId, messageId, user.id, emoji, nextReaction)
      );
      return true;
    } catch (error) {
      applyLocalReaction(previousReaction, nextReaction, previousReactionTime);
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

    liveConversations.forEach((conv) => {
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
  }, [liveConversations, user?.id]);

  const filteredAvailableProfiles = useMemo(() => {
    if (optimisticHiddenIds.length === 0 && blockedUserIds.length === 0) return availableProfiles;
    const hiddenIds = new Set([...optimisticHiddenIds, ...blockedUserIds]);
    return availableProfiles.filter((profileItem) => !hiddenIds.has(profileItem.id));
  }, [availableProfiles, blockedUserIds, optimisticHiddenIds]);

  const combinedAppointments = useMemo(() => {
    const result = [];
    const seenAppointmentIds = new Set();
    const seenConversationHostKeys = new Set();
    const currentUserId = user?.id;

    (appointments || []).forEach((apt) => {
      if (!apt?.id) return;
      result.push(apt);
      seenAppointmentIds.add(apt.id);
      if (apt.conversationId && apt.hostId) {
        seenConversationHostKeys.add(`${apt.conversationId}:${apt.hostId}`);
      }
    });

    if (!currentUserId) return result;

    (liveConversations || []).forEach((conv) => {
      if (!conv?.id || !Array.isArray(conv.participants)) return;
      const otherUserId = conv.profileId
        || conv.participants.find((p) => p !== currentUserId);
      if (!otherUserId) return;

      const acceptedUsers = Array.isArray(conv.meetupAcceptedUsers) ? conv.meetupAcceptedUsers : [];
      const isAcceptedByMe = acceptedUsers.includes(currentUserId);
      const isAcceptedByOther = acceptedUsers.includes(otherUserId);

      const otherProfile = conv.participantProfiles?.[otherUserId]
        || sharedProfilesById.get(otherUserId)
        || availableProfilesById.get(otherUserId)
        || {};

      const partnerMeetup = otherProfile.meetup
        || otherProfile.selectedMeetup
        || conv.participantProfiles?.[otherUserId]?.meetup
        || conv.participantProfiles?.[otherUserId]?.selectedMeetup
        || (conv.hostId === otherUserId ? conv.meetup : null)
        || conv.meetup
        || null;

      const partnerDate = partnerMeetup?.schedule?.date
        || (partnerMeetup?.scheduledFor ? String(partnerMeetup.scheduledFor) : null);

      // 1. Meetup created by the other person (hostId = otherUserId)
      if (partnerMeetup && partnerDate) {
        const appointmentId = `a-${conv.id}-${otherUserId}`;
        const hostKey = `${conv.id}:${otherUserId}`;

        if (!seenConversationHostKeys.has(hostKey) && !seenAppointmentIds.has(appointmentId)) {
          if (isAcceptedByMe) {
            seenAppointmentIds.add(appointmentId);
            seenConversationHostKeys.add(hostKey);
            result.push({
              id: appointmentId,
              conversationId: conv.id,
              hostId: otherUserId,
              guestId: currentUserId,
              participants: [otherUserId, currentUserId].sort(),
              meetup: partnerMeetup,
              schedule: partnerMeetup.schedule || {},
              scheduledFor: partnerMeetup.schedule?.scheduledFor || partnerMeetup.scheduledFor || null,
              status: 'active',
              isConversationDerived: true,
              isHost: false,
              createdAt: conv.updatedAt || Date.now(),
              updatedAt: conv.updatedAt || Date.now(),
            });
          } else {
            // Proposed meetup from the other person
            const proposedId = `proposed-${conv.id}-${otherUserId}`;
            if (!seenAppointmentIds.has(proposedId)) {
              seenAppointmentIds.add(proposedId);
              result.push({
                id: proposedId,
                conversationId: conv.id,
                hostId: otherUserId,
                guestId: currentUserId,
                participants: [otherUserId, currentUserId].sort(),
                meetup: partnerMeetup,
                schedule: partnerMeetup.schedule || {},
                scheduledFor: partnerMeetup.schedule?.scheduledFor || partnerMeetup.scheduledFor || null,
                status: 'pending',
                isConversationDerived: true,
                isHost: false,
                createdAt: conv.updatedAt || Date.now(),
                updatedAt: conv.updatedAt || Date.now(),
              });
            }
          }
        }
      }

      // 2. Meetup created by current user (hostId = currentUserId)
      const myMeetup = profile?.meetup
        || selectedMeetup
        || conv.participantProfiles?.[currentUserId]?.meetup
        || (conv.hostId === currentUserId ? conv.meetup : null)
        || null;

      const myDate = myMeetup?.schedule?.date
        || (myMeetup?.scheduledFor ? String(myMeetup.scheduledFor) : null);

      if (myMeetup && myDate) {
        const myAppointmentId = `a-${conv.id}-${currentUserId}`;
        const myHostKey = `${conv.id}:${currentUserId}`;

        if (!seenConversationHostKeys.has(myHostKey) && !seenAppointmentIds.has(myAppointmentId)) {
          if (isAcceptedByOther) {
            seenAppointmentIds.add(myAppointmentId);
            seenConversationHostKeys.add(myHostKey);
            result.push({
              id: myAppointmentId,
              conversationId: conv.id,
              hostId: currentUserId,
              guestId: otherUserId,
              participants: [currentUserId, otherUserId].sort(),
              meetup: myMeetup,
              schedule: myMeetup.schedule || {},
              scheduledFor: myMeetup.schedule?.scheduledFor || myMeetup.scheduledFor || null,
              status: 'active',
              isConversationDerived: true,
              isHost: true,
              createdAt: conv.updatedAt || Date.now(),
              updatedAt: conv.updatedAt || Date.now(),
            });
          }
        }
      }
    });

    return result;
  }, [appointments, availableProfilesById, liveConversations, profile, selectedMeetup, sharedProfilesById, user?.id]);

  const activeUserId = user?.id || profile?.id;
  const totalUnreadMessages = useMemo(() => {
    if (!activeUserId || !Array.isArray(activeConversations)) return 0;
    return activeConversations.reduce((sum, item) => {
      const count = item.unreadCounts?.[activeUserId] || item.unread || 0;
      return sum + (typeof count === 'number' && count > 0 ? count : 0);
    }, 0);
  }, [activeConversations, activeUserId]);

  useEffect(() => {
    if (user?.id) {
      void updateNotificationBadgeAsync(totalUnreadMessages);
    } else {
      void clearNotificationBadgeAsync();
    }
  }, [totalUnreadMessages, user?.id]);

  // Most actions below are re-created on every render. Calls are routed through
  // a ref so the exposed identities stay stable without capturing stale state.
  const latestActionsRef = useRef(null);
  latestActionsRef.current = {
    blockUser,
    cancelAppointment: cancelAppointmentAction,
    cancelOutgoingLike: cancelOutgoingLikeAction,
    chooseMeetup,
    clearMeetup,
    deleteMessageForMeInChat,
    dismissProfile,
    ensureConversation,
    getMeetupStats,
    loadMoreProfiles: loadMoreDiscoveryProfiles,
    markAsRead,
    matchProfile,
    reactToMessageInChat,
    recycleSkippedProfiles,
    removeConversation,
    reportContent,
    resetMatching,
    respondToLike,
    saveMatchingPreferences,
    saveProfile,
    sendActivityInvite,
    sendMessage,
    syncNow,
    toggleMeetupAcceptanceInChat,
    unblockUser,
    unsendMessageInChat,
    updateChatSettingsInChat,
    updateMeetupSchedule,
    deleteAccount: async () => {
      if (!user?.id) throw new Error('กรุณาเข้าสู่ระบบก่อนลบบัญชี');
      await deleteAccountData(user.id);
    },
  };

  const actions = useMemo(() => {
    const bound = {};
    Object.keys(latestActionsRef.current).forEach((name) => {
      bound[name] = (...args) => latestActionsRef.current[name](...args);
    });
    bound.showPrivacyPolicy = () => setShowPrivacyPolicy(true);
    bound.hidePrivacyPolicy = () => setShowPrivacyPolicy(false);
    return bound;
  }, []);

  const profileSlice = useMemo(
    () => ({ profile, profileLoading }),
    [profile, profileLoading],
  );

  const pendingLikeCount = pendingIncomingLikes.length;
  const badgeSlice = useMemo(
    () => ({ pendingLikeCount, totalUnreadMessages }),
    [pendingLikeCount, totalUnreadMessages],
  );

  const conversationsSlice = useMemo(() => ({
    allConversations: liveConversations,
    availableProfiles: filteredAvailableProfiles,
    conversations: activeConversations,
    hiddenConversationIds,
    totalUnreadMessages,
  }), [
    activeConversations,
    filteredAvailableProfiles,
    hiddenConversationIds,
    liveConversations,
    totalUnreadMessages,
  ]);

  const syncSlice = useMemo(() => ({
    isOnline,
    isSyncing,
    lastSyncError,
    lastSyncedAt,
    networkReady,
    pendingSyncCount,
  }), [isOnline, isSyncing, lastSyncError, lastSyncedAt, networkReady, pendingSyncCount]);

  const value = useMemo(() => ({
    ...actions,
    profile,
    profileLoading,
    conversations: activeConversations,
    allConversations: liveConversations,
    totalUnreadMessages,
    hiddenConversationIds,
    availableProfiles: filteredAvailableProfiles,
    hasMoreProfiles: hasMoreDiscoveryProfiles,
    isLoadingMoreProfiles: isLoadingMoreDiscoveryProfiles,
    matchedProfileIds,
    incomingLikes,
    pendingIncomingLikes,
    acceptedIncomingLikes,
    outgoingLikes,
    pendingOutgoingLikes,
    appointments: combinedAppointments,
    campusSpots: computedSpots,
    selectedMeetup,
    blockedUserIds,
    isOnline,
    networkReady,
    pendingSyncCount,
    isSyncing,
    lastSyncedAt,
    lastSyncError,
    privacyPolicyVisible: showPrivacyPolicy,
  }), [
    acceptedIncomingLikes,
    actions,
    activeConversations,
    combinedAppointments,
    blockedUserIds,
    computedSpots,
    filteredAvailableProfiles,
    hasMoreDiscoveryProfiles,
    hiddenConversationIds,
    incomingLikes,
    liveConversations,
    matchedProfileIds,
    outgoingLikes,
    pendingOutgoingLikes,
    isOnline,
    isLoadingMoreDiscoveryProfiles,
    isSyncing,
    lastSyncError,
    lastSyncedAt,
    networkReady,
    pendingIncomingLikes,
    pendingSyncCount,
    profile,
    profileLoading,
    selectedMeetup,
    showPrivacyPolicy,
    totalUnreadMessages,
  ]);


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
    console.log('Consent accepted, dismissing...');
    setConsentDismissed(true);
    if (user?.id) {
      try {
        await saveProfile({ consentAcceptedAt: Date.now() });
      } catch (err) {
        console.error('Error saving consent:', err);
      }
    }
  };

  return (
    <AppActionsContext.Provider value={actions}>
      <AppProfileContext.Provider value={profileSlice}>
        <AppBadgeContext.Provider value={badgeSlice}>
          <AppConversationsContext.Provider value={conversationsSlice}>
            <AppSyncContext.Provider value={syncSlice}>
              <AppContext.Provider value={value}>
                {children}
                {(needsConsent && !consentDismissed) ? (
                  <ConsentModal
                    visible={true}
                    onAccept={handleConsentAccept}
                    onViewPolicy={() => setShowPrivacyPolicy(true)}
                  />
                ) : null}
              </AppContext.Provider>
            </AppSyncContext.Provider>
          </AppConversationsContext.Provider>
        </AppBadgeContext.Provider>
      </AppProfileContext.Provider>
    </AppActionsContext.Provider>
  );
}

function useAppSlice(context, hookName) {
  const slice = useContext(context);
  if (!slice) throw new Error(`${hookName} ต้องอยู่ภายใน AppProvider`);
  return slice;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp ต้องอยู่ภายใน AppProvider');
  return context;
}

/** Stable action identities. Never changes, so it is safe in dependency arrays. */
export function useAppActions() {
  return useAppSlice(AppActionsContext, 'useAppActions');
}

export function useAppProfile() {
  return useAppSlice(AppProfileContext, 'useAppProfile');
}

/** Unread and pending-like counts only — does not change when message bodies do. */
export function useAppBadges() {
  return useAppSlice(AppBadgeContext, 'useAppBadges');
}

export function useAppConversations() {
  return useAppSlice(AppConversationsContext, 'useAppConversations');
}

export function useAppSync() {
  return useAppSlice(AppSyncContext, 'useAppSync');
}
