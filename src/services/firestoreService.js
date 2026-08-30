import {
  Timestamp,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getCurrentUserIdToken } from './authService';
import { requireFirebase } from './dbService';
import * as FileSystem from 'expo-file-system/legacy';

const publicProfileFields = [
  'name',
  'nickname',
  'age',
  'faculty',
  'year',
  'activity',
  'activities',
  'activityLabel',
  'skill',
  'pace',
  'availability',
  'bio',
  'avatar',
  'avatarColor',
  'avatarUri',
  'compatibility',
  'latitude',
  'longitude',
  'tags',
  'interests',
  'gender',
  'meetup',
];

const privateProfileFields = [
  ...publicProfileFields,
  'privacy',
  'matchingPreferences',
  'notificationsEnabled',
];

function withoutUndefined(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj
      .filter((item) => item !== undefined)
      .map((item) => withoutUndefined(item));
  }
  if (
    typeof obj.toDate === 'function'
    || obj instanceof Date
    || obj.constructor?.name === 'FieldValue'
    || obj.constructor?.name === 'ServerTimestampTransform'
    || obj._methodName
  ) {
    return obj;
  }
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = withoutUndefined(value);
    }
  }
  return result;
}

function toPublicProfile(userId, data) {
  const privacy = data.privacy || {};
  const profile = { id: userId };
  const alwaysVisibleFields = [
    'name',
    'nickname',
    'bio',
    'avatar',
    'avatarColor',
    'avatarUri',
    'compatibility',
    'tags',
    'interests',
    'latitude',
    'longitude',
    'meetup',
  ];
  const visibilityByField = {
    age: privacy.showAge !== false,
    gender: privacy.showGender !== false,
    faculty: privacy.showFaculty !== false,
    year: privacy.showFaculty !== false,
    activity: privacy.showActivity !== false,
    activities: privacy.showActivity !== false,
    activityLabel: privacy.showActivity !== false,
    skill: privacy.showActivity !== false,
    pace: privacy.showActivity !== false,
    availability: privacy.showAvailability !== false,
  };

  publicProfileFields.forEach((field) => {
    if (
      data[field] !== undefined
      && (alwaysVisibleFields.includes(field) || visibilityByField[field] !== false)
    ) {
      profile[field] = data[field];
    }
  });
  profile.isDiscoverable = data.isDiscoverable !== false;
  return withoutUndefined(profile);
}

function toConversationProfile(userId, data) {
  const publicProfile = toPublicProfile(userId, data);
  const profile = { id: userId, isDiscoverable: publicProfile.isDiscoverable === true };
  const textLimits = {
    name: 100,
    nickname: 100,
    faculty: 100,
    year: 50,
    activity: 100,
    activityLabel: 100,
    availability: 100,
    location: 200,
    bio: 1000,
    avatar: 100,
    avatarColor: 50,
    avatarUri: 2000,
    gender: 100,
  };

  Object.entries(textLimits).forEach(([field, maxLength]) => {
    if (typeof publicProfile[field] === 'string') {
      profile[field] = publicProfile[field].slice(0, maxLength);
    }
  });
  if (typeof publicProfile.age === 'number' && publicProfile.age >= 18 && publicProfile.age <= 100) {
    profile.age = publicProfile.age;
  }
  if (publicProfile.meetup || data.meetup || data.selectedMeetup) {
    profile.meetup = publicProfile.meetup || data.meetup || data.selectedMeetup;
  }
  return profile;
}

function getRealDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0;
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
}

function getDistanceBetweenProfiles(p1, p2) {
  if (!p1 || !p2 || p1.latitude == null || p2.latitude == null) {
    // Fallback pseudo distance if GPS is missing
    const str = [p1?.id || 'a', p2?.id || 'b'].sort().join('');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return (Math.abs(hash) % 50) + 1;
  }
  return getRealDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
}

/**
 * คำนวณระยะห่างจริง (กม.) ระหว่างตำแหน่ง GPS ผู้ใช้กับสถานที่
 * คืนค่า null ถ้าไม่มีพิกัดฝั่งใดฝั่งหนึ่ง
 */
