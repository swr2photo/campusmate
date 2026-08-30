import React, { useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
  Modal,
  Switch,
  useColorScheme,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { SymbolView } from 'expo-symbols';
import * as ImagePicker from 'expo-image-picker';
import { ACTIVITY_CATEGORIES } from '../data/activityCategories';
import { useApp } from '../context/AppContext';
import { Avatar, Card, Chip, OutlineButton, PrimaryButton, SectionTitle } from '../components/ui';
import { radius, spacing, type, useTheme } from '../theme';

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
const generateAvailabilityOptions = () => {
  const options = [];
  const now = new Date();
  const thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const thaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];

  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(now.getDate() + i);
    const dayName = thaiDays[d.getDay()];
    const dateNum = d.getDate();
    const monthName = thaiMonths[d.getMonth()];
    const prefix = i === 0 ? 'วันนี้' : i === 1 ? 'พรุ่งนี้' : `วัน${dayName}ที่ ${dateNum} ${monthName}`;
    
    options.push(`${prefix} · 17:00–19:00 (ช่วงเย็น)`);
    options.push(`${prefix} · 19:00–21:00 (ช่วงค่ำ)`);
    options.push(`${prefix} · 06:00–08:30 (ช่วงเช้า)`);
    options.push(`${prefix} · 13:00–16:00 (ช่วงบ่าย)`);
  }
  options.push('สะดวกตลอดเวลา');
  options.push('ช่วงเย็นทุกวัน (17:00 - 20:00)');
  options.push('วันเสาร์-อาทิตย์ ทั้งวัน');
  return options;
};

const AVAILABILITIES = generateAvailabilityOptions();

