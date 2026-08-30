import React, { useState } from 'react';
import { useRemoteImage } from '../utils/useRemoteImage';
import { Keyboard, Pressable, View, useColorScheme } from 'react-native';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import {
  BottomSheet,
  Button,
  DatePicker,
  Form,
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
import {
  aspectRatio,
  background,
  buttonBorderShape,
  buttonStyle,
  clipShape,
  clipped,
  contentShape,
  controlSize,
  datePickerStyle,
  font,
  foregroundStyle,
  frame,
  labelStyle,
  lineLimit,
  padding,
  presentationDetents,
  presentationDragIndicator,
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
import { formatReadableDate } from '../utils/formatters';

import { FACULTIES } from '../data/faculties';
const YEARS = ['ชั้นปีที่ 1', 'ชั้นปีที่ 2', 'ชั้นปีที่ 3', 'ชั้นปีที่ 4', 'ปริญญาโท', 'ปริญญาเอก'];
const AGES = Array.from({ length: 17 }, (_, i) => ({
  label: `${i + 19} ปี`,
  value: String(i + 19),
}));
const GENDERS = [
  { label: 'ชาย', value: 'male' },
  { label: 'หญิง', value: 'female' },
  { label: 'นอนไบนารี', value: 'nonbinary' },
  { label: 'ไม่ระบุ', value: 'unspecified' },
];
const ACTIVITIES = [
  { label: 'วิ่ง', value: 'running', icon: 'figure.run' },
  { label: 'เข้ายิม / ฟิตเนส', value: 'gym', icon: 'figure.strengthtraining.traditional' },
  { label: 'เล่นกีฬา', value: 'sports', icon: 'sportscourt.fill' },
  { label: 'อ่านหนังสือ / ติวสอบ', value: 'study', icon: 'book.fill' },
  { label: 'คุยเล่น / คาเฟ่', value: 'chill', icon: 'cup.and.saucer.fill' },
  { label: 'กิจกรรมอื่น ๆ', value: 'other', icon: 'sparkles' },
];
const AVAILABILITIES = ['ไม่ระบุ', 'ช่วงเช้า (06:00 - 12:00)', 'ช่วงบ่าย (12:00 - 18:00)', 'ช่วงเย็น (18:00 - 21:00)', 'ช่วงดึก (21:00 เป็นต้นไป)', 'สะดวกตลอดเวลา'];

const darkPalette = { background: '#14171B', surface: '#20242A', surfaceRaised: '#292E35', text: '#F7F8FA', secondary: '#B6BDC8', tertiary: '#7F8896', coral: '#FF7A6B', coralSoft: 'rgba(255,122,107,0.16)', violet: '#9A8CFF', violetSoft: 'rgba(154,140,255,0.16)', blue: '#62A8FF', blueSoft: 'rgba(98,168,255,0.16)', mint: '#45D1A1', mintSoft: 'rgba(69,209,161,0.16)' , purple: '#9A8CFF', card: '#20242A', white: '#FFFFFF', chip: '#292E35', circle: '#292E35'};
const lightPalette = { background: '#F6F8FC', surface: '#FFFFFF', surfaceRaised: '#F6F8FC', text: '#10203A', secondary: '#60708A', tertiary: '#8B98AC', coral: '#F47C6B', coralSoft: 'rgba(244,124,107,0.16)', violet: '#9A8CFF', violetSoft: 'rgba(154,140,255,0.16)', blue: '#3986E8', blueSoft: 'rgba(57,134,232,0.16)', mint: '#18A878', mintSoft: 'rgba(24,168,120,0.16)' , purple: '#5B5CE2', card: '#FFFFFF', white: '#FFFFFF', chip: '#EEF0FF', circle: '#E7EBF2'};
function usePalette() { const scheme = useColorScheme(); return scheme === 'dark' ? darkPalette : lightPalette; }

const cardShape = shapes.roundedRectangle({ cornerRadius: 24, roundedCornerStyle: 'continuous' });

export default function ProfileScreen({ onClose, onLogout, onToast, overrideSave }) {
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const { profile, saveProfile } = useApp();
  const [name, setName] = useState(profile.name || '');
  const [faculty, setFaculty] = useState(profile.faculty || FACULTIES[0]);
  const [year, setYear] = useState(profile.year || YEARS[0]);
  const [age, setAge] = useState(profile.age ? String(profile.age) : '');
  const [gender, setGender] = useState(profile.gender || 'unspecified');
  const [activities, setActivities] = useState(() => {
    if (Array.isArray(profile.activities) && profile.activities.length > 0) {
      return profile.activities;
    }
    if (profile.activity) {
      return [profile.activity];
    }
    return ['other'];
  });
  const [availability, setAvailability] = useState(profile.availability || '');
  const [showAvailabilitySheet, setShowAvailabilitySheet] = useState(false);
  const [availDate, setAvailDate] = useState(new Date());
  const [availStart, setAvailStart] = useState(() => {
    const d = new Date();
    d.setHours(17, 0, 0, 0);
    return d;
  });
  const [availEnd, setAvailEnd] = useState(() => {
    const d = new Date();
    d.setHours(19, 0, 0, 0);
    return d;
  });
  const [bio, setBio] = useState(profile.bio || '');
  const [avatarUri, setAvatarUri] = useState(profile.avatarUri || null);
  const avatarDisplayUri = useRemoteImage(avatarUri);
  const [notifications, setNotifications] = useState(profile.notificationsEnabled ?? true);
  const [discoverable, setDiscoverable] = useState(profile.isDiscoverable ?? false);
  const [privacy, setPrivacy] = useState(profile.privacy || {});
  
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

  const confirmAvailability = () => {
    const year = availDate.getFullYear();
    const month = String(availDate.getMonth() + 1).padStart(2, '0');
    const day = String(availDate.getDate()).padStart(2, '0');
    const isoDate = `${year}-${month}-${day}`;
    const formatTime = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const readable = `${formatReadableDate(isoDate)} · ${formatTime(availStart)}–${formatTime(availEnd)}`;
    setAvailability(readable);
    setShowAvailabilitySheet(false);
  };

  const applyQuickSlot = (startH, endH) => {
    const s = new Date(availDate);
    s.setHours(startH, 0, 0, 0);
    const e = new Date(availDate);
    e.setHours(endH, 0, 0, 0);
    setAvailStart(s);
    setAvailEnd(e);
    const year = availDate.getFullYear();
    const month = String(availDate.getMonth() + 1).padStart(2, '0');
    const day = String(availDate.getDate()).padStart(2, '0');
    const isoDate = `${year}-${month}-${day}`;
    const readable = `${formatReadableDate(isoDate)} · ${String(startH).padStart(2, '0')}:00–${String(endH).padStart(2, '0')}:00`;
    setAvailability(readable);
    setShowAvailabilitySheet(false);
  };

  React.useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setFaculty(profile.faculty || FACULTIES[0]);
      setYear(profile.year || YEARS[0]);
      setAge(profile.age ? String(profile.age) : '');
      setGender(profile.gender || 'unspecified');
      setActivities(() => {
        if (Array.isArray(profile.activities) && profile.activities.length > 0) {
          return profile.activities;
        }
        if (profile.activity) {
          return [profile.activity];
        }
        return ['other'];
      });
      setAvailability(profile.availability || '');
      setBio(profile.bio || '');
      setAvatarUri(profile.avatarUri || null);
      setNotifications(profile.notificationsEnabled ?? true);
      setDiscoverable(profile.isDiscoverable ?? false);
      setPrivacy(profile.privacy || {});
    }
  }, [profile?.id]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      base64: true,
    });

    if (!result.canceled) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const parsedAge = Number(age);
      if (age && (!Number.isInteger(parsedAge) || parsedAge < 18 || parsedAge > 100)) {
        throw new Error('กรุณาระบุอายุระหว่าง 18–100 ปี');
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
        availability,
        bio,
        avatarUri,
        notificationsEnabled: notifications,
        isDiscoverable: discoverable,
        privacy,
        matchingPreferences: {
          ...(profile.matchingPreferences || {}),
        },
      };
      if (overrideSave) await overrideSave(profileData);
      else await saveProfile(profileData);
      onToast?.('บันทึกโปรไฟล์เรียบร้อยแล้ว');
      if (onClose) onClose();
    } catch (error) {
      onToast?.(error.message || 'ยังบันทึกโปรไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    } finally {
      setSaving(false);
    }
  };


  const blurIntensity = colorScheme === 'dark' ? 30 : 40;

  return (
    <Pressable onPress={Keyboard.dismiss} style={{ flex: 1, backgroundColor: palette.background }}>
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
            <HStack modifiers={[frame({ maxWidth: Infinity })]}>
              <Text modifiers={[font({ textStyle: 'title2', weight: 'bold', design: 'rounded' }), foregroundStyle(palette.text)]}>
                โปรไฟล์และการตั้งค่า
              </Text>
              <Spacer />
              {onClose && (
                <Button
                  label="ปิด"
                  onPress={onClose}
                  systemImage="xmark"
                  modifiers={[
                    buttonStyle('glass'),
                    buttonBorderShape('circle'),
                    controlSize('large'),
                    labelStyle('iconOnly'),
                  ]}
                />
              )}
            </HStack>
          </VStack>
        </Host>
      </View>
      <Host colorScheme={colorScheme} seedColor={palette.coral} style={{ flex: 1 }}>
        <ScrollView showsIndicators={false} modifiers={[scrollIndicators('never', 'vertical'), scrollDismissesKeyboard('immediately')]}>
          <VStack
            alignment="leading"
            spacing={18}
            modifiers={[
              padding({ top: 60, bottom: 42, horizontal: 20 }),
              frame({ maxWidth: Infinity, alignment: 'topLeading' }),
            ]}
          >

            <ProfileIdentity
              avatarUri={avatarDisplayUri}
              email={profile.email}
              name={name || profile.nickname || 'โปรไฟล์ของคุณ'}
              onPickImage={pickImage}
            />

            <SettingsCard title="ข้อมูลโปรไฟล์" systemImage="person.text.rectangle.fill">
              <NativeField label="ชื่อที่แสดง" onChange={setName} systemImage="person.fill" value={name} />
              <SelectionRow label="คณะ" options={FACULTIES} onSelect={setFaculty} systemImage="building.columns.fill" value={faculty} />
              <SelectionRow label="ชั้นปี" options={YEARS} onSelect={setYear} systemImage="graduationcap.fill" value={year} />
              <SelectionRow label="อายุ" options={AGES} onSelect={setAge} systemImage="calendar" value={age || '20'} />
              <SelectionRow label="เพศ" options={GENDERS} onSelect={setGender} systemImage="person.2.fill" value={gender} />
              <MultiActivityPicker onToggle={toggleActivity} options={ACTIVITIES} palette={palette} selected={activities} />
              <Button
                onPress={() => setShowAvailabilitySheet(true)}
                modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity })]}
              >
                <HStack
                  spacing={10}
                  modifiers={[
                    padding({ all: 12 }),
                    background(palette.surfaceRaised, shapes.roundedRectangle({ cornerRadius: 14 })),
                    frame({ maxWidth: Infinity }),
                  ]}
                >
                  <Image color={palette.coral} size={17} systemName="calendar.badge.clock" />
                  <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                    <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>
                      ช่วงเวลาที่สะดวก
                    </Text>
                    <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(palette.text), lineLimit(1)]}>
                      {availability || 'แตะเพื่อเลือกวันและเวลาที่สะดวก'}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Image color={palette.tertiary} size={13} systemName="chevron.right" />
                </HStack>
              </Button>
              <NativeField label="แนะนำตัวสั้น ๆ" multiline onChange={setBio} systemImage="text.quote" value={bio} />
            </SettingsCard>

            <SettingsCard title="ความเป็นส่วนตัว" systemImage="hand.raised.fill">
              <SettingToggle
                isOn={discoverable}
                label="แสดงโปรไฟล์ในการค้นหา"
                onChange={setDiscoverable}
                systemImage="eye.fill"
              />
              <SettingToggle
                isOn={privacy.showAge ?? true}
                label="แสดงอายุ"
                onChange={(value) => setPrivacy((current) => ({ ...current, showAge: value }))}
                systemImage="calendar"
              />
              <SettingToggle
                isOn={privacy.showGender ?? true}
                label="แสดงเพศ"
                onChange={(value) => setPrivacy((current) => ({ ...current, showGender: value }))}
                systemImage="person.2.fill"
              />
              <SettingToggle
                isOn={privacy.showFaculty ?? true}
                label="แสดงคณะและชั้นปี"
                onChange={(value) => setPrivacy((current) => ({ ...current, showFaculty: value }))}
                systemImage="graduationcap.fill"
              />
              <SettingToggle
                isOn={privacy.showActivity ?? true}
                label="แสดงกิจกรรมที่ชอบ"
                onChange={(value) => setPrivacy((current) => ({ ...current, showActivity: value }))}
                systemImage="figure.run"
              />
              <SettingToggle
                isOn={privacy.showAvailability ?? true}
                label="แสดงเวลาที่สะดวก"
                onChange={(value) => setPrivacy((current) => ({ ...current, showAvailability: value }))}
                systemImage="clock.fill"
              />
              <SettingToggle
                isOn={notifications}
                label="การแจ้งเตือนข้อความและแมตช์"
                onChange={setNotifications}
                systemImage="bell.fill"
              />
            </SettingsCard>

            <Button
              label={saving ? 'กำลังบันทึก' : 'บันทึกการเปลี่ยนแปลง'}
              onPress={handleSave}
              systemImage={saving ? 'hourglass' : 'checkmark.circle.fill'}
              modifiers={[
                buttonStyle('glassProminent'),
                buttonBorderShape('capsule'),
                controlSize('large'),
                tint(palette.coral),
                frame({ maxWidth: Infinity }),
              ]}
            />

            <Button
              label="ออกจากระบบ"
              onPress={onLogout}
              role="destructive"
              systemImage="rectangle.portrait.and.arrow.right"
              modifiers={[
                buttonStyle('glass'),
                buttonBorderShape('capsule'),
                controlSize('large'),
                tint(palette.coral),
                frame({ maxWidth: Infinity }),
              ]}
            />
          </VStack>
        </ScrollView>

        <BottomSheet
          isPresented={showAvailabilitySheet}
          onIsPresentedChange={setShowAvailabilitySheet}
          modifiers={[
            presentationDetents(['large']),
            presentationDragIndicator('visible'),
          ]}
        >
          <VStack style={{ flex: 1 }}>
            <Text
              modifiers={[
                font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }),
                padding({ top: 16, bottom: 2, horizontal: 20 }),
                frame({ maxWidth: Infinity, alignment: 'center' }),
              ]}
            >
              ตั้งค่าช่วงเวลาที่สะดวก
            </Text>
            <Text
              modifiers={[
                font({ textStyle: 'caption', weight: 'medium' }),
                foregroundStyle(palette.secondary),
                padding({ bottom: 8, horizontal: 20 }),
                frame({ maxWidth: Infinity, alignment: 'center' }),
              ]}
            >
              เลือกวันและช่วงเวลาที่พร้อมทำกิจกรรมร่วมกับเพื่อน
            </Text>

            <Form>
              <Section header={<Text>เลือกวัน</Text>}>
                <DatePicker
                  title="วันที่"
                  selection={availDate}
                  onDateChange={setAvailDate}
                  displayedComponents={['date']}
                  modifiers={[datePickerStyle('compact')]}
                />
              </Section>
              <Section header={<Text>เลือกเวลา</Text>}>
                <DatePicker
                  title="เวลาเริ่ม"
                  selection={availStart}
                  onDateChange={setAvailStart}
                  displayedComponents={['hourAndMinute']}
                  modifiers={[datePickerStyle('compact')]}
                />
                <DatePicker
                  title="เวลาสิ้นสุด"
                  selection={availEnd}
                  onDateChange={setAvailEnd}
                  displayedComponents={['hourAndMinute']}
                  modifiers={[datePickerStyle('compact')]}
                />
              </Section>
              <Section header={<Text>ตัวเลือกช่วงเวลายอดนิยม</Text>}>
                <Button
                  label="ช่วงเช้า (06:00 - 12:00)"
                  onPress={() => applyQuickSlot(6, 12)}
                  systemImage="sunrise.fill"
                />
                <Button
                  label="ช่วงบ่าย (12:00 - 18:00)"
                  onPress={() => applyQuickSlot(12, 18)}
                  systemImage="sun.max.fill"
                />
                <Button
                  label="ช่วงเย็น (18:00 - 21:00)"
                  onPress={() => applyQuickSlot(18, 21)}
                  systemImage="sunset.fill"
                />
                <Button
                  label="สะดวกตลอดเวลา"
                  onPress={() => {
                    setAvailability('สะดวกตลอดเวลา');
                    setShowAvailabilitySheet(false);
                  }}
                  systemImage="sparkles"
                />
              </Section>
            </Form>

            <Button
              label="บันทึกช่วงเวลาที่สะดวก"
              onPress={confirmAvailability}
              systemImage="checkmark.circle.fill"
              modifiers={[
                buttonStyle('glassProminent'),
                buttonBorderShape('capsule'),
                controlSize('regular'),
                tint(palette.coral),
                padding({ horizontal: 20, bottom: 24, top: 8 }),
                frame({ maxWidth: Infinity }),
              ]}
            />
          </VStack>
        </BottomSheet>
      </Host>
    </Pressable>
  );
}