export function getSpotDistanceFromUser(userProfile, spot) {
  const coordinates = [
    userProfile?.latitude,
    userProfile?.longitude,
    spot?.latitude,
    spot?.longitude,
  ];
  if (coordinates.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    return null;
  }
  return getRealDistance(...coordinates);
}

/**
 * แปลงระยะทาง (กม.) เป็นข้อความภาษาไทย เช่น "ห่าง 350 ม." หรือ "ห่าง 1.2 กม."
 */
export function formatDistance(km) {
  if (typeof km !== 'number' || !Number.isFinite(km)) return 'เปิด GPS เพื่อดูระยะทาง';
  if (km < 1) {
    const meters = Math.round(km * 1000);
    return `ห่าง ${meters} ม.`;
  }
  return `ห่าง ${km.toFixed(1)} กม.`;
}

function matchesPreferences(profile, preferences = {}, currentUserProfile = null) {
  if (currentUserProfile && preferences.maxDistance) {
    const dist = getDistanceBetweenProfiles(currentUserProfile, profile);
    if (dist > preferences.maxDistance) return false;
  }

  // "Same faculty" and a specifically selected faculty are mutually exclusive.
  // Prefer the user's own faculty when sameFacultyOnly is enabled so stale
  // persisted values cannot combine into an impossible filter.
  const facultyFilter = preferences.sameFacultyOnly
    ? preferences.currentFaculty
    : (preferences.faculty && preferences.faculty !== 'all' ? preferences.faculty : null);
  if (facultyFilter && profile.faculty !== facultyFilter) {
    return false;
  }
  if (preferences.ageMin && profile.age && profile.age < preferences.ageMin) return false;
  if (preferences.ageMax && profile.age && profile.age > preferences.ageMax) return false;
  if (preferences.genders?.length && profile.gender && !preferences.genders.includes(profile.gender)) {
    return false;
  }
  if (preferences.years?.length && profile.year && !preferences.years.includes(profile.year)) {
    return false;
  }
  if (preferences.activities?.length && profile.activity && !preferences.activities.includes(profile.activity)) {
    return false;
  }
  return true;
}

function toMillis(value) {
  if (typeof value === 'number') return value;
  if (value?.toMillis) return value.toMillis();
  return 0;
}

function formatLikeTime(value) {
  const millis = toMillis(value);
  if (!millis) return 'เมื่อสักครู่';
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(millis));
}



export async function uploadImage(uri, userId) {
  if (!uri || !userId) return null;
  const workerUrl = (process.env.EXPO_PUBLIC_WORKER_URL || 'https://campusmate-upload.comcamp.workers.dev').replace(/\/$/, '');

  const idToken = await getCurrentUserIdToken();

  // If local file, use FileSystem.uploadAsync for reliable native upload
  if (uri.startsWith('file://')) {
    const uploadResult = await FileSystem.uploadAsync(
      `${workerUrl}/avatar/${encodeURIComponent(userId)}`,
      uri,
      {
        httpMethod: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'image/jpeg',
        },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      }
    );

    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      let errorMsg = 'อัปโหลดรูปภาพไม่สำเร็จ';
      try {
        const body = JSON.parse(uploadResult.body);
        if (body.error) errorMsg = body.error;
      } catch {}
      throw new Error(errorMsg);
    }

    const result = JSON.parse(uploadResult.body);
    return result.url;
  }

  // If data: URI or base64, convert to temporary local file first, then upload
  if (uri.startsWith('data:')) {
    const base64Data = uri.split(',')[1] || uri;
    const tempFileUri = `${FileSystem.cacheDirectory}upload_temp_${Date.now()}.jpg`;
    await FileSystem.writeAsStringAsync(tempFileUri, base64Data, {
      encoding: FileSystem.EncodingType.Base64,
    });
    try {
      const uploadResult = await FileSystem.uploadAsync(
        `${workerUrl}/avatar/${encodeURIComponent(userId)}`,
        tempFileUri,
        {
          httpMethod: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'image/jpeg',
          },
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        }
      );

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        let errorMsg = 'อัปโหลดรูปภาพไม่สำเร็จ';
        try {
          const body = JSON.parse(uploadResult.body);
          if (body.error) errorMsg = body.error;
        } catch {}
        throw new Error(errorMsg);
      }
      const result = JSON.parse(uploadResult.body);
      return result.url;
    } finally {
      await FileSystem.deleteAsync(tempFileUri, { idempotent: true }).catch(() => {});
    }
  }

  return uri;
}