export default function ProfileScreen({ onLogout, onToast, overrideSave }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const { profile, saveProfile } = useApp();
  const [name, setName] = useState(profile.name || '');
  const [faculty, setFaculty] = useState(profile.faculty || FACULTIES[0]);
  const [year, setYear] = useState(profile.year || YEARS[0]);
  const [age, setAge] = useState(profile.age ? String(profile.age) : '');
  const [gender, setGender] = useState(profile.gender || 'unspecified');
  const [pace, setPace] = useState(profile.pace || '');
  const [availability, setAvailability] = useState(profile.availability || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [interests, setInterests] = useState(profile.interests || (profile.activities || (profile.activity ? [profile.activity] : [])));
  const [avatarUri, setAvatarUri] = useState(profile.avatarUri || null);
  const [discoverable, setDiscoverable] = useState(profile.isDiscoverable ?? false);
  const [notifications, setNotifications] = useState(profile.notificationsEnabled ?? true);
  const [privacy, setPrivacy] = useState(profile.privacy || {});

  const toggleInterest = (id) => {
    setInterests((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  };

  React.useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setFaculty(profile.faculty || 'คณะวิทยาศาสตร์');
      setYear(profile.year || 'ชั้นปีที่ 1');
      setAge(profile.age ? String(profile.age) : '');
      setGender(profile.gender || 'unspecified');
      setPace(profile.pace || '');
      setAvailability(profile.availability || '');
      setBio(profile.bio || '');
      setInterests(profile.interests || (profile.activities || (profile.activity ? [profile.activity] : [])));
      setAvatarUri(profile.avatarUri || null);
      setDiscoverable(profile.isDiscoverable ?? false);
      setNotifications(profile.notificationsEnabled ?? true);
      setPrivacy(profile.privacy || {});
    }
  }, [profile?.id]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });

    if (!result.canceled) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    try {
      const parsedAge = Number(age);
      if (age && (!Number.isInteger(parsedAge) || parsedAge < 18 || parsedAge > 100)) {
        throw new Error('กรุณาระบุอายุระหว่าง 18–100 ปี');
      }
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
        pace,
        availability,
        bio,
        interests: activities,
        avatarUri,
        isDiscoverable: discoverable,
        notificationsEnabled: notifications,
        privacy,
        matchingPreferences: {
          ...(profile.matchingPreferences || {}),
        },
      };
      if (overrideSave) await overrideSave(profileData);
      else await saveProfile(profileData);
      onToast?.('บันทึกโปรไฟล์เรียบร้อยแล้ว');
    } catch (error) {
      onToast?.(error.message || 'บันทึกโปรไฟล์ไม่สำเร็จ', 'info');
    }
  };

  const colorScheme = useColorScheme();
  const blurTint = colorScheme === 'dark' ? 'dark' : 'light';
  const blurIntensity = colorScheme === 'dark' ? 30 : 40;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <BlurView intensity={blurIntensity} tint={blurTint} style={{ zIndex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm }}>
        <Text style={styles.title}>โปรไฟล์ของฉัน</Text>
        <Text style={styles.subtitle}>ข้อมูลนี้ช่วยให้ระบบแนะนำเพื่อนที่เข้ากับคุณมากขึ้น</Text>
      </BlurView>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: spacing.md }]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        <Card style={styles.identityCard}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={{ width: 86, height: 86, borderRadius: 43 }} />
          ) : (
            <View style={{ width: 86, height: 86, borderRadius: 43, backgroundColor: colors.line, justifyContent: 'center', alignItems: 'center' }}>
              <SymbolView name="person.fill" size={50} tintColor={colors.inkSoft} />
            </View>
          )}
          <View style={styles.identityCopy}>
            <Text style={styles.identityName}>{name || 'ชื่อของคุณ'}</Text>
            <Text style={styles.identityEmail}>{profile.email}</Text>
            <View style={styles.verifiedPill}><Text style={styles.verifiedText}>✓ ยืนยันอีเมลแล้ว</Text></View>
          </View>
          <Pressable onPress={pickImage} style={styles.cameraButton}>
            <Text style={styles.cameraText}>📷</Text>
          </Pressable>
        </Card>

        <Card style={styles.formCard}>
          <SectionTitle title="ข้อมูลพื้นฐาน" subtitle="ข้อมูลที่ใช้แสดงบนการ์ดจับคู่" />
          <Field colors={colors} styles={styles} label="ชื่อ-นามสกุล (ชื่อเล่น)" value={name} onChangeText={setName} />

          <View style={styles.pickerContainer}>
            <Text style={styles.label}>คณะ</Text>
            <CustomDropdown colors={colors} styles={styles} value={faculty} onSelect={setFaculty} options={FACULTIES} placeholder="เลือกคณะ" />
          </View>

          <View style={styles.pickerContainer}>
            <Text style={styles.label}>ชั้นปี</Text>
            <CustomDropdown colors={colors} styles={styles} value={year} onSelect={setYear} options={YEARS} placeholder="เลือกชั้นปี" />
          </View>

          <View style={styles.pickerContainer}>
            <Text style={styles.label}>อายุ</Text>
            <CustomDropdown colors={colors} styles={styles} value={age || '20'} onSelect={setAge} options={AGES} placeholder="เลือกอายุ" />
          </View>
          <View style={styles.pickerContainer}>
            <Text style={styles.label}>เพศ</Text>
            <CustomDropdown colors={colors} styles={styles} value={gender} onSelect={setGender} options={GENDERS} placeholder="เลือกเพศ" />
          </View>
          

          <View style={styles.formSectionSpacing}>
            <SectionTitle title="กิจกรรมและไลฟ์สไตล์" subtitle="เลือกได้มากกว่าหนึ่งกิจกรรม" />
          </View>
          <View style={styles.interestRow}>
            {ACTIVITY_CATEGORIES.filter((category) => category.id !== 'all').map((category) => (
              <Chip
                key={category.id}
                active={interests.includes(category.id)}
                color={category.color}
                icon={category.icon}
                label={category.label}
                onPress={() => toggleInterest(category.id)}
                style={styles.interestChip}
              />
            ))}
          </View>

          <Field colors={colors} styles={styles} label="ระดับความเร็ว / ทักษะที่สนใจ" value={pace} onChangeText={setPace} placeholder="เช่น Pace 6:00 - 6:30 นาที/กม." />
          <View style={styles.fieldContainer}>
              <Text style={styles.label}>ช่วงเวลาว่างสะดวก</Text>
              <CustomDropdown colors={colors} styles={styles} value={availability} onSelect={setAvailability} options={AVAILABILITIES} placeholder="เลือกช่วงเวลา" />
            </View>
          <Field colors={colors} styles={styles} label="คำแนะนำตัวสั้น ๆ" value={bio} onChangeText={setBio} multiline inputStyle={styles.bioInput} placeholder="เล่าให้เพื่อนรู้จักคุณมากขึ้น" />



          <View style={styles.formSectionSpacing}>
            <SectionTitle title="ความเป็นส่วนตัว" subtitle="เลือกข้อมูลที่คนอื่นมองเห็นได้" />
          </View>
          <ToggleRow colors={colors} styles={styles} label="แสดงโปรไฟล์ในการค้นหา" value={discoverable} onChange={setDiscoverable} />
          <ToggleRow colors={colors} styles={styles} label="แสดงอายุ" value={privacy.showAge ?? true} onChange={(value) => setPrivacy((current) => ({ ...current, showAge: value }))} />
          <ToggleRow colors={colors} styles={styles} label="แสดงเพศ" value={privacy.showGender ?? true} onChange={(value) => setPrivacy((current) => ({ ...current, showGender: value }))} />
          <ToggleRow colors={colors} styles={styles} label="แสดงคณะและชั้นปี" value={privacy.showFaculty ?? true} onChange={(value) => setPrivacy((current) => ({ ...current, showFaculty: value }))} />
          <ToggleRow colors={colors} styles={styles} label="แสดงกิจกรรม" value={privacy.showActivity ?? true} onChange={(value) => setPrivacy((current) => ({ ...current, showActivity: value }))} />
          <ToggleRow colors={colors} styles={styles} label="แสดงเวลาที่สะดวก" value={privacy.showAvailability ?? true} onChange={(value) => setPrivacy((current) => ({ ...current, showAvailability: value }))} />
          
          <ToggleRow colors={colors} styles={styles} label="แจ้งเตือนข้อความและแมตช์" value={notifications} onChange={setNotifications} />
          <PrimaryButton label="บันทึกข้อมูลโปรไฟล์" icon="✓" onPress={handleSave} style={styles.saveButton} />
        </Card>

        <Card style={styles.securityCard}>
          <View style={styles.securityIcon}><Text style={styles.securityIconText}>🔒</Text></View>
          <View style={styles.securityCopy}>
            <Text style={styles.securityTitle}>ความเป็นส่วนตัวของคุณสำคัญ</Text>
            <Text style={styles.securityText}>เราจะแสดงข้อมูลโปรไฟล์กับผู้ใช้ที่จับคู่กันสำเร็จเท่านั้น</Text>
          </View>
        </Card>

        <OutlineButton danger icon="↪" label="ออกจากระบบ" onPress={onLogout} style={styles.logoutButton} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ colors, styles, label, value, onChangeText, placeholder, multiline = false, inputStyle, keyboardType }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
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

