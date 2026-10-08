import { Button, Text } from '../components/NativeTypography';
import { font } from '../components/brandFont';
import { useNativePalette } from '../theme';
import { useToast } from '../context/ToastContext';
import React, { useMemo, useState } from 'react';
import { useRemoteImage } from '../utils/useRemoteImage';
import { Keyboard, Pressable, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { Form, Grid, Host, HStack, Image, Menu, RNHostView, ScrollView, Section, Spacer, TextField, useNativeState, VStack, ZStack } from '@expo/ui/swift-ui';
import AvailabilityModal from '../components/AvailabilityModal';
import SpotifyTrackSearchSheet, { MAX_FAVORITE_TRACKS } from '../components/SpotifyTrackSearchSheet';
import FaceVerificationModal from '../components/FaceVerificationModal';
import { isSpotifyFeatureAllowed } from '../utils/featureFlags';
import TrackPreviewButton from '../components/TrackPreviewButton';
import { compressProfileImage, validateImageSize, MAX_PROFILE_IMAGE_SIZE_MB } from '../utils/compressImage';
import { aspectRatio, background, buttonBorderShape, buttonStyle, clipShape, clipped, contentShape, controlSize, foregroundStyle, frame, labelStyle, lineLimit, padding, resizable, scrollDismissesKeyboard, scrollIndicators, shadow, shapes, textFieldStyle, tint } from '@expo/ui/swift-ui/modifiers';
import { useAppActions, useAppProfile } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
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

const FACULTY_OPTIONS = FACULTIES.map((fac) => ({ label: fac, value: fac }));
const YEAR_OPTIONS = ACADEMIC_YEARS.map((yr) => ({ label: yr, value: yr }));

import {
  ACTIVITY_CATEGORIES,
  MORE_ACTIVITY_CATEGORIES,
  PRIMARY_ACTIVITY_CATEGORIES,
  getActivityCategory,
  getActivityDetailFields,
  getRunningPace,
  sanitizeActivityDetails,
} from '../data/activityCategories';
import { showAlert } from '../utils/appAlert';

const AGES = Array.from({ length: 17 }, (_, i) => ({
  label: `${i + 19} ปี`,
  value: String(i + 19),
}));
const GENDERS = [
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
const toActivityOption = (category) => ({ label: category.label, value: category.id, icon: category.symbol });
const ACTIVITIES = ACTIVITY_CATEGORIES.filter((category) => category.id !== 'all').map(toActivityOption);
const PRIMARY_ACTIVITIES = PRIMARY_ACTIVITY_CATEGORIES.map(toActivityOption);
const MORE_ACTIVITIES = MORE_ACTIVITY_CATEGORIES.map(toActivityOption);

// Older profiles only stored `pace`; seed the running detail from it.
function getInitialActivityDetails(profile) {
  const details = sanitizeActivityDetails(profile?.activityDetails);
  if (!details.running?.pace && typeof profile?.pace === 'string' && profile.pace.trim()) {
    const seeded = sanitizeActivityDetails({ running: { pace: profile.pace.trim() } });
    if (seeded.running) details.running = { ...(details.running || {}), ...seeded.running };
  }
  return details;
}
const AVAILABILITIES = ['ไม่ระบุ', 'ช่วงเช้า (06:00 - 12:00)', 'ช่วงบ่าย (12:00 - 18:00)', 'ช่วงเย็น (18:00 - 21:00)', 'ช่วงดึก (21:00 เป็นต้นไป)', 'สะดวกตลอดเวลา'];

const usePalette = useNativePalette;

const cardShape = shapes.roundedRectangle({ cornerRadius: 24, roundedCornerStyle: 'continuous' });

export default function ProfileScreen({ onClose, onToast, overrideSave, showHeader = true }) {
  const { showImageModeration } = useToast();
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAppProfile();
  const { user } = useAuth();
  const { saveProfile, markFaceVerified } = useAppActions();
  const canUseSpotify = useMemo(() => isSpotifyFeatureAllowed(user, profile), [user, profile]);
  const safeProfile = useMemo(() => ({
    ...(profile || {}),
    email: profile?.email || user?.email || '',
    campusEmail: profile?.campusEmail || user?.campusEmail || user?.email || '',
  }), [profile, user]);

  const isFirstSetup = Boolean(overrideSave);
  const academicProfile = useMemo(() => getStudentAcademicProfile(safeProfile), [safeProfile]);

  const derivedFacultyFromId = academicProfile.studentId ? getFacultyFromStudentId(academicProfile.studentId) : '';
  const hasDerivedFaculty = Boolean(derivedFacultyFromId);

  const derivedYearFromId = academicProfile.studentId ? getAcademicYearFromStudentId(academicProfile.studentId) : '';
  const hasDerivedYear = Boolean(derivedYearFromId);

  const isFacultyLocked = hasDerivedFaculty || Boolean(safeProfile.faculty && !isFirstSetup);
  const isYearLocked = hasDerivedYear || Boolean(safeProfile.year && !isFirstSetup);

  const facultyHelper = isFirstSetup
    ? null
    : (hasDerivedFaculty
      ? null
      : 'ล็อกตามที่ตั้งไว้ในการสร้างโปรไฟล์ครั้งแรก');

  const yearHelper = isFirstSetup
    ? null
    : (hasDerivedYear
      ? null
      : 'ล็อกตามที่ตั้งไว้ในการสร้างโปรไฟล์ครั้งแรก');

  const studentId = academicProfile.studentId || safeProfile.studentId || '';

  const [faculty, setFaculty] = useState(
    (hasDerivedFaculty ? derivedFacultyFromId : safeProfile.faculty) || academicProfile.faculty || ''
  );
  const [year, setYear] = useState(
    (hasDerivedYear ? derivedYearFromId : safeProfile.year) || academicProfile.year || ''
  );
  const [name, setName] = useState(safeProfile.name || '');
  const [age, setAge] = useState(safeProfile.age ? String(safeProfile.age) : '');
  const [gender, setGender] = useState(safeProfile.gender || '');
  const [activities, setActivities] = useState(() => {
    if (Array.isArray(safeProfile.activities) && safeProfile.activities.length > 0) {
      return safeProfile.activities;
    }
    if (safeProfile.activity) {
      return [safeProfile.activity];
    }
    return ['other'];
  });
  const [activityDetails, setActivityDetails] = useState(() => getInitialActivityDetails(safeProfile));
  const [showMoreActivities, setShowMoreActivities] = useState(() => (
    MORE_ACTIVITIES.some((option) => (safeProfile.activities || []).includes(option.value))
  ));
  const [skill, setSkill] = useState(safeProfile.skill || '');
  const [availability, setAvailability] = useState(safeProfile.availability || '');
  const [availabilitySlots, setAvailabilitySlots] = useState(() => (
    Array.isArray(safeProfile.availabilitySlots) ? safeProfile.availabilitySlots : []
  ));
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [bio, setBio] = useState(safeProfile.bio || '');
  const [favoriteTracks, setFavoriteTracks] = useState(() => (
    Array.isArray(safeProfile.favoriteTracks) ? safeProfile.favoriteTracks.slice(0, MAX_FAVORITE_TRACKS) : []
  ));
  const [showSpotifySearch, setShowSpotifySearch] = useState(false);
  const [showFaceVerificationModal, setShowFaceVerificationModal] = useState(false);
  const isFaceVerified = Boolean(safeProfile?.isFaceVerified);
  const faceMatchScore = safeProfile?.faceMatchScore;
  const [avatarUri, setAvatarUri] = useState(safeProfile.avatarUri || null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const avatarDisplayUri = useRemoteImage(avatarUri, profile?.avatarRevision, profile?.id);
  const [saving, setSaving] = useState(false);

  const toggleActivity = (val) => {
    setActivities((prev) => {
      if (prev.includes(val)) {
        const next = prev.filter((item) => item !== val);
        return next.length > 0 ? next : ['other'];
      }
      return [...prev.filter((item) => item !== 'other'), val];
    });
  };

  const updateActivityDetail = (activityId, fieldKey, value) => {
    setActivityDetails((current) => {
      const next = { ...current, [activityId]: { ...(current[activityId] || {}) } };
      const isEmpty = value == null || value === '' || (Array.isArray(value) && value.length === 0);
      if (isEmpty) delete next[activityId][fieldKey];
      else next[activityId][fieldKey] = value;
      if (!Object.keys(next[activityId]).length) delete next[activityId];
      return next;
    });
  };

  const orderedActivities = ACTIVITIES.map((option) => option.value).filter((id) => activities.includes(id));
  const pace = activities.includes('running') ? getRunningPace(activityDetails) : '';

  React.useEffect(() => {
    if (profile || user) {
      if (hasDerivedFaculty && derivedFacultyFromId) {
        setFaculty(derivedFacultyFromId);
      } else if (profile?.faculty) {
        setFaculty(profile.faculty);
      } else {
        const detected = getStudentAcademicProfile(safeProfile);
        if (detected.faculty) setFaculty(detected.faculty);
      }

      if (hasDerivedYear && derivedYearFromId) {
        setYear(derivedYearFromId);
      } else if (profile?.year) {
        setYear(profile.year);
      } else {
        const detected = getStudentAcademicProfile(safeProfile);
        if (detected.year) setYear(detected.year);
      }
      setName(profile?.name || '');
      setAge(profile?.age ? String(profile.age) : '');
      setGender(profile?.gender || '');
      setActivities(() => {
        if (Array.isArray(profile?.activities) && profile.activities.length > 0) {
          return profile.activities;
        }
        if (profile?.activity) {
          return [profile.activity];
        }
        return ['other'];
      });
      setActivityDetails(getInitialActivityDetails(profile));
      if (MORE_ACTIVITIES.some((option) => (profile?.activities || []).includes(option.value))) {
        setShowMoreActivities(true);
      }
      setSkill(profile?.skill || '');
      setAvailability(profile?.availability || '');
      setAvailabilitySlots(Array.isArray(profile?.availabilitySlots) ? profile.availabilitySlots : []);
      setBio(profile?.bio || '');
      setFavoriteTracks(
        Array.isArray(profile?.favoriteTracks) ? profile.favoriteTracks.slice(0, MAX_FAVORITE_TRACKS) : []
      );
      setAvatarUri(profile?.avatarUri || null);
    }
  }, [profile, user, hasDerivedFaculty, derivedFacultyFromId, hasDerivedYear, derivedYearFromId, safeProfile]);

  const pickImage = async () => {
    if (isProcessingImage) return;
    try {
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

      // Validate image size (must not exceed 30 MB)
      const sizeValidation = await validateImageSize(asset.uri, asset.fileSize, MAX_PROFILE_IMAGE_SIZE_MB);
      if (!sizeValidation.valid) {
        showAlert('รูปภาพมีขนาดใหญ่เกินไป', sizeValidation.error, { tone: 'warning' });
        return;
      }

      try {
        const compressedUri = await compressProfileImage(asset.uri);
        setAvatarUri(compressedUri);
      } catch (compressionError) {
        console.warn('[Profile.ios] Image compression failed:', compressionError);
        showAlert(
          'ไม่สามารถประมวลผลรูปภาพได้',
          compressionError.message || 'เกิดข้อผิดพลาดในการปรับขนาดรูปภาพ กรุณาลองเลือกรูปภาพใหม่อีกครั้ง',
          { tone: 'danger' }
        );
      }
    } catch (error) {
      console.error('[Profile.ios] Image picking error:', error);
      showAlert('เกิดข้อผิดพลาด', 'ไม่สามารถเปิดเลือกรูปภาพได้ กรุณาลองใหม่อีกครั้ง', { tone: 'danger' });
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (isProcessingImage) {
      showAlert('กำลังประมวลผลรูปภาพ', 'กรุณารอสักครู่ก่อนบันทึกโปรไฟล์', { tone: 'info' });
      return;
    }
    setSaving(true);
    try {
      if (!name || name.trim().length < 2) {
        throw new Error('กรุณากรอกชื่อของคุณ (อย่างน้อย 2 ตัวอักษร)');
      }
      if (!gender) {
        throw new Error('กรุณาเลือกเพศของคุณ');
      }
      if (!studentId) {
        throw new Error(STUDENT_ID_REQUIRED_MESSAGE);
      }
      if (!faculty) {
        throw new Error(STUDENT_FACULTY_UNAVAILABLE_MESSAGE);
      }
      if (!year) {
        throw new Error(STUDENT_YEAR_UNAVAILABLE_MESSAGE);
      }
      if (!avatarUri) {
         throw new Error('กรุณาเพิ่มรูปโปรไฟล์ของคุณ');
      }
      const parsedAge = Number(age);
      if (!age || !Number.isInteger(parsedAge) || parsedAge < 18 || parsedAge > 100) {
        throw new Error('กรุณาระบุอายุระหว่าง 18–100 ปี');
      }
      if (isFirstSetup && !activities.length) {
        throw new Error('กรุณาเลือกกิจกรรมหรือความสนใจอย่างน้อย 1 รายการ');
      }
      if (isFirstSetup && activities.includes('running') && !pace) {
        throw new Error('กรุณาเลือกเพซวิ่งเมื่อเลือกวิ่งออกกำลังกาย');
      }
      if (isFirstSetup && !skill.trim()) {
        throw new Error('กรุณากรอกทักษะเพิ่มเติมของคุณ');
      }
      if (isFirstSetup && !availabilitySlots.length && !availability?.trim()) {
        throw new Error('กรุณาเลือกช่วงเวลาที่สะดวกอย่างน้อย 1 ช่วง');
      }
      if (isFirstSetup && !bio.trim()) {
        throw new Error('กรุณาเขียนแนะนำตัวสั้น ๆ');
      }
      const activityLabels = activities.map((act) => ACTIVITIES.find((option) => option.value === act)?.label || act);
      const activityLabel = activityLabels.join(', ');
      const cleanActivityDetails = sanitizeActivityDetails(activityDetails, activities);
      const profileData = {
        name,
        faculty,
        studentId,
        year,
        age: age ? parsedAge : null,
        gender,
        activity: activities[0] || 'other',
        activities,
        activityLabel,
        activityDetails: cleanActivityDetails,
        pace: getRunningPace(cleanActivityDetails),
        skill,
        availability,
        availabilitySlots,
        bio,
        favoriteTracks,
        avatarUri,
        matchingPreferences: {
          ...(safeProfile.matchingPreferences || {}),
        },
      };
      if (overrideSave) await overrideSave(profileData);
      else await saveProfile(profileData);
      if (onClose) {
        // iOS presents this screen as a native formSheet. Wait until it is
        // dismissed before showing the global toast so the sheet transition
        // cannot swallow the notification.
        onClose();
        setTimeout(() => onToast?.('บันทึกโปรไฟล์เรียบร้อยแล้ว'), 350);
        return;
      }
      onToast?.('บันทึกโปรไฟล์เรียบร้อยแล้ว');
    } catch (error) {
      if (error.isModerationViolation || error.isModerationUnavailable) {
        showImageModeration(error);
      } else {
        onToast?.(error.message || 'ยังบันทึกโปรไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
      }
    } finally {
      setSaving(false);
    }
  };


  const blurIntensity = colorScheme === 'dark' ? 30 : 40;

  return (
    <Pressable onPress={Keyboard.dismiss} style={{ flex: 1, backgroundColor: palette.background }}>
      {showHeader && (
        <>
          <MaskedView
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 85, zIndex: 10 }}
            maskElement={
              <LinearGradient colors={['#FFFFFF', '#FFFFFF00']} style={{ flex: 1 }} />
            }
          >
            <BlurView intensity={blurIntensity} tint={colorScheme} style={{ flex: 1 }} />
          </MaskedView>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }} pointerEvents="box-none">
            <Host colorScheme={colorScheme} seedColor={palette.coral} style={{ width: '100%', height: 85 }}>
              <VStack modifiers={[padding({ top: 35, bottom: 15, horizontal: 20 }), frame({ maxWidth: Infinity, alignment: 'topLeading' })]}>
                <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
                  {onClose && (
                    <Button
                      label="ย้อนกลับ"
                      onPress={onClose}
                      systemImage="chevron.left"
                      modifiers={[
                        buttonStyle('glass'),
                        buttonBorderShape('circle'),
                        controlSize('large'),
                        labelStyle('iconOnly'),
                      ]}
                    />
                  )}
                  <Text modifiers={[font({ textStyle: 'title2', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text)]}>
                    โปรไฟล์
                  </Text>
                  <Spacer />
                </HStack>
              </VStack>
            </Host>
          </View>
        </>
      )}
      <Host colorScheme={colorScheme} seedColor={palette.coral} style={{ flex: 1 }}>
        <VStack style={{ flex: 1 }}>
          <Form modifiers={[padding({ top: showHeader ? 88 : 0 })]}>
          <Section>
            <ProfileIdentity
              avatarUri={avatarDisplayUri}
              email={safeProfile.email || ''}
              isProcessingImage={isProcessingImage}
              name={name || safeProfile.nickname || 'โปรไฟล์ของคุณ'}
              onPickImage={pickImage}
            />
          </Section>
          <Section
            header={
              <HStack spacing={6}>
                <Image color={isFaceVerified ? palette.mint : palette.blue} size={14} systemName={isFaceVerified ? 'checkmark.seal.fill' : 'lock.shield.fill'} />
                <Text modifiers={[font({ weight: 'bold' })]}>{isFaceVerified ? 'ยืนยันใบหน้าแล้ว' : 'ยืนยันใบหน้า'}</Text>
              </HStack>
            }
            footer={
              <Text>
                {isFaceVerified
                  ? `โปรไฟล์ของคุณได้รับตราสัญลักษณ์ยืนยันแล้ว${faceMatchScore ? ` (ความตรงกัน ${faceMatchScore}%)` : ''}`
                  : 'สแกนใบหน้าสดเพื่อรับตราสัญลักษณ์ความถูกต้อง ป้องกันการแอบอ้าง ต้องตั้งรูปโปรไฟล์หลักก่อน'}
              </Text>
            }
          >
            <Button
              onPress={() => {
                if (!avatarUri) {
                  showAlert('กรุณาตั้งรูปโปรไฟล์หลัก', 'ต้องตั้งรูปโปรไฟล์หลักก่อนทำการยืนยันใบหน้า', { tone: 'warning' });
                  return;
                }
                setShowFaceVerificationModal(true);
              }}
              modifiers={[
                buttonStyle('bordered'),
                controlSize('large'),
                tint(isFaceVerified ? palette.mint : palette.blue),
              ]}
            >
              <HStack alignment="center" spacing={8}>
                <Image
                  color={isFaceVerified ? palette.mint : palette.blue}
                  size={16}
                  systemName={isFaceVerified ? 'arrow.triangle.2.circlepath.camera.fill' : 'camera.fill'}
                />
                <Text modifiers={[font({ weight: 'semibold' })]}>
                  {isFaceVerified ? 'สแกนใหม่' : 'เริ่มยืนยันใบหน้า'}
                </Text>
              </HStack>
            </Button>
          </Section>

          <Section
            header={
              <HStack spacing={6}>
                <Image color={palette.coral} size={14} systemName="person.text.rectangle.fill" />
                <Text modifiers={[font({ weight: 'bold' })]}>ข้อมูลโปรไฟล์</Text>
              </HStack>
            }
            footer={<Text>ข้อมูลพื้นฐานที่จะแสดงให้เพื่อนร่วมมหาวิทยาลัยเห็น</Text>}
          >
            <NativeField label="ชื่อที่แสดง" onChange={setName} systemImage="person.fill" value={name} />
            {isFacultyLocked ? (
              <ReadOnlyField
                helper={facultyHelper}
                label="คณะ"
                systemImage="building.columns.fill"
                value={faculty || 'ไม่พบข้อมูล'}
              />
            ) : (
              <SelectionRow
                label="คณะ"
                options={FACULTY_OPTIONS}
                onSelect={setFaculty}
                systemImage="building.columns.fill"
                value={faculty}
              />
            )}
            {isYearLocked ? (
              <ReadOnlyField
                helper={yearHelper}
                label="ชั้นปี"
                systemImage="graduationcap.fill"
                value={year || 'ไม่พบข้อมูล'}
              />
            ) : (
              <SelectionRow
                label="ชั้นปี"
                options={YEAR_OPTIONS}
                onSelect={setYear}
                systemImage="graduationcap.fill"
                value={year}
              />
            )}
            <SelectionRow label="อายุ" options={AGES} onSelect={setAge} systemImage="calendar" value={age || '20'} />
            <SelectionRow label="เพศ" options={GENDERS} onSelect={setGender} systemImage="person.2.fill" value={gender} />
          </Section>

          <Section
            header={
              <HStack spacing={6}>
                <Image color={palette.coral} size={14} systemName="figure.run.circle.fill" />
                <Text modifiers={[font({ weight: 'bold' })]}>กิจกรรมและความสนใจ</Text>
              </HStack>
            }
            footer={<Text>เลือกกิจกรรมที่คุณสนใจเพื่อช่วยค้นหาเพื่อนที่มีเป้าหมายและไลฟ์สไตล์ตรงกัน</Text>}
          >
            <MultiActivityPicker
              moreOptions={MORE_ACTIVITIES}
              onToggle={toggleActivity}
              onToggleMore={() => setShowMoreActivities((current) => !current)}
              options={PRIMARY_ACTIVITIES}
              palette={palette}
              selected={activities}
              showMore={showMoreActivities}
            />
            {orderedActivities.map((activityId) => (
              <ActivityDetailSection
                activityId={activityId}
                key={activityId}
                onChange={updateActivityDetail}
                palette={palette}
                values={activityDetails[activityId] || {}}
              />
            ))}
            <NativeField label="ทักษะเพิ่มเติม" onChange={setSkill} systemImage="star.fill" value={skill} />
            <Button
              onPress={() => setShowAvailabilityModal(true)}
              modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity })]}
            >
              <HStack
                spacing={10}
                modifiers={[
                  padding({ all: 12 }),
                  background(palette.surfaceRaised, shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' })),
                  frame({ minHeight: 54, maxWidth: Infinity }),
                ]}
              >
                <Image color={palette.coral} size={17} systemName="calendar.badge.clock" />
                <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                  <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>
                    ช่วงเวลาที่สะดวก
                  </Text>
                  <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(palette.text), lineLimit(1)]}>
                    {availabilitySlots.length > 0 ? `เลือกไว้ ${availabilitySlots.length} ช่วงเวลา` : 'แตะเพื่อเลือกหลายวันและเวลาที่สะดวก'}
                  </Text>
                </VStack>
                <Spacer />
                <Image color={palette.tertiary} size={13} systemName="chevron.right" />
              </HStack>
            </Button>

            {canUseSpotify ? (<>
<Button
              onPress={() => {
                if (favoriteTracks.length < MAX_FAVORITE_TRACKS) setShowSpotifySearch(true);
              }}
              modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity })]}
            >
              <HStack
                spacing={10}
                modifiers={[
                  padding({ all: 12 }),
                  background(palette.surfaceRaised, shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' })),
                  frame({ minHeight: 54, maxWidth: Infinity }),
                ]}
              >
                <Image color={palette.coral} size={17} systemName="music.note" />
                <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                  <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>
                    เพลงโปรด ({favoriteTracks.length}/{MAX_FAVORITE_TRACKS})
                  </Text>
                  <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(palette.text), lineLimit(1)]}>
                    {favoriteTracks.length > 0
                      ? favoriteTracks.map((track) => track.name).join(', ')
                      : 'ค้นหาและเพิ่มเพลงจาก Spotify'}
                  </Text>
                </VStack>
                <Spacer />
                <Image color={palette.tertiary} size={13} systemName="chevron.right" />
              </HStack>
            </Button>
            {favoriteTracks.length > 0 ? (
              <VStack spacing={8} modifiers={[padding({ horizontal: 4, bottom: 4 })]}>
                {favoriteTracks.map((track) => (
                  <HStack key={track.id} spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
                    <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                      <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(palette.text), lineLimit(1)]}>
                        {track.name}
                      </Text>
                      <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(palette.tertiary), lineLimit(1)]}>
                        {track.artists}
                        {Number.isFinite(track.previewStartMs) && Number.isFinite(track.previewEndMs)
                          ? ` · ท่อน ${Math.floor(track.previewStartMs / 1000)}-${Math.floor(track.previewEndMs / 1000)}วิ`
                          : ''}
                      </Text>
                    </VStack>
                    <Spacer />
                    {(track.previewUrl || track.youtubeVideoId || track.name) ? (
                      <RNHostView>
                        <TrackPreviewButton
                          backgroundColor={palette.violetSoft}
                          color={palette.purple}
                          previewEndMs={track.previewEndMs}
                          previewStartMs={track.previewStartMs}
                          previewUrl={track.previewUrl}
                          size={34}
                          track={track}
                          trackArtists={track.artists}
                          trackName={track.name}
                          youtubeVideoId={track.youtubeVideoId}
                        />
                      </RNHostView>
                    ) : null}
                    <Button
                      onPress={() => setFavoriteTracks((current) => current.filter((item) => item.id !== track.id))}
                      modifiers={[buttonStyle('plain')]}
                    >
                      <Image color={palette.tertiary} size={18} systemName="xmark.circle.fill" />
                    </Button>
                  </HStack>
                ))}
              </VStack>
            ) : null}
