import { Pressable } from '../components/NativePressable';
import NativeCard from '../components/NativeCard';
import Text, { AppTextInput as TextInput } from '../components/AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import FeatureIcon from '../components/FeatureIcon';
import BentoPhotoGrid from '../components/BentoPhotoGrid';
import FaceVerificationModal from '../components/FaceVerificationModal';
import LiquidGlassView from '../components/LiquidGlassView';
import ProfileActivityChip from '../components/ProfileActivityChip';
import ProfileFavoriteTrackRow from '../components/ProfileFavoriteTrackRow';
import SpotifyConnectCard from '../components/SpotifyConnectCard';
import SpotifyTrackSearchSheet, { MAX_FAVORITE_TRACKS } from '../components/SpotifyTrackSearchSheet';
import { WelcomeScene } from '../components/illustrations';
import { Chip, PrimaryButton, TonalButton } from '../components/ui';
import { uploadGalleryImage } from '../services/profileGalleryService';
import { useAppActions, useAppProfile } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  ACTIVITY_CATEGORIES,
  RUNNING_PACE_OPTIONS,
  SELECTABLE_ACTIVITY_CATEGORIES,
  getRunningPace,
  sanitizeActivityDetails,
} from '../data/activityCategories';
import { FACULTIES } from '../data/faculties';
import { useResponsiveSize } from '../hooks/useResponsiveSize';
import { compressProfileImage, MAX_PROFILE_IMAGE_SIZE_MB, validateImageSize } from '../utils/compressImage';
import { isSpotifyFeatureAllowed } from '../utils/featureFlags';
import { isCommittedProfilePhoto } from '../utils/profilePhoto';
import { showAlert } from '../utils/appAlert';
import {
  ACADEMIC_YEARS,
  getAcademicYearFromStudentId,
  getFacultyFromStudentId,
  getStudentAcademicProfile,
  STUDENT_FACULTY_UNAVAILABLE_MESSAGE,
  STUDENT_ID_REQUIRED_MESSAGE,
  STUDENT_YEAR_UNAVAILABLE_MESSAGE,
} from '../utils/studentId';
import { motion, radius, spacing, type, useTheme } from '../theme';
import {
  AGES,
  AndroidReadOnlyRow,
  AndroidSelectionRow,
  GENDERS,
  getProfileValidationError,
} from './ProfileScreen';

// First-run profile wizard: four short steps, one idea each. Only what
// matching needs is required; music is optional and can be skipped.
const ALL_STEPS = [
  { id: 'intro', icon: 'hand.wave.fill', title: 'ยินดีต้อนรับสู่ CampusMate!', subtitle: 'มาทำความรู้จักกันสักนิด ใช้เวลาไม่ถึง 2 นาที' },
  { id: 'photos', icon: 'camera.fill', title: 'โชว์ความเป็นตัวคุณ', subtitle: 'รูปหลักควรเห็นหน้าชัด แล้วเราจะชวนยืนยันใบหน้าสั้น ๆ ให้เพื่อนมั่นใจว่าเป็นคุณจริง' },
  { id: 'lifestyle', icon: 'sparkles', title: 'ชอบทำอะไรบ้าง?', subtitle: 'เลือกได้หลายอย่าง เพื่อเจอเพื่อนที่ชอบเหมือนกัน' },
  { id: 'music', icon: 'music.note', title: 'เพลงที่ฟังวนบ่อย ๆ', subtitle: 'แชร์เพลงโปรดให้เพื่อนรู้จักสไตล์คุณ ข้ามขั้นนี้ไปก่อนก็ได้' },
];

const PHOTO_SLOTS = 6;
const FACULTY_OPTIONS = FACULTIES.map((faculty) => ({ label: faculty, value: faculty }));
const YEAR_OPTIONS = ACADEMIC_YEARS.map((year) => ({ label: year, value: year }));
const DEFAULT_AGE = '20';
const DEFAULT_GENDER = 'unspecified';
const BIO_MAX_LENGTH = 300;
const BIO_STARTERS = [
  'กำลังหาเพื่อนไปทำกิจกรรมด้วยกัน',
  'ชอบลองร้านใหม่ ๆ แถวมหาลัย',
  'ทักมาคุยกันได้เลยนะ',
];

