import Text, { AppTextInput as TextInput } from '../components/AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, BackHandler, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import FeatureIcon from '../components/FeatureIcon';
import AvailabilityModal from '../components/AvailabilityModal';
import FaceVerificationModal from '../components/FaceVerificationModal';
import LiquidGlassView from '../components/LiquidGlassView';
import { Chip, PrimaryButton } from '../components/ui';
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
import { compressProfileImage, MAX_PROFILE_IMAGE_SIZE_MB, validateImageSize } from '../utils/compressImage';
import { formatAvailabilitySlots } from '../utils/formatters';
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
import { radius, spacing, type, useTheme } from '../theme';
import {
  AGES,
  AndroidReadOnlyRow,
  AndroidSelectionRow,
  GENDERS,
  getProfileValidationError,
} from './ProfileScreen';

// First-run profile setup, one short step at a time. Only what matching needs
// is asked here; music, gallery, activity details and privacy live in the
// regular profile editor and settings afterwards.
const STEPS = [
  { id: 'basic', icon: 'person.fill', title: 'มาทำความรู้จักกัน', subtitle: 'ข้อมูลนี้จะแสดงบนการ์ดของคุณ' },
  { id: 'photo', icon: 'camera.fill', title: 'เพิ่มรูปโปรไฟล์', subtitle: 'ใช้รูปที่เห็นหน้าชัด ระบบจะยืนยันใบหน้าว่าเป็นคุณจริง' },
  { id: 'interests', icon: 'sparkles', title: 'คุณชอบทำอะไร', subtitle: 'เลือกได้หลายอย่าง เพื่อเจอเพื่อนที่ชอบเหมือนกัน' },
  { id: 'availability', icon: 'clock.fill', title: 'ว่างช่วงไหนบ้าง', subtitle: 'เพื่อนจะได้รู้ว่าชวนคุณได้เมื่อไร' },
  { id: 'bio', icon: 'quote.bubble.fill', title: 'แนะนำตัวสั้น ๆ', subtitle: 'ประโยคเดียวก็พอ แก้ไขภายหลังได้เสมอ' },
];

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
  const { age, avatarUri, bio, faculty, gender, interests, name, pace, studentId, year, availabilitySlots } = values;
  if (stepId === 'basic') {
    if (!name || name.trim().length < 2) return 'กรุณากรอกชื่อของคุณ (อย่างน้อย 2 ตัวอักษร)';
    if (!studentId) return STUDENT_ID_REQUIRED_MESSAGE;
    if (!faculty || faculty === 'all') return STUDENT_FACULTY_UNAVAILABLE_MESSAGE;
    if (!year) return STUDENT_YEAR_UNAVAILABLE_MESSAGE;
    const parsedAge = Number(age);
    if (!age || !Number.isInteger(parsedAge) || parsedAge < 18 || parsedAge > 100) return 'กรุณาระบุอายุระหว่าง 18–100 ปี';
    if (!gender) return 'กรุณาเลือกเพศของคุณ';
  }
  if (stepId === 'photo' && !avatarUri) return 'กรุณาเพิ่มรูปโปรไฟล์ของคุณ';
  if (stepId === 'interests') {
    const safeList = Array.isArray(interests) ? interests : [];
    if (!safeList.length) return 'กรุณาเลือกกิจกรรมหรือความสนใจอย่างน้อย 1 รายการ';
    if (safeList.includes('running') && !pace) return 'กรุณาเลือกเพซวิ่งเมื่อเลือกวิ่งออกกำลังกาย';
  }
  if (stepId === 'availability' && (!Array.isArray(availabilitySlots) || !availabilitySlots.length)) return 'กรุณาเลือกช่วงเวลาที่สะดวกอย่างน้อย 1 ช่วง';
  if (stepId === 'bio' && !bio.trim()) return 'กรุณาเขียนแนะนำตัวสั้น ๆ';
  return null;
}