</>) : null}

            <NativeField label="แนะนำตัวสั้น ๆ" multiline onChange={setBio} systemImage="text.quote" value={bio} />
          </Section>

          </Form>
          <Button
            onPress={handleSave}
            modifiers={[
              buttonStyle('glassProminent'),
              buttonBorderShape('capsule'),
              controlSize('large'),
              tint(palette.coral),
              padding({ top: 8, horizontal: 20, bottom: Math.max(insets.bottom, 12) }),
              frame({ maxWidth: Infinity }),
            ]}
          >
            <HStack alignment="center" spacing={8}>
              <Image color={palette.white} size={17} systemName={saving ? 'hourglass' : 'checkmark.circle.fill'} />
              <Text modifiers={[font({ weight: 'bold' }), foregroundStyle(palette.white)]}>
                {saving ? 'กำลังบันทึก' : 'บันทึกการเปลี่ยนแปลง'}
              </Text>
            </HStack>
          </Button>
        </VStack>

      </Host>
      <AvailabilityModal
        visible={showAvailabilityModal}
        onClose={() => setShowAvailabilityModal(false)}
        availabilitySlots={availabilitySlots}
        onSave={(slots) => {
          setAvailabilitySlots(slots);
          setAvailability(slots.length > 0 ? `ระบุ ${slots.length} ช่วงเวลา` : '');
        }}
      />
      <FaceVerificationModal
        avatarUri={avatarUri}
        onClose={() => setShowFaceVerificationModal(false)}
        onSuccess={(result) => {
          markFaceVerified?.(result.similarity);
          onToast?.(`ยืนยันใบหน้าสำเร็จ ความตรงกัน ${result.similarity}%`, 'success');
        }}
        visible={showFaceVerificationModal}
      />
      {showSpotifySearch ? (
        <SpotifyTrackSearchSheet
          excludeIds={favoriteTracks.map((track) => track.id)}
          onClose={() => setShowSpotifySearch(false)}
          onSelect={(track) => {
            setFavoriteTracks((current) => {
              if (current.some((item) => item.id === track.id)) return current;
              if (current.length >= MAX_FAVORITE_TRACKS) return current;
              return [...current, track].slice(0, MAX_FAVORITE_TRACKS);
            });
            setShowSpotifySearch(false);
          }}
          visible
        />
      ) : null}
    </Pressable>
  );
}

