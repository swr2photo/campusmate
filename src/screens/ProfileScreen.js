import { useToast } from '../context/ToastContext';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACTIVITY_CATEGORIES } from '../data/activityCategories';
import { useApp } from '../context/AppContext';
import { Card, Chip, PrimaryButton, SectionTitle } from '../components/ui';
import { IosLikeAvatar } from '../components/iosLike';
import FeatureIcon from '../components/FeatureIcon';
import AvailabilityModal from '../components/AvailabilityModal';
import { compressProfileImage, validateImageSize, MAX_PROFILE_IMAGE_SIZE_MB } from '../utils/compressImage';
import { radius, spacing, type, useTheme } from '../theme';

import { FACULTIES } from '../data/faculties';
const ACTIVITY_ANDROID_ICONS = {
  running: 'figure.run',
  gym: 'dumbbell.fill',
  sports: 'sportscourt.fill',
  study: 'book.closed.fill',
  chill: 'cup.and.saucer.fill',
  other: 'sparkles',
};
const YEARS = ['ชั้นปีที่ 1', 'ชั้นปีที่ 2', 'ชั้นปีที่ 3', 'ชั้นปีที่ 4', 'ปริญญาโท', 'ปริญญาเอก'];
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
const PACE_OPTIONS = [
  '\u0e44\u0e21\u0e48\u0e23\u0e30\u0e1a\u0e38',
  '\u0e40\u0e14\u0e34\u0e19 / \u0e40\u0e23\u0e34\u0e48\u0e21\u0e15\u0e49\u0e19',
  'Pace 8:00+ \u0e19\u0e32\u0e17\u0e35/\u0e01\u0e21.',
  'Pace 7:00 - 8:00 \u0e19\u0e32\u0e17\u0e35/\u0e01\u0e21.',
  'Pace 6:00 - 7:00 \u0e19\u0e32\u0e17\u0e35/\u0e01\u0e21.',
  'Pace 5:00 - 6:00 \u0e19\u0e32\u0e17\u0e35/\u0e01\u0e21.',
  'Pace \u0e15\u0e48\u0e33\u0e01\u0e27\u0e48\u0e32 5:00 \u0e19\u0e32\u0e17\u0e35/\u0e01\u0e21.',
];

const DEFAULT_AGE = '20';
const DEFAULT_FACULTY = FACULTIES[0];
const DEFAULT_GENDER = 'unspecified';
const DEFAULT_ACTIVITY = 'other';
const DEFAULT_PACE = PACE_OPTIONS[0];
const REQUIRED_MARK = '*';

function getInitialInterests(profile) {
  const savedInterests = [profile?.interests, profile?.activities]
    .find((value) => Array.isArray(value) && value.length > 0);
  if (savedInterests) return savedInterests;
  if (profile?.activity) return [profile.activity];
  return [DEFAULT_ACTIVITY];
}

function getProfileValidationError({ age, avatarUri, bio, faculty, gender, interests, name, pace, year, availability, availabilitySlots, requireComplete = true }) {
  if (!name || name.trim().length < 2) return 'กรุณากรอกชื่อของคุณ (อย่างน้อย 2 ตัวอักษร)';
  if (!faculty || faculty === 'all') return 'กรุณาเลือกคณะของคุณ';
  if (!gender) return 'กรุณาเลือกเพศของคุณ';
  if (!year) return 'กรุณาเลือกชั้นปี';
  if (!avatarUri) return 'กรุณาเพิ่มรูปโปรไฟล์ของคุณ';
  const parsedAge = Number(age);
  if (!age || !Number.isInteger(parsedAge) || parsedAge < 18 || parsedAge > 100) return 'กรุณาระบุอายุระหว่าง 18–100 ปี';
  if (!requireComplete) return null;
  if (!interests.length) return 'กรุณาเลือกกิจกรรมหรือความสนใจอย่างน้อย 1 รายการ';
  if (interests.includes('running') && (!pace || pace === DEFAULT_PACE)) {
    return 'กรุณาเลือกเพซวิ่งเมื่อเลือกวิ่งออกกำลังกาย';
  }
  if (!availabilitySlots.length && !availability?.trim()) return 'กรุณาเลือกช่วงเวลาที่สะดวกอย่างน้อย 1 ช่วง';
  if (!bio.trim()) return 'กรุณาเขียนแนะนำตัวสั้น ๆ';
  return null;
}

