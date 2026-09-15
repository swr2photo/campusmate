import { useToast } from '../context/ToastContext';
import React, { useState } from 'react';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useRemoteImage } from '../utils/useRemoteImage';
import { Alert, Keyboard, Pressable, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import {
  Button,
  Form,
  Grid,
  Host,
  HStack,
  Image,
  Menu,
  ScrollView,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  useNativeState,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import AvailabilityModal from '../components/AvailabilityModal';
import { compressProfileImage, validateImageSize, MAX_PROFILE_IMAGE_SIZE_MB } from '../utils/compressImage';
import {
  aspectRatio,
  background,
  buttonBorderShape,
  buttonStyle,
  clipShape,
  clipped,
  contentShape,
  controlSize,
  font,
  foregroundStyle,
  frame,
  labelStyle,
  lineLimit,
  padding,
  resizable,
  scrollDismissesKeyboard,
  scrollIndicators,
  shadow,
  shapes,
  textFieldStyle,
  tint,
  toggleStyle,
} from '@expo/ui/swift-ui/modifiers';
import { useApp } from '../context/AppContext';

import { FACULTIES } from '../data/faculties';
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
const ACTIVITIES = [
  { label: 'วิ่ง', value: 'running', icon: 'figure.run' },
  { label: 'เข้ายิม / ฟิตเนส', value: 'gym', icon: 'figure.strengthtraining.traditional' },
  { label: 'เล่นกีฬา', value: 'sports', icon: 'sportscourt.fill' },
  { label: 'อ่านหนังสือ / ติวสอบ', value: 'study', icon: 'book.fill' },
  { label: 'คุยเล่น / คาเฟ่', value: 'chill', icon: 'cup.and.saucer.fill' },
  { label: 'กิจกรรมอื่น ๆ', value: 'other', icon: 'sparkles' },
];
const PACE_OPTIONS = [
  'ไม่ระบุ',
  'เดิน / เริ่มต้น',
  'Pace 8:00+ นาที/กม.',
  'Pace 7:00 - 8:00 นาที/กม.',
  'Pace 6:00 - 7:00 นาที/กม.',
  'Pace 5:00 - 6:00 นาที/กม.',
  'Pace ต่ำกว่า 5:00 นาที/กม.',
];
const AVAILABILITIES = ['ไม่ระบุ', 'ช่วงเช้า (06:00 - 12:00)', 'ช่วงบ่าย (12:00 - 18:00)', 'ช่วงเย็น (18:00 - 21:00)', 'ช่วงดึก (21:00 เป็นต้นไป)', 'สะดวกตลอดเวลา'];

const darkPalette = { background: '#14171B', surface: '#20242A', surfaceRaised: '#292E35', text: '#F7F8FA', secondary: '#B6BDC8', tertiary: '#7F8896', coral: '#FF7A6B', coralSoft: 'rgba(255,122,107,0.16)', violet: '#9A8CFF', violetSoft: 'rgba(154,140,255,0.16)', blue: '#62A8FF', blueSoft: 'rgba(98,168,255,0.16)', mint: '#45D1A1', mintSoft: 'rgba(69,209,161,0.16)' , purple: '#9A8CFF', card: '#20242A', white: '#FFFFFF', chip: '#292E35', circle: '#292E35'};
const lightPalette = { background: '#F6F8FC', surface: '#FFFFFF', surfaceRaised: '#F6F8FC', text: '#10203A', secondary: '#60708A', tertiary: '#8B98AC', coral: '#F47C6B', coralSoft: 'rgba(244,124,107,0.16)', violet: '#9A8CFF', violetSoft: 'rgba(154,140,255,0.16)', blue: '#3986E8', blueSoft: 'rgba(57,134,232,0.16)', mint: '#18A878', mintSoft: 'rgba(24,168,120,0.16)' , purple: '#5B5CE2', card: '#FFFFFF', white: '#FFFFFF', chip: '#EEF0FF', circle: '#E7EBF2'};
function usePalette() { const scheme = useColorScheme(); return scheme === 'dark' ? darkPalette : lightPalette; }

const cardShape = shapes.roundedRectangle({ cornerRadius: 24, roundedCornerStyle: 'continuous' });

export default function ProfileScreen({ onClose, onLogout, onToast, overrideSave, showHeader = true }) {
  const { showImageModeration } = useToast();
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { deleteAccount, profile, saveProfile } = useApp();
  const safeProfile = profile || {};
  const isFirstSetup = Boolean(overrideSave);
  const [name, setName] = useState(safeProfile.name || '');
  const [faculty, setFaculty] = useState(safeProfile.faculty || FACULTIES[0]);
  const [year, setYear] = useState(safeProfile.year || YEARS[0]);
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
  const [pace, setPace] = useState(safeProfile.pace || PACE_OPTIONS[0]);
  const [skill, setSkill] = useState(safeProfile.skill || '');
  const [availability, setAvailability] = useState(safeProfile.availability || '');
  const [availabilitySlots, setAvailabilitySlots] = useState(() => (
    Array.isArray(safeProfile.availabilitySlots) ? safeProfile.availabilitySlots : []
  ));
  const [showAvailabilityModal, setShowAvailabilityModal] = useState(false);
  const [bio, setBio] = useState(safeProfile.bio || '');
  const [avatarUri, setAvatarUri] = useState(safeProfile.avatarUri || null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const avatarDisplayUri = useRemoteImage(avatarUri, profile?.updatedAt, profile?.id);
  const [notifications, setNotifications] = useState(safeProfile.notificationsEnabled ?? true);
  const [discoverable, setDiscoverable] = useState(safeProfile.isDiscoverable ?? true);
  const [privacy, setPrivacy] = useState(safeProfile.privacy || {});
  
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

  React.useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setFaculty(profile.faculty || FACULTIES[0]);
      setYear(profile.year || YEARS[0]);
      setAge(profile.age ? String(profile.age) : '');
      setGender(profile.gender || '');
      setActivities(() => {
        if (Array.isArray(profile.activities) && profile.activities.length > 0) {
          return profile.activities;
        }
        if (profile.activity) {
          return [profile.activity];
        }
        return ['other'];
      });
      setPace(profile.pace || PACE_OPTIONS[0]);
      setSkill(profile.skill || '');
      setAvailability(profile.availability || '');
      setAvailabilitySlots(Array.isArray(profile.availabilitySlots) ? profile.availabilitySlots : []);
      setBio(profile.bio || '');
      setAvatarUri(profile.avatarUri || null);
      setNotifications(profile.notificationsEnabled ?? true);
      setDiscoverable(profile.isDiscoverable ?? true);
      setPrivacy(profile.privacy || {});
    }
  }, [profile]);

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
        return;
      }

      try {
        const compressedUri = await compressProfileImage(asset.uri);
        setAvatarUri(compressedUri);
      } catch (compressionError) {
        console.warn('[Profile.ios] Image compression failed:', compressionError);
        Alert.alert(
          'ไม่สามารถประมวลผลรูปภาพได้',
          compressionError.message || 'เกิดข้อผิดพลาดในการปรับขนาดรูปภาพ กรุณาลองเลือกรูปภาพใหม่อีกครั้ง'
        );
      }
    } catch (error) {
      console.error('[Profile.ios] Image picking error:', error);
      Alert.alert('เกิดข้อผิดพลาด', 'ไม่สามารถเปิดเลือกรูปภาพได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (isProcessingImage) {
      Alert.alert('กำลังประมวลผลรูปภาพ', 'กรุณารอสักครู่ก่อนบันทึกโปรไฟล์');
      return;
    }
    setSaving(true);
    try {
      if (!name || name.trim().length < 2) {
        throw new Error('กรุณากรอกชื่อของคุณ (อย่างน้อย 2 ตัวอักษร)');
      }
      if (!faculty || faculty === 'all') {
        throw new Error('กรุณาเลือกคณะของคุณ');
      }
      if (!gender) {
        throw new Error('กรุณาเลือกเพศของคุณ');
      }
      if (!year) {
        throw new Error('กรุณาเลือกชั้นปี');
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
      if (isFirstSetup && (!pace || pace === PACE_OPTIONS[0])) {
        throw new Error('กรุณาเลือกเพซหรือระดับกิจกรรมของคุณ');
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
      const profileData = {
        name,
        faculty,
        year,
        age: age ? parsedAge : null,
        gender,
        activity: activities[0] || 'other',
        activities,
        activityLabel,
        pace: pace === PACE_OPTIONS[0] ? '' : pace,
        skill,
        availability,
        availabilitySlots,
        bio,
        avatarUri,
        notificationsEnabled: notifications,
        isDiscoverable: discoverable,
        privacy,
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

  const handleDeleteAccount = () => {
    Alert.alert(
      'ยืนยันการลบบัญชี',
      'ข้อมูลโปรไฟล์ ข้อความแชท และการจับคู่จะถูกลบอย่างถาวรและไม่สามารถกู้คืนได้',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบบัญชี',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
            } catch (error) {
              onToast?.(error.message || 'ลบบัญชีไม่สำเร็จ', 'info');
            }
          },
        },
      ]
    );
  };

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
                    โปรไฟล์และการตั้งค่า
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
                <Image color={palette.coral} size={14} systemName="person.text.rectangle.fill" />
                <Text modifiers={[font({ weight: 'bold' })]}>ข้อมูลโปรไฟล์</Text>
              </HStack>
            }
            footer={<Text>ข้อมูลพื้นฐานที่จะแสดงให้เพื่อนร่วมมหาวิทยาลัยเห็น</Text>}
          >
            <NativeField label="ชื่อที่แสดง" onChange={setName} systemImage="person.fill" value={name} />
            <SelectionRow label="คณะ" options={FACULTIES} onSelect={setFaculty} systemImage="building.columns.fill" value={faculty} />
            <SelectionRow label="ชั้นปี" options={YEARS} onSelect={setYear} systemImage="graduationcap.fill" value={year} />
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
            <MultiActivityPicker onToggle={toggleActivity} options={ACTIVITIES} palette={palette} selected={activities} />
            <SelectionRow label="เพซวิ่ง" options={PACE_OPTIONS} onSelect={setPace} systemImage="speedometer" value={pace || PACE_OPTIONS[0]} />
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

            <NativeField label="แนะนำตัวสั้น ๆ" multiline onChange={setBio} systemImage="text.quote" value={bio} />
          </Section>

          <Section
            header={
              <HStack spacing={6}>
                <Image color={palette.coral} size={14} systemName="bell.badge.fill" />
                <Text modifiers={[font({ weight: 'bold' })]}>การแจ้งเตือน</Text>
              </HStack>
            }
            footer={<Text>รับการแจ้งเตือนเมื่อมีเพื่อนส่งข้อความหรือตอบรับกิจกรรม</Text>}
          >
            <SettingToggle
              isOn={notifications}
              label="การแจ้งเตือนข้อความและแมตช์"
              onChange={setNotifications}
              systemImage="bell.fill"
            />
          </Section>

          <Section
            header={
              <HStack spacing={6}>
                <Image color={palette.coral} size={14} systemName="eye.fill" />
                <Text modifiers={[font({ weight: 'bold' })]}>การแสดงโปรไฟล์</Text>
              </HStack>
            }
            footer={<Text>กำหนดข้อมูลที่ผู้ใช้อื่นจะเห็นบนโปรไฟล์ของคุณ</Text>}
          >
            <LegalRow label="เปิดหน้าตั้งค่าการแสดงโปรไฟล์" systemImage="eye.fill" onPress={() => router.push('/profile-visibility')} />
          </Section>

          <Section>
            <AccountActionRow label="เกี่ยวกับ CampusMate" onPress={() => router.push('/about')} systemImage="info.circle.fill" />
          </Section>

          <Section>
            <Text modifiers={[font({ textStyle: 'headline', weight: 'bold' }), foregroundStyle(palette.text), padding({ top: 8, bottom: 6 })]}>
              ตั้งค่าบัญชี
            </Text>
            <AccountActionRow label="ลบบัญชีอย่างถาวร" onPress={handleDeleteAccount} systemImage="trash.fill" />
            <AccountActionRow label="ออกจากระบบ" onPress={onLogout} systemImage="rectangle.portrait.and.arrow.right" />
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
    </Pressable>
  );
}