function ProfileIdentity({ avatarUri, email, isProcessingImage = false, name, onPickImage }) {
  const palette = usePalette();
  return (
    <VStack
      spacing={10}
      modifiers={[
        padding({ vertical: 24, horizontal: 18 }),
        frame({ maxWidth: Infinity }),
        background(palette.surface, cardShape),
        shadow({ radius: 20, y: 8, color: 'rgba(0,0,0,0.22)' }),
      ]}
    >
      <ZStack alignment="bottomTrailing">
        {avatarUri ? (
          <Image
            uiImage={avatarUri}
            modifiers={[
              resizable(),
              aspectRatio({ contentMode: 'fill' }),
              frame({ width: 116, height: 116 }),
              clipped(),
              clipShape('circle'),
            ]}
          />
        ) : (
          <Image
            color={palette.text}
            size={64}
            systemName="person.crop.circle.fill"
            modifiers={[
              frame({ width: 116, height: 116 }),
              background(palette.surfaceRaised, shapes.circle()),
            ]}
          />
        )}
        <Button
          disabled={isProcessingImage}
          label="เปลี่ยนรูปโปรไฟล์"
          onPress={onPickImage}
          systemImage="camera.fill"
          modifiers={[
            buttonStyle('glassProminent'),
            buttonBorderShape('circle'),
            controlSize('regular'),
            labelStyle('iconOnly'),
            tint(palette.coral),
          ]}
        />
      </ZStack>
      <Text modifiers={[font({ textStyle: 'title2', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text), lineLimit(1)]}>
        {name}
      </Text>
      <Text modifiers={[font({ textStyle: 'caption', weight: 'medium' }), foregroundStyle(palette.secondary), lineLimit(1)]}>
        {email}
      </Text>
      <HStack spacing={5} modifiers={[padding({ horizontal: 9, vertical: 5 }), background(palette.mintSoft, shapes.capsule())]}>
        <Image color={palette.mint} size={12} systemName="checkmark.seal.fill" />
        <Text modifiers={[font({ textStyle: 'caption2', weight: 'bold' }), foregroundStyle(palette.mint)]}>
          ยืนยันบัญชีแล้ว
        </Text>
      </HStack>
    </VStack>
  );
}

function SettingsCard({ children, systemImage, title }) {
  const palette = usePalette();
  return (
    <VStack
      alignment="leading"
      spacing={14}
      modifiers={[
        padding({ all: 17 }),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        background(palette.surface, cardShape),
      ]}
    >
      <HStack spacing={8}>
        <Image color={palette.coral} size={18} systemName={systemImage} />
        <Text modifiers={[font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text)]}>
          {title}
        </Text>
      </HStack>
      {children}
    </VStack>
  );
}