function getStepError(stepId, values) {
  const { age, avatarUri, bio, faculty, gender, interests, name, pace, studentId, year } = values;
  if (stepId === 'intro') {
    if (!name || name.trim().length < 2) return 'บอกชื่อที่อยากให้เพื่อนเรียกก่อนนะ (อย่างน้อย 2 ตัวอักษร)';
    if (!studentId) return STUDENT_ID_REQUIRED_MESSAGE;
    if (!faculty || faculty === 'all') return STUDENT_FACULTY_UNAVAILABLE_MESSAGE;
    if (!year) return STUDENT_YEAR_UNAVAILABLE_MESSAGE;
    const parsedAge = Number(age);
    if (!age || !Number.isInteger(parsedAge) || parsedAge < 18 || parsedAge > 100) return 'เลือกอายุของคุณ (18–100 ปี)';
    if (!gender) return 'เลือกเพศที่ต้องการแสดง';
  }
  if (stepId === 'photos' && !avatarUri) return 'เพิ่มรูปหลักสักรูปก่อนไปต่อ';
  if (stepId === 'lifestyle') {
    const safeList = Array.isArray(interests) ? interests : [];
    if (!safeList.length) return 'เลือกกิจกรรมที่ชอบอย่างน้อย 1 อย่าง';
    if (safeList.includes('running') && !pace) return 'เลือกเพซวิ่งที่สบายสำหรับคุณ';
    if (!bio.trim()) return 'เขียนแนะนำตัวสั้น ๆ สักประโยค';
  }
  return null;
}

function StepProgress({ index, total, colors }) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const fill = useSharedValue(0);
  useEffect(() => {
    if (!width) return;
    const target = (width * (index + 1)) / total;
    fill.set(reduceMotion ? target : withSpring(target, motion.spring.snappy));
  }, [fill, index, reduceMotion, total, width]);
  const fillStyle = useAnimatedStyle(() => ({ width: fill.get() }));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`ขั้นตอนที่ ${index + 1} จาก ${total}`}
      accessibilityValue={{ min: 1, max: total, now: index + 1 }}
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      style={[progressStyles.track, { backgroundColor: colors.surfaceContainerHigh || colors.line }]}
    >
      <Animated.View style={[progressStyles.fill, { backgroundColor: colors.primary }, fillStyle]} />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});