export default function ProfileSetupScreen({ onComplete }) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { width: windowWidth } = useWindowDimensions();
  const { showToast, showImageModeration } = useToast();
  const { profile } = useAppProfile();
  const { saveProfile, markFaceVerified } = useAppActions();
  const { user } = useAuth();

  // The route only mounts this once a profile exists, so the draft is seeded
  // once and never overwritten by later profile updates (e.g. the avatar save).
  const [initialProfile] = useState(() => ({
    ...(profile || {}),
    email: profile?.email || user?.email || '',
    campusEmail: profile?.campusEmail || user?.campusEmail || user?.email || '',
  }));
  const academicProfile = useMemo(() => getStudentAcademicProfile(initialProfile), [initialProfile]);
  const studentId = academicProfile.studentId || initialProfile.studentId || '';
  const derivedFaculty = studentId ? getFacultyFromStudentId(studentId) : '';
  const derivedYear = studentId ? getAcademicYearFromStudentId(studentId) : '';

  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState(initialProfile.name || '');
  const [faculty, setFaculty] = useState(derivedFaculty || initialProfile.faculty || academicProfile.faculty || '');
  const [year, setYear] = useState(derivedYear || initialProfile.year || academicProfile.year || '');
  const [age, setAge] = useState(initialProfile.age ? String(initialProfile.age) : DEFAULT_AGE);
  const [gender, setGender] = useState(initialProfile.gender || DEFAULT_GENDER);
  const [avatarUri, setAvatarUri] = useState(initialProfile.avatarUri || null);
  // Mirrors the server-owned badge; the client never writes it.
  const [faceVerification, setFaceVerification] = useState(initialProfile.isFaceVerified === true);
  const [interests, setInterests] = useState(() => {
    const list = [initialProfile.interests, initialProfile.activities].find((value) => Array.isArray(value) && value.length > 0);
    return Array.isArray(list) ? list : [];
  });
  const [pace, setPace] = useState(() => getRunningPace(sanitizeActivityDetails(initialProfile.activityDetails)) || '');
  const [availabilitySlots, setAvailabilitySlots] = useState(() => (
    Array.isArray(initialProfile.availabilitySlots) ? initialProfile.availabilitySlots : []
  ));
  const [bio, setBio] = useState(initialProfile.bio || '');
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [showFaceVerificationModal, setShowFaceVerificationModal] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const verificationPassedRef = useRef(false);
  const scrollRef = useRef(null);
  const stepAnim = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  const step = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;
  const values = { age, avatarUri, bio, faculty, gender, interests, name, pace, studentId, year, availabilitySlots };
  // HIG (Entering data): keep Next unavailable until the step's required data exists.
  const pendingRequirement = getStepError(step.id, values);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (mounted) setReduceMotion(Boolean(enabled)); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled) => setReduceMotion(Boolean(enabled)));
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    if (reduceMotion) {
      stepAnim.setValue(1);
      return;
    }
    // Prevent white screen: Start from 0.85 rather than 0 so content is never blank, with a fallback completion handler.
    stepAnim.setValue(0.85);
    Animated.timing(stepAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) stepAnim.setValue(1);
    });
  }, [reduceMotion, stepIndex, stepAnim]);

  const goBack = useCallback(() => {
    Keyboard.dismiss();
    setStepIndex((current) => Math.max(0, current - 1));
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stepIndex > 0) goBack();
      else showToast('กรุณาสร้างโปรไฟล์ให้เสร็จสมบูรณ์ก่อนเข้าใช้งาน', 'info');
      return true;
    });
    return () => subscription.remove();
  }, [goBack, showToast, stepIndex]);

  const toggleInterest = useCallback((id) => {
    setInterests((current) => {
      const list = Array.isArray(current) ? current : [];
      return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
    });
  }, []);

  // The server compares the selfie with the *saved* main photo and revokes the
  // badge whenever that photo changes, so the photo is saved before verifying.
  const pickAvatar = async () => {
    if (isProcessingImage) return;
    let saved = false;
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
      setIsProcessingImage(true);
      const sizeValidation = await validateImageSize(asset.uri, asset.fileSize, MAX_PROFILE_IMAGE_SIZE_MB);
      if (!sizeValidation.valid) {
        showAlert('รูปภาพมีขนาดใหญ่เกินไป', sizeValidation.error, { tone: 'warning' });
        return;
      }
      const compressed = await compressProfileImage(asset.uri);
      const committed = await saveProfile({ avatarUri: compressed });
      setAvatarUri(committed?.avatarUri || compressed);
      setFaceVerification(false);
      saved = true;
    } catch (error) {
      console.warn('[ProfileSetup] Image save failed:', error?.message || error);
      if (error?.isModerationViolation || error?.isModerationUnavailable) showImageModeration(error);
      else showAlert('ไม่สามารถบันทึกรูปภาพได้', error?.message || 'กรุณาลองเลือกรูปภาพใหม่อีกครั้ง', { tone: 'danger' });
    } finally {
      setIsProcessingImage(false);
    }
    if (saved) {
      verificationPassedRef.current = false;
      setShowFaceVerificationModal(true);
    }
  };

  const handleFaceVerified = () => {
    // The server already recorded the result; only mirror it locally.
    verificationPassedRef.current = true;
    setFaceVerification(true);
    markFaceVerified?.();
    showToast('ยืนยันใบหน้าสำเร็จ', 'success');
  };

  const finish = async () => {
    const fullError = getProfileValidationError({ ...values, availability: '', requireComplete: true });
    if (fullError) {
      const failingStep = STEPS.findIndex((item) => getStepError(item.id, values));
      if (failingStep >= 0) setStepIndex(failingStep);
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
        availability: `ระบุ ${availabilitySlots.length} ช่วงเวลา`,
        availabilitySlots,
        bio: bio.trim(),
        interests: activities,
        avatarUri,
        gallery: Array.isArray(initialProfile.gallery) ? initialProfile.gallery : [],
        favoriteTracks: Array.isArray(initialProfile.favoriteTracks) ? initialProfile.favoriteTracks : [],
        isDiscoverable: initialProfile.isDiscoverable ?? true,
        notificationsEnabled: initialProfile.notificationsEnabled ?? true,
        privacy: initialProfile.privacy || {},
      });
    } catch (error) {
      console.error('[ProfileSetup] save failed', error?.message || error);
      if (error?.isModerationViolation || error?.isModerationUnavailable) showImageModeration(error);
      else showToast(error?.message || 'สร้างโปรไฟล์ไม่สำเร็จ', 'info');
    } finally {
      setSaving(false);
    }
  };

  const goNext = () => {
    Keyboard.dismiss();
    if (isProcessingImage) {
      showToast('กำลังประมวลผลรูปภาพ กรุณารอสักครู่...', 'info');
      return;
    }
    const error = getStepError(step.id, values);
    if (error) {
      showToast(error, 'info');
      return;
    }
    if (isLastStep) void finish();
    else setStepIndex((current) => current + 1);
  };

  const photoSize = Math.min(windowWidth - spacing.xl * 2, 240);

  const renderBasic = () => (
    <View style={styles.stack}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>ชื่อที่แสดง</Text>
        <TextInput
          accessibilityLabel="ชื่อที่แสดง"
          autoCorrect={false}
          autoFocus={!name}
          clearButtonMode="while-editing"
          maxLength={40}
          onChangeText={setName}
          placeholder="เพื่อน ๆ เรียกคุณว่าอะไร"
          placeholderTextColor={colors.inkSoft}
          returnKeyType="done"
          style={styles.nameInput}
          textContentType="nickname"
          value={name}
        />
      </View>

      <View style={styles.groupCard}>
        {derivedFaculty ? (
          <AndroidReadOnlyRow helper="ดึงจากรหัสนักศึกษาอัตโนมัติ" icon="building.columns.fill" label="คณะ" value={faculty} />
        ) : (
          <AndroidSelectionRow icon="building.columns.fill" label="คณะ" onSelect={setFaculty} options={FACULTY_OPTIONS} placeholder="เลือกคณะ" required value={faculty} />
        )}
        {derivedYear ? (
          <AndroidReadOnlyRow helper="ดึงจากรหัสนักศึกษาอัตโนมัติ" icon="graduationcap.fill" label="ชั้นปี" value={year} />
        ) : (
          <AndroidSelectionRow icon="graduationcap.fill" label="ชั้นปี" onSelect={setYear} options={YEAR_OPTIONS} placeholder="เลือกชั้นปี" required value={year} />
        )}
        <AndroidSelectionRow icon="calendar" label="อายุ" onSelect={setAge} options={AGES} placeholder="เลือกอายุ" required value={age} />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>เพศ</Text>
        <View style={styles.wrapRow}>
          {GENDERS.map((option) => (
            <Chip active={gender === option.value} key={option.value} label={option.label} onPress={() => setGender(option.value)} />
          ))}
        </View>
      </View>
    </View>
  );

  const renderPhoto = () => (
    <View style={[styles.stack, styles.centered]}>
      <Pressable
        accessibilityLabel={avatarUri ? 'เปลี่ยนรูปโปรไฟล์' : 'เพิ่มรูปโปรไฟล์'}
        accessibilityRole="button"
        disabled={isProcessingImage}
        onPress={pickAvatar}
        style={({ pressed }) => [
          styles.photoSlot,
          { width: photoSize, height: photoSize, borderRadius: photoSize / 2 },
          !avatarUri && styles.photoSlotEmpty,
          pressed && styles.pressed,
        ]}
      >
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={styles.photoEmptyContent}>
            <View style={styles.photoPlusCircle}>
              <FeatureIcon color={colors.onPrimary} name="plus" size={26} />
            </View>
            <Text style={styles.photoEmptyText}>แตะเพื่อเลือกรูป</Text>
          </View>
        )}
        {isProcessingImage ? (
          <View style={styles.photoLoading}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : null}
      </Pressable>

      {avatarUri ? (
        <View style={styles.photoActions}>
          {faceVerification ? (
            <View style={styles.verifiedPill}>
              <FeatureIcon color={colors.green} name="checkmark.seal.fill" size={15} />
              <Text style={styles.verifiedText}>ยืนยันใบหน้าแล้ว</Text>
            </View>
          ) : null}
          <Pressable accessibilityRole="button" disabled={isProcessingImage} hitSlop={8} onPress={pickAvatar} style={styles.linkButton}>
            <FeatureIcon color={colors.primary} name="pencil" size={14} />
            <Text style={styles.linkButtonText}>เปลี่ยนรูป</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.tipCard}>
        {[
          'เห็นใบหน้าชัด อยู่คนเดียวในรูป',
          'หลังเลือกรูป จะมีการถ่ายเซลฟีสั้น ๆ เพื่อยืนยันตัวตน',
          'เพิ่มรูปอื่น ๆ ได้ภายหลังในหน้าโปรไฟล์',
        ].map((tip) => (
          <View key={tip} style={styles.tipRow}>
            <FeatureIcon color={colors.primary} name="checkmark.circle.fill" size={16} />
            <Text style={styles.tipText}>{tip}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  const renderInterests = () => {
    const safeInterests = Array.isArray(interests) ? interests : [];
    return (
      <View style={styles.stack}>
        <View style={styles.interestGrid}>
          {SELECTABLE_ACTIVITY_CATEGORIES.map((category) => (
            <View key={category.id} style={styles.interestGridItem}>
              <Chip
                active={safeInterests.includes(category.id)}
                color={category.color}
                iconName={category.symbol}
                label={category.label}
                onPress={() => toggleInterest(category.id)}
                style={styles.interestChip}
              />
            </View>
          ))}
        </View>
        {safeInterests.includes('running') ? (
          <View style={styles.groupCard}>
            <View style={styles.inlineHeader}>
              <FeatureIcon color={colors.coral} name="speedometer" size={16} />
              <Text style={styles.fieldLabel}>เพซวิ่งของคุณ</Text>
            </View>
            <View style={styles.wrapRow}>
              {RUNNING_PACE_OPTIONS.map((option) => (
                <Chip active={pace === option} color={colors.coral} key={option} label={option} onPress={() => setPace(option)} />
              ))}
            </View>
          </View>
        ) : null}
        <Text style={styles.footnote}>รายละเอียดของแต่ละกิจกรรมเพิ่มได้ภายหลังในหน้าแก้ไขโปรไฟล์</Text>
      </View>
    );
  };

  const renderAvailability = () => {
    const summary = formatAvailabilitySlots(availabilitySlots);
    return (
      <View style={styles.stack}>
        <Pressable
          accessibilityLabel="เลือกช่วงเวลาว่างสะดวก"
          accessibilityRole="button"
          onPress={() => setShowAvailabilityModal(true)}
          style={({ pressed }) => [styles.availabilityCard, pressed && styles.pressed]}
        >
          <View style={styles.availabilityIcon}>
            <FeatureIcon color={colors.primary} name="calendar" size={22} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.availabilityTitle}>
              {availabilitySlots.length ? `เลือกไว้ ${availabilitySlots.length} ช่วงเวลา` : 'เลือกวันและเวลาที่ว่าง'}
            </Text>
            <Text numberOfLines={3} style={styles.availabilitySubtitle}>
              {summary || 'เลือกได้หลายวันและหลายช่วงเวลา'}
            </Text>
          </View>
          <FeatureIcon color={colors.inkSoft} name="chevron.right" size={18} />
        </Pressable>
        <Text style={styles.footnote}>ช่วงเวลานี้ใช้แนะนำเพื่อนที่ว่างตรงกัน และปรับได้ตลอดเวลา</Text>
      </View>
    );
  };

  const renderBio = () => {
    const facultyLine = [faculty, year].filter(Boolean).join(' · ');
    const safeInterests = Array.isArray(interests) ? interests : [];
    const interestLabels = safeInterests
      .map((id) => ACTIVITY_CATEGORIES.find((item) => item.id === id)?.shortLabel)
      .filter(Boolean);
    return (
      <View style={styles.stack}>
        <View style={styles.previewCard}>
          {avatarUri ? <Image source={{ uri: avatarUri }} style={styles.previewAvatar} /> : <View style={styles.previewAvatar} />}
          <View style={styles.flex}>
            <Text numberOfLines={1} style={styles.previewName}>{name.trim()}{age ? `, ${age}` : ''}</Text>
            {facultyLine ? <Text numberOfLines={1} style={styles.previewMeta}>{facultyLine}</Text> : null}
            {interestLabels.length ? (
              <Text numberOfLines={1} style={styles.previewInterests}>{interestLabels.join(' · ')}</Text>
            ) : null}
          </View>
        </View>

        <View>
          <TextInput
            accessibilityLabel="คำแนะนำตัวสั้น ๆ"
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
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>ไม่รู้จะเริ่มยังไง? ลองแตะ</Text>
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

  const renderCurrentStep = () => {
    try {
      switch (step.id) {
        case 'basic': return renderBasic();
        case 'photo': return renderPhoto();
        case 'interests': return renderInterests();
        case 'availability': return renderAvailability();
        case 'bio': return renderBio();
        default: return renderBasic();
      }
    } catch (err) {
      console.warn('[ProfileSetupScreen] Error rendering step:', step.id, err?.message || err);
      return (
        <View style={styles.errorCard}>
          <FeatureIcon color={colors.danger} name="exclamationmark.triangle.fill" size={28} />
          <Text style={styles.errorText}>เกิดข้อผิดพลาดในการแสดงผลขั้นตอนนี้</Text>
        </View>
      );
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.header}>
          {stepIndex > 0 ? (
            <Pressable accessibilityLabel="ย้อนกลับ" accessibilityRole="button" hitSlop={8} onPress={goBack} style={styles.headerButton}>
              <FeatureIcon color={colors.ink} name="chevron.left" size={20} />
            </Pressable>
          ) : <View style={styles.headerButton} />}
          <Text style={styles.headerTitle}>สร้างโปรไฟล์</Text>
          <Text style={styles.headerStep}>{stepIndex + 1}/{STEPS.length}</Text>
        </View>
        <View
          accessibilityLabel={`ขั้นตอนที่ ${stepIndex + 1} จาก ${STEPS.length}`}
          accessibilityRole="progressbar"
          style={styles.progressRow}
        >
          {STEPS.map((item, index) => (
            <View key={item.id} style={[styles.progressSegment, index <= stepIndex && styles.progressSegmentActive]} />
          ))}
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={{
              opacity: stepAnim,
              transform: [{ translateY: stepAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
            }}
          >
            <View style={styles.stepIcon}>
              <FeatureIcon color={colors.primary} name={step.icon} size={22} />
            </View>
            <Text accessibilityRole="header" style={styles.title}>{step.title}</Text>
            <Text style={styles.subtitle}>{step.subtitle}</Text>
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
              disabled={Boolean(pendingRequirement) || isProcessingImage}
              iconName={isLastStep ? 'checkmark.circle.fill' : undefined}
              label={isLastStep ? 'สร้างโปรไฟล์' : 'ถัดไป'}
              loading={saving}
              onPress={goNext}
              style={styles.footerButton}
            />
          </LiquidGlassView>
        </View>
      </KeyboardAvoidingView>

      <AvailabilityModal
        availabilitySlots={availabilitySlots}
        onClose={() => setShowAvailabilityModal(false)}
        onSave={setAvailabilitySlots}
        visible={showAvailabilityModal}
      />
      <FaceVerificationModal
        avatarUri={avatarUri}
        onClose={() => {
          setShowFaceVerificationModal(false);
          if (!verificationPassedRef.current) {
            showToast('บันทึกรูปแล้ว ยืนยันใบหน้าภายหลังได้จากหน้าโปรไฟล์', 'info');
          }
        }}
        onSuccess={handleFaceVerified}
        visible={showFaceVerificationModal}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1, minWidth: 0 },
  header: { alignItems: 'center', flexDirection: 'row', height: 52, paddingHorizontal: spacing.md },
  headerButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  headerTitle: { color: colors.ink, flex: 1, fontSize: type.h3, fontWeight: '800', textAlign: 'center' },
  headerStep: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '700', textAlign: 'center', width: 44 },
  progressRow: { flexDirection: 'row', gap: 6, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  progressSegment: { backgroundColor: colors.line, borderRadius: radius.pill, flex: 1, height: 4 },
  progressSegmentActive: { backgroundColor: colors.primary },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  stepIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 16, borderCurve: 'continuous', height: 48, justifyContent: 'center', marginBottom: spacing.md, width: 48 },
  title: { color: colors.ink, fontSize: type.h1, fontWeight: '900', letterSpacing: -0.4, lineHeight: 36 },
  subtitle: { color: colors.inkMuted, fontSize: type.subheadline, lineHeight: 22, marginBottom: spacing.xl, marginTop: spacing.xs },
  stack: { gap: spacing.lg },
  centered: { alignItems: 'center' },
  field: { gap: spacing.sm },
  fieldLabel: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '800' },
  nameInput: { backgroundColor: colors.card, borderColor: colors.line, borderCurve: 'continuous', borderRadius: radius.lg, borderWidth: 1, color: colors.ink, fontSize: 20, fontWeight: '700', minHeight: 56, paddingHorizontal: spacing.lg },
  groupCard: { backgroundColor: colors.card, borderColor: colors.line, borderCurve: 'continuous', borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  inlineHeader: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  pressed: { opacity: 0.75 },
  photoSlot: { alignItems: 'center', backgroundColor: colors.surfaceRaised, justifyContent: 'center', overflow: 'hidden' },
  photoSlotEmpty: { borderColor: colors.primary, borderStyle: 'dashed', borderWidth: 2 },
  photoEmptyContent: { alignItems: 'center', gap: spacing.sm },
  photoPlusCircle: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 28, height: 56, justifyContent: 'center', width: 56 },
  photoEmptyText: { color: colors.primary, fontSize: type.subheadline, fontWeight: '800' },
  photoLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center' },
  photoActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  verifiedPill: { alignItems: 'center', backgroundColor: colors.greenSoft, borderRadius: radius.pill, flexDirection: 'row', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6 },
  verifiedText: { color: colors.green, fontSize: type.caption, fontWeight: '800' },
  linkButton: { alignItems: 'center', flexDirection: 'row', gap: 4, minHeight: 44, paddingHorizontal: spacing.sm },
  linkButtonText: { color: colors.primary, fontSize: type.subheadline, fontWeight: '800' },
  tipCard: { alignSelf: 'stretch', backgroundColor: colors.card, borderColor: colors.line, borderCurve: 'continuous', borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  tipRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  tipText: { color: colors.ink, flex: 1, fontSize: type.caption, lineHeight: 19 },
  interestGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  interestGridItem: { marginBottom: 8, paddingHorizontal: 4, width: '50%' },
  interestChip: { alignItems: 'center', justifyContent: 'center', minHeight: 46, paddingVertical: 10, width: '100%' },
  footnote: { color: colors.inkSoft, fontSize: type.caption2, lineHeight: 18 },
  availabilityCard: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderCurve: 'continuous', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.md, minHeight: 76, padding: spacing.md },
  availabilityIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 14, height: 44, justifyContent: 'center', width: 44 },
  availabilityTitle: { color: colors.ink, fontSize: type.body, fontWeight: '800' },
  availabilitySubtitle: { color: colors.inkMuted, fontSize: type.caption, lineHeight: 18, marginTop: 2 },
  previewCard: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderCurve: 'continuous', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  previewAvatar: { backgroundColor: colors.surfaceRaised, borderRadius: 28, height: 56, width: 56 },
  previewName: { color: colors.ink, fontSize: type.body, fontWeight: '800' },
  previewMeta: { color: colors.inkMuted, fontSize: type.caption, marginTop: 2 },
  previewInterests: { color: colors.primary, fontSize: type.caption, fontWeight: '700', marginTop: 2 },
  bioInput: { backgroundColor: colors.card, borderColor: colors.line, borderCurve: 'continuous', borderRadius: radius.lg, borderWidth: 1, color: colors.ink, fontSize: type.body, lineHeight: 22, minHeight: 130, padding: spacing.md },
  counter: { color: colors.inkSoft, fontSize: type.caption2, marginTop: 4, textAlign: 'right' },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, paddingTop: spacing.xs },
  requirementHint: { color: colors.inkMuted, fontSize: type.caption, marginBottom: spacing.sm, textAlign: 'center' },
  footerGlass: { borderRadius: radius.pill, borderCurve: 'continuous', padding: 4 },
  footerGlassContent: { alignItems: 'stretch', width: '100%' },
  footerButton: { alignSelf: 'stretch', borderRadius: radius.pill },
  errorCard: { alignItems: 'center', backgroundColor: colors.dangerSoft || '#FEE2E2', borderRadius: radius.lg, gap: spacing.sm, padding: spacing.xl },
  errorText: { color: colors.danger, fontSize: type.subheadline, fontWeight: '700', textAlign: 'center' },
});