function NativeField({ label, multiline = false, onChange, systemImage, value }) {
  const palette = usePalette();
  const nativeText = useNativeState(value || '');
  const fieldShape = shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' });

  return (
    <HStack
      alignment={multiline ? 'top' : 'center'}
      spacing={10}
      modifiers={[
        padding({ all: 12 }),
        background(palette.surfaceRaised, fieldShape),
        frame({ minHeight: multiline ? 90 : 54, maxWidth: Infinity }),
      ]}
    >
      <Image color={palette.coral} size={17} systemName={systemImage} />
      <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>
          {label}
        </Text>
        <TextField
          axis={multiline ? 'vertical' : 'horizontal'}
          onTextChange={onChange}
          placeholder={`ระบุ${label}`}
          modifiers={[
            textFieldStyle('plain'),
            font({ textStyle: 'subheadline', weight: 'semibold' }),
            foregroundStyle(palette.text),
            frame({ maxWidth: Infinity }),
            lineLimit(multiline ? 4 : 1),
          ]}
          text={nativeText}
        />
      </VStack>
    </HStack>
  );
}

function ReadOnlyField({ helper, label, systemImage, value }) {
  const palette = usePalette();
  const fieldShape = shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' });

  return (
    <HStack
      alignment="center"
      spacing={10}
      modifiers={[
        padding({ all: 12 }),
        background(palette.surfaceRaised, fieldShape),
        frame({ minHeight: 54, maxWidth: Infinity }),
      ]}
    >
      <Image color={palette.coral} size={17} systemName={systemImage} />
      <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>
          {label}
        </Text>
        <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(palette.text), lineLimit(1)]}>
          {value || 'ไม่ระบุ'}
        </Text>
        {helper ? (
          <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(palette.tertiary), lineLimit(1)]}>
            {helper}
          </Text>
        ) : null}
      </VStack>
      <Image color={palette.tertiary} size={14} systemName="lock.fill" />
    </HStack>
  );
}