export async function getUserProfile(userId) {
  if (!userId) return null;
  const { db } = requireFirebase();
  const [privateSnapshot, publicSnapshot] = await Promise.all([
    getDoc(doc(db, 'users', userId)),
    getDoc(doc(db, 'profiles', userId)),
  ]);

  if (!privateSnapshot.exists() && !publicSnapshot.exists()) return null;
  return {
    id: userId,
    ...(publicSnapshot.exists() ? publicSnapshot.data() : {}),
    ...(privateSnapshot.exists() ? privateSnapshot.data() : {}),
  };
}

export async function createUserProfile(userId, data) {
  const { db } = requireFirebase();
  const batch = writeBatch(db);
  const privateData = {
    id: userId,
    email: data.email || '',
    isNewUser: data.isNewUser !== false,
    isDiscoverable: data.isDiscoverable !== false,
    updatedAt: serverTimestamp(),
  };
  privateProfileFields.forEach((field) => {
    if (data[field] !== undefined) privateData[field] = data[field];
  });
  const publicData = {
    ...toPublicProfile(userId, data),
    updatedAt: serverTimestamp(),
  };

  batch.set(doc(db, 'users', userId), withoutUndefined(privateData), { merge: true });
  batch.set(doc(db, 'profiles', userId), withoutUndefined(publicData));
  await batch.commit();

  // อัพเดท participantProfiles ใน conversations ที่ user นี้เป็นสมาชิก
  // เพื่อให้อีกเครื่องเห็นชื่อ/รูปที่เปลี่ยนแปลงทันที
  try {
    const convQuery = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', userId)
    );
    const convSnapshot = await getDocs(convQuery);
    if (!convSnapshot.empty) {
      const convBatch = writeBatch(db);
      const updatedProfile = toConversationProfile(userId, data);
      convSnapshot.docs.forEach((convDoc) => {
        convBatch.update(convDoc.ref, {
          [`participantProfiles.${userId}`]: withoutUndefined(updatedProfile),
          updatedAt: serverTimestamp(),
        });
      });
      await convBatch.commit();
    }
  } catch (error) {
    // ถ้าอัพเดท conversations ไม่สำเร็จ ไม่ต้อง throw — โปรไฟล์หลักอัพเดทแล้ว
    console.error('[createUserProfile] Failed to sync conversations:', error);
  }
}

export function subscribeToSpots(callback, onError) {
  const { db } = requireFirebase();
  return onSnapshot(
    collection(db, 'spots'),
    (snapshot) => callback(snapshot.docs.map((spotDoc) => ({ id: spotDoc.id, ...spotDoc.data() }))),
    onError
  );
}