function AccountActionRow({ label, onPress, systemImage }) {
  const palette = usePalette();
  return (
    <Button onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity })]}>
      <HStack spacing={10} modifiers={[padding({ vertical: 12, horizontal: 4 }), frame({ maxWidth: Infinity })]}>
        <Image color={palette.coral} size={17} systemName={systemImage} />
        <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(palette.coral), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          {label}
        </Text>
        <Image color={palette.coral} size={13} systemName="chevron.right" />
      </HStack>
    </Button>
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

function SettingToggle({ isOn, label, onChange, systemImage }) {
  const palette = usePalette();
  return (
    <Toggle
      isOn={isOn}
      label={label}
      onIsOnChange={onChange}
      systemImage={systemImage}
      modifiers={[
        toggleStyle('switch'),
        tint(palette.coral),
        frame({ maxWidth: Infinity }),
      ]}
    />
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

function MultiActivityPicker({ options, selected, onToggle, palette }) {
  const rows = [];
  for (let i = 0; i < options.length; i += 2) {
    rows.push(options.slice(i, i + 2));
  }

  return (
    <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 4 })]}>
      <HStack spacing={6}>
        <Image color={palette.coral} size={15} systemName="figure.run" />
        <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(palette.secondary)]}>
          กิจกรรมที่ชอบ (เลือกได้หลายข้อ)
        </Text>
      </HStack>
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