function SelectionRow({ label, onSelect, options, systemImage, value }) {
  const palette = usePalette();
  const selectedLabel = options.find((option) => (typeof option === 'string' ? option : option.value) === value);
  const displayValue = typeof selectedLabel === 'string' ? selectedLabel : selectedLabel?.label || value;
  const rowShape = shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' });
  return (
    <Menu
      label={(
        <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity, minHeight: 30 })]}>
          <Image color={palette.coral} size={17} systemName={systemImage} />
          <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>{label}</Text>
            <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(palette.text), lineLimit(1)]}>{displayValue}</Text>
          </VStack>
          <Spacer />
          <Image color={palette.tertiary} size={13} systemName="chevron.up.chevron.down" />
        </HStack>
      )}
      modifiers={[
        padding({ all: 12 }),
        background(palette.surfaceRaised, rowShape),
        frame({ minHeight: 54, maxWidth: Infinity }),
      ]}
    >
      {options.map((option) => {
        const optionValue = typeof option === 'string' ? option : option.value;
        const optionLabel = typeof option === 'string' ? option : option.label;
        return (
          <Button key={optionValue} label={optionLabel} onPress={() => onSelect(optionValue)} systemImage={optionValue === value ? 'checkmark' : undefined} />
        );
      })}
    </Menu>
  );
}