export default function ProfileSetupScreen({ onComplete }) {
  const { colors } = useTheme();
  const responsive = useResponsiveSize();
  const styles = useMemo(() => getStyles(colors, responsive.gutter), [colors, responsive.gutter]);
  const { showToast, showImageModeration } = useToast();
  const { profile } = useAppProfile();
  const { markFaceVerified } = useAppActions();
  const { user } = useAuth();

  // The route only mounts this once a profile exists, so the draft is seeded
  // once and never overwritten by later profile updates (e.g. the avatar save).
  const [initialProfile] = useState(() => ({
    ...(profile || {}),
    email: profile?.email || user?.email || '',
    campusEmail: profile?.campusEmail || user?.campusEmail || user?.email || '',
  }));
  const steps = useMemo(
    () => (isSpotifyFeatureAllowed(user, initialProfile) ? ALL_STEPS : ALL_STEPS.filter((item) => item.id !== 'music')),
    [initialProfile, user],
  );
  const academicProfile = useMemo(() => getStudentAcademicProfile(initialProfile), [initialProfile]);
  const studentId = academicProfile.studentId || initialProfile.studentId || '';
  const derivedFaculty = studentId ? getFacultyFromStudentId(studentId) : '';
  const derivedYear = studentId ? getAcademicYearFromStudentId(studentId) : '';

  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [name, setName] = useState(initialProfile.name || '');
  const [faculty, setFaculty] = useState(derivedFaculty || initialProfile.faculty || academicProfile.faculty || '');
  const [year, setYear] = useState(derivedYear || initialProfile.year || academicProfile.year || '');
  const [age, setAge] = useState(initialProfile.age ? String(initialProfile.age) : DEFAULT_AGE);
  const [gender, setGender] = useState(initialProfile.gender || DEFAULT_GENDER);
  const [avatarUri, setAvatarUri] = useState(initialProfile.avatarUri || null);
  const [gallery, setGallery] = useState(() => (
    Array.isArray(initialProfile.gallery) ? initialProfile.gallery.filter((uri) => typeof uri === 'string' && uri) : []
  ));
  // Mirrors the server-owned badge; the client never writes it.
  const [faceVerification, setFaceVerification] = useState(initialProfile.isFaceVerified === true);
  const [interests, setInterests] = useState(() => {
    const list = [initialProfile.interests, initialProfile.activities].find((value) => Array.isArray(value) && value.length > 0);
    return Array.isArray(list) ? list : [];
  });
  const [pace, setPace] = useState(() => getRunningPace(sanitizeActivityDetails(initialProfile.activityDetails)) || '');
  const [bio, setBio] = useState(initialProfile.bio || '');
  const [favoriteTracks, setFavoriteTracks] = useState(() => (
    Array.isArray(initialProfile.favoriteTracks) ? initialProfile.favoriteTracks.slice(0, MAX_FAVORITE_TRACKS) : []
  ));
  const [showSpotifySearch, setShowSpotifySearch] = useState(false);
  const [showFaceVerificationModal, setShowFaceVerificationModal] = useState(false);
  const [verificationCandidate, setVerificationCandidate] = useState(null);
  const [uploadingSlot, setUploadingSlot] = useState(null);
  const photoOwnerRef = useRef(profile?.id);
  photoOwnerRef.current = profile?.id;
  useEffect(() => () => { photoOwnerRef.current = null; }, []);
  const [saving, setSaving] = useState(false);
  const verificationPassedRef = useRef(false);
  const scrollRef = useRef(null);

  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;
  const busyWithPhoto = uploadingSlot != null;
  const values = { age, avatarUri, bio, faculty, gender, interests, name, pace, studentId, year };
  // HIG (Entering data): keep Next unavailable until the step's required data exists.
  const pendingRequirement = getStepError(step.id, values);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    AccessibilityInfo.announceForAccessibility?.(`ขั้นตอนที่ ${stepIndex + 1} จาก ${steps.length} ${step.title}`);
  }, [step.title, stepIndex, steps.length]);

  const moveTo = useCallback((next) => {
    Keyboard.dismiss();
    setDirection(next > stepIndex ? 1 : -1);
    setStepIndex(Math.max(0, Math.min(steps.length - 1, next)));
    Haptics.selectionAsync().catch(() => {});
  }, [stepIndex, steps.length]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stepIndex > 0) moveTo(stepIndex - 1);
      else showToast('สร้างโปรไฟล์ให้เสร็จก่อนนะ แล้วค่อยเริ่มหาเพื่อนกัน', 'info');
      return true;
    });
    return () => subscription.remove();
  }, [moveTo, showToast, stepIndex]);

  const toggleInterest = useCallback((id) => {
    setInterests((current) => {
      const list = Array.isArray(current) ? current : [];
      return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
    });
  }, []);

  // Upload an immutable candidate; only the verification server publishes it.
  const pickAvatar = async () => {
    if (busyWithPhoto) return;
    const ownerId = profile?.id;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploadingSlot(0);
      const sizeValidation = await validateImageSize(asset.uri, asset.fileSize, MAX_PROFILE_IMAGE_SIZE_MB);
      if (!sizeValidation.valid) {
        showAlert('รูปภาพมีขนาดใหญ่เกินไป', sizeValidation.error, { tone: 'warning' });
        return;
      }
      const compressed = await compressProfileImage(asset.uri);
      const uri = await uploadGalleryImage(compressed, ownerId);
      if (photoOwnerRef.current !== ownerId) return;
      setVerificationCandidate({ uri, ownerId });
      verificationPassedRef.current = false;
      setShowFaceVerificationModal(true);
    } catch (error) {
      console.warn('[ProfileSetup] Image save failed:', error?.message || error);
      if (error?.isModerationViolation || error?.isModerationUnavailable) showImageModeration(error);
      else showAlert('ยังบันทึกรูปไม่ได้', error?.message || 'ลองเลือกรูปใหม่อีกครั้งนะ', { tone: 'danger' });
    } finally {
      setUploadingSlot(null);
    }
  };

  // Extra photos are optional; each is uploaded (and moderated) before it shows.
  const pickGalleryPhoto = async (slotIndex) => {
    if (busyWithPhoto) return;
    const ownerId = profile?.id;
    const galleryIndex = Math.min(slotIndex - 1, gallery.length);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [2, 3],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploadingSlot(galleryIndex + 1);
      const sizeValidation = await validateImageSize(asset.uri, asset.fileSize, MAX_PROFILE_IMAGE_SIZE_MB);
      if (!sizeValidation.valid) {
        showAlert('รูปภาพมีขนาดใหญ่เกินไป', sizeValidation.error, { tone: 'warning' });
        return;
      }
      const resized = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 800 } }], {
        compress: 0.8, format: ImageManipulator.SaveFormat.JPEG,
      });
      const url = await uploadGalleryImage(resized.uri, ownerId);
      if (photoOwnerRef.current !== ownerId) return;
      setGallery((current) => {
        const next = [...current];
        next[Math.min(galleryIndex, next.length)] = url;
        return next.filter(Boolean);
      });
    } catch (error) {
      console.warn('[ProfileSetup] Gallery photo failed:', error?.message || error);
      if (error?.isModerationViolation || error?.isModerationUnavailable) showImageModeration(error);
      else showToast(error?.message || 'ยังเพิ่มรูปนี้ไม่ได้ ลองอีกครั้งนะ', 'info');
    } finally {
      setUploadingSlot(null);
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
    setFaceVerification(true);
    showToast('ยืนยันใบหน้าสำเร็จ', 'success');
  };

  const finish = async () => {
    const fullError = getProfileValidationError({ ...values, availability: '', requireComplete: true });
    if (fullError) {
      const failingStep = steps.findIndex((item) => getStepError(item.id, values));
      if (failingStep >= 0) moveTo(failingStep);
      showToast(fullError, 'info');
      return;
    }
    setSaving(true);
    try {
      const activities = Array.isArray(interests) ? interests : [];
      const activityDetails = sanitizeActivityDetails({
        ...sanitizeActivityDetails(initialProfile.activityDetails),
        ...(activities.includes('running') ? { running: { ...(initialProfile.activityDetails?.running || {}), pace } } : {}),
      }, activities);
      await onComplete({
        name: name.trim(),
        faculty,
        studentId,
        year,
        age: Number(age),
        gender,
        activity: activities[0],
        activities,
        activityLabel: activities.map((id) => ACTIVITY_CATEGORIES.find((item) => item.id === id)?.label || id).join(', '),
        activityDetails,
        pace: getRunningPace(activityDetails),
        skill: initialProfile.skill || '',
        availability: null,
        availabilitySlots: null,
        bio: bio.trim(),
        interests: activities,
        avatarUri,
        gallery: gallery.filter(Boolean),
        favoriteTracks,
        isDiscoverable: initialProfile.isDiscoverable ?? true,
        notificationsEnabled: initialProfile.notificationsEnabled ?? true,
        privacy: initialProfile.privacy || {},
      });
    } catch (error) {
      console.error('[ProfileSetup] save failed', error?.message || error);
      if (error?.isModerationViolation || error?.isModerationUnavailable) showImageModeration(error);
      else showToast(error?.message || 'ยังสร้างโปรไฟล์ไม่สำเร็จ ลองอีกครั้งนะ', 'info');
    } finally {
      setSaving(false);
    }
  };

  const goNext = () => {
    Keyboard.dismiss();
    if (busyWithPhoto) {
      showToast('กำลังเตรียมรูปให้อยู่ รอสักครู่นะ', 'info');
      return;
    }
    const error = getStepError(step.id, values);
    if (error) {
      showToast(error, 'info');
      return;
    }
    if (isLastStep) void finish();
    else moveTo(stepIndex + 1);
  };

  const renderIntro = () => (
    <View style={styles.stack}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>ชื่อที่อยากให้เพื่อนเรียก</Text>
        <TextInput
          accessibilityLabel="ชื่อที่อยากให้เพื่อนเรียก"
          autoCorrect={false}
          clearButtonMode="while-editing"
          maxLength={40}
          onChangeText={setName}
          placeholder="เช่น มายด์, ต้นกล้า"
          placeholderTextColor={colors.inkSoft}
          returnKeyType="done"
          style={styles.nameInput}
          textContentType="nickname"
          value={name}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>ข้อมูลการศึกษา</Text>
        <NativeCard style={styles.groupCard}>
          {derivedFaculty ? (
            <AndroidReadOnlyRow helper="ตั้งให้อัตโนมัติจากรหัสนักศึกษา" icon="building.columns.fill" label="คณะ" value={faculty} />
          ) : (
            <AndroidSelectionRow icon="building.columns.fill" label="คณะ" onSelect={setFaculty} options={FACULTY_OPTIONS} placeholder="เลือกคณะ" required value={faculty} />
          )}
          {derivedYear ? (
            <AndroidReadOnlyRow helper="ตั้งให้อัตโนมัติจากรหัสนักศึกษา" icon="graduationcap.fill" label="ชั้นปี" value={year} />
          ) : (
            <AndroidSelectionRow icon="graduationcap.fill" label="ชั้นปี" onSelect={setYear} options={YEAR_OPTIONS} placeholder="เลือกชั้นปี" required value={year} />
          )}
        </NativeCard>
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>เกี่ยวกับคุณ</Text>
        <NativeCard style={styles.groupCard}>
          <AndroidSelectionRow icon="calendar" label="อายุ" onSelect={setAge} options={AGES} placeholder="เลือกอายุ" required value={age} />
        </NativeCard>
        <View style={styles.wrapRow}>
          {GENDERS.map((option) => (
            <Chip active={gender === option.value} key={option.value} label={option.label} onPress={() => setGender(option.value)} />
          ))}
        </View>
      </View>
    </View>
  );

  const renderPhotos = () => (
    <View style={styles.stack}>
      <BentoPhotoGrid
        photos={[avatarUri, ...gallery]}
        slots={PHOTO_SLOTS}
        busyIndex={uploadingSlot}
        disabled={busyWithPhoto}
        identityPrefix={`setup:${profile?.id || 'me'}`}
        avatarRevision={profile?.avatarRevision}
        onPressSlot={(index) => (index === 0 ? pickAvatar() : pickGalleryPhoto(index))}
        onRemove={(index) => setGallery((current) => current.filter((_, position) => position !== index - 1))}
      />
      {avatarUri && faceVerification ? (
        <View style={styles.verifiedPill}>
          <FeatureIcon color={colors.green} name="checkmark.seal.fill" size={15} />
          <Text style={styles.verifiedText}>ยืนยันใบหน้าแล้ว</Text>
        </View>
      ) : null}
      <View style={styles.tipList}>
        {[
          ['face.smiling', 'รูปหลักเห็นหน้าชัด อยู่คนเดียวในรูป'],
          ['photo.on.rectangle', 'รูปอื่น ๆ เพิ่มตอนนี้หรือภายหลังก็ได้'],
        ].map(([icon, tip]) => (
          <View key={tip} style={styles.tipRow}>
            <FeatureIcon color={colors.primary} name={icon} size={16} />
            <Text style={styles.tipText}>{tip}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  const renderLifestyle = () => {
    const safeInterests = Array.isArray(interests) ? interests : [];
    return (
      <View style={styles.stack}>
        <View style={styles.chipGrid}>
          {SELECTABLE_ACTIVITY_CATEGORIES.map((category) => (
            <ProfileActivityChip
              key={category.id}
              category={category}
              selected={safeInterests.includes(category.id)}
              onPress={() => toggleInterest(category.id)}
            />
          ))}
        </View>
        {safeInterests.includes('running') ? (
          <NativeCard style={styles.groupCard}>
            <View style={styles.inlineHeader}>
              <FeatureIcon color={colors.coral} name="speedometer" size={16} />
              <Text style={styles.fieldLabel}>เพซวิ่งของคุณ</Text>
            </View>
            <View style={styles.wrapRow}>
              {RUNNING_PACE_OPTIONS.map((option) => (
                <Chip active={pace === option} color={colors.coral} key={option} label={option} onPress={() => setPace(option)} />
              ))}
            </View>
          </NativeCard>
        ) : null}

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>แนะนำตัวสั้น ๆ</Text>
          <TextInput
            accessibilityLabel="แนะนำตัวสั้น ๆ"
            maxLength={BIO_MAX_LENGTH}
            multiline
            onChangeText={setBio}
            placeholder="เล่าให้เพื่อนรู้จักคุณมากขึ้น"
            placeholderTextColor={colors.inkSoft}
            style={styles.bioInput}
            textAlignVertical="top"
            value={bio}
          />
          <Text style={styles.counter}>{bio.length}/{BIO_MAX_LENGTH}</Text>
          <Text style={styles.footnote}>ไม่รู้จะเริ่มยังไง? แตะประโยคด้านล่างได้เลย</Text>
          <View style={styles.wrapRow}>
            {BIO_STARTERS.map((starter) => (
              <Chip
                key={starter}
                label={starter}
                onPress={() => setBio((current) => {
                  const trimmed = current.trim();
                  return `${trimmed}${trimmed ? ' ' : ''}${starter}`.slice(0, BIO_MAX_LENGTH);
                })}
              />
            ))}
          </View>
        </View>
      </View>
    );
  };

  const renderMusic = () => (
    <View style={styles.stack}>
      <SpotifyConnectCard style={styles.spotifyCard} />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>เพลงโปรด ({favoriteTracks.length}/{MAX_FAVORITE_TRACKS})</Text>
        {favoriteTracks.map((track) => (
          <ProfileFavoriteTrackRow
            key={track.id}
            track={track}
            onRemove={(id) => setFavoriteTracks((current) => current.filter((item) => item.id !== id))}
          />
        ))}
        {favoriteTracks.length < MAX_FAVORITE_TRACKS ? (
          <TonalButton iconName="magnifyingglass" label="ค้นหาและเพิ่มเพลง" onPress={() => setShowSpotifySearch(true)} />
        ) : (
          <Text style={styles.footnote}>ครบ {MAX_FAVORITE_TRACKS} เพลงแล้ว ลบเพลงเดิมเพื่อเพิ่มเพลงใหม่ได้</Text>
        )}
      </View>
    </View>
  );

  const renderCurrentStep = () => {
    switch (step.id) {
      case 'photos': return renderPhotos();
      case 'lifestyle': return renderLifestyle();
      case 'music': return renderMusic();
      default: return renderIntro();
    }
  };

  const entering = (direction > 0 ? FadeInRight : FadeInLeft).springify().damping(20).stiffness(180);
  const primaryLabel = !isLastStep ? 'ถัดไป'
    : step.id === 'music' && !favoriteTracks.length ? 'ข้ามและสร้างโปรไฟล์' : 'สร้างโปรไฟล์';

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.header}>
          {stepIndex > 0 ? (
            <Pressable accessibilityLabel="ย้อนกลับ" accessibilityRole="button" hitSlop={8} onPress={() => moveTo(stepIndex - 1)} style={styles.headerButton}>
              <FeatureIcon color={colors.ink} name="chevron.left" size={20} />
            </Pressable>
          ) : <View style={styles.headerButton} />}
          <Text style={styles.headerStep}>ขั้นตอนที่ {stepIndex + 1} จาก {steps.length}</Text>
          <View style={styles.headerButton} />
        </View>
        <View style={styles.progressRow}>
          <StepProgress index={stepIndex} total={steps.length} colors={colors} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View key={step.id} entering={entering}>
            {step.id === 'intro' ? (
              <View style={styles.hero}>
                <WelcomeScene size={responsive.illustration.hero} />
                <Text accessibilityRole="header" style={[styles.title, styles.centerText, { fontSize: responsive.font.display }]}>{step.title}</Text>
                <Text style={[styles.subtitle, styles.centerText]}>{step.subtitle}</Text>
              </View>
            ) : (
              <View style={styles.stepHeader}>
                <View style={styles.stepIcon}>
                  <FeatureIcon color={colors.primary} name={step.icon} size={22} />
                </View>
                <Text accessibilityRole="header" style={[styles.title, { fontSize: responsive.font.display }]}>{step.title}</Text>
                <Text style={styles.subtitle}>{step.subtitle}</Text>
              </View>
            )}
            {renderCurrentStep()}
          </Animated.View>
        </ScrollView>

        <View style={styles.footer}>
          {pendingRequirement ? (
            <Text accessibilityLiveRegion="polite" style={styles.requirementHint}>{pendingRequirement}</Text>
          ) : null}
          <LiquidGlassView
            borderRadius={radius.pill}
            contentStyle={styles.footerGlassContent}
            glassEffectStyle="regular"
            style={styles.footerGlass}
          >
            <PrimaryButton
              disabled={Boolean(pendingRequirement) || busyWithPhoto}
              iconName={isLastStep ? 'checkmark.circle.fill' : undefined}
              label={primaryLabel}
              loading={saving}
              onPress={goNext}
              style={styles.footerButton}
            />
          </LiquidGlassView>
        </View>
      </KeyboardAvoidingView>

      <FaceVerificationModal
        avatarUri={verificationCandidate?.uri || avatarUri}
        candidateAvatarUri={verificationCandidate?.uri}
        onClose={() => {
          setShowFaceVerificationModal(false);
          setVerificationCandidate(null);
          if (!verificationPassedRef.current) {
            showToast('รูปหลักจะเปลี่ยนหลังยืนยันใบหน้าผ่านแล้ว ลองอีกครั้งได้ทุกเมื่อ', 'info');
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
    </SafeAreaView>
  );
}

const getStyles = (colors, gutter) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1, minWidth: 0 },
  header: { alignItems: 'center', flexDirection: 'row', height: 52, paddingHorizontal: spacing.md },
  headerButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  headerStep: { color: colors.inkMuted, flex: 1, fontSize: type.caption, fontWeight: '700', textAlign: 'center' },
  progressRow: { paddingHorizontal: gutter, paddingBottom: spacing.sm },
  content: { paddingHorizontal: gutter, paddingTop: spacing.sm, paddingBottom: spacing.xxxl, width: '100%', maxWidth: 640, alignSelf: 'center' },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  stepHeader: { marginBottom: spacing.xl },
  stepIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 16, borderCurve: 'continuous', height: 48, justifyContent: 'center', marginBottom: spacing.md, width: 48 },
  title: { color: colors.ink, fontWeight: '900', letterSpacing: -0.4, lineHeight: 36, marginTop: spacing.sm },
  centerText: { textAlign: 'center' },
  subtitle: { color: colors.inkMuted, fontSize: type.subheadline, lineHeight: 22, marginTop: spacing.xs },
  stack: { gap: spacing.lg },
  field: { gap: spacing.sm },
  fieldLabel: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '800' },
  nameInput: { backgroundColor: colors.card, borderColor: colors.line, borderCurve: 'continuous', borderRadius: radius.lg, borderWidth: 1, color: colors.ink, fontSize: 20, fontWeight: '700', minHeight: 56, paddingHorizontal: spacing.lg },
  groupCard: { backgroundColor: colors.card, borderColor: colors.line, borderCurve: 'continuous', borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, gap: spacing.sm, padding: spacing.md },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inlineHeader: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  verifiedPill: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.greenSoft, borderRadius: radius.pill, flexDirection: 'row', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6 },
  verifiedText: { color: colors.green, fontSize: type.caption, fontWeight: '800' },
  tipList: { gap: spacing.sm },
  tipRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  tipText: { color: colors.inkMuted, flex: 1, fontSize: type.caption, lineHeight: 19 },
  footnote: { color: colors.inkSoft, fontSize: type.caption2, lineHeight: 18 },
  bioInput: { backgroundColor: colors.card, borderColor: colors.line, borderCurve: 'continuous', borderRadius: radius.lg, borderWidth: 1, color: colors.ink, fontSize: type.body, lineHeight: 22, minHeight: 120, padding: spacing.md },
  counter: { color: colors.inkSoft, fontSize: type.caption2, textAlign: 'right' },
  spotifyCard: { marginHorizontal: 0, marginVertical: 0 },
  footer: { paddingHorizontal: gutter, paddingBottom: spacing.sm, paddingTop: spacing.xs },
  requirementHint: { color: colors.inkMuted, fontSize: type.caption, marginBottom: spacing.sm, textAlign: 'center' },
  footerGlass: { borderRadius: radius.pill, borderCurve: 'continuous', padding: 4 },
  footerGlassContent: { alignItems: 'stretch', width: '100%' },
  footerButton: { alignSelf: 'stretch', borderRadius: radius.pill },
});