export function subscribeToAvailableProfiles(currentUserId, preferences, callback, onError) {
  const { db } = requireFirebase();
  let profiles = [];
  let outgoingDecisions = [];

  const emit = () => {
    // เมื่อผู้ใช้กดแมต/ถูกใจหรือกดข้ามแล้ว ให้ซ่อนทันทีจาก discover pool
    // เพื่อไม่ให้โปรไฟล์เดียวกันกลับมาปรากฏก่อนที่คิวจะ refresh ใหม่
    const hiddenIds = new Set(
      outgoingDecisions
        .filter((d) => (
          d.type === 'skip'
          || (d.type === 'like' && d.status !== 'rejected' && d.status !== 'removed')
          || d.status === 'accepted'
          || d.status === 'removed'
        ))
        .map((d) => d.toUserId)
    );
    const currentUserProfile = profiles.find(p => p.id === currentUserId);
    const filtered = profiles.filter((profile) => (
      profile.id !== currentUserId
      && profile.isDiscoverable !== false
      && !hiddenIds.has(profile.id)
      && matchesPreferences(profile, preferences, currentUserProfile)
    ));
    
    // Attach the real distance and matched status so UI can display it
    callback(filtered.map(profile => {
      const isMatched = outgoingDecisions.some(d => d.toUserId === profile.id && d.status === 'accepted');
      return {
        ...profile,
        isMatched,
        distance: getDistanceBetweenProfiles(currentUserProfile, profile),
      };
    }));
  };

  const unsubscribeProfiles = onSnapshot(
    collection(db, 'profiles'),
    (snapshot) => {
      profiles = snapshot.docs.map((profileDoc) => ({ id: profileDoc.id, ...profileDoc.data() }));
      emit();
    },
    onError
  );

  const outgoingQuery = query(
    collection(db, 'decisions'),
    where('fromUserId', '==', currentUserId)
  );
  const unsubscribeDecisions = onSnapshot(
    outgoingQuery,
    (snapshot) => {
      outgoingDecisions = snapshot.docs.map((decisionDoc) => ({ id: decisionDoc.id, ...decisionDoc.data() }));
      emit();
    },
    onError
  );

  return () => {
    unsubscribeProfiles();
    unsubscribeDecisions();
  };
}

export function subscribeToIncomingLikes(currentUserId, callback, onError) {
  const { db } = requireFirebase();
  const incomingQuery = query(
    collection(db, 'decisions'),
    where('toUserId', '==', currentUserId)
  );

  let latestDecisions = [];
  let profilesCache = {};

  const hydrate = () => {
    const likeDocs = latestDecisions
      .filter((d) => d.type === 'like' && d.status !== 'removed' && d.status !== 'rejected');

    const hydratedLikes = likeDocs.map((decision) => {
      const profileData = profilesCache[decision.fromUserId];
      if (!profileData) return null;
      return {
        id: decision.fromUserId,
        ...profileData,
        decisionId: decision.decisionId,
        status: decision.status || 'pending',
        likeMessage: decision.likeMessage || '',
        likedAt: formatLikeTime(decision.createdAt),
        createdAt: decision.createdAt,
      };
    });

    callback(
      hydratedLikes
        .filter(Boolean)
        .sort((first, second) => toMillis(second.createdAt) - toMillis(first.createdAt))
    );
  };

  // Subscribe ทั้ง decisions และ profiles เพื่อให้ข้อมูลอัพเดทแบบ real-time
  const unsubDecisions = onSnapshot(
    incomingQuery,
    (snapshot) => {
      latestDecisions = snapshot.docs.map((d) => ({
        decisionId: d.id,
        ...d.data(),
      }));
      hydrate();
    },
    onError
  );

  const unsubProfiles = onSnapshot(
    collection(db, 'profiles'),
    (snapshot) => {
      profilesCache = {};
      snapshot.docs.forEach((d) => {
        profilesCache[d.id] = d.data();
      });
      hydrate();
    },
    onError
  );

  return () => {
    unsubDecisions();
    unsubProfiles();
  };
}