function LegalRow({ label, onPress, systemImage, value }) {
  const palette = usePalette();
  return (
    <Button
      onPress={onPress}
      modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity })]}
    >
      <HStack spacing={10} modifiers={[padding({ vertical: 12, horizontal: 4 }), frame({ maxWidth: Infinity })]}>
        <Image color={palette.coral} size={17} systemName={systemImage} />
        <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(palette.text), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          {label}
        </Text>
        {value ? <Text modifiers={[font({ textStyle: 'caption', weight: 'medium' }), foregroundStyle(palette.secondary)]}>{value}</Text> : null}
        {onPress ? <Image color={palette.tertiary} size={13} systemName="chevron.right" /> : null}
      </HStack>
    </Button>
  );
}

function LegalSubsectionTitle() {
  const palette = usePalette();
  return (
    <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(palette.secondary), padding({ top: 8, bottom: 4 })]}>
      ข้อกำหนดทางกฎหมาย
    </Text>
  );
}

function ActivityChipGrid({ onToggle, options, palette, selected }) {
  const rows = [];
  for (let i = 0; i < options.length; i += 2) {
    rows.push(options.slice(i, i + 2));
  }
  return (
    <Grid horizontalSpacing={8} verticalSpacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
      {rows.map((pair, rowIndex) => (
        <Grid.Row key={rowIndex}>
          <ActivityChip
            item={pair[0]}
            isSelected={selected.includes(pair[0].value)}
            onPress={() => onToggle(pair[0].value)}
            palette={palette}
          />
          {pair[1] ? (
            <ActivityChip
              item={pair[1]}
              isSelected={selected.includes(pair[1].value)}
              onPress={() => onToggle(pair[1].value)}
              palette={palette}
            />
          ) : (
            <VStack modifiers={[frame({ maxWidth: Infinity, height: 46 })]} />
          )}
        </Grid.Row>
      ))}
    </Grid>
  );
}