function CustomDropdown({ colors, styles, value, onSelect, options, placeholder }) {
  const [modalVisible, setModalVisible] = useState(false);
  const selectedOption = options.find((option) => (typeof option === 'string' ? option : option.value) === value);
  const selectedLabel = typeof selectedOption === 'string' ? selectedOption : selectedOption?.label;
  return (
    <View>
      <Pressable style={styles.dropdownButton} onPress={() => setModalVisible(true)}>
        <Text style={value ? styles.dropdownButtonText : styles.dropdownButtonPlaceholder}>
          {selectedLabel || value || placeholder}
        </Text>
        <Text style={styles.dropdownIcon}>▼</Text>
      </Pressable>
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{placeholder}</Text>
            <ScrollView style={styles.modalScroll}>
              {options.map((opt) => {
                const optionValue = typeof opt === 'string' ? opt : opt.value;
                const optionLabel = typeof opt === 'string' ? opt : opt.label;
                return (
                <Pressable
                  key={optionValue}
                  style={[styles.modalItem, value === optionValue && styles.modalItemActive]}
                  onPress={() => {
                    onSelect(optionValue);
                    setModalVisible(false);
                  }}
                >
                  <Text style={[styles.modalItemText, value === optionValue && styles.modalItemTextActive]}>
                    {optionLabel}
                  </Text>
                </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function ToggleRow({ colors, styles, label, onChange, value }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch onValueChange={onChange} trackColor={{ false: colors.line, true: colors.primary }} value={value} />
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  eyebrow: { color: colors.primary, fontSize: type.micro, fontWeight: '800', letterSpacing: 1, marginBottom: spacing.xs, textTransform: 'uppercase' },
  title: { color: colors.ink, fontSize: type.h1, fontWeight: '900', letterSpacing: -0.5, marginBottom: spacing.xs },
  subtitle: { color: colors.inkMuted, fontSize: type.body, lineHeight: 22, marginBottom: spacing.xl },
  identityCard: { alignItems: 'center', flexDirection: 'row', marginBottom: spacing.xl, padding: spacing.lg },
  identityCopy: { flex: 1, marginLeft: spacing.lg },
  identityName: { color: colors.ink, fontSize: type.section, fontWeight: '800', marginBottom: 2 },
  identityEmail: { color: colors.inkMuted, fontSize: type.caption, marginBottom: spacing.sm },
  verifiedPill: { alignSelf: 'flex-start', backgroundColor: colors.greenSoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  verifiedText: { color: colors.green, fontSize: type.micro, fontWeight: '700' },
  cameraButton: { alignItems: 'center', backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: 20, borderWidth: 1, height: 40, justifyContent: 'center', position: 'absolute', right: spacing.lg, top: spacing.lg, width: 40 },
  cameraText: { color: colors.ink, fontSize: 18 },
  formCard: { marginBottom: spacing.xl, padding: spacing.lg },
  field: { marginBottom: spacing.lg },
  label: { color: colors.ink, fontSize: type.caption, fontWeight: '700', marginBottom: spacing.sm },
  input: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, color: colors.ink, fontSize: type.body, minHeight: 48, paddingHorizontal: spacing.md },
  multilineInput: { minHeight: 100, paddingVertical: spacing.md },
  bioInput: { minHeight: 120 },
  pickerContainer: { marginBottom: spacing.lg },
  dropdownButton: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radius.md, borderWidth: 1, minHeight: 48, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownButtonText: { color: colors.ink, fontSize: type.body },
  dropdownButtonPlaceholder: { color: colors.inkSoft, fontSize: type.body },
  dropdownIcon: { color: colors.inkSoft, fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.xl },
  modalContent: { backgroundColor: colors.card, borderRadius: radius.lg, maxHeight: '80%', padding: spacing.lg, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 },
  modalTitle: { color: colors.ink, fontSize: type.h3, fontWeight: '800', marginBottom: spacing.md, textAlign: 'center' },
  modalScroll: { flexGrow: 0 },
  modalItem: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line },
  modalItemActive: { backgroundColor: colors.greenSoft, borderRadius: radius.sm, borderBottomWidth: 0, paddingHorizontal: spacing.sm },
  modalItemText: { color: colors.ink, fontSize: type.body, textAlign: 'center' },
  modalItemTextActive: { color: colors.primary, fontWeight: '800' },
  interestRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.xl },
  interestChip: { marginBottom: spacing.sm, marginRight: spacing.sm },
  formSectionSpacing: { marginTop: spacing.md },
  interestRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  interestChip: { marginBottom: spacing.sm, marginRight: spacing.sm, minHeight: 34, paddingHorizontal: 10 },
  field: { marginBottom: spacing.md },
  label: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '800', marginBottom: 6 },
  input: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radius.sm, borderWidth: 1, color: colors.ink, fontSize: type.body, minHeight: 46, paddingHorizontal: spacing.md, paddingVertical: 10 },
  multilineInput: { minHeight: 90 },
  bioInput: { lineHeight: 20 },
  saveButton: { marginTop: spacing.sm },
  toggleRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 52 },
  toggleLabel: { color: colors.ink, flex: 1, fontSize: type.body, marginRight: spacing.md },
  securityCard: { alignItems: 'center', backgroundColor: colors.greenSoft, borderColor: colors.greenSoft, flexDirection: 'row', marginTop: spacing.lg, padding: spacing.lg },
  securityIcon: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 20, height: 40, justifyContent: 'center', marginRight: spacing.md, width: 40 },
  securityIconText: { fontSize: 18 },
  securityCopy: { flex: 1 },
  securityTitle: { color: colors.green, fontSize: type.caption, fontWeight: '900' },
  securityText: { color: colors.green, fontSize: type.micro, lineHeight: 16, marginTop: 3 },
  logoutButton: { marginTop: spacing.lg },
});
