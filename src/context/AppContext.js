import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { ActivityIndicator, ImageBackground, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useAuth } from './AuthContext';
import { requireFirebase } from '../services/dbService';
import {
  createConversation,
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
import { CAMPUS_SPOTS } from '../data/campusSpots';
import { saveAccount } from '../services/accountStorage';
import AppSplashScreen from '../components/AppSplashScreen';

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

    setProfileLoading(true);
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
        if (active) setDataError(error);
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });

    return () => {
      active = false;
    };
  }, [retryKey, user]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const handleError = (error) => {
      console.error('[AppContext] Subscription error:', error);
      setDataError(error);
    };
    console.log('[AppContext] Starting core subscriptions for user:', user.id);
    const unsubscribers = [
      subscribeToSpots(setCampusSpots, handleError),
      subscribeToConversations(user.id, (convs) => {
        console.log('[AppContext] setConversations called with', convs.length, 'items');
        setConversations(convs);
      }, handleError),
      subscribeToIncomingLikes(user.id, (likes) => {
        console.log('[AppContext] setIncomingLikes called with', likes.length, 'items');
        setIncomingLikes(likes);
      }, handleError),
    ];
    return () => {
      console.log('[AppContext] Cleaning up core subscriptions for user:', user.id);
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [retryKey, user?.id]);

  useEffect(() => {
    if (!user?.id || !profile) return undefined;
    const handleError = (error) => {
      console.error('[AppContext] Available profiles error:', error);
      setDataError(error);
    };
    const preferences = {
      ...profile.matchingPreferences,
      currentFaculty: profile.faculty || '',
    };
    const unsubscribe = subscribeToAvailableProfiles(user.id, preferences, setAvailableProfiles, handleError);
    return () => {
      unsubscribe?.();
    };
  }, [profile?.faculty, profile?.matchingPreferences, retryKey, user?.id]);

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
    await saveDecision(user.id, profileId, 'skip');
  };

  const resetMatching = async () => {
    if (!user?.id) return;

    const { db } = requireFirebase();
    const outgoingQuery = query(
      collection(db, 'decisions'),
      where('fromUserId', '==', user.id)
    );
    const snapshot = await getDocs(outgoingQuery);
    await Promise.all(snapshot.docs.map((decisionDoc) => deleteDoc(decisionDoc.ref)));
  };

  const recycleSkippedProfiles = async () => {
    if (!user?.id) return;
    await resetSkippedDecisions(user.id);
  };

  const respondToLike = async (candidate, response) => {
    if (!user?.id || !candidate?.decisionId || !['accept', 'reject'].includes(response)) return;

    if (response === 'accept') {
      await Promise.all([
        respondToDecision(candidate.decisionId, user.id, 'accepted'),
        saveDecision(user.id, candidate.id, 'like', '', 'accepted'),
      ]);
      await createConversation(user.id, profile, candidate);
      return;
    }

    const skipStatus = candidate.status === 'accepted' ? 'removed' : 'pending';
    const { db } = requireFirebase();
    const reverseDecisionRef = doc(db, 'decisions', `${candidate.id}_${user.id}`);

    await Promise.all([
      respondToDecision(candidate.decisionId, user.id, 'rejected'),
      saveDecision(user.id, candidate.id, 'skip', '', skipStatus),
      getDocs(query(collection(db, 'decisions'), where('fromUserId', '==', candidate.id), where('toUserId', '==', user.id)))
        .then((snapshot) => {
          const reverseDoc = snapshot.docs[0];
          if (!reverseDoc || reverseDoc.data().type !== 'like') return null;
          return updateDoc(reverseDecisionRef, {
            status: 'rejected',
            updatedAt: serverTimestamp(),
          });
        }),
    ]);
    const participantIds = [user.id, candidate.id].sort();
    const conversationId = `c-${participantIds.join('-')}`;
    await deleteConversation(conversationId);
  };

  const ensureConversation = async (candidate) => {
    if (!user?.id || !profile || !candidate?.id) {
      throw new Error('ไม่พบข้อมูลสำหรับเปิดห้องแชต');
    }
    const conversationId = `c-${[user.id, candidate.id].sort().join('-')}`;
    if (conversations.some((conversation) => conversation.id === conversationId)) {
      return conversationId;
    }
    await saveDecision(user.id, candidate.id, 'like', '', 'accepted');
    return createConversation(user.id, profile, candidate);
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
    try {
      const existingConvo = conversations.find(
        (c) => c.profileId === candidate.id || c.participants?.includes(candidate.id)
      );
      if (existingConvo) {
        return { matched: true, conversationId: existingConvo.id, alreadyMatched: true };
      }

      const result = await saveDecision(user.id, candidate.id, 'like', '', 'pending');
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
    await updateConversationMessage(conversationId, user.id, trimmedText, options);
    return true;
  };

  const markAsRead = async (conversationId) => {
    if (!user?.id || !conversationId) return;
    await markConversationAsRead(conversationId, user.id);
  };

  const saveProfile = async (profileData) => {
    if (!user?.id) throw new Error('กรุณาเข้าสู่ระบบก่อนบันทึกโปรไฟล์');
    const nextProfileData = { ...profileData };
    if (
      nextProfileData.avatarUri
      && (nextProfileData.avatarUri.startsWith('data:image') || nextProfileData.avatarUri.startsWith('file:'))
    ) {
      nextProfileData.avatarUri = await uploadImage(nextProfileData.avatarUri, user.id);
    }

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
    await createUserProfile(user.id, nextProfile);
    saveAccount({
      id: user.id,
      email: user.email || nextProfile.email,
      displayName: nextProfile.nickname || nextProfile.name || user.displayName,
      photoURL: nextProfile.avatarUri || nextProfile.photos?.[0] || user.photoURL,
      faculty: nextProfile.faculty || '',
    });
    setProfile(nextProfile);
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
        return {
          ...localSpot,
          ...remote,
          category: localSpot.category || remote.category,
          categoryLabel: localSpot.categoryLabel || remote.categoryLabel,
          group: localSpot.group || remote.group,
          latitude: remote.latitude ?? localSpot.latitude,
          longitude: remote.longitude ?? localSpot.longitude,
        };
      }
      return localSpot;
    });

    // รวม spots เพิ่มเติมจาก Firestore (ถ้ามี)
    firestoreSpotMap.forEach((remoteSpot) => {
      mergedList.push(remoteSpot);
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
    return toggleMeetupAcceptance(conversationId, user.id, hostUserId, spotName);
  };

  const updateChatSettingsInChat = async (conversationId, settings) => {
    if (!user?.id || !conversationId) return;
    return updateChatSettings(conversationId, user.id, settings);
  };

  const unsendMessageInChat = async (conversationId, messageId) => {
    if (!user?.id || !conversationId || !messageId) return false;
    return unsendMessage(conversationId, messageId, user.id);
  };

  const deleteMessageForMeInChat = async (conversationId, messageId) => {
    if (!user?.id || !conversationId || !messageId) return false;
    return deleteMessageForUser(conversationId, messageId, user.id);
  };

  const reactToMessageInChat = async (conversationId, messageId, emoji) => {
    if (!user?.id || !conversationId || !messageId || !emoji) return false;
    return reactToMessage(conversationId, messageId, user.id, emoji);
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

  const value = useMemo(() => ({
    profile,
    conversations,
    availableProfiles,
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
  }), [
    acceptedIncomingLikes,
    availableProfiles,
    computedSpots,
    conversations,
    getMeetupStats,
    incomingLikes,
    matchedProfileIds,
    pendingIncomingLikes,
    profile,
    selectedMeetup,
    user?.id,
  ]);

  if (profileLoading) {
    return <AppSplashScreen message="กำลังเข้าสู่ระบบ กรุณารอสักครู่..." />;
  }

  if (dataError) {
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
              <SymbolView name="exclamationmark.triangle.fill" size={26} tintColor="#FF4B4B" />
            </View>
            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800', textAlign: 'center' }}>
              เข้าสู่ระบบไม่สำเร็จ
            </Text>
            <Text style={{ color: '#B6BDC8', marginTop: 8, textAlign: 'center', fontSize: 13, lineHeight: 18 }}>
              {dataError.message || 'กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่อีกครั้ง'}
            </Text>
            <Pressable
              onPress={() => {
                setDataError(null);
                setRetryKey((current) => current + 1);
              }}
              style={{ backgroundColor: '#111318', borderColor: 'rgba(255,255,255,0.2)', borderRadius: 24, borderWidth: 1, marginTop: 20, paddingHorizontal: 22, paddingVertical: 12 }}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 14 }}>ลองใหม่อีกครั้ง</Text>
            </Pressable>
          </View>
        </LinearGradient>
      </ImageBackground>
    );
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp ต้องอยู่ภายใน AppProvider');
  return context;
}