function MultiActivityPicker({ moreOptions = [], onToggle, onToggleMore, options, palette, selected, showMore = false }) {
  const moreSelected = moreOptions.some((option) => selected.includes(option.value));
  const expanded = showMore || moreSelected;
  return (
    <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 4 })]}>
      <HStack spacing={6}>
        <Image color={palette.coral} size={15} systemName="figure.run" />
        <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(palette.secondary)]}>
          กิจกรรมที่ชอบ (เลือกได้หลายข้อ)
        </Text>
      </HStack>
      <ActivityChipGrid onToggle={onToggle} options={options} palette={palette} selected={selected} />
      {moreOptions.length ? (
        <Button
          label={expanded ? 'ซ่อนกิจกรรมเพิ่มเติม' : `กิจกรรมเพิ่มเติม (${moreOptions.length})`}
          onPress={onToggleMore}
          systemImage={expanded ? 'chevron.up' : 'chevron.down'}
          modifiers={[buttonStyle('plain'), controlSize('small'), tint(palette.coral), font({ textStyle: 'caption', weight: 'bold' })]}
        />
      ) : null}
      {expanded && moreOptions.length ? (
        <ActivityChipGrid onToggle={onToggle} options={moreOptions} palette={palette} selected={selected} />
      ) : null}
    </VStack>
  );
}