export default function ProfileScreen({ onClose, onCloseGuardReady, onLogout, onToast, overrideSave }) {
  const { showImageModeration } = useToast();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const isFirstSetup = Boolean(overrideSave);

  const { profile, saveProfile, deleteAccount } = useApp();
  const safeProfile = profile || {};
  const [name, setName] = useState(safeProfile.name || '');
  const [faculty, setFaculty] = useState(safeProfile.faculty || DEFAULT_FACULTY);
  const [year, setYear] = useState(safeProfile.year || YEARS[0]);
  const [age, setAge] = useState(safeProfile.age ? String(safeProfile.age) : DEFAULT_AGE);
  const [gender, setGender] = useState(safeProfile.gender || DEFAULT_GENDER);
  const [pace, setPace] = useState(safeProfile.pace || DEFAULT_PACE);
  const [skill, setSkill] = useState(safeProfile.skill || '');
  const [availability, setAvailability] = useState(safeProfile.availability || '');
  const [availabilitySlots, setAvailabilitySlots] = useState(() => (
    Array.isArray(safeProfile.availabilitySlots) ? safeProfile.availabilitySlots : []
  ));
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [bio, setBio] = useState(safeProfile.bio || '');
  const [interests, setInterests] = useState(() => getInitialInterests(safeProfile));
  const [avatarUri, setAvatarUri] = useState(safeProfile.avatarUri || null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [discoverable, setDiscoverable] = useState(safeProfile.isDiscoverable ?? true);
  const [notifications, setNotifications] = useState(safeProfile.notificationsEnabled ?? true);
  const [privacy, setPrivacy] = useState(safeProfile.privacy || {});
  const [expandedSection, setExpandedSection] = useState('basic');
  const [saving, setSaving] = useState(false);
  const isRunningSelected = interests.includes('running');

  const toggleInterest = (id) => {
    setInterests((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
    if (id === 'running' && isRunningSelected) setPace(DEFAULT_PACE);
  };

  React.useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setFaculty(profile.faculty || DEFAULT_FACULTY);
      setYear(profile.year || YEARS[0]);
      setAge(profile.age ? String(profile.age) : DEFAULT_AGE);
      setGender(profile.gender || DEFAULT_GENDER);
      setPace(profile.pace || DEFAULT_PACE);
      setSkill(profile.skill || '');
      setAvailability(profile.availability || '');
      setAvailabilitySlots(Array.isArray(profile.availabilitySlots) ? profile.availabilitySlots : []);
      setBio(profile.bio || '');
      setInterests(getInitialInterests(profile));
      setAvatarUri(profile.avatarUri || null);
      setDiscoverable(profile.isDiscoverable ?? true);
      setNotifications(profile.notificationsEnabled ?? true);
      setPrivacy(profile.privacy || {});
    }
  }, [profile]);

  React.useEffect(() => {
    if (!isRunningSelected && pace !== DEFAULT_PACE) setPace(DEFAULT_PACE);
  }, [isRunningSelected, pace]);

  const getValidationError = () => getProfileValidationError({
    age,
    avatarUri,
    bio,
    faculty,
    gender,
    interests,
    name,
    pace,
    year,
    availability,
    availabilitySlots,
    requireComplete: isFirstSetup,
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
  }, [onCloseGuardReady, age, avatarUri, bio, faculty, gender, interests, name, pace, skill, year, availability, availabilitySlots]);

  React.useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => subscription.remove();
  }, [age, avatarUri, bio, faculty, gender, interests, name, onClose, onToast, pace, skill, year, availability, availabilitySlots]);

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
        Alert.alert('รูปภาพมีขนาดใหญ่เกินไป', sizeValidation.error);
        onToast?.(sizeValidation.error, 'error');
        return;
      }

      try {
        const compressedUri = await compressProfileImage(asset.uri);
        setAvatarUri(compressedUri);
      } catch (compressionError) {
        console.warn('[Profile] Image compression failed:', compressionError);
        Alert.alert(
          'ไม่สามารถประมวลผลรูปภาพได้',
          compressionError.message || 'เกิดข้อผิดพลาดในการปรับขนาดรูปภาพ กรุณาลองเลือกรูปภาพใหม่อีกครั้ง'
        );
        onToast?.(compressionError.message || 'ไม่สามารถประมวลผลรูปภาพได้', 'error');
      }
    } catch (error) {
      console.error('[Profile] Image picking error:', error);
      Alert.alert('เกิดข้อผิดพลาด', 'ไม่สามารถเปิดเลือกรูปภาพได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (isProcessingImage) {
      onToast?.('กำลังประมวลผลรูปภาพ กรุณารอสักครู่...', 'info');
      return;
    }
    setSaving(true);
    try {
      const validationError = getValidationError();
      if (validationError) throw new Error(validationError);
      const parsedAge = Number(age);
      const activities = interests.length > 0 ? interests : ['other'];
      const activity = activities[0];
      const activityLabels = activities.map(
        (id) => ACTIVITY_CATEGORIES.find((item) => item.id === id)?.label || id
      );
      const activityLabel = activityLabels.join(', ');
      const profileData = {
        name,
        faculty,
        year,
        age: age ? parsedAge : null,
        gender,
        activity,
        activities,
        activityLabel,
        pace: isRunningSelected && pace !== DEFAULT_PACE ? pace : '',
        skill,
        availability,
        availabilitySlots,
        bio,
        interests: activities,
        avatarUri,
        isDiscoverable: discoverable,
        notificationsEnabled: notifications,
        privacy,
        matchingPreferences: {
          ...(safeProfile.matchingPreferences || {}),
        },
      };
      if (overrideSave) await overrideSave(profileData);
      else await saveProfile(profileData);
      const successMessage = 'บันทึกโปรไฟล์เรียบร้อยแล้ว';
      if (onClose) {
        onClose();
        setTimeout(() => onToast?.(successMessage), 350);
      } else {
        onToast?.(successMessage);
      }
    } catch (error) {
      if (error.isModerationViolation || error.isModerationUnavailable) {
        showImageModeration(error);
      } else {
        onToast?.(error.message || 'บันทึกโปรไฟล์ไม่สำเร็จ', 'info');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'ยืนยันการลบบัญชี',
      'คุณแน่ใจหรือไม่ว่าต้องการลบบัญชี? ข้อมูลทั้งหมดของคุณรวมถึงโปรไฟล์ ข้อความแชท และการจับคู่จะถูกลบอย่างถาวรและไม่สามารถกู้คืนได้',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        { 
          text: 'ลบบัญชี', 
          style: 'destructive', 
          onPress: async () => {
            try {
              onToast?.('กำลังลบบัญชี...', 'info');
              await deleteAccount();
              // When successful, the AppContext will be unmounted because auth state changes.
            } catch (error) {
              onToast?.(error.message || 'ลบบัญชีไม่สำเร็จ', 'info');
            }
          }
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'android' ? 'height' : 'padding'}
      keyboardVerticalOffset={0}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={[styles.content, styles.contentWithStickySave]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        <Card style={styles.identityCard}>
          <FormLabel label="รูปโปรไฟล์" required styles={styles} />
          <View style={styles.avatarContainer}>
            <IosLikeAvatar cacheScope={profile?.id} cacheVersion={profile?.updatedAt} color={colors.primarySoft} size={74} uri={avatarUri} />
            {isProcessingImage && (
              <View style={[StyleSheet.absoluteFill, styles.avatarLoadingOverlay]}>
                <ActivityIndicator color="#FFFFFF" size="small" />
              </View>
            )}
            <Pressable disabled={isProcessingImage} onPress={pickImage} style={[styles.cameraButton, isProcessingImage && { opacity: 0.6 }]}>
              <FeatureIcon color={colors.ink} name="camera.fill" size={16} />
            </Pressable>
          </View>
          <View style={styles.identityCopy}>
            <Text style={styles.identityName}>{name || 'ชื่อของคุณ'}</Text>
            <Text style={styles.identityEmail}>{safeProfile.email || ''}</Text>
            <View style={styles.verifiedPill}><Text style={styles.verifiedText}>✓ ยืนยันอีเมลแล้ว</Text></View>
          </View>
        </Card>

        <Text style={styles.requiredLegend}>
          <Text style={styles.requiredMark}>{REQUIRED_MARK}</Text> ต้องกรอกข้อมูล
        </Text>

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
            <AndroidSelectionRow
              icon="building.columns.fill"
              label="คณะ"
              onSelect={setFaculty}
              options={FACULTIES}
              placeholder="เลือกคณะ"
              required
              value={faculty}
            />
            <AndroidSelectionRow
              icon="graduationcap.fill"
              label="ชั้นปี"
              onSelect={setYear}
              options={YEARS}
              placeholder="เลือกชั้นปี"
              required
              value={year}
            />
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
              <View key={category.id} style={styles.interestGridItem}>
                <Chip
                  active={interests.includes(category.id)}
                  color={category.color}
                  iconName={ACTIVITY_ANDROID_ICONS[category.id]}
                  label={category.label}
                  onPress={() => toggleInterest(category.id)}
                  style={styles.uniformInterestChip}
                />
              </View>
            ))}
          </View>

          <View style={styles.pickerContainer}>
            <FormLabel label="เพซวิ่ง" required={isFirstSetup && isRunningSelected} styles={styles} />
            <CustomDropdown
              colors={colors}
              disabled={!isRunningSelected}
              onSelect={setPace}
              options={PACE_OPTIONS}
              placeholder={isRunningSelected ? 'เลือกเพซวิ่ง' : 'ไม่ต้องระบุ หากไม่ได้เลือกวิ่งออกกำลังกาย'}
              styles={styles}
              value={isRunningSelected ? pace : DEFAULT_PACE}
            />
          </View>
          <Field colors={colors} styles={styles} label="ทักษะเพิ่มเติม (ไม่บังคับ)" value={skill} onChangeText={setSkill} placeholder="เช่น โค้ชวิ่ง ถ่ายรูป เล่นดนตรี" />
          <View style={styles.fieldContainer}>
            <FormLabel label="ช่วงเวลาว่างสะดวก" required={isFirstSetup} styles={styles} />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="เลือกช่วงเวลาว่างสะดวก"
              style={[styles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
              onPress={() => setShowAvailabilityModal(true)}
            >
              <Text style={{ color: availabilitySlots.length > 0 ? colors.ink : colors.inkSoft }}>
                {availabilitySlots.length > 0 ? `เลือกไว้ ${availabilitySlots.length} ช่วงเวลา` : 'เลือกหลายวันและเวลา'}
              </Text>
              <Feather name="chevron-down" size={20} color={colors.inkSoft} />
            </TouchableOpacity>
          </View>
          <Field colors={colors} styles={styles} label="คำแนะนำตัวสั้น ๆ" required={isFirstSetup} value={bio} onChangeText={setBio} multiline inputStyle={styles.bioInput} placeholder="เล่าให้เพื่อนรู้จักคุณมากขึ้น" />
          </View>
          )}
        </Card>

        <Pressable accessibilityRole="button" onPress={() => router.push('/profile-visibility')} style={styles.visibilityEntry}>
          <FeatureIcon color={colors.primary} name="eye.fill" size={20} />
          <View style={styles.visibilityEntryCopy}>
            <Text style={styles.visibilityEntryTitle}>การแสดงโปรไฟล์</Text>
            <Text style={styles.visibilityEntrySubtitle}>ตั้งค่าข้อมูลที่ผู้ใช้อื่นมองเห็น</Text>
          </View>
          <FeatureIcon color={colors.inkSoft} name="chevron.right" size={19} />
        </Pressable>

        <Card style={styles.aboutSettingsCard}>
          <SettingsListRow icon="info.circle.fill" label={'\u0e40\u0e01\u0e35\u0e48\u0e22\u0e27\u0e01\u0e31\u0e1a CampusMate'} onPress={() => router.push('/about')} last />
        </Card>

        <Card style={styles.accountSettingsCard}>
          <Text style={styles.accountSettingsTitle}>ตั้งค่าบัญชี</Text>
          <SettingsListRow danger icon="trash.fill" label="ลบบัญชีอย่างถาวร" onPress={handleDeleteAccount} />
          <SettingsListRow danger icon="arrowshape.turn.up.left" label="ออกจากระบบ" onPress={onLogout} last />
        </Card>
      </ScrollView>
      <AvailabilityModal
        visible={showAvailabilityModal}
        onClose={() => setShowAvailabilityModal(false)}
        availabilitySlots={availabilitySlots}
        onSave={(slots) => {
          setAvailabilitySlots(slots);
          // Maintain legacy string for backward compatibility
          setAvailability(slots.length > 0 ? `ระบุ ${slots.length} ช่วงเวลา` : '');
        }}
      />
      {(
        <View style={[styles.stickySaveBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <PrimaryButton
            iconName="checkmark.circle.fill"
            label="บันทึกโปรไฟล์"
            loading={saving}
            onPress={handleSave}
            style={styles.stickySaveButton}
          />
        </View>
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
      <View style={[styles.settingsIcon, { backgroundColor: danger ? colors.dangerSoft : colors.primarySoft }]}>
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

function SectionToggleHeader({ colors, expanded, icon, onPress, required = false, subtitle, title }) {
  const styles = getStyles(colors);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.sectionToggleHeader}>
      <View style={styles.sectionToggleIcon}>
        <FeatureIcon color={colors.primary} name={icon} size={19} />
      </View>
      <View style={styles.sectionToggleCopy}>
        <Text style={styles.sectionToggleTitle}>{title}{required ? <Text style={styles.requiredMark}> {REQUIRED_MARK}</Text> : null}</Text>
        <Text style={styles.sectionToggleSubtitle}>{subtitle}</Text>
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

function AndroidSelectionRow({ icon, label, onSelect, options, placeholder, required = false, value }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <CustomDropdown
      colors={colors}
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
            <Text numberOfLines={1} style={value ? styles.fullRowDropdownValue : styles.fullRowDropdownPlaceholder}>
              {displayValue}
            </Text>
          </View>
        ) : (
          <Text style={value ? styles.dropdownButtonText : styles.dropdownButtonPlaceholder}>{displayValue}</Text>
        )}
        <FeatureIcon color={colors.inkSoft} name="chevron.down" size={15} />
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
            ]}
          >
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
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.md, paddingBottom: spacing.xxxl },
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
  interestGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: spacing.md },
  interestGridItem: { width: '50%', paddingHorizontal: 4, marginBottom: 8 },
  uniformInterestChip: { width: '100%', height: 46, justifyContent: 'center', alignItems: 'center' },
  formSectionSpacing: { marginTop: spacing.md },
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
  settingsRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 56, paddingHorizontal: spacing.lg },
  settingsIcon: { alignItems: 'center', borderRadius: 16, height: 32, justifyContent: 'center', marginRight: spacing.md, width: 32 },
  settingsLabel: { flex: 1, fontSize: type.body, fontWeight: '700' },
  settingsValue: { fontSize: type.caption, marginRight: spacing.sm },
  sectionToggleHeader: { alignItems: 'center', flexDirection: 'row', minHeight: 44 },
  sectionToggleIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 16, height: 32, justifyContent: 'center', marginRight: spacing.sm, width: 32 },
  sectionToggleCopy: { flex: 1 },
  sectionToggleTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  sectionToggleSubtitle: { color: colors.inkMuted, fontSize: type.caption2, marginTop: 1 },
  aboutSettingsCard: { marginTop: spacing.md, padding: 0 },
  accountSettingsCard: { marginTop: spacing.md, padding: 0 },
  stickySaveBar: { backgroundColor: colors.canvas, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, elevation: 8, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, shadowColor: '#000000', shadowOffset: { height: -3, width: 0 }, shadowOpacity: 0.12, shadowRadius: 8 },
  stickySaveButton: { alignSelf: 'stretch' },
  accountSettingsTitle: { color: colors.ink, fontSize: type.section, fontWeight: '900', paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  visibilityEntry: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', marginBottom: spacing.md, minHeight: 60, paddingHorizontal: spacing.md },
  visibilityEntryCopy: { flex: 1, marginLeft: spacing.md },
  visibilityEntryTitle: { color: colors.ink, fontSize: type.body, fontWeight: '900' },
  visibilityEntrySubtitle: { color: colors.inkMuted, fontSize: type.caption, marginTop: 2 },
});