export function subscribeToConversations(currentUserId, callback, onError) {
  const { db } = requireFirebase();
  console.log('[Firestore] Subscribing to conversations for user:', currentUserId);
  let previousEntries = new Map();
  let previousConversations = null;
  const conversationsQuery = query(
    collection(db, 'conversations'),
    where('participants', 'array-contains', currentUserId)
  );

  return onSnapshot(
    conversationsQuery,
    (snapshot) => {
      console.log(`[Firestore] onSnapshot conversations: ${snapshot.docs.length} docs found for user ${currentUserId}`);
      const nextEntries = new Map();
      const conversations = snapshot.docs.map((conversationDoc) => {
        const data = conversationDoc.data();
        const otherUserId = data.participants?.find((participantId) => participantId !== currentUserId);
        const otherProfile = data.participantProfiles?.[otherUserId] || {};
        const messages = (data.messages || [])
          .map((message, index) => ({
            ...message,
            id: message.id || `${conversationDoc.id}-m-${toMillis(message.createdAt || message.time)}-${message.senderId || message.sender || 'unknown'}-${index}`,
            sender: message.senderId
              ? (message.senderId === currentUserId ? 'me' : 'other')
              : message.sender,
          }))
          .filter((message) => !(message.hiddenFor || []).includes(currentUserId))
          .sort((first, second) => toMillis(first.createdAt || first.time) - toMillis(second.createdAt || second.time));
        const conversation = {
          id: conversationDoc.id,
          ...data,
          profileId: otherUserId || data.profileId,
          name: otherProfile.name || data.name || 'ผู้ใช้ CampusMate',
          avatar: otherProfile.avatar || data.avatar,
          avatarColor: otherProfile.avatarColor || data.avatarColor,
          avatarUri: otherProfile.avatarUri || data.avatarUri,
          subtitle: [otherProfile.faculty, otherProfile.year].filter(Boolean).join(' · '),
          readReceipts: data.readReceipts || {},
          participantSettings: data.participantSettings || {},
          mySettings: data.participantSettings?.[currentUserId] || {},
          lastMessage: messages[messages.length - 1]?.text || data.lastMessage,
          messages,
        };
        const signature = conversationRenderSignature(conversation);
        const previousEntry = previousEntries.get(conversation.id);
        const stableConversation = previousEntry?.signature === signature
          ? previousEntry.conversation
          : conversation;
        nextEntries.set(conversation.id, { conversation: stableConversation, signature });
        return stableConversation;
      });
      conversations.sort((first, second) => toMillis(second.updatedAt) - toMillis(first.updatedAt));
      const changed = previousConversations === null
        || conversations.length !== previousConversations.length
        || conversations.some((conversation, index) => conversation !== previousConversations[index]);
      previousEntries = nextEntries;
      if (changed) {
        console.log(`[Firestore] Conversations updated -> ${conversations.length} conversation(s):`, conversations.map(c => ({ id: c.id, name: c.name, lastMessage: c.lastMessage })));
        previousConversations = conversations;
        callback(conversations);
      }
    },
    (error) => {
      console.error('[Firestore] subscribeToConversations error:', error);
      onError?.(error);
    }
  );
}

function conversationRenderSignature(conversation) {
  const unreadCounts = Object.entries(conversation.unreadCounts || {})
    .sort(([firstId], [secondId]) => firstId.localeCompare(secondId));
  const readReceipts = Object.entries(conversation.readReceipts || {})
    .map(([uid, ts]) => [uid, toMillis(ts)])
    .sort(([firstId], [secondId]) => firstId.localeCompare(secondId));
  const participantSettings = Object.entries(conversation.participantSettings || {})
    .sort(([firstId], [secondId]) => firstId.localeCompare(secondId));
  const messages = (conversation.messages || []).map((message) => [
    message.id,
    message.sender,
    message.text,
    toMillis(message.createdAt || message.time),
    JSON.stringify(message.reactions || {}),
    JSON.stringify(message.replyTo || null),
    Boolean(message.forwarded),
    JSON.stringify(message.hiddenFor || []),
  ]);
  return JSON.stringify([
    conversation.id,
    conversation.profileId,
    conversation.name,
    conversation.avatar,
    conversation.avatarColor,
    conversation.avatarUri,
    conversation.subtitle,
    conversation.lastMessage,
    unreadCounts,
    readReceipts,
    participantSettings,
    messages,
  ]);
}

