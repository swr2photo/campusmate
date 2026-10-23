import { Pressable, TouchableOpacity } from '../components/NativePressable';
import Text from '../components/AppText';
import { MAX_PROFILE_PHOTOS } from '../data/profilePhotos';
import { AppTextInput as TextInput } from '../components/AppText';
import { useToast } from '../context/ToastContext';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, PanResponder, Platform, ScrollView, StyleSheet, Switch, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import ChatImageEditorModal from '../components/ChatImageEditorModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ACTIVITY_CATEGORIES,
  getActivityCategory,
  getActivityDetailFields,
  getRunningPace,
  sanitizeActivityDetails,
} from '../data/activityCategories';
import SpotifyTrackSearchSheet, { MAX_FAVORITE_TRACKS } from '../components/SpotifyTrackSearchSheet';
import ProfileActivityChip from '../components/ProfileActivityChip';
import ProfileFavoriteTrackRow from '../components/ProfileFavoriteTrackRow';
import SpotifyConnectCard from '../components/SpotifyConnectCard';
import { prefetchBrowseMusicTracks } from '../services/spotifyService';
import { isSpotifyFeatureAllowed } from '../utils/featureFlags';
import { useAuth } from '../context/AuthContext';
import { getStyles as getDiscoverStyles, ProfileCardView } from './DiscoverProfileScreen.js';
import { useAppProfile, useAppActions } from '../context/AppContext';
import { Card, Chip, PrimaryButton, TonalButton } from '../components/ui';
import * as ImageManipulator from 'expo-image-manipulator';
import FeatureIcon from '../components/FeatureIcon';
import AvailabilityModal from '../components/AvailabilityModal';
import FaceVerificationModal from '../components/FaceVerificationModal';
import { uploadGalleryImage } from '../services/profileGalleryService';
import LiquidGlassSegmentedControl from '../components/LiquidGlassSegmentedControl';
import LiquidGlassView from '../components/LiquidGlassView';
import ProfileSettingsScreen from './ProfileSettingsScreen';
import { compressProfileImage, validateImageSize, MAX_PROFILE_IMAGE_SIZE_MB } from '../utils/compressImage';
import { isCommittedProfilePhoto } from '../utils/profilePhoto';
import BentoPhotoGrid from '../components/BentoPhotoGrid';
import { ScreenChrome, ScreenScrollView } from '../components/ScreenChrome';
import { radius, spacing, type, useTheme } from '../theme';

import { FACULTIES } from '../data/faculties';
import {
  ACADEMIC_YEARS,
  getAcademicYearFromStudentId,
  getFacultyFromStudentId,
  getStudentAcademicProfile,
  STUDENT_FACULTY_UNAVAILABLE_MESSAGE,
  STUDENT_ID_REQUIRED_MESSAGE,
  STUDENT_YEAR_UNAVAILABLE_MESSAGE,
} from '../utils/studentId';
import { showAlert } from '../utils/appAlert';
import { GlassBackground, useLiquidGlass, useSheetGlassTint } from '../components/LiquidGlassSurface';
const FACULTY_OPTIONS = FACULTIES.map((faculty) => ({ label: faculty, value: faculty }));
const YEAR_OPTIONS = ACADEMIC_YEARS.map((year) => ({ label: year, value: year }));
export const AGES = Array.from({ length: 17 }, (_, i) => ({
  label: `${i + 19} ปี`,
  value: String(i + 19),
}));
export const GENDERS = [
  { label: 'ชาย', value: 'male' },
  { label: 'หญิง', value: 'female' },
  { label: 'ชายข้ามเพศ', value: 'trans_male' },
  { label: 'หญิงข้ามเพศ', value: 'trans_female' },
  { label: 'นอนไบนารี', value: 'nonbinary' },
  { label: 'เจนเดอร์ฟลูอิด', value: 'genderfluid' },
  { label: 'ไบเจนเดอร์', value: 'bigender' },
  { label: 'อะเจนเดอร์', value: 'agender' },
  { label: 'เควียร์', value: 'queer' },
  { label: 'เพศอื่น ๆ', value: 'other' },
  { label: 'ไม่ประสงค์ระบุ', value: 'unspecified' },
];
const DEFAULT_AGE = '20';
const DEFAULT_GENDER = 'unspecified';
const DEFAULT_ACTIVITY = 'other';
const REQUIRED_MARK = '*';

function getInitialInterests(profile) {
  const savedInterests = [profile?.interests, profile?.activities]
    .find((value) => Array.isArray(value) && value.length > 0);
  if (savedInterests) return savedInterests;
  if (profile?.activity) return [profile.activity];
  return [DEFAULT_ACTIVITY];
}

function getInitialActivityDetails(profile) {
  const details = sanitizeActivityDetails(profile?.activityDetails);
  if (!details.running?.pace && typeof profile?.pace === 'string' && profile.pace.trim()) {
    const seeded = sanitizeActivityDetails({ running: { pace: profile.pace.trim() } });
    if (seeded.running) details.running = { ...(details.running || {}), ...seeded.running };
  }
  return details;
}

export function getProfileValidationError({ age, avatarUri, bio, faculty, gender, interests, name, pace, studentId, year, availability, availabilitySlots, requireComplete = true }) {
  if (!name || name.trim().length < 2) return 'กรุณากรอกชื่อของคุณ (อย่างน้อย 2 ตัวอักษร)';
  if (!gender) return 'กรุณาเลือกเพศของคุณ';
  if (!studentId) return STUDENT_ID_REQUIRED_MESSAGE;
  if (!faculty || faculty === 'all') return STUDENT_FACULTY_UNAVAILABLE_MESSAGE;
  if (!year) return STUDENT_YEAR_UNAVAILABLE_MESSAGE;
  if (!avatarUri) return 'กรุณาเพิ่มรูปโปรไฟล์ของคุณ';
  const parsedAge = Number(age);
  if (!age || !Number.isInteger(parsedAge) || parsedAge < 18 || parsedAge > 100) return 'กรุณาระบุอายุระหว่าง 18–100 ปี';
  if (!requireComplete) return null;
  if (!interests.length) return 'กรุณาเลือกกิจกรรมหรือความสนใจอย่างน้อย 1 รายการ';
  if (interests.includes('running') && !pace) {
    return 'กรุณาเลือกเพซวิ่งเมื่อเลือกวิ่งออกกำลังกาย';
  }
  if (!bio.trim()) return 'กรุณาเขียนแนะนำตัวสั้น ๆ';
  return null;
}

function ProfilePreview({
  activityDetails,
  activities,
  age,
  availability,
  availabilitySlots,
  avatarUri,
  bio,
  colors,
  faculty,
  favoriteTracks,
  gallery,
  gender,
  name,
  onNavigateToEdit,
  skill,
  year,
}) {
  const { isDark } = useTheme();
  const discoverStyles = React.useMemo(() => getDiscoverStyles(colors, isDark), [colors, isDark]);
  const insets = useSafeAreaInsets();
  const { profile: myProfile } = useAppProfile();
  const { getMeetupStats } = useAppActions();

  const candidate = React.useMemo(() => {
    return {
      id: myProfile?.id || 'preview',
      avatarUri,
      gallery,
      name,
      age,
      gender,
      faculty,
      year,
      bio,
      activities,
      activityDetails,
      skill,
      availabilitySlots,
      availability,
      favoriteTracks,
    };
  }, [avatarUri, gallery, name, age, gender, faculty, year, bio, activities, activityDetails, skill, availabilitySlots, availability, favoriteTracks, myProfile]);

  const previewStyles = React.useMemo(() => ({
    ...discoverStyles,
    scrollContent: {
      ...discoverStyles.scrollContent,
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: Math.max(insets.bottom + 24, 48),
    },
  }), [discoverStyles, insets.bottom]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ paddingHorizontal: 14, paddingTop: 6, paddingBottom: 6 }}>
        <ScreenChrome elevated
          style={{
            borderRadius: 18,
            width: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, paddingRight: 12 }}>
            <FeatureIcon color={colors.primary} name="eye.fill" size={17} />
            <Text style={{ fontSize: 13, lineHeight: 20, flexShrink: 1, fontWeight: '700', color: colors.ink }}>
              ตัวอย่างโปรไฟล์ของคุณ
            </Text>
          </View>
          {onNavigateToEdit ? (
            <Pressable
              hitSlop={6}
              onPress={onNavigateToEdit}
              accessibilityRole="button"
              accessibilityLabel="แก้ไขข้อมูลโปรไฟล์"
              style={({ pressed }) => [
                {
                  backgroundColor: '#3B82F6',
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  minHeight: 44,
                  flexShrink: 0,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  borderRadius: 22,
                  shadowColor: '#3B82F6',
                  shadowOpacity: 0.35,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 3,
                },
                pressed && { opacity: 0.8 },
              ]}
            >
              <FeatureIcon color="#FFFFFF" name="pencil" size={14} />
              <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: '800', color: '#FFFFFF' }}>
                แก้ไขข้อมูล
              </Text>
            </Pressable>
          ) : null}
        </ScreenChrome>
      </View>
      <ProfileCardView
        candidate={candidate}
        colors={colors}
        insets={{ ...insets, top: 0, bottom: insets.bottom }}
        isDark={isDark}
        isViewOnly={true}
        myProfile={null}
        styles={previewStyles}
        getMeetupStats={getMeetupStats}
      />
    </View>
  );
}