function ActivityChip({ item, isSelected, onPress, palette }) {
  const chipBg = isSelected ? palette.coral : palette.surfaceRaised;
  const textColor = isSelected ? palette.white : palette.text;
  const iconColor = isSelected ? palette.white : palette.secondary;
  const chipShape = shapes.roundedRectangle({ cornerRadius: 16, roundedCornerStyle: 'continuous' });

  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        frame({ maxWidth: Infinity }),
        contentShape(chipShape),
      ]}
    >
      <HStack
        alignment="center"
        spacing={8}
        modifiers={[
          frame({ maxWidth: Infinity, height: 46, alignment: 'center' }),
          padding({ horizontal: 12 }),
          background(chipBg, chipShape),
        ]}
      >
        <Image color={iconColor} size={15} systemName={isSelected ? 'checkmark.circle.fill' : item.icon} />
        <Text
          modifiers={[
            font({ textStyle: 'subheadline', weight: isSelected ? 'bold' : 'medium' }),
            foregroundStyle(textColor),
            lineLimit(1),
          ]}
        >
          {item.label}
        </Text>
      </HStack>
    </Button>
  );
}

// Small selectable pill used for multi-choice detail options.
function OptionPill({ isSelected, label, onPress, palette }) {
  const pillShape = shapes.capsule();
  return (
    <Button onPress={onPress} modifiers={[buttonStyle('plain'), contentShape(pillShape)]}>
      <Text
        modifiers={[
          font({ textStyle: 'caption', weight: isSelected ? 'bold' : 'medium' }),
          foregroundStyle(isSelected ? palette.white : palette.text),
          padding({ horizontal: 12, vertical: 8 }),
          background(isSelected ? palette.coral : palette.chip, pillShape),
        ]}
      >
        {label}
      </Text>
    </Button>
  );
}

function OptionPillRows({ onToggle, options, palette, selected }) {
  // Two per row keeps long Thai labels readable inside the form width.
  const rows = [];
  for (let i = 0; i < options.length; i += 2) rows.push(options.slice(i, i + 2));
  return (
    <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      {rows.map((pair, index) => (
        <HStack key={index} spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          {pair.map((option) => (
            <OptionPill
              isSelected={selected.includes(option)}
              key={option}
              label={option}
              onPress={() => onToggle(option)}
              palette={palette}
            />
          ))}
          <Spacer />
        </HStack>
      ))}
    </VStack>
  );
}

// Extra questions for one selected activity, driven by ACTIVITY_DETAIL_FIELDS.
function ActivityDetailSection({ activityId, onChange, palette, values }) {
  const category = getActivityCategory(activityId);
  const fields = getActivityDetailFields(activityId);
  if (!category || !fields.length) return null;
  const sectionShape = shapes.roundedRectangle({ cornerRadius: 18, roundedCornerStyle: 'continuous' });
  return (
    <VStack
      alignment="leading"
      spacing={10}
      modifiers={[
        padding({ all: 12 }),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        background(palette.surfaceRaised, sectionShape),
      ]}
    >
      <HStack spacing={8}>
        <Image color={category.color} size={15} systemName={category.symbol} />
        <Text modifiers={[font({ textStyle: 'subheadline', weight: 'bold' }), foregroundStyle(palette.text)]}>
          {category.label}
        </Text>
        <Spacer />
        <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>
          รายละเอียดเพิ่มเติม
        </Text>
      </HStack>
      {fields.map((field) => {
        const value = values[field.key];
        if (field.type === 'multi') {
          const selected = Array.isArray(value) ? value : [];
          return (
            <VStack alignment="leading" key={field.key} spacing={6} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
              <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(palette.secondary)]}>
                {field.label}
              </Text>
              <OptionPillRows
                onToggle={(option) => onChange(
                  activityId,
                  field.key,
                  selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]
                )}
                options={field.options}
                palette={palette}
                selected={selected}
              />
            </VStack>
          );
        }
        if (field.type === 'text') {
          return (
            <NativeField
              key={field.key}
              label={field.label}
              onChange={(text) => onChange(activityId, field.key, text)}
              systemImage="text.quote"
              value={typeof value === 'string' ? value : ''}
            />
          );
        }
        return (
          <SelectionRow
            key={field.key}
            label={field.label}
            onSelect={(next) => onChange(activityId, field.key, next)}
            options={[{ label: 'ไม่ระบุ', value: '' }, ...field.options]}
            systemImage={field.symbol || 'list.bullet'}
            value={typeof value === 'string' ? value : ''}
          />
        );
      })}
    </VStack>
  );
}