export async function saveDecision(currentUserId, otherUserId, type, likeMessage = '', status = 'pending') {
  const { db } = requireFirebase();
  const decisionRef = doc(db, 'decisions', `${currentUserId}_${otherUserId}`);
  
  let existingData = null;
  try {
    const existingDecision = await getDoc(decisionRef);
    if (existingDecision.exists()) {
      existingData = existingDecision.data();
    }
  } catch (error) {
    // Permission denied implies the document doesn't exist
  }

  let finalStatus = status;
  let isMutual = false;

  if (type === 'like') {
    const reverseDecisionRef = doc(db, 'decisions', `${otherUserId}_${currentUserId}`);
    try {
      const reverseSnap = await getDoc(reverseDecisionRef);
      if (reverseSnap.exists()) {
        const reverseData = reverseSnap.data();
        if (reverseData.type === 'like' && reverseData.status !== 'removed' && reverseData.status !== 'rejected') {
          isMutual = true;
          finalStatus = 'accepted';
          if (reverseData.status !== 'accepted') {
            await updateDoc(reverseDecisionRef, { status: 'accepted', updatedAt: serverTimestamp() });
          }
        }
      }
    } catch (error) {
      // Reverse decision may not exist or permission denied
    }
  }

  if (
    existingData?.fromUserId === currentUserId
    && existingData?.toUserId === otherUserId
    && existingData?.type === type
    && existingData?.status === finalStatus
  ) {
    return { matched: isMutual };
  }

  await setDoc(decisionRef, withoutUndefined({
    fromUserId: currentUserId,
    toUserId: otherUserId,
    type,
    status: finalStatus,
    likeMessage: type === 'like' ? likeMessage : '',
    createdAt: existingData
      ? existingData.createdAt
      : serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  return { matched: isMutual };
}

export async function respondToDecision(decisionId, currentUserId, status) {
  const { db } = requireFirebase();
  const decisionRef = doc(db, 'decisions', decisionId);
  const snapshot = await getDoc(decisionRef);
  if (!snapshot.exists() || snapshot.data().toUserId !== currentUserId) {
    throw new Error('ไม่พบคำขอถูกใจนี้');
  }
  await updateDoc(decisionRef, { status, updatedAt: serverTimestamp() });
}

export async function unmatchUser(currentUserId, otherUserId) {
  const { db } = requireFirebase();
  const batch = writeBatch(db);

  // 1. อัพเดท decision ทั้งสองฝั่งเป็น 'removed'
  const decisionA = doc(db, 'decisions', `${currentUserId}_${otherUserId}`);
  const decisionB = doc(db, 'decisions', `${otherUserId}_${currentUserId}`);

  const [snapA, snapB] = await Promise.all([
    getDoc(decisionA),
    getDoc(decisionB),
  ]);

  if (snapA.exists()) {
    batch.update(decisionA, { status: 'removed', updatedAt: serverTimestamp() });
  }
  if (snapB.exists()) {
    batch.update(decisionB, { status: 'removed', updatedAt: serverTimestamp() });
  }

  // 2. ลบ conversation ที่สร้างไว้
  const participantIds = [currentUserId, otherUserId].sort();
  const conversationRef = doc(db, 'conversations', `c-${participantIds.join('-')}`);
  const conversationSnap = await getDoc(conversationRef);
  if (conversationSnap.exists()) {
    batch.delete(conversationRef);
  }

  await batch.commit();
}

export async function resetSkippedDecisions(currentUserId) {
  const { db } = requireFirebase();
  const outgoingQuery = query(
    collection(db, 'decisions'),
    where('fromUserId', '==', currentUserId)
  );
  const snapshot = await getDocs(outgoingQuery);
  await Promise.all(snapshot.docs
    .filter((decisionDoc) => decisionDoc.data().type === 'skip')
    .map((decisionDoc) => deleteDoc(decisionDoc.ref)));
}

export async function createConversation(currentUserId, currentProfile, otherProfile) {
  const { db } = requireFirebase();
  console.log('[Firestore] createConversation called:', { currentUserId, otherUserId: otherProfile?.id });
  const participantIds = [currentUserId, otherProfile.id].sort();
  const conversationRef = doc(db, 'conversations', `c-${participantIds.join('-')}`);
  const existingConversation = await getDoc(conversationRef);
  if (existingConversation.exists()) {
    console.log('[Firestore] Conversation already exists:', conversationRef.id);
    return conversationRef.id;
  }

  console.log('[Firestore] Writing new conversation to Firestore:', conversationRef.id);
  await setDoc(conversationRef, {
    participants: participantIds,
    participantProfiles: {
      [currentUserId]: toConversationProfile(currentUserId, currentProfile),
      [otherProfile.id]: toConversationProfile(otherProfile.id, otherProfile),
    },
    unreadCounts: {
        [currentUserId]: 0,
        [otherProfile.id]: 0,
      },
    lastMessage: 'เริ่มบทสนทนาได้เลย',
    messages: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  console.log('[Firestore] Conversation created successfully:', conversationRef.id);
  return conversationRef.id;
}

export async function updateConversationMessage(conversationId, currentUserId, text, options = {}) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);

  await runTransaction(db, async (transaction) => {
    const convSnap = await transaction.get(convRef);
    if (!convSnap.exists()) throw new Error('ไม่พบห้องสนทนา');

    const data = convSnap.data();
    const participants = Array.isArray(data.participants) ? data.participants : [];
    if (!participants.includes(currentUserId)) throw new Error('คุณไม่มีสิทธิ์ส่งข้อความในห้องนี้');

    const sentAt = Timestamp.now();
    const message = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      senderId: currentUserId,
      text,
      createdAt: sentAt,
      time: sentAt,
    };

    if (options.replyTo?.id && options.replyTo?.text) {
      message.replyTo = {
        id: options.replyTo.id,
        senderId: options.replyTo.senderId || '',
        text: String(options.replyTo.text).slice(0, 240),
      };
    }
    if (options.forwarded) {
      message.forwarded = true;
      if (options.forwardedFrom?.conversationId && options.forwardedFrom?.messageId) {
        message.forwardedFrom = {
          conversationId: options.forwardedFrom.conversationId,
          messageId: options.forwardedFrom.messageId,
        };
      }
    }

    const unreadCounts = { ...(data.unreadCounts || {}) };
    participants.forEach((uid) => {
      if (uid !== currentUserId) unreadCounts[uid] = (unreadCounts[uid] || 0) + 1;
    });

    const existingMessages = Array.isArray(data.messages) ? data.messages : [];
    transaction.update(convRef, {
      messages: [...existingMessages.slice(-499), message],
      lastMessage: text,
      unreadCounts,
      updatedAt: serverTimestamp(),
    });
  });
  return true;
}

export async function deleteConversation(conversationId) {
  const { db } = requireFirebase();
  try {
    await deleteDoc(doc(db, "conversations", conversationId));
  } catch (error) {
    // If we try to delete a conversation that doesn't exist (e.g. rejecting a pending like),
    // Firestore rules will reject it with a permission error because resource is null.
    // We can safely ignore this since the goal is for the conversation to not exist anyway.
    if (error.code !== 'permission-denied') {
      console.warn("deleteConversation warning:", error);
    }
  }
}

export async function markConversationAsRead(conversationId, currentUserId) {
  const { db } = requireFirebase();
  await updateDoc(doc(db, 'conversations', conversationId), {
    [`unreadCounts.${currentUserId}`]: 0,
    [`readReceipts.${currentUserId}`]: serverTimestamp(),
  });
}

export async function toggleMeetupAcceptance(conversationId, currentUserId, hostUserId, spotName) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  const snap = await getDoc(convRef);
  if (!snap.exists()) return false;
  const data = snap.data();
  const currentAccepted = Array.isArray(data.meetupAcceptedUsers) ? data.meetupAcceptedUsers : [];
  const isAccepted = currentAccepted.includes(currentUserId);
  const nextAccepted = isAccepted
    ? currentAccepted.filter((id) => id !== currentUserId)
    : [...currentAccepted, currentUserId];

  const sentAt = Timestamp.now();
  const noticeText = isAccepted
    ? `ยกเลิกการตอบรับนัดหมายที่ ${spotName || 'จุดนัดพบ'}`
    : `ตอบรับนัดหมายที่ ${spotName || 'จุดนัดพบ'} แล้ว`;

  await updateDoc(convRef, {
    meetupAcceptedUsers: nextAccepted,
    messages: arrayUnion({
      id: `m-${Date.now()}`,
      senderId: currentUserId,
      text: noticeText,
      isSystem: true,
      createdAt: sentAt,
      time: sentAt,
    }),
    lastMessage: noticeText,
    updatedAt: serverTimestamp(),
  });
  return !isAccepted;
}

export async function updateChatSettings(conversationId, currentUserId, settings) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  const updates = {};
  for (const [key, value] of Object.entries(settings)) {
    updates[`participantSettings.${currentUserId}.${key}`] = value;
  }
  await updateDoc(convRef, updates);
}