export default function ProfileScreen({
  activeTab: controlledActiveTab,
  initialSection = 'basic',
  initialTab = 'edit',
  onClose,
  onCloseGuardReady,
  onLogout,
  onTabChange,
  onToast,
  overrideSave,
  tabs = ['edit', 'preview'],
}) {
  const { showImageModeration } = useToast();
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors, isDark);
  const glass = useLiquidGlass();
  const glassTint = useSheetGlassTint();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isFirstSetup = Boolean(overrideSave);

  const isControlled = controlledActiveTab !== undefined;
  const [internalActiveTab, setInternalActiveTab] = useState(initialTab || 'edit');
  const activeTab = isControlled ? controlledActiveTab : internalActiveTab;

  const handleTabChange = useCallback((tabId) => {
    Keyboard.dismiss();
    if (isControlled) {
      onTabChange?.(tabId);
    } else {
      setInternalActiveTab(tabId);
    }
  }, [isControlled, onTabChange]);

  const tabConfigs = useMemo(() => {
    const configMap = {
      edit: { id: 'edit', label: 'แก้ไขโปรไฟล์' },
      preview: { id: 'preview', label: 'ตัวอย่าง' },
      settings: { id: 'settings', label: 'การตั้งค่า' },
    };
    return tabs.map((t) => configMap[t] || { id: t, label: t });
  }, [tabs]);

  const { profile } = useAppProfile();
  const { saveProfile, markFaceVerified } = useAppActions();
  const { user } = useAuth();
  const safeProfile = useMemo(() => ({
    ...(profile || {}),
    email: profile?.email || user?.email || '',
    campusEmail: profile?.campusEmail || user?.campusEmail || user?.email || '',
  }), [profile, user]);
  const canUseSpotify = useMemo(() => isSpotifyFeatureAllowed(user, safeProfile), [user, safeProfile]);
  const academicProfile = useMemo(() => getStudentAcademicProfile(safeProfile), [safeProfile]);
  const derivedFacultyFromId = academicProfile.studentId ? getFacultyFromStudentId(academicProfile.studentId) : '';
  const derivedYearFromId = academicProfile.studentId ? getAcademicYearFromStudentId(academicProfile.studentId) : '';
  const studentId = academicProfile.studentId || safeProfile.studentId || '';
  const isFacultyLocked = Boolean(derivedFacultyFromId) || Boolean(safeProfile.faculty && !isFirstSetup);
  const isYearLocked = Boolean(derivedYearFromId) || Boolean(safeProfile.year && !isFirstSetup);
  const facultyHelper = isFirstSetup || derivedFacultyFromId ? null : 'ล็อกตามที่ตั้งไว้ในการสร้างโปรไฟล์ครั้งแรก';
  const yearHelper = isFirstSetup || derivedYearFromId ? null : 'ล็อกตามที่ตั้งไว้ในการสร้างโปรไฟล์ครั้งแรก';

  const [name, setName] = useState(safeProfile.name || '');
  const [faculty, setFaculty] = useState(derivedFacultyFromId || safeProfile.faculty || academicProfile.faculty || '');
  const [year, setYear] = useState(derivedYearFromId || safeProfile.year || academicProfile.year || '');
  const [age, setAge] = useState(safeProfile.age ? String(safeProfile.age) : DEFAULT_AGE);
  const [gender, setGender] = useState(safeProfile.gender || DEFAULT_GENDER);
  const [activityDetails, setActivityDetails] = useState(() => getInitialActivityDetails(safeProfile));
  const [skill, setSkill] = useState(safeProfile.skill || '');
  const [availability, setAvailability] = useState(safeProfile.availability || '');
  const [availabilitySlots, setAvailabilitySlots] = useState(() => Array.isArray(safeProfile.availabilitySlots) ? safeProfile.availabilitySlots : []);
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [bio, setBio] = useState(safeProfile.bio || '');
  const [interests, setInterests] = useState(() => getInitialInterests(safeProfile));
  const [avatarUri, setAvatarUri] = useState(safeProfile.avatarUri || null);
  const [gallery, setGallery] = useState(() => Array.isArray(safeProfile.gallery) ? safeProfile.gallery : []);
  const [showSpotifySearch, setShowSpotifySearch] = useState(false);
  const [favoriteTracks, setFavoriteTracks] = useState(() => Array.isArray(safeProfile.favoriteTracks) ? safeProfile.favoriteTracks.slice(0, MAX_FAVORITE_TRACKS) : []);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [processingPhotoIndex, setProcessingPhotoIndex] = useState(null);
  const [localPhotoPreview, setLocalPhotoPreview] = useState(null);
  const [uploadingGallery, setUploadingGallery] = useState({});
  const [showFaceVerificationModal, setShowFaceVerificationModal] = useState(false);
  const [verificationCandidate, setVerificationCandidate] = useState(null);
  const [editingPhoto, setEditingPhoto] = useState(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(null);

  const photoActionTimer = useRef(null);
  useEffect(() => () => clearTimeout(photoActionTimer.current), []);

  const requestPhotoPermission = async () => {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showAlert(
          'อนุญาตการเข้าถึงรูปภาพ',
          'เปิดสิทธิ์การเข้าถึงรูปภาพในการตั้งค่าแอป เพื่อเลือกรูปภาพในโปรไฟล์',
          [
            { text: 'ยกเลิก', style: 'cancel' },
            {
              text: 'เปิดการตั้งค่า',
              onPress: () => {
                Linking.openSettings().catch(() => {
                  onToast?.('เปิดการตั้งค่าไม่ได้ กรุณาเปิดจากการตั้งค่าของอุปกรณ์', 'info');
                });
              },
            },
          ]
        );
        return false;
      }
    }
    return true;
  };

  const pickGalleryPhoto = async (galleryIndex) => {
    const ownerId = currentOwnerId;
    try {
      const hasPermission = await requestPhotoPermission();
      if (!hasPermission) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [2, 3],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      if (photoOwnerRef.current !== ownerId) return;
      setIsProcessingImage(true);
      setProcessingPhotoIndex(galleryIndex + 1);
      const asset = result.assets[0];
      setLocalPhotoPreview(asset.uri);
      const sizeValidation = await validateImageSize(asset.uri, asset.fileSize, MAX_PROFILE_IMAGE_SIZE_MB);
      if (!sizeValidation.valid) throw new Error(sizeValidation.error);
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 800 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
      const localUri = manipulated.uri;
      setGallery((current) => {
        const next = [...current];
        next[galleryIndex] = localUri;
        return next.filter(Boolean);
      });
      if (currentOwnerId) {
        const uploadOwner = currentOwnerId;
        setUploadingGallery(current => ({ ...current, [localUri]: true }));
        uploadGalleryImage(localUri, uploadOwner)
          .then((remoteUrl) => {
            if (photoOwnerRef.current !== uploadOwner) return;
            setGallery((current) => {
              const next = [...current];
              const idx = next.indexOf(localUri);
              if (idx !== -1) {
                next[idx] = remoteUrl;
                return [...next];
              }
              return current;
            });
          })
          .catch((err) => {
            if (photoOwnerRef.current !== uploadOwner) return;
            if (err?.isModerationViolation || err?.isModerationUnavailable) showImageModeration?.(err);
            else showAlert('อัปโหลดรูปไม่สำเร็จ', 'รูปยังอยู่ในฉบับร่าง กดบันทึกเพื่อลองอัปโหลดอีกครั้ง', { tone: 'danger' });
          }).finally(() => { if (photoOwnerRef.current === uploadOwner) setUploadingGallery(({ [localUri]: _done, ...rest }) => rest); });
      }
    } catch (error) {
      console.warn('[ProfileScreen] pickGalleryPhoto error:', error);
      onToast?.(error?.message || 'เพิ่มรูปภาพไม่สำเร็จ', 'info');
    } finally {
      setIsProcessingImage(false);
      setProcessingPhotoIndex(null);
      setLocalPhotoPreview(null);
    }
  };

  const handleEditPhoto = async (index) => {
    const targetUri = index === 0 ? avatarUri : gallery[index - 1];
    if (!targetUri) return;
    try {
      setIsProcessingImage(true);
      setProcessingPhotoIndex(index);
      let uri = targetUri;
      if (/^https?:\/\//i.test(uri)) {
        const target = `${FileSystem.cacheDirectory}profile_edit_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        const response = await FileSystem.downloadAsync(uri, target);
        if (response.status >= 200 && response.status < 300) {
          uri = response.uri;
        }
      }
      setEditingPhoto({ index, uri, uris: [uri] });
    } catch (err) {
      console.warn('[ProfileScreen] handleEditPhoto error:', err);
      setEditingPhoto({ index, uri: targetUri, uris: [targetUri] });
    } finally {
      setIsProcessingImage(false);
      setProcessingPhotoIndex(null);
      setLocalPhotoPreview(null);
    }
  };

  const handleReplacePhoto = async (index) => {
    if (index === 0) {
      await pickImage();
    } else {
      await pickGalleryPhoto(index - 1);
    }
  };

  const triggerReplacePhoto = (index) => {
    setSelectedPhotoIndex(null);
    clearTimeout(photoActionTimer.current);
    photoActionTimer.current = setTimeout(() => {
      handleReplacePhoto(index);
    }, 350);
  };

  const triggerEditPhoto = (index) => {
    setSelectedPhotoIndex(null);
    clearTimeout(photoActionTimer.current);
    photoActionTimer.current = setTimeout(() => {
      handleEditPhoto(index);
    }, 350);
  };

  const handleMakeMainPhoto = (gallerySlotIndex) => {
    if (gallerySlotIndex === 0) return;
    const selectedUri = gallery[gallerySlotIndex - 1];
    if (!selectedUri) return;
    const remainingGallery = gallery.filter((_, i) => i !== gallerySlotIndex - 1);
    const newGallery = avatarUri ? [avatarUri, ...remainingGallery] : remainingGallery;
    setAvatarUri(selectedUri);
    setGallery(newGallery);
    onToast?.('ตั้งเป็นรูปโปรไฟล์หลักแล้ว', 'success');
  };

  const handleDeletePhoto = (index) => {
    if (index === 0) {
      onToast?.('เลือกรูปหลักใหม่และยืนยันใบหน้าก่อนเปลี่ยนรูปเดิม', 'info');
    } else {
      setGallery((current) => current.filter((_, i) => i !== index - 1));
      onToast?.('นำรูปภาพออกจากโปรไฟล์แล้ว', 'info');
    }
  };
  const currentOwnerId = profile?.id || user?.uid || user?.id;
  const photoOwnerRef = useRef(currentOwnerId);
  photoOwnerRef.current = currentOwnerId;
  useEffect(() => () => { photoOwnerRef.current = null; }, []);
  const isFaceVerified = Boolean(safeProfile?.isFaceVerified);
  const [discoverable, setDiscoverable] = useState(safeProfile.isDiscoverable ?? true);
  const [notifications, setNotifications] = useState(safeProfile.notificationsEnabled ?? true);
  const [privacy, setPrivacy] = useState(safeProfile.privacy || {});
  const [expandedSection, setExpandedSection] = useState(initialSection || 'basic');
  const [saving, setSaving] = useState(false);
  const editorScrollRef = useRef(null);
  const musicShortcutHandled = useRef(false);
  const musicSectionYRef = useRef(0);
  const verificationPassedRef = useRef(false);

  useEffect(() => {
    if (initialSection) {
      setExpandedSection(initialSection);
      if (initialSection === 'music') {
        musicShortcutHandled.current = false;
        if (musicSectionYRef.current > 0) {
          setTimeout(() => {
            editorScrollRef.current?.scrollTo({ y: musicSectionYRef.current, animated: true });
          }, 150);
        }
      }
    }
  }, [initialSection]);
  const isRunningSelected = interests.includes('running');
  const pace = isRunningSelected ? getRunningPace(activityDetails) : '';

  useEffect(() => {
    if (canUseSpotify) void prefetchBrowseMusicTracks().catch(() => {});
  }, [canUseSpotify]);

  const updateActivityDetail = useCallback((activityId, fieldKey, value) => {
    setActivityDetails((current) => {
      const next = { ...current, [activityId]: { ...(current[activityId] || {}) } };
      if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) delete next[activityId][fieldKey];
      else next[activityId][fieldKey] = value;
      if (!Object.keys(next[activityId]).length) delete next[activityId];
      return next;
    });
  }, []);

  const toggleInterest = (id) => {
    setInterests((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  };

  React.useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setFaculty(derivedFacultyFromId || profile.faculty || academicProfile.faculty || '');
      setYear(derivedYearFromId || profile.year || academicProfile.year || '');
      setAge(profile.age ? String(profile.age) : DEFAULT_AGE);
      setGender(profile.gender || DEFAULT_GENDER);
      setActivityDetails(getInitialActivityDetails(profile));
      setSkill(profile.skill || '');
      setAvailability(profile.availability || '');
      setAvailabilitySlots(Array.isArray(profile.availabilitySlots) ? profile.availabilitySlots : []);
      setBio(profile.bio || '');
      setInterests(getInitialInterests(profile));
      setAvatarUri(profile.avatarUri || null);
      setGallery(Array.isArray(profile.gallery) ? profile.gallery : []);
      setFavoriteTracks(Array.isArray(profile.favoriteTracks) ? profile.favoriteTracks.slice(0, MAX_FAVORITE_TRACKS) : []);
      setDiscoverable(profile.isDiscoverable ?? true);
      setNotifications(profile.notificationsEnabled ?? true);
      setPrivacy(profile.privacy || {});
    }
  }, [profile, derivedFacultyFromId, derivedYearFromId, academicProfile.faculty, academicProfile.year]);

  const getValidationError = (overrideValues = {}) => getProfileValidationError({
    age,
    avatarUri: overrideValues.avatarUri !== undefined ? overrideValues.avatarUri : avatarUri,
    bio,
    faculty,
    gender,
    interests,
    name,
    pace,
    studentId,
    year,
    availability,
    availabilitySlots,
    requireComplete: isFirstSetup,
    ...overrideValues,
  });

  const handleClose = () => {
    const validationError = getValidationError();
    if (validationError) {
      onToast?.(`${validationError} ก่อนปิดหน้านี้`, 'info');
      return false;
    }
    onClose?.();
    return true;
  };

  React.useEffect(() => {
    onCloseGuardReady?.(handleClose);
    return () => onCloseGuardReady?.(null);
  }, [onCloseGuardReady, age, avatarUri, bio, faculty, gender, interests, name, pace, studentId, skill, year, availability, availabilitySlots]);

  React.useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isFirstSetup) {
        onToast?.('กรุณาสร้างโปรไฟล์ให้เสร็จสมบูรณ์ก่อนเข้าใช้งาน', 'info');
        return true;
      }
      handleClose();
      return true;
    });
    return () => subscription.remove();
  }, [isFirstSetup, age, avatarUri, bio, faculty, gender, interests, name, onClose, onToast, pace, studentId, skill, year, availability, availabilitySlots]);

  const pickImage = async () => {
    if (isProcessingImage) return;
    const ownerId = profile?.id || user?.uid || user?.id;
    let compressedUri = null;
    try {
      const hasPermission = await requestPhotoPermission();
      if (!hasPermission) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      setIsProcessingImage(true);
      setProcessingPhotoIndex(0);
      setLocalPhotoPreview(asset.uri);

      // Validate image size (must not exceed 30 MB)
      const sizeValidation = await validateImageSize(asset.uri, asset.fileSize, MAX_PROFILE_IMAGE_SIZE_MB);
      if (!sizeValidation.valid) {
        showAlert('รูปภาพมีขนาดใหญ่เกินไป', sizeValidation.error, { tone: 'warning' });
        onToast?.(sizeValidation.error, 'error');
        return;
      }

      try {
        compressedUri = await compressProfileImage(asset.uri);
        const uri = await uploadGalleryImage(compressedUri, ownerId);
        if (photoOwnerRef.current !== ownerId) return;
        setVerificationCandidate({ uri, ownerId });
        verificationPassedRef.current = false;
        setShowFaceVerificationModal(true);
      } catch (compressionError) {
        console.warn('[Profile] Image compression failed:', compressionError);
        if (compressionError?.isModerationViolation || compressionError?.isModerationUnavailable) {
          showImageModeration?.(compressionError);
        } else {
          showAlert(
            'ไม่สามารถประมวลผลรูปภาพได้',
            compressionError.message || 'เกิดข้อผิดพลาดในการปรับขนาดรูปภาพ กรุณาลองเลือกรูปภาพใหม่อีกครั้ง',
            { tone: 'danger' }
          );
          onToast?.(compressionError.message || 'ไม่สามารถประมวลผลรูปภาพได้', 'error');
        }
      }
    } catch (error) {
      console.error('[Profile] Image picking error:', error);
      showAlert('เกิดข้อผิดพลาด', 'ไม่สามารถเปิดเลือกรูปภาพได้ กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
    } finally {
      setIsProcessingImage(false);
      setProcessingPhotoIndex(null);
      setLocalPhotoPreview(null);
    }
  };

  const handleFaceVerified = async () => {
    const candidate = verificationCandidate;
    if (!candidate || photoOwnerRef.current !== candidate.ownerId) return;
    const committed = await markFaceVerified?.(candidate.uri);
    if (photoOwnerRef.current !== candidate.ownerId) return;
    if (!isCommittedProfilePhoto(committed, candidate.uri)) {
      throw new Error('ยังบันทึกรูปใหม่ไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
    setAvatarUri(committed.avatarUri);
    verificationPassedRef.current = true;
    onToast?.('ยืนยันใบหน้าเรียบร้อยแล้ว', 'success');
  };

  const handleSave = async (customOverrides = {}) => {
    if (saving) return false;
    if (isProcessingImage) {
      return false;
    }
    setSaving(true);
    try {
      const activeAvatar = customOverrides.avatarUri !== undefined ? customOverrides.avatarUri : avatarUri;
      const validationError = getValidationError({ avatarUri: activeAvatar, ...customOverrides });
      if (validationError) throw new Error(validationError);
      const parsedAge = Number(age);
      const activities = interests.length > 0 ? interests : ['other'];
      const activity = activities[0];
      const activityLabels = activities.map(
        (id) => ACTIVITY_CATEGORIES.find((item) => item.id === id)?.label || id
      );
      const activityLabel = activityLabels.join(', ');
      const cleanActivityDetails = sanitizeActivityDetails(activityDetails, activities);
      const profileData = {
        name,
        faculty,
        studentId,
        year,
        age: age ? parsedAge : null,
        gender,
        activity,
        activities,
        activityLabel,
        activityDetails: cleanActivityDetails,
        pace: getRunningPace(cleanActivityDetails),
        skill,
        availability: null,
        availabilitySlots: null,
        bio,
        interests: activities,
        favoriteTracks,
        avatarUri: activeAvatar,
        gallery,
        isDiscoverable: discoverable,
        notificationsEnabled: notifications,
        privacy,
        matchingPreferences: {
          ...(safeProfile.matchingPreferences || {}),
        },
        ...customOverrides,
      };
      delete profileData.keepOpen;
      delete profileData.successMessage;

      if (overrideSave) await overrideSave(profileData);
      else await saveProfile(profileData);
      const successMessage = customOverrides.successMessage || 'บันทึกโปรไฟล์เรียบร้อยแล้ว';
      if (onClose && !customOverrides.keepOpen) {
        onClose();
        setTimeout(() => onToast?.(successMessage), 350);
      } else {
        onToast?.(successMessage);
      }
      return true;
    } catch (error) {
      console.error('[ProfileScreen handleSave error]', error?.message || error, error?.code, error?.stack);
      if (error.isModerationViolation || error.isModerationUnavailable) {
        showImageModeration(error);
      } else {
        onToast?.(error.message || 'บันทึกโปรไฟล์ไม่สำเร็จ', 'info');
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'android' ? 'height' : 'padding'}
      keyboardVerticalOffset={0}
      style={styles.container}
    >
      {/* Sticky Tab Switcher */}
      {tabs && tabs.length > 1 ? (
        <View style={styles.stickyTabBarContainer}>
          <LiquidGlassSegmentedControl
            activeTab={activeTab}
            onChangeTab={handleTabChange}
            tabs={tabConfigs}
          />
        </View>
      ) : null}

      {activeTab === 'settings' ? (
        <ProfileSettingsScreen
          onLogout={onLogout}
          onNavigateToEdit={() => handleTabChange('edit')}
          onToast={onToast}
        />
      ) : activeTab === 'preview' ? (
        <View style={{ flex: 1, backgroundColor: colors.canvas }}>
          <ProfilePreview
            activityDetails={activityDetails}
            activities={interests}
            age={age}
            availability={availability}
            availabilitySlots={availabilitySlots}
            avatarUri={avatarUri}
            bio={bio}
            colors={colors}
            faculty={faculty}
            favoriteTracks={favoriteTracks}
            gallery={gallery}
            gender={gender}
            name={name}
            onNavigateToEdit={() => handleTabChange('edit')}
            skill={skill}
            year={year}
          />
        </View>
      ) : (
        <ScreenScrollView
          ref={editorScrollRef}
          contentContainerStyle={[styles.content, styles.contentWithStickySave]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* --- Photo section header: one row, title + count on the left, link on the right --- */}
          <View style={{ marginBottom: 12, marginTop: 4, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 }}>
              <Text style={{ fontSize: 18, lineHeight: 26, fontWeight: '800', color: colors.ink }}>รูปภาพ</Text>
              <View style={{ backgroundColor: colors.surfaceRaised, borderRadius: 12, paddingHorizontal: 8, height: 24, justifyContent: 'center' }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.inkMuted }}>
                  {(avatarUri ? 1 : 0) + gallery.filter(Boolean).length}/{MAX_PROFILE_PHOTOS}
                </Text>
              </View>
              <View style={{ flex: 1 }} />
              <Pressable accessibilityLabel="เปิดหน้ารูปภาพของฉัน" accessibilityRole="button" hitSlop={6} onPress={() => router.push('/profile-photos')}
                style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8, opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.accentText }}>จัดเรียงรูป</Text>
                <FeatureIcon name="chevron.right" size={13} color={colors.accentText} />
              </Pressable>
            </View>
            <Text style={{ fontSize: 13, color: colors.inkMuted, lineHeight: 18 }}>
              รูปหลักควรเห็นหน้าชัด ส่วนรูปอื่นเล่าเรื่องกิจกรรมที่คุณชอบได้เลย
            </Text>
          </View>

          {/* --- Bento photo grid: main photo 2 x 2, the rest around it --- */}
          <View style={{ marginBottom: 14 }}>
            <BentoPhotoGrid
              photos={Array.from({ length: MAX_PROFILE_PHOTOS }, (_, index) => index === processingPhotoIndex && localPhotoPreview ? localPhotoPreview : index === 0 ? avatarUri : gallery[index - 1])}
              busyIndex={isProcessingImage ? processingPhotoIndex : null}
              busyUris={Object.keys(uploadingGallery)}
              slots={MAX_PROFILE_PHOTOS}
              disabled={isProcessingImage}
              identityPrefix={`profile-editor:${safeProfile.id || 'me'}`}
              avatarRevision={safeProfile.avatarRevision}
              onPressSlot={(index, uri) => {
                if (isProcessingImage) return;
                if (uri) setSelectedPhotoIndex(index);
                else if (index === 0) pickImage();
                else pickGalleryPhoto(index - 1);
              }}
              onRemove={handleDeletePhoto}
            />
          </View>
          {((avatarUri ? 1 : 0) + gallery.filter(Boolean).length) < 3 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.amberSoft, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderCurve: 'continuous', marginBottom: 16 }}>
              <FeatureIcon name="sparkles" size={15} color={colors.amber} />
              <Text style={{ fontSize: 12, lineHeight: 18, color: colors.ink, flex: 1, fontWeight: '600' }}>
                เพิ่มอีก {3 - ((avatarUri ? 1 : 0) + gallery.filter(Boolean).length)} รูป ให้เพื่อนเห็นมุมต่าง ๆ ของคุณ
              </Text>
            </View>
          )}



          <Card style={styles.formCard}>
          <SectionToggleHeader
            colors={colors}
            expanded={expandedSection === 'basic'}
            icon="person.text.rectangle.fill"
            onPress={() => setExpandedSection((current) => current === 'basic' ? null : 'basic')}
            subtitle="ข้อมูลที่ใช้แสดงบนการ์ดจับคู่"
            title="ข้อมูลพื้นฐาน"
          />
          {expandedSection === 'basic' && (
          <View style={styles.basicInfoList}>
            <AndroidInputField
              icon="person.fill"
              label="ชื่อที่แสดง"
              onChangeText={setName}
              placeholder="ระบุชื่อของคุณ"
              required
              value={name}
            />
            {isFacultyLocked ? (
              <AndroidReadOnlyRow helper={facultyHelper} icon="building.columns.fill" label="คณะ" value={faculty || 'ไม่พบข้อมูล'} />
            ) : (
              <AndroidSelectionRow
                icon="building.columns.fill"
                label="คณะ"
                onSelect={setFaculty}
                options={FACULTY_OPTIONS}
                placeholder="เลือกคณะ"
                required
                value={faculty}
              />
            )}
            {isYearLocked ? (
              <AndroidReadOnlyRow helper={yearHelper} icon="graduationcap.fill" label="ชั้นปี" value={year || 'ไม่พบข้อมูล'} />
            ) : (
              <AndroidSelectionRow
                icon="graduationcap.fill"
                label="ชั้นปี"
                onSelect={setYear}
                options={YEAR_OPTIONS}
                placeholder="เลือกชั้นปี"
                required
                value={year}
              />
            )}
            <AndroidSelectionRow
              icon="calendar"
              label="อายุ"
              onSelect={setAge}
              options={AGES}
              placeholder="เลือกอายุ"
              required
              value={age}
            />
            <AndroidSelectionRow
              icon="person.2.fill"
              label="เพศ"
              onSelect={setGender}
              options={GENDERS}
              placeholder="เลือกเพศ"
              required
              value={gender}
            />
            <View style={{ marginTop: spacing.xs }}>
              <Field
                colors={colors}
                styles={styles}
                label="คำแนะนำตัวสั้น ๆ"
                required={isFirstSetup}
                value={bio}
                onChangeText={setBio}
                multiline
                inputStyle={styles.bioInput}
                placeholder="เล่าให้เพื่อนรู้จักคุณมากขึ้น"
              />
            </View>
          </View>
          )}
        </Card>

        <Card style={styles.formCard}>
          <SectionToggleHeader
            colors={colors}
            expanded={expandedSection === 'activities'}
            icon="figure.run.circle.fill"
            onPress={() => setExpandedSection((current) => current === 'activities' ? null : 'activities')}
            subtitle="เลือกได้มากกว่าหนึ่งกิจกรรม"
            title="กิจกรรมและไลฟ์สไตล์"
            required
          />
          {expandedSection === 'activities' && (
          <View style={styles.formSectionSpacing}>
          <View style={styles.interestGrid}>
            {ACTIVITY_CATEGORIES.filter((category) => category.id !== 'all').map((category) => (
              <ProfileActivityChip
                key={category.id}
                category={category}
                selected={interests.includes(category.id)}
                onPress={() => toggleInterest(category.id)}
              />
            ))}
          </View>


            {ACTIVITY_CATEGORIES.map((option) => option.id).filter((id) => interests.includes(id)).map((activityId) => (
              <ActivityDetailSection
                activityId={activityId}
                key={activityId}
                onChange={updateActivityDetail}
                colors={colors}
                styles={styles}
                values={activityDetails[activityId] || {}}
              />
            ))}

          <Field colors={colors} styles={styles} label="ทักษะเพิ่มเติม (ไม่บังคับ)" value={skill} onChangeText={setSkill} placeholder="เช่น โค้ชวิ่ง ถ่ายรูป เล่นดนตรี" />
          </View>
          )}
        </Card>

        {canUseSpotify ? (
          <View onLayout={({ nativeEvent }) => {
            musicSectionYRef.current = nativeEvent.layout.y;
            if (initialSection === 'music' && !musicShortcutHandled.current) {
              musicShortcutHandled.current = true;
              setTimeout(() => {
                editorScrollRef.current?.scrollTo({ y: nativeEvent.layout.y, animated: true });
              }, 100);
            }
          }}>
          <LiquidGlassView
            borderRadius={22}
            borderWidth={StyleSheet.hairlineWidth}
            contentStyle={{ width: '100%', alignItems: 'stretch' }}
            glassEffectStyle="regular"
            specular
            style={[styles.formCard, styles.musicGlassCard]}
          >
            <SectionToggleHeader
              colors={colors}
              expanded={expandedSection === 'music'}
              icon="music.note"
              onPress={() => setExpandedSection((current) => current === 'music' ? null : 'music')}
              subtitle={favoriteTracks.length > 0 ? `เลือกไว้ ${favoriteTracks.length}/${MAX_FAVORITE_TRACKS} เพลง · แสดงบนโปรไฟล์` : 'เชื่อมต่อ Spotify และเลือกเพลงโปรดแสดงบนโปรไฟล์'}
              title="เพลงและดนตรีโปรด"
            />
            {expandedSection === 'music' && (
              <View style={styles.formSectionSpacing}>
                <View style={styles.fieldContainer}>
                  <SpotifyConnectCard />
                </View>
                <View style={styles.fieldContainer}>
                  <FormLabel label={`เพลงโปรด (${favoriteTracks.length}/${MAX_FAVORITE_TRACKS})`} styles={styles} />
                  {favoriteTracks.map((track) => (
                    <ProfileFavoriteTrackRow
                      key={track.id}
                      track={track}
                      onRemove={(id) => setFavoriteTracks((current) => current.filter((item) => item.id !== id))}
                    />
                  ))}
                  {favoriteTracks.length < MAX_FAVORITE_TRACKS ? (
                    <TonalButton iconName="magnifyingglass" label="ค้นหาและเพิ่มเพลง" onPress={() => setShowSpotifySearch(true)} style={{ marginTop: 4 }} />
                  ) : (
                    <Text style={styles.favoriteTracksHint}>เพิ่มได้สูงสุด {MAX_FAVORITE_TRACKS} เพลง</Text>
                  )}
                </View>
              </View>
            )}
          </LiquidGlassView>
          </View>
        ) : null}
        </ScreenScrollView>
      )}
      <FaceVerificationModal
        avatarUri={verificationCandidate?.uri || avatarUri}
        candidateAvatarUri={verificationCandidate?.uri}
        onClose={() => {
          setShowFaceVerificationModal(false);
          setVerificationCandidate(null);
          if (!verificationPassedRef.current) {
            onToast?.('ยังไม่ได้เปลี่ยนรูปหลัก ต้องยืนยันรูปใหม่ให้ผ่านก่อน', 'info');
          }
        }}
        onSuccess={handleFaceVerified}
        visible={showFaceVerificationModal}
      />
      {showSpotifySearch ? (
        <SpotifyTrackSearchSheet
          excludeIds={favoriteTracks.map((track) => track.id)}
          onClose={() => setShowSpotifySearch(false)}
          onSelect={(track) => {
            setFavoriteTracks((current) => {
              if (current.some((item) => item.id === track.id) || current.length >= MAX_FAVORITE_TRACKS) return current;
              return [...current, track];
            });
            setShowSpotifySearch(false);
          }}
          visible
        />
      ) : null}

      {editingPhoto ? (
        <ChatImageEditorModal
          confirmLabel="ใช้รูปนี้"
          imageUri={editingPhoto.uri}
          imageUris={editingPhoto.uris}
          onClose={() => setEditingPhoto(null)}
          onSend={async (edited) => {
            const targetIndex = editingPhoto.index;
            const editedUri = Array.isArray(edited) ? edited[0]?.uri : edited?.uri;
            if (!editedUri) return;
            setEditingPhoto(null);
            if (targetIndex === 0) {
              setAvatarUri(editedUri);
            } else {
              setGallery((current) => {
                const next = [...current];
                next[targetIndex - 1] = editedUri;
                return next;
              });
              if (currentOwnerId) {
                uploadGalleryImage(editedUri, currentOwnerId)
                  .then((remoteUrl) => {
                    setGallery((current) => {
                      const next = [...current];
                      const idx = next.indexOf(editedUri);
                      if (idx !== -1) {
                        next[idx] = remoteUrl;
                        return [...next];
                      }
                      return current;
                    });
                  })
                  .catch((err) => {
                    console.warn('[ProfileScreen] Background gallery upload error:', err);
                  });
              }
            }
            onToast?.('บันทึกการแก้ไขรูปภาพแล้ว', 'success');
          }}
          showCaption={false}
          visible
        />
      ) : null}

      {/* Photo Management Action Sheet */}
      <Modal
        animationType="slide"
        onRequestClose={() => setSelectedPhotoIndex(null)}
        transparent
        visible={selectedPhotoIndex !== null}
      >
        <Pressable onPress={() => setSelectedPhotoIndex(null)} style={styles.sheetBackdrop}>
          <Pressable onPress={(e) => e.stopPropagation()} style={[styles.sheetContainer, glass
            ? { backgroundColor: 'transparent', borderColor: 'transparent' }
            : { backgroundColor: colors.card, borderColor: colors.line }]}>
            <GlassBackground style={{ borderTopLeftRadius: 24, borderTopRightRadius: 24 }} tintColor={glassTint} />
            <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.ink }]}>
              {selectedPhotoIndex === 0 ? 'รูปโปรไฟล์หลัก' : `รูปที่ ${(selectedPhotoIndex || 0) + 1}`}
            </Text>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const idx = selectedPhotoIndex;
                triggerEditPhoto(idx);
              }}
              style={[styles.sheetActionItem, { borderBottomColor: colors.line }]}
            >
              <FeatureIcon color={colors.ink} name="slider.horizontal.3" size={20} />
              <Text style={[styles.sheetActionText, { color: colors.ink }]}>แก้ไขรูปภาพ</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const idx = selectedPhotoIndex;
                triggerReplacePhoto(idx);
              }}
              style={[styles.sheetActionItem, { borderBottomColor: colors.line }]}
            >
              <FeatureIcon color={colors.ink} name="pencil" size={20} />
              <Text style={[styles.sheetActionText, { color: colors.ink }]}>เปลี่ยนรูปภาพ</Text>
            </Pressable>

            {selectedPhotoIndex > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  const idx = selectedPhotoIndex;
                  setSelectedPhotoIndex(null);
                  handleMakeMainPhoto(idx);
                }}
                style={[styles.sheetActionItem, { borderBottomColor: colors.line }]}
              >
                <FeatureIcon color={colors.ink} name="person.crop.square.fill" size={20} />
                <Text style={[styles.sheetActionText, { color: colors.ink }]}>ตั้งเป็นรูปหลัก</Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const idx = selectedPhotoIndex;
                setSelectedPhotoIndex(null);
                handleDeletePhoto(idx);
              }}
              style={[styles.sheetActionItem, { borderBottomColor: colors.line }]}
            >
              <FeatureIcon color={colors.danger} name="trash" size={20} />
              <Text style={[styles.sheetActionText, { color: colors.danger }]}>ลบรูปภาพ</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSelectedPhotoIndex(null);
                clearTimeout(photoActionTimer.current);
                photoActionTimer.current = setTimeout(() => {
                  router.push('/profile-photos');
                }, 300);
              }}
              style={[styles.sheetActionItem, { borderBottomColor: colors.line }]}
            >
              <FeatureIcon color={colors.primary} name="photo.on.rectangle.angled" size={20} />
              <Text style={[styles.sheetActionText, { color: colors.primary }]}>เปิดหน้ารูปภาพของฉัน</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => setSelectedPhotoIndex(null)}
              style={[styles.sheetCloseButton, { backgroundColor: colors.surfaceRaised }]}
            >
              <Text style={[styles.sheetCloseText, { color: colors.ink }]}>ยกเลิก</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      {activeTab === 'edit' && (
        <ScreenChrome elevated pointerEvents="box-none" style={[styles.stickySaveBarContainer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
            <PrimaryButton
              iconName="checkmark.circle.fill"
              label={isFirstSetup ? 'สร้างโปรไฟล์' : 'บันทึกโปรไฟล์'}
              loading={saving}
              onPress={handleSave}
              numberOfLines={0}
              style={[styles.stickySaveButton, { borderRadius: Platform.OS === 'ios' ? 28 : 16 }]}
            />
        </ScreenChrome>
      )}
    </KeyboardAvoidingView>
  );
}

function SettingsListRow({ danger = false, icon, label, onPress, value, last = false }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const accentColor = danger ? colors.danger : colors.primary;
  const content = (
    <>
      <View style={styles.settingsIcon}>
        <FeatureIcon color={accentColor} name={icon} size={18} />
      </View>
      <Text style={[styles.settingsLabel, { color: danger ? colors.danger : colors.ink }]}>{label}</Text>
      {value ? <Text style={[styles.settingsValue, { color: colors.inkMuted }]}>{value}</Text> : null}
      {onPress ? <FeatureIcon color={danger ? colors.danger : colors.inkSoft} name="chevron.right" size={18} /> : null}
    </>
  );

  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.settingsRow, !last && { borderBottomColor: colors.line }]}>
      {content}
    </Pressable>
  ) : (
    <View style={[styles.settingsRow, !last && { borderBottomColor: colors.line }]}>{content}</View>
  );
}

function FormLabel({ label, required = false, styles }) {
  return (
    <Text style={styles.label}>
      {label}{required ? <Text style={styles.requiredMark}> {REQUIRED_MARK}</Text> : null}
    </Text>
  );
}

function SectionToggleHeader({ colors, expanded, icon, onPress, required = false, title }) {
  const styles = getStyles(colors);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }} onPress={onPress} style={styles.sectionToggleHeader}>
      <View style={styles.sectionToggleIcon}>
        <FeatureIcon color={colors.primary} name={icon} size={19} />
      </View>
      <View style={styles.sectionToggleCopy}>
        <Text style={styles.sectionToggleTitle}>{title}{required ? <Text style={styles.requiredMark}> {REQUIRED_MARK}</Text> : null}</Text>
      </View>
      <FeatureIcon color={colors.inkSoft} name={expanded ? 'chevron.up' : 'chevron.down'} size={19} />
    </Pressable>
  );
}

function Field({ colors, styles, label, required = false, value, onChangeText, placeholder, multiline = false, inputStyle, keyboardType }) {
  return (
    <View style={styles.field}>
      <FormLabel label={label} required={required} styles={styles} />
      <TextInput
        accessibilityLabel={required ? `${label} จำเป็น` : label}
        multiline={multiline}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSoft}
        style={[styles.input, multiline && styles.multilineInput, inputStyle]}
        textAlignVertical={multiline ? 'top' : 'center'}
        value={value}
      />
    </View>
  );
}

function AndroidInputField({ icon, label, onChangeText, placeholder, required = false, value }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <View style={styles.fullRowInputContainer}>
      <FeatureIcon color={colors.primary} name={icon} size={18} style={styles.fullRowDropdownIcon} />
      <View style={styles.fullRowDropdownCopy}>
        <Text style={styles.fullRowDropdownLabel}>{label}{required ? <Text style={styles.requiredMark}> {REQUIRED_MARK}</Text> : null}</Text>
        <TextInput
          accessibilityLabel={required ? `${label} จำเป็น` : label}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.inkSoft}
          style={styles.fullRowInputValue}
          value={value}
        />
      </View>
    </View>
  );
}

export function AndroidReadOnlyRow({ helper, icon, label, value }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <View style={styles.fullRowInputContainer}>
      <FeatureIcon color={colors.primary} name={icon} size={18} style={styles.fullRowDropdownIcon} />
      <View style={styles.fullRowDropdownCopy}>
        <Text style={styles.fullRowDropdownLabel}>{label}</Text>
        <Text style={value ? styles.fullRowDropdownValue : styles.fullRowDropdownPlaceholder}>
          {value || 'ไม่ระบุ'}
        </Text>
        {helper ? <Text style={styles.fullRowReadOnlyHint}>{helper}</Text> : null}
      </View>
      <FeatureIcon color={colors.inkSoft} name="lock.fill" size={15} />
    </View>
  );
}

export function AndroidSelectionRow({ icon, label, onSelect, options, placeholder, required = false, value, disabled = false }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <CustomDropdown
      colors={colors}
      disabled={disabled}
      fullRow
      icon={icon}
      label={label}
      onSelect={onSelect}
      options={options}
      placeholder={placeholder}
      required={required}
      styles={styles}
      value={value}
    />
  );
}

function CustomDropdown({ colors, styles, value, onSelect, options, placeholder, compact = false, disabled = false, fullRow = false, icon, label, required = false }) {
  const [modalVisible, setModalVisible] = useState(false);
  const glass = useLiquidGlass();
  const glassTint = useSheetGlassTint();
  const { height: windowHeight } = useWindowDimensions();
  const selectedOption = options.find((option) => (typeof option === 'string' ? option : option.value) === value);
  const selectedLabel = typeof selectedOption === 'string' ? selectedOption : selectedOption?.label;
  const displayValue = selectedLabel || value || placeholder;

  const translateY = useRef(new Animated.Value(600)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);

  const closeWithAnimation = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 700,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setModalVisible(false);
      isClosingRef.current = false;
    });
  }, [translateY, fadeAnim]);

  useEffect(() => {
    if (modalVisible) {
      isClosingRef.current = false;
      translateY.setValue(600);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          damping: 22,
          mass: 0.8,
          stiffness: 280,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [modalVisible, translateY, fadeAnim]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) => (
      gestureState.dy > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
    ),
    onMoveShouldSetPanResponderCapture: (_, gestureState) => (
      gestureState.dy > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
    ),
    onPanResponderGrant: () => {
      translateY.stopAnimation();
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dy > 0) {
        translateY.setValue(gestureState.dy);
      } else {
        translateY.setValue(gestureState.dy * 0.15);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dy > 70 || gestureState.vy > 0.5) {
        closeWithAnimation();
      } else {
        Animated.spring(translateY, {
          toValue: 0,
          damping: 22,
          mass: 0.8,
          stiffness: 280,
          useNativeDriver: true,
        }).start();
      }
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      Animated.spring(translateY, {
        toValue: 0,
        damping: 22,
        mass: 0.8,
        stiffness: 280,
        useNativeDriver: true,
      }).start();
    },
  }), [closeWithAnimation, translateY]);

  return (
    <View>
      <Pressable
        accessibilityLabel={label || placeholder}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setModalVisible(true)}
        style={[
          styles.dropdownButton,
          compact && styles.compactDropdownButton,
          fullRow && styles.fullRowDropdownButton,
          disabled && styles.dropdownDisabled,
        ]}
      >
        {fullRow && <FeatureIcon color={colors.primary} name={icon} size={18} style={styles.fullRowDropdownIcon} />}
        {fullRow ? (
          <View style={styles.fullRowDropdownCopy}>
            <Text style={styles.fullRowDropdownLabel}>{label}{required ? <Text style={styles.requiredMark}> {REQUIRED_MARK}</Text> : null}</Text>
            <Text style={value ? styles.fullRowDropdownValue : styles.fullRowDropdownPlaceholder}>
              {displayValue}
            </Text>
          </View>
        ) : (
          <Text style={value ? styles.dropdownButtonText : styles.dropdownButtonPlaceholder}>{displayValue}</Text>
        )}
        {!disabled && <FeatureIcon color={colors.inkSoft} name="chevron.down" size={15} />}
      </Pressable>
      <Modal
        animationType="none"
        onRequestClose={closeWithAnimation}
        statusBarTranslucent
        transparent
        visible={modalVisible}
      >
        <View style={styles.modalOverlay}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: fadeAnim }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeWithAnimation} />
          </Animated.View>
          <Animated.View
            style={[
              styles.modalContent,
              {
                height: Math.min(Math.max(windowHeight * 0.82, 220), 680),
                transform: [{ translateY }],
              },
              glass && { backgroundColor: 'transparent' },
            ]}
          >
            <GlassBackground style={{ borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl }} tintColor={glassTint} />
            <View
              {...panResponder.panHandlers}
              accessibilityHint="ลากลงเพื่อปิด"
              style={styles.sheetHeaderDraggable}
            >
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>{placeholder}</Text>
            </View>
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator
              style={styles.modalScroll}
            >
              {options.map((opt) => {
                const optionValue = typeof opt === 'string' ? opt : opt.value;
                const optionLabel = typeof opt === 'string' ? opt : opt.label;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected: value === optionValue }}
                    key={optionValue}
                    style={[styles.modalItem, value === optionValue && styles.modalItemActive]}
                    onPress={() => {
                      onSelect(optionValue);
                      closeWithAnimation();
                    }}
                  >
                    <Text style={[styles.modalItemText, value === optionValue && styles.modalItemTextActive]}>{optionLabel}</Text>
                    {value === optionValue && <FeatureIcon color={colors.primary} name="checkmark" size={18} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

function ToggleRow({ colors, styles, label, onChange, value, last = false }) {
  return (
    <View style={[styles.toggleRow, !last && styles.toggleRowBorder]}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch onValueChange={onChange} trackColor={{ false: colors.line, true: colors.primary }} value={value} />
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
    activityDetailSection: { backgroundColor: colors.surfaceRaised, borderRadius: 18, padding: 12, marginBottom: 16, width: '100%' },
    activityDetailHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    activityDetailIcon: { marginRight: 8 },
    activityDetailTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', flex: 1 },
    activityDetailSubtitle: { color: colors.tertiary || colors.inkSoft, fontSize: 11, fontWeight: '600' },
    activityDetailField: { marginBottom: 12 },
    activityDetailFieldLabel: { color: colors.inkSoft, fontSize: 12, fontWeight: '800', marginBottom: 6 },
    activityDetailTextInput: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: 12, borderWidth: 1, color: colors.ink, minHeight: 44, paddingHorizontal: 12, fontSize: 15 },
    optionPillRows: { gap: 8 },
    optionPillRow: { flexDirection: 'row', gap: 8 },
    optionPill: { flex: 1, backgroundColor: colors.card, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
    optionPillSelected: { backgroundColor: colors.primary },
    optionPillText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    optionPillTextSelected: { color: colors.onPrimary },
  container: { flex: 1, backgroundColor: colors.canvas },
  stickyTabBarContainer: {
    backgroundColor: 'transparent',
    alignSelf: 'center',
    maxWidth: 680,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    width: '100%',
    zIndex: 999,
  },
  tabSwitcher: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 20,
    borderWidth: 1,
    elevation: 1,
    flexDirection: 'row',
    padding: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  tabButton: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 16,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  tabButtonActive: {
    backgroundColor: colors.canvas,
    elevation: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
  },
  tabButtonText: {
    color: colors.inkMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  tabButtonTextActive: {
    color: colors.primary,
  },
  tabButtonTextInactive: {
    color: colors.inkMuted,
  },
  content: { alignSelf: 'center', maxWidth: 680, padding: spacing.md, paddingBottom: spacing.xxxl, width: '100%' },
  contentWithStickySave: { paddingBottom: spacing.lg },
  eyebrow: { color: colors.primary, fontSize: type.micro, fontWeight: '800', letterSpacing: 1, marginBottom: spacing.xs, textTransform: 'uppercase' },
  title: { color: colors.ink, fontSize: type.h1, fontWeight: '900', letterSpacing: -0.5, marginBottom: spacing.xs },
  subtitle: { color: colors.inkMuted, fontSize: type.body, lineHeight: 22, marginBottom: spacing.md },
  identityCard: { alignItems: 'center', borderCurve: 'continuous', flexDirection: 'column', marginBottom: spacing.md, padding: spacing.md, position: 'relative' },
  avatarContainer: { position: 'relative' },
  avatarLoadingOverlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 37, justifyContent: 'center' },
  identityCopy: { alignItems: 'center', marginTop: spacing.xs, width: '100%' },
  identityName: { color: colors.ink, fontSize: 18, fontWeight: '800', marginBottom: 2, textAlign: 'center' },
  identityEmail: { color: colors.inkMuted, fontSize: type.caption, marginBottom: spacing.xs, textAlign: 'center' },
  verifiedPill: { alignSelf: 'center', backgroundColor: colors.greenSoft, borderCurve: 'continuous', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  verifiedText: { color: colors.green, fontSize: type.micro, fontWeight: '700' },
  cameraButton: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.canvas, borderCurve: 'continuous', borderRadius: 16, borderWidth: 2, bottom: -2, height: 32, justifyContent: 'center', position: 'absolute', right: -2, width: 32 },
  cameraText: { color: colors.ink, fontSize: 16 },
  formCard: { borderCurve: 'continuous', marginBottom: spacing.md, padding: spacing.md },
  field: { marginBottom: spacing.md },
  label: { color: colors.ink, fontSize: type.caption, fontWeight: '700', marginBottom: spacing.xs },
  input: { backgroundColor: colors.canvas, borderColor: colors.line, borderCurve: 'continuous', borderRadius: radius.md, borderWidth: 1, color: colors.ink, fontSize: type.body, minHeight: 48, paddingHorizontal: spacing.md },
  multilineInput: { minHeight: 100, paddingVertical: spacing.md },
  bioInput: { minHeight: 100 },
  pickerContainer: { marginBottom: spacing.md },
  basicInfoList: { gap: spacing.sm, marginTop: spacing.sm },
  fullRowInputContainer: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: 4, width: '100%' },
  fullRowInputValue: { color: colors.ink, fontSize: type.body, fontWeight: '700', margin: 0, minHeight: 22, padding: 0 },
  androidSelectionRow: { width: '100%' },
  privacyList: { borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  notificationList: { borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, marginTop: spacing.md, overflow: 'hidden' },
  dropdownButton: { backgroundColor: colors.canvas, borderColor: colors.line, borderCurve: 'continuous', borderRadius: radius.md, borderWidth: 1, minHeight: 48, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownDisabled: { opacity: 0.55 },
  compactDropdownButton: { borderWidth: 0, minHeight: 48, paddingHorizontal: 0 },
  fullRowDropdownButton: { backgroundColor: colors.surfaceRaised, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: 6, width: '100%' },
  fullRowDropdownIcon: { marginRight: spacing.sm },
  fullRowDropdownCopy: { flex: 1, minWidth: 0 },
  fullRowDropdownLabel: { color: colors.inkSoft, fontSize: type.caption2, fontWeight: '600', marginBottom: 2 },
  fullRowDropdownValue: { color: colors.ink, fontSize: type.body, fontWeight: '700' },
  fullRowDropdownPlaceholder: { color: colors.inkSoft, fontSize: type.body, fontWeight: '700' },
  fullRowReadOnlyHint: { color: colors.inkSoft, fontSize: type.caption2, marginTop: 2 },
  dropdownButtonText: { color: colors.ink, fontSize: type.body },
  dropdownButtonPlaceholder: { color: colors.inkSoft, fontSize: type.body },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '82%', padding: spacing.lg, paddingBottom: spacing.xl, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8 },
  modalHandle: { alignSelf: 'center', backgroundColor: colors.inkSoft, borderRadius: radius.pill, height: 5, marginBottom: spacing.sm, opacity: 0.5, width: 44 },
  modalTitle: { color: colors.ink, fontSize: type.h3, fontWeight: '800', textAlign: 'center', marginBottom: spacing.sm },
  sheetHeaderDraggable: { alignSelf: 'stretch', paddingBottom: spacing.xs },
  modalScroll: { flex: 1, minHeight: 0 },
  modalScrollContent: { paddingBottom: spacing.sm },
  requiredLegend: { color: colors.inkMuted, fontSize: type.caption2, marginBottom: spacing.sm, marginHorizontal: spacing.xs },
  requiredMark: { color: colors.danger, fontWeight: '900' },
  modalItem: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: spacing.sm, paddingVertical: spacing.md },
  modalItemActive: { backgroundColor: colors.greenSoft, borderRadius: radius.sm, borderBottomWidth: 0, paddingHorizontal: spacing.sm },
  modalItemText: { color: colors.ink, flex: 1, fontSize: type.body },
  modalItemTextActive: { color: colors.primary, fontWeight: '800' },
  interestGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: spacing.lg, marginBottom: spacing.md },
  formSectionSpacing: { marginTop: spacing.md },
  fieldContainer: { marginBottom: spacing.md },
  addTrackButton: { alignItems: 'center', borderCurve: 'continuous', borderRadius: 16, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 52, paddingHorizontal: spacing.md, paddingVertical: 12 },
  addTrackButtonText: { color: colors.accentText, fontSize: 15, lineHeight: 23, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  favoriteTracksHint: { color: colors.inkSoft, fontSize: type.caption2, marginTop: spacing.xs },
  field: { marginBottom: spacing.md },
  label: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '800', marginBottom: 6 },
  input: { backgroundColor: colors.canvas, borderColor: colors.line, borderCurve: 'continuous', borderRadius: radius.md, borderWidth: 1, color: colors.ink, fontSize: type.body, minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: 10 },
  multilineInput: { minHeight: 90, borderCurve: 'continuous', borderRadius: radius.md },
  bioInput: { lineHeight: 20 },
  saveButton: { marginTop: spacing.sm },
  toggleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 58, paddingHorizontal: spacing.md },
  toggleRowBorder: { borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth },
  toggleLabel: { color: colors.ink, flex: 1, fontSize: type.body, marginRight: spacing.md },
  securityCard: { alignItems: 'center', backgroundColor: colors.greenSoft, borderColor: colors.greenSoft, flexDirection: 'row', marginTop: spacing.lg, padding: spacing.lg },
  securityIcon: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 20, height: 40, justifyContent: 'center', marginRight: spacing.md, width: 40 },
  securityIconText: { fontSize: 18 },
  securityCopy: { flex: 1 },
  securityTitle: { color: colors.green, fontSize: type.caption, fontWeight: '900' },
  securityText: { color: colors.green, fontSize: type.micro, lineHeight: 16, marginTop: 3 },
  settingsCard: { marginTop: spacing.md, padding: 0 },
  settingsTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900', paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  legalSubsection: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.sm, paddingTop: spacing.sm },
  legalSubsectionTitle: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '800', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  settingsRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 52, paddingHorizontal: spacing.lg },
  settingsIcon: { alignItems: 'center', height: 28, justifyContent: 'center', marginRight: spacing.md, width: 28 },
  settingsLabel: { flex: 1, fontSize: type.body, fontWeight: '700' },
  settingsValue: { fontSize: type.caption, marginRight: spacing.sm },
  sectionToggleHeader: { alignItems: 'center', flexDirection: 'row', minHeight: 44 },
  sectionToggleIcon: { alignItems: 'center', height: 28, justifyContent: 'center', marginRight: spacing.sm, width: 28 },
  sectionToggleCopy: { flex: 1 },
  sectionToggleTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  sectionToggleSubtitle: { color: colors.inkMuted, fontSize: type.caption2, marginTop: 1 },
  aboutSettingsCard: { marginTop: spacing.md, padding: 0 },
  accountSettingsCard: { marginTop: spacing.md, padding: 0 },
  musicGlassCard: {
    borderRadius: 22,
    borderCurve: 'continuous',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  stickySaveBarContainer: {
    alignSelf: 'center',
    maxWidth: 680,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    width: '100%',
    zIndex: 999,
  },
  stickySaveButton: { alignSelf: 'stretch' },
  accountSettingsTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900', paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  visibilityEntry: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.md, minHeight: 60, paddingHorizontal: spacing.md },
  visibilityEntryCopy: { flex: 1, marginLeft: spacing.md },
  visibilityEntryTitle: { color: colors.ink, fontSize: type.body, fontWeight: '900' },
  visibilityEntrySubtitle: { color: colors.inkMuted, fontSize: type.caption, marginTop: 2 },
  photoActionButtonTop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    position: 'absolute',
    right: 6,
    top: 6,
    width: 32,
    zIndex: 2,
  },
  photoActionButtonBottom: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 32,
    zIndex: 2,
  },
  sheetBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingBottom: 34,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sheetHandle: {
    alignSelf: 'center',
    borderRadius: 3,
    height: 5,
    marginBottom: 16,
    width: 36,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  sheetActionItem: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 52,
    paddingVertical: 12,
  },
  sheetActionText: {
    fontSize: 16,
    fontWeight: '700',
  },
  sheetCloseButton: {
    alignItems: 'center',
    borderRadius: radius.md,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 48,
  },
  sheetCloseText: {
    fontSize: 16,
    fontWeight: '700',
  },
});

function OptionPillRows({ onToggle, options, colors, styles, selected }) {
  const rows = [];
  for (let i = 0; i < options.length; i += 2) rows.push(options.slice(i, i + 2));
  return (
    <View style={styles.optionPillRows}>
      {rows.map((pair, index) => (
        <View key={index} style={styles.optionPillRow}>
          {pair.map((option) => {
            const isSelected = selected.includes(option);
            return (
              <Pressable
                key={option}
                onPress={() => onToggle(option)}
                style={[
                  styles.optionPill,
                  isSelected && styles.optionPillSelected,
                ]}
              >
                <Text style={[styles.optionPillText, isSelected && styles.optionPillTextSelected]}>
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function ActivityDetailSection({ activityId, onChange, colors, styles, values }) {
  const category = getActivityCategory(activityId);
  const fields = getActivityDetailFields(activityId);
  if (!category || !fields.length) return null;

  return (
    <View style={styles.activityDetailSection}>
      <View style={styles.activityDetailHeader}>
        <FeatureIcon color={category.color} name={category.symbol} size={15} style={styles.activityDetailIcon} />
        <Text style={styles.activityDetailTitle}>{category.label}</Text>
        <Text style={styles.activityDetailSubtitle}>รายละเอียดเพิ่มเติม</Text>
      </View>
      {fields.map((field) => {
        const value = values[field.key];

        if (field.type === 'multi') {
          const selected = Array.isArray(value) ? value : [];
          return (
            <View key={field.key} style={styles.activityDetailField}>
              <Text style={styles.activityDetailFieldLabel}>{field.label}</Text>
              <OptionPillRows
                onToggle={(option) => onChange(
                  activityId,
                  field.key,
                  selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]
                )}
                options={field.options}
                colors={colors}
                styles={styles}
                selected={selected}
              />
            </View>
          );
        }

        if (field.type === 'text') {
          return (
            <View key={field.key} style={styles.activityDetailField}>
               <Text style={styles.activityDetailFieldLabel}>{field.label}</Text>
               <TextInput
                  placeholder={field.label}
                  value={typeof value === 'string' ? value : ''}
                  onChangeText={(text) => onChange(activityId, field.key, text)}
                  style={styles.activityDetailTextInput}
                  placeholderTextColor={colors.inkSoft}
               />
            </View>
          );
        }

        return (
          <View key={field.key} style={styles.activityDetailField}>
             <FormLabel label={field.label} styles={styles} />
             <CustomDropdown
                colors={colors}
                onSelect={(next) => onChange(activityId, field.key, next)}
                options={[{ label: 'ไม่ระบุ', value: '' }, ...field.options.map(o => typeof o === 'string' ? { label: o, value: o } : o)]}
                placeholder="เลือก"
                styles={styles}
                value={typeof value === 'string' ? value : ''}
                fullRow={false}
             />
          </View>
        );
      })}
    </View>
  );
}