function ProfileIdentity({ avatarUri, email, name, onPickImage }) {
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

  return (
    <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: Infinity })]}>
      <HStack spacing={6}>
        <Image color={palette.tertiary} size={13} systemName={systemImage} />
        <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(palette.secondary)]}>
          {label}
        </Text>
      </HStack>
      <TextField
        axis={multiline ? 'vertical' : 'horizontal'}
        onTextChange={onChange}
        placeholder={label}
        modifiers={[
          textFieldStyle('roundedBorder'),
          frame({ minHeight: multiline ? 86 : 46, maxWidth: Infinity }),
          lineLimit(multiline ? 4 : 1),
        ]}
        text={nativeText}
      />
    </VStack>
  );
}

function SelectionRow({ label, onSelect, options, systemImage, value }) {
  const palette = usePalette();
  const selectedLabel = options.find((option) => (typeof option === 'string' ? option : option.value) === value);
  const displayValue = typeof selectedLabel === 'string' ? selectedLabel : selectedLabel?.label || value;
  return (
    <Menu
      label={(
        <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
          <Image color={palette.coral} size={17} systemName={systemImage} />
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>{label}</Text>
            <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(palette.text), lineLimit(1)]}>{displayValue}</Text>
          </VStack>
          <Spacer />
          <Image color={palette.tertiary} size={13} systemName="chevron.up.chevron.down" />
        </HStack>
      )}
      modifiers={[
        padding({ all: 12 }),
        background(palette.surfaceRaised, shapes.roundedRectangle({ cornerRadius: 14 })),
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
      <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        {rows.map((pair, rowIndex) => (
          <HStack key={rowIndex} spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
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
              <Spacer />
            )}
          </HStack>
        ))}
      </VStack>
    </VStack>
  );
}

function ActivityChip({ item, isSelected, onPress, palette }) {
  const chipBg = isSelected ? palette.coral : palette.surfaceRaised;
  const textColor = isSelected ? palette.white : palette.text;
  const iconColor = isSelected ? palette.white : palette.secondary;

  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        frame({ maxWidth: Infinity }),
        contentShape(shapes.roundedRectangle({ cornerRadius: 14, roundedCornerStyle: 'continuous' })),
      ]}
    >
      <HStack
        alignment="center"
        spacing={7}
        modifiers={[
          frame({ maxWidth: Infinity, height: 42 }),
          padding({ horizontal: 12 }),
          background(chipBg, shapes.roundedRectangle({ cornerRadius: 14, roundedCornerStyle: 'continuous' })),
        ]}
      >
        <Image color={iconColor} size={14} systemName={isSelected ? 'checkmark.circle.fill' : item.icon} />
        <Text modifiers={[font({ textStyle: 'subheadline', weight: isSelected ? 'bold' : 'medium' }), foregroundStyle(textColor), lineLimit(1)]}>
          {item.label}
        </Text>
      </HStack>
    </Button>
  );
}