export async function unsendMessage(conversationId, messageId, currentUserId) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  let removed = false;
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(convRef);
    if (!snap.exists()) return;
    const data = snap.data();
    if (!(data.participants || []).includes(currentUserId)) return;
    const existingMessages = Array.isArray(data.messages) ? data.messages : [];
    const targetIndex = findStoredMessageIndex(convRef.id, existingMessages, messageId);
    if (targetIndex === -1 || existingMessages[targetIndex].senderId !== currentUserId) return;

    const updatedMessages = existingMessages.filter((_, index) => index !== targetIndex);
    transaction.update(convRef, {
      messages: updatedMessages,
      lastMessage: updatedMessages[updatedMessages.length - 1]?.text || 'เริ่มบทสนทนาได้เลย',
      updatedAt: serverTimestamp(),
    });
    removed = true;
  });
  return removed;
}

export async function reactToMessage(conversationId, messageId, currentUserId, emoji) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  let changed = false;
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(convRef);
    if (!snap.exists()) return;
    const data = snap.data();
    if (!(data.participants || []).includes(currentUserId)) return;
    const existingMessages = Array.isArray(data.messages) ? data.messages : [];
    const targetIndex = findStoredMessageIndex(convRef.id, existingMessages, messageId);
    if (targetIndex === -1) return;

    const targetMessage = { ...existingMessages[targetIndex] };
    const reactions = { ...(targetMessage.reactions || {}) };
    if (reactions[currentUserId] === emoji) delete reactions[currentUserId];
    else reactions[currentUserId] = emoji;
    targetMessage.reactions = reactions;

    const updatedMessages = [...existingMessages];
    updatedMessages[targetIndex] = targetMessage;
    transaction.update(convRef, { messages: updatedMessages, updatedAt: serverTimestamp() });
    changed = true;
  });
  return changed;
}

export async function deleteMessageForUser(conversationId, messageId, currentUserId) {
  const { db } = requireFirebase();
  const convRef = doc(db, 'conversations', conversationId);
  let changed = false;

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(convRef);
    if (!snap.exists()) return;
    const data = snap.data();
    if (!(data.participants || []).includes(currentUserId)) return;
    const existingMessages = Array.isArray(data.messages) ? data.messages : [];
    const targetIndex = findStoredMessageIndex(convRef.id, existingMessages, messageId);
    if (targetIndex === -1) return;

    const targetMessage = { ...existingMessages[targetIndex] };
    targetMessage.hiddenFor = Array.from(new Set([...(targetMessage.hiddenFor || []), currentUserId]));
    const updatedMessages = [...existingMessages];
    updatedMessages[targetIndex] = targetMessage;
    transaction.update(convRef, { messages: updatedMessages, updatedAt: serverTimestamp() });
    changed = true;
  });
  return changed;
}

function findStoredMessageIndex(conversationId, messages, messageId) {
  return messages.findIndex((message, index) => (
    message.id === messageId
    || `${conversationId}-m-${toMillis(message.createdAt || message.time)}-${message.senderId || message.sender || 'unknown'}-${index}` === messageId
  ));
}
